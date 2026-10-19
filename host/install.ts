import {
  mkdir,
  mkdtemp,
  rm,
  rename,
  readFile,
  readdir,
  lstat,
  chmod,
  writeFile,
} from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { extract } from 'tar';
import { sha256, verifyKernel, KERNEL_PIN, exec } from './config.js';
import { privateRoot, writePrivate, readPrivate } from './private.js';
import type { Options } from './runtime.js';

export const AGENTKIT_PIN = {
  version: '0.3.7',
  revision: 'a8610a420bad72eaedcf706b30df87153a0f3e16',
};
export const REPOSITORY = 'https://github.com/TekesApps/TekesWebUI';
export interface BundleManifest {
  format: 1;
  version: string;
  platform: string;
  archive: string;
  sha256: string;
  sourceRevision: string;
  agentkit: typeof AGENTKIT_PIN;
  kernel: typeof KERNEL_PIN;
  files: Record<string, { sha256: string; executable: boolean }>;
}
export interface Release {
  directory: string;
  version: string;
  platform: string;
  manifestHash: string;
}
export interface Installation {
  format: 1;
  current: Release;
  previous?: Release;
  options: Options;
}
const VERSION = /^\d+\.\d+\.\d+$/;
export function safePath(path: string): boolean {
  return (
    !!path &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !path.split('/').some((p) => p === '..' || p === '.' || p === '')
  );
}
export async function installation(
  root: string,
): Promise<Installation | undefined> {
  try {
    const value = JSON.parse(
      await readPrivate(join(root, 'installation.json')),
    ) as Installation;
    if (
      value.format !== 1 ||
      !VERSION.test(value.current.version) ||
      !isAbsolute(value.current.directory)
    )
      throw new Error('Invalid installation configuration');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function saveInstallation(
  root: string,
  value: Installation,
): Promise<void> {
  const pending = join(
    root,
    'installation-' + randomBytes(6).toString('hex') + '.json',
  );
  await writePrivate(pending, JSON.stringify(value, null, 2));
  await rename(pending, join(root, 'installation.json'));
}
export function releaseOptions(
  root: string,
  release: Release,
  options: Options,
): Options {
  return {
    ...options,
    runtimeDir: root,
    agentkitSource: release.directory,
    agentkitBinary: join(release.directory, 'runtime/agentkit/tekes-agent-web'),
    kernelBinaryDir: join(release.directory, 'runtime/kernel'),
    webRoot: join(release.directory, 'dist'),
  };
}
export async function download(url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120000),
    headers: { 'User-Agent': 'TekesWebUI-installer' },
  });
  if (!response.ok || !response.body)
    throw new Error(
      `Release download failed (${response.status}); existing installation retained`,
    );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error('Release exceeds download limit');
    }
    chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks);
}
export async function latestVersion(): Promise<string> {
  const value = JSON.parse(
    (
      await download(
        'https://api.github.com/repos/TekesApps/TekesWebUI/releases/latest',
        1024 * 1024,
      )
    ).toString(),
  ) as { tag_name?: string };
  const version = value.tag_name?.replace(/^v/, '') ?? '';
  if (!VERSION.test(version))
    throw new Error('Invalid published release version');
  return version;
}
export async function publishedBundle(
  version: string,
  platform: string,
): Promise<{ manifest: BundleManifest; archive: Buffer }> {
  if (!VERSION.test(version) || platform !== 'darwin-arm64')
    throw new Error('No published package for this platform');
  const base = `${REPOSITORY}/releases/download/v${version}/`;
  const manifest = JSON.parse(
    (
      await download(
        base + `tekes-webui-${version}-${platform}.json`,
        1024 * 1024,
      )
    ).toString(),
  ) as BundleManifest;
  if (
    manifest.version !== version ||
    manifest.platform !== platform ||
    manifest.archive !== `tekes-webui-${version}-${platform}.tar.gz`
  )
    throw new Error(
      'Release manifest does not match requested version/platform',
    );
  return {
    manifest,
    archive: await download(base + manifest.archive, 256 * 1024 * 1024),
  };
}
async function walk(root: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, relative), {
    withFileTypes: true,
  })) {
    const path = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Release contains a link or special file');
  }
  return files.sort();
}
export async function verifyRelease(release: Release): Promise<void> {
  const text = await readFile(join(release.directory, 'bundle-manifest.json'));
  if (sha256(text) !== release.manifestHash)
    throw new Error('Installed manifest hash mismatch');
  const manifest = JSON.parse(text.toString()) as BundleManifest;
  if (
    manifest.version !== release.version ||
    manifest.platform !== release.platform
  )
    throw new Error('Installed release identity mismatch');
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (!safePath(path)) throw new Error('Invalid installed file path');
    const file = join(release.directory, path);
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      sha256(await readFile(file)) !== expected.sha256
    )
      throw new Error('Installed file hash mismatch: ' + path);
  }
}
export async function installBundle(
  root: string,
  manifest: BundleManifest,
  archive: Buffer,
  platform = `${process.platform}-${process.arch}`,
): Promise<Release> {
  if (
    manifest.format !== 1 ||
    !VERSION.test(manifest.version) ||
    manifest.platform !== platform ||
    manifest.agentkit?.revision !== AGENTKIT_PIN.revision ||
    manifest.agentkit.version !== AGENTKIT_PIN.version ||
    JSON.stringify(manifest.kernel) !== JSON.stringify(KERNEL_PIN) ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceRevision) ||
    sha256(archive) !== manifest.sha256
  )
    throw new Error(
      'Release version, dependency pins or archive hash mismatch',
    );
  const entries = Object.keys(manifest.files);
  if (
    !entries.length ||
    entries.length > 2048 ||
    entries.some((path) => !safePath(path))
  )
    throw new Error('Invalid release file manifest');
  for (const path of [
    'package.json',
    'dist/index.html',
    'dist-host/cli.js',
    'dist-host/manage.cjs',
    'runtime/agentkit/tekes-agent-web',
    'runtime/kernel/BuildProvenance.json',
  ]) {
    if (!manifest.files[path])
      throw new Error('Required release file missing: ' + path);
  }
  const releases = await privateRoot(join(root, 'installed'));
  const staging = await mkdtemp(join(releases, '.staging-'));
  const manifestText = JSON.stringify(manifest);
  const directory = join(
    releases,
    `v${manifest.version}-${manifest.sha256.slice(0, 16)}`,
  );
  const release: Release = {
    directory,
    version: manifest.version,
    platform,
    manifestHash: sha256(Buffer.from(manifestText)),
  };
  const archivePath = join(staging, 'download.tar.gz');
  const content = join(staging, 'content');
  try {
    await mkdir(content, { mode: 0o700 });
    await writeFile(archivePath, archive, { mode: 0o600 });
    const seen = new Set<string>();
    let total = 0;
    let invalid: string | undefined;
    await extract({
      file: archivePath,
      cwd: content,
      strict: true,
      preservePaths: false,
      filter: (path, entry) => {
        if (!('type' in entry)) {
          invalid = 'Invalid archive entry';
          return false;
        }
        const name = path.replace(/\/$/, '');
        if (!safePath(name) || !['File', 'Directory'].includes(entry.type)) {
          invalid = 'Unsafe archive entry';
          return false;
        }
        if (entry.type === 'Directory') return true;
        if (!manifest.files[name] || seen.has(name)) {
          invalid = 'Unexpected or repeated archive file';
          return false;
        }
        total += entry.size;
        if (total > 768 * 1024 * 1024 || entry.size > 256 * 1024 * 1024) {
          invalid = 'Extracted release size limit';
          return false;
        }
        seen.add(name);
        return true;
      },
    });
    if (invalid) throw new Error(invalid);
    if (JSON.stringify(await walk(content)) !== JSON.stringify(entries.sort()))
      throw new Error('Archive inventory differs from manifest');
    for (const [path, expected] of Object.entries(manifest.files)) {
      if (sha256(await readFile(join(content, path))) !== expected.sha256)
        throw new Error('Release file hash mismatch: ' + path);
      await chmod(join(content, path), expected.executable ? 0o700 : 0o600);
    }
    if (
      (
        JSON.parse(await readFile(join(content, 'package.json'), 'utf8')) as {
          version: string;
        }
      ).version !== manifest.version
    )
      throw new Error('Package version mismatch');
    await verifyKernel(join(content, 'runtime/kernel'));
    await exec(
      process.execPath,
      [join(content, 'dist-host/cli.js'), '--help'],
      { timeout: 15000 },
    );
    await writeFile(join(content, 'bundle-manifest.json'), manifestText, {
      mode: 0o600,
    });
    try {
      await rename(content, directory);
    } catch (error) {
      if (
        !['EEXIST', 'ENOTEMPTY'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
      await verifyRelease(release);
    }
    return release;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
