import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KERNEL_PIN, sha256 } from '../host/config.js';
import { alive, delay } from '../host/private.js';
import type { Ready } from '../host/runtime.js';
const exec = promisify(execFile);

// Protocol-only process fixtures: no model, Harness database or user session.
test(
  'CLI detaches, prevents duplicate startup, keeps service after observer disconnect and stops all owned children',
  { timeout: 30000 },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'tekes-cli-')));
    const runtime = join(root, 'runtime'),
      binary = join(root, 'kernel'),
      web = join(root, 'web'),
      workspace = join(root, 'workspace');
    let ready: Ready | undefined;
    const cli = resolve('dist-host/cli.js');
    const invoke = (command: string, args: string[] = []) =>
      exec(
        process.execPath,
        [cli, command, '--runtime-dir', runtime, ...args],
        {
          timeout: 20000,
          env: {
            ...process.env,
            TEKES_FIXTURE_KEY: 'fixture-private-pipe-value',
          },
        },
      );
    try {
      for (const path of [binary, web, workspace]) await mkdir(path);
      await writeFile(join(web, 'index.html'), '<p>fixture</p>');
      const kernelSource = `#!/usr/bin/env node
if (process.argv.includes('--describe-build')) {
 console.log(JSON.stringify({version:${JSON.stringify(KERNEL_PIN.version)},source_revision:${JSON.stringify(KERNEL_PIN.revision)}}));
} else {
 let data=Buffer.alloc(0), sent=false;
 process.stdin.on('data', part=>{data=Buffer.concat([data,part]);
 const head=Buffer.from('TEKES-KERNEL-BOOTSTRAP/1\\n');
 if (!sent && data.length>=head.length+4 && data.length>=head.length+4+data.readUInt32BE(head.length)) {
 sent=true; console.log(JSON.stringify({protocolVersion:4,url:'http://127.0.0.1:1'}));
 }});
 process.stdin.on('end',()=>process.exit(0));
}
`;
      const binaries: Record<string, { sha256: string }> = {};
      for (const name of [
        'tekes-supervisor',
        'tekes-worker',
        'tekes-helper',
        'tekes-workspace-service',
      ]) {
        await writeFile(join(binary, name), kernelSource, { mode: 0o700 });
        binaries[name] = { sha256: sha256(Buffer.from(kernelSource)) };
      }
      await writeFile(
        join(binary, 'BuildProvenance.json'),
        JSON.stringify({ kernel: KERNEL_PIN, binaries }),
      );
      const bridge = join(root, 'fixture-agentkit');
      await writeFile(
        bridge,
        `#!/usr/bin/env node
const readline=require('node:readline'); let config;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const msg=JSON.parse(line); if(!config){config=msg;return;}
 if(msg.op==='cancelObservation')return;
 const value=msg.op==='endpoints'?config.endpoints.map(e=>({...e,connection:'ready',capabilities:{}})):{};
 console.log(JSON.stringify({id:msg.id,value}));
 if(msg.op!=='follow')console.log(JSON.stringify({id:msg.id,done:true}));
}).on('close',()=>process.exit(0));
`,
        { mode: 0o700 },
      );
      const settings = join(root, 'settings.json');
      await writeFile(
        settings,
        JSON.stringify({
          providers: [
            {
              id: 'fixture',
              providerID: 'deepseek',
              api: 'deepseek-responses',
              connectionMode: 'direct',
              baseURL: 'https://example.invalid',
              models: [{ id: 'protocol-fixture' }],
            },
          ],
          agentSelections: { tekes: { providerIDs: ['fixture'] } },
        }),
      );
      const args = [
        '--agentkit-source',
        root,
        '--agentkit-binary',
        bridge,
        '--kernel-binary-dir',
        binary,
        '--kernel-data-root',
        join(root, 'owned-kernel-data'),
        '--web-root',
        web,
        '--workspace',
        workspace,
        '--settings',
        settings,
        '--credential-env',
        'TEKES_FIXTURE_KEY',
        '--pi-registry',
        join(root, 'absent-registry'),
        '--port',
        '0',
      ];
      const result = await invoke('start', args);
      assert.equal(result.stdout.includes('fixture-private-pipe-value'), false);
      ready = JSON.parse(result.stdout) as Ready;
      assert.ok(alive(ready.pid));
      assert.ok(alive(ready.kernelPid!));
      assert.ok(alive(ready.agentkitPid!));
      assert.equal(
        JSON.parse((await invoke('status')).stdout).instance,
        ready.instance,
      );
      await assert.rejects(invoke('start', args), /already running/);
      const launcher = await readFile(
        join(runtime, 'open-browser.html'),
        'utf8',
      );
      const token = /#([^"<>]+)/.exec(launcher)![1];
      const request = (op: string) =>
        fetch(ready!.url + '/api', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ op }),
        });
      const response = await request('follow');
      const reader = response.body!.getReader();
      assert.ok((await reader.read()).value?.length);
      await reader.cancel();
      assert.equal((await request('endpoints')).status, 200);
      assert.ok(alive(ready.pid));
      const descriptor = JSON.parse(
        await readFile(join(runtime, 'app-connection.json'), 'utf8'),
      );
      assert.notEqual(descriptor.bearer, token);
      assert.equal((await fetch(ready.url + '/')).status, 200);
      assert.equal(
        (await readFile(join(runtime, 'start-options.json'), 'utf8')).includes(
          'fixture-private-pipe-value',
        ),
        false,
      );
      await invoke('stop');
      assert.equal(JSON.parse((await invoke('status')).stdout).running, false);
      for (let n = 0; n < 50 && alive(ready.pid); n++) await delay(10);
      assert.equal(alive(ready.pid), false);
      assert.equal(alive(ready.kernelPid!), false);
      assert.equal(alive(ready.agentkitPid!), false);
      // The daily manager starts without low-level overrides. Reuse the saved
      // paths, including the isolated data root, after a real cold stop.
      const restarted = JSON.parse((await invoke('start')).stdout) as Ready;
      assert.notEqual(restarted.instance, ready.instance);
      ready = restarted;
      assert.ok(alive(ready.kernelPid!));
      await invoke('stop');
    } finally {
      if (ready && alive(ready.pid)) await invoke('stop').catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);
