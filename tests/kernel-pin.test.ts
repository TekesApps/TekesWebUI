import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KERNEL_PIN, sha256, verifyKernel } from '../host/config.js';

const binaries = [
  'tekes-supervisor',
  'tekes-worker',
  'tekes-helper',
  'tekes-workspace-service',
];

async function makeKernelFixture(
  version = KERNEL_PIN.version,
  revision: string | null = KERNEL_PIN.revision,
) {
  const root = await mkdtemp(join(tmpdir(), 'tekes-kernel-pin-'));
  const hashes: Record<string, { sha256: string }> = {};
  for (const name of binaries) {
    const contents =
      name === 'tekes-supervisor'
        ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({format:1,identifier:'com.tekes.kernel.supervisor',version:${JSON.stringify(version)},...((${JSON.stringify(revision)}) === null ? {} : {source_revision:${JSON.stringify(revision)}})}));\n`
        : `#!/usr/bin/env node\nprocess.exit(0);\n`;
    const data = Buffer.from(contents);
    await writeFile(join(root, name), data, { mode: 0o700 });
    hashes[name] = { sha256: sha256(data) };
  }
  await writeFile(
    join(root, 'BuildProvenance.json'),
    JSON.stringify({ kernel: KERNEL_PIN, binaries: hashes }),
  );
  return root;
}

test('accepts a source-bound supervisor and pinned provenance', async () => {
  const root = await makeKernelFixture();
  try {
    await verifyKernel(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a supervisor from a different Kernel version', async () => {
  const root = await makeKernelFixture('0.9.10');
  try {
    await assert.rejects(verifyKernel(root), /Kernel binary identity mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects provenance from a different Kernel source revision', async () => {
  const root = await makeKernelFixture();
  try {
    const path = join(root, 'BuildProvenance.json');
    const receipt = JSON.parse(await readFile(path, 'utf8')) as {
      kernel: typeof KERNEL_PIN;
      binaries: Record<string, { sha256: string }>;
    };
    receipt.kernel.revision = '0000000000000000000000000000000000000000';
    await writeFile(path, JSON.stringify(receipt));
    await assert.rejects(
      verifyKernel(root),
      /Kernel bundle provenance differs from the published pin/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a binary changed after its published hash was recorded', async () => {
  const root = await makeKernelFixture();
  try {
    await writeFile(join(root, 'tekes-worker'), 'modified');
    await assert.rejects(
      verifyKernel(root),
      /Kernel bundle hash mismatch: tekes-worker/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a supervisor missing its release source revision', async () => {
  const root = await makeKernelFixture(KERNEL_PIN.version, null);
  try {
    await assert.rejects(verifyKernel(root), /Kernel binary identity mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a supervisor reporting another source revision', async () => {
  const root = await makeKernelFixture(
    KERNEL_PIN.version,
    '0000000000000000000000000000000000000000',
  );
  try {
    await assert.rejects(verifyKernel(root), /Kernel binary identity mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
