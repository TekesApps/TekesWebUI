import { parseArgs } from 'node:util';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  lstat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { create } from 'tar';
import { AGENTKIT_PIN, type BundleManifest } from '../host/install.js';
import { KERNEL_PIN, sha256, verifyKernel } from '../host/config.js';
const { values } = parseArgs({
  options: {
    'agentkit-source': { type: 'string' },
    'agentkit-binary': { type: 'string' },
    'kernel-binary-dir': { type: 'string' },
    out: { type: 'string', default: 'release-artifacts' },
  },
});
if (
  !values['agentkit-source'] ||
  !values['agentkit-binary'] ||
  !values['kernel-binary-dir']
)
  throw new Error(
    'Release packager needs explicit verified AgentKit source/binary and Kernel bundle paths',
  );
const project = process.cwd();
const version = (
  JSON.parse(await readFile(join(project, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: values['agentkit-source'],
    encoding: 'utf8',
  }).trim() !== AGENTKIT_PIN.revision
)
  throw new Error('AgentKit release source differs from the exact pin');
execFileSync('git', ['diff', '--exit-code'], {
  cwd: values['agentkit-source'],
  stdio: 'ignore',
});
await verifyKernel(values['kernel-binary-dir']);
const staging = await mkdtemp(join(tmpdir(), 'tekes-webui-package-'));
try {
  for (const path of [
    'dist',
    'dist-host',
    'package.json',
    'scripts/manage.mjs',
    'LICENSE',
    'README.md',
    'docs/local-service.md',
  ]) {
    const target = join(staging, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await cp(join(project, path), target, { recursive: true });
  }
  await mkdir(join(staging, 'runtime/agentkit'), { recursive: true });
  await cp(
    values['agentkit-binary'],
    join(staging, 'runtime/agentkit/tekes-agent-web'),
  );
  await cp(
    join(values['agentkit-source'], 'LICENSE'),
    join(staging, 'runtime/agentkit/LICENSE'),
  );
  await mkdir(join(staging, 'runtime/kernel'), { recursive: true });
  for (const path of [
    'tekes-supervisor',
    'tekes-worker',
    'tekes-helper',
    'tekes-workspace-service',
    'BuildProvenance.json',
  ])
    await cp(
      join(values['kernel-binary-dir'], path),
      join(staging, 'runtime/kernel', path),
    );
  await writeFile(
    join(staging, 'THIRD_PARTY_NOTICES.md'),
    'TekesWebUI, TekesAgentKit and TekesKernel: MIT, Copyright 2026 TekesApps.\nThe bundled manager includes node-tar, @isaacs/fs-minipass, chownr, minipass, minizlib and yallist. Full licenses follow.\n',
  );
  for (const name of [
    'tar',
    '@isaacs/fs-minipass',
    'chownr',
    'minipass',
    'minizlib',
    'yallist',
  ]) {
    const folder = join(project, 'node_modules', name);
    const license = (await readdir(folder)).find((file) =>
      /^licen[sc]e/i.test(file),
    );
    if (!license) throw new Error('Missing dependency license: ' + name);
    await writeFile(
      join(staging, 'THIRD_PARTY_NOTICES.md'),
      `\n## ${name}\n\n` + (await readFile(join(folder, license), 'utf8')),
      { flag: 'a' },
    );
  }
  const files: BundleManifest['files'] = {};
  async function inventory(relative = ''): Promise<void> {
    for (const name of await readdir(join(staging, relative))) {
      const path = relative ? relative + '/' + name : name;
      const full = join(staging, path);
      const stat = await lstat(full);
      if (stat.isDirectory()) await inventory(path);
      else if (stat.isFile())
        files[path] = {
          sha256: sha256(await readFile(full)),
          executable:
            path.startsWith('runtime/') && !/LICENSE|\.json$/.test(path),
        };
      else throw new Error('No symlinks in a release');
    }
  }
  await inventory();
  const platform = `${process.platform}-${process.arch}`;
  const archive = `tekes-webui-${version}-${platform}.tar.gz`;
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  await create(
    {
      cwd: staging,
      file: join(out, archive),
      gzip: true,
      portable: true,
      noMtime: true,
    },
    Object.keys(files).sort(),
  );
  const manifest: BundleManifest = {
    format: 1,
    version,
    platform,
    archive,
    sha256: sha256(await readFile(join(out, archive))),
    sourceRevision,
    agentkit: AGENTKIT_PIN,
    kernel: KERNEL_PIN,
    files,
  };
  await writeFile(
    join(out, `tekes-webui-${version}-${platform}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(
    `Release package: ${archive} (${Object.keys(files).length} files); source ${sourceRevision}`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
