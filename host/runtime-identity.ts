import { readFile, realpath, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cleanEnvironment } from './private.js';
import { exec, sha256, verifyKernel, KERNEL_PIN } from './config.js';
import type { Options } from './runtime.js';

export interface RuntimeIdentity {
  kind: 'local-candidate';
  manifestPath: string;
  manifestSha256: string;
}
interface Reference {
  path: string;
  sha256: string;
}
interface BuildIdentity {
  format: number;
  identifier: string;
  version: string;
  source_revision: string;
}
export interface CandidateManifest {
  version: 1;
  label: 'LOCAL_CANDIDATE_NOT_PUBLIC018';
  scope: {
    root: string;
    runtimeDir: string;
    kernelDataRoot: string;
    workspace: string;
    harnesses: ['native'];
  };
  kernel: {
    revision: string;
    tree: string;
    build: string;
    receipt: Reference;
    binaries: Record<string, string>;
    describeBuild: BuildIdentity;
  };
  core: {
    revision: string;
    tree: string;
    programSha256: string;
    receipt: Reference;
  };
  web: {
    revision: string;
    tree: string;
    compiledManifest: Reference;
    dto: { revision: string; lockSha256: string };
  };
}
const BINARIES = [
  'tekes-supervisor',
  'tekes-worker',
  'tekes-helper',
  'tekes-workspace-service',
];
const digest = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const revision = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const absolute = (v: unknown): v is string =>
  typeof v === 'string' && isAbsolute(v);
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Invalid candidate manifest object');
  return v as Record<string, unknown>;
}
function reference(v: unknown): boolean {
  const r = record(v);
  return absolute(r.path) && digest(r.sha256);
}
/** Whitelist only the nonsecret reference, including on configuration round trips. */
export function runtimeIdentity(value: unknown): RuntimeIdentity | undefined {
  if (value === undefined) return undefined;
  const v = record(value);
  if (
    v.kind !== 'local-candidate' ||
    !absolute(v.manifestPath) ||
    !digest(v.manifestSha256)
  )
    throw new Error('Invalid runtime identity reference');
  return {
    kind: 'local-candidate',
    manifestPath: v.manifestPath,
    manifestSha256: v.manifestSha256,
  };
}
function manifest(value: unknown): CandidateManifest {
  const v = record(value),
    scope = record(v.scope),
    kernel = record(v.kernel),
    core = record(v.core),
    web = record(v.web),
    dto = record(web.dto),
    described = record(kernel.describeBuild),
    bins = record(kernel.binaries);
  if (
    v.version !== 1 ||
    v.label !== 'LOCAL_CANDIDATE_NOT_PUBLIC018' ||
    !['root', 'runtimeDir', 'kernelDataRoot', 'workspace'].every((k) =>
      absolute(scope[k]),
    ) ||
    JSON.stringify(scope.harnesses) !== '["native"]' ||
    !revision(kernel.revision) ||
    !revision(kernel.tree) ||
    typeof kernel.build !== 'string' ||
    !kernel.build ||
    !reference(kernel.receipt) ||
    JSON.stringify(Object.keys(bins).sort()) !==
      JSON.stringify([...BINARIES].sort()) ||
    !BINARIES.every((name) => digest(bins[name])) ||
    described.format !== 1 ||
    described.identifier !== 'com.tekes.kernel.supervisor' ||
    typeof described.version !== 'string' ||
    !described.version ||
    described.source_revision !== kernel.revision ||
    !revision(core.revision) ||
    !revision(core.tree) ||
    !digest(core.programSha256) ||
    !reference(core.receipt) ||
    !revision(web.revision) ||
    !revision(web.tree) ||
    !reference(web.compiledManifest) ||
    !revision(dto.revision) ||
    !digest(dto.lockSha256)
  )
    throw new Error('Invalid candidate manifest v1');
  return value as CandidateManifest;
}
async function checkedJson(ref: Reference): Promise<Record<string, unknown>> {
  const bytes = await readFile(ref.path);
  if (sha256(bytes) !== ref.sha256)
    throw new Error('Candidate provenance hash mismatch');
  return record(JSON.parse(bytes.toString()));
}
async function checkFile(path: string, expected: string, label: string) {
  if (sha256(await readFile(path)) !== expected)
    throw new Error(`Candidate ${label} hash mismatch`);
}
function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return (
    part !== '' &&
    part !== '..' &&
    !part.startsWith('..' + sep) &&
    !isAbsolute(part)
  );
}
async function compiledFiles(root: string, prefix: string): Promise<string[]> {
  const names: string[] = [];
  for (const item of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix + '/' + item.name;
    if (item.isDirectory()) names.push(...(await compiledFiles(root, name)));
    else if (item.isFile()) names.push(name);
    else
      throw new Error('Candidate compiled closure must contain regular files');
  }
  return names;
}
/** Shared setup/start boundary; absence retains the original published verifier. */
export async function verifyRuntimeIdentity(
  options: Options,
  hostRoot = dirname(dirname(fileURLToPath(import.meta.url))),
): Promise<string> {
  const identity = runtimeIdentity(options.runtimeIdentity);
  if (!identity) {
    await verifyKernel(options.kernelBinaryDir);
    return KERNEL_PIN.version;
  }
  const m = manifest(
    await checkedJson({
      path: identity.manifestPath,
      sha256: identity.manifestSha256,
    }),
  );
  const scope = await realpath(m.scope.root);
  const canonical = join(homedir(), '.agents'),
    defaultWorkspace = join(homedir(), 'Documents/TekesKernel-Web-Workspace');
  if (
    scope === sep ||
    scope === homedir() ||
    scope === canonical ||
    inside(canonical, scope) ||
    scope === defaultWorkspace ||
    inside(defaultWorkspace, scope) ||
    JSON.stringify(options.harnesses) !== '["native"]' ||
    options.kernelConfigurationMode !== 'existing'
  )
    throw new Error(
      'Candidate requires an isolated Native existing configuration',
    );
  for (const key of ['runtimeDir', 'kernelDataRoot', 'workspace'] as const) {
    const expected = await realpath(m.scope[key]);
    if (
      !inside(scope, expected) ||
      expected === homedir() ||
      expected === canonical ||
      inside(canonical, expected) ||
      expected === defaultWorkspace ||
      inside(defaultWorkspace, expected) ||
      (await realpath(options[key])) !== expected
    )
      throw new Error('Candidate directory differs from the isolated scope');
  }
  const kernelReceipt = await checkedJson(m.kernel.receipt),
    kernelSource = record(kernelReceipt.sourceBefore);
  if (
    kernelSource.head !== m.kernel.revision ||
    kernelSource.tree !== m.kernel.tree ||
    kernelReceipt.sourceRevision !== m.kernel.revision ||
    Object.entries(m.kernel.describeBuild).some(
      ([key, value]) => record(kernelReceipt.describeBuild)[key] !== value,
    )
  )
    throw new Error('Candidate Kernel source receipt mismatch');
  for (const name of BINARIES)
    await checkFile(
      join(options.kernelBinaryDir, name),
      m.kernel.binaries[name],
      name,
    );
  const coreReceipt = await checkedJson(m.core.receipt);
  if (
    coreReceipt.sourceRevision !== m.core.revision ||
    coreReceipt.sourceTree !== m.core.tree ||
    coreReceipt.programSha256 !== m.core.programSha256
  )
    throw new Error('Candidate Core source receipt mismatch');
  await checkFile(options.agentkitBinary, m.core.programSha256, 'Core');
  const build = await checkedJson(m.web.compiledManifest);
  if (
    build.sourceRevision !== m.web.revision ||
    build.sourceTree !== m.web.tree
  )
    throw new Error('Candidate Web source receipt mismatch');
  const root = await realpath(hostRoot);
  if ((await realpath(options.webRoot)) !== join(root, 'dist'))
    throw new Error(
      'Candidate assets and running host must share the compiled tree',
    );
  const hashes = record(build.files);
  const names = [
    ...(await compiledFiles(root, 'dist')),
    ...(await compiledFiles(root, 'dist-host')),
    'package.json',
    'package-lock.json',
  ].sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(hashes).sort()))
    throw new Error('Candidate compiled closure file set mismatch');
  for (const name of names) {
    if (!digest(hashes[name]))
      throw new Error('Invalid compiled closure digest');
    await checkFile(
      join(root, name),
      hashes[name] as string,
      'Web compiled file',
    );
  }
  await checkFile(
    join(root, 'package-lock.json'),
    m.web.dto.lockSha256,
    'DTO lock',
  );
  const pkg = record(
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')),
  );
  if (
    record(pkg.dependencies)['@tekesagentkit/client-contract'] !==
    `https://codeload.github.com/TekesApps/TekesAgentKit/tar.gz/${m.web.dto.revision}`
  )
    throw new Error('Candidate DTO pin mismatch');
  const { stdout } = await exec(
    join(options.kernelBinaryDir, 'tekes-supervisor'),
    ['--describe-build'],
    { env: cleanEnvironment(), timeout: 15000, maxBuffer: 65536 },
  );
  const described = record(JSON.parse(stdout));
  if (
    Object.entries(m.kernel.describeBuild).some(
      ([key, value]) => described[key] !== value,
    )
  )
    throw new Error('Candidate actual Kernel identity mismatch');
  return m.kernel.describeBuild.version;
}
