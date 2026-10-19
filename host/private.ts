import { constants as C } from 'node:fs';
import { open, mkdir, lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

export const LIMIT = 16 * 1024 * 1024;
export const DEFAULT_ROOT = resolve(homedir(), '.agents/client/agent-web');
export function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      [
        'HOME',
        'PATH',
        'TMPDIR',
        'LANG',
        'LC_ALL',
        'SSL_CERT_FILE',
        'SSL_CERT_DIR',
      ].includes(key),
    ),
  );
}
export async function privateRoot(path: string): Promise<string> {
  path = resolve(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw new Error(
      'Runtime directory must be owned by this user with mode 0700',
    );
  return path;
}
export async function writePrivate(
  path: string,
  content: string,
): Promise<void> {
  const file = await open(
    path,
    C.O_CREAT | C.O_TRUNC | C.O_WRONLY | C.O_NOFOLLOW,
    0o600,
  );
  try {
    const stat = await file.stat();
    if (stat.uid !== process.getuid?.() || stat.mode & 0o077)
      throw new Error('Unsafe private file permissions');
    await file.writeFile(content);
  } finally {
    await file.close();
  }
}
export async function readPrivate(path: string): Promise<string> {
  const file = await open(path, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (stat.uid !== process.getuid?.() || stat.mode & 0o077)
      throw new Error('Unsafe private file permissions');
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}
export const jsonFile = async <T = Record<string, unknown>>(
  path: string,
): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
export function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function openPrivateAppend(path: string) {
  const file = await open(
    path,
    C.O_CREAT | C.O_APPEND | C.O_WRONLY | C.O_NOFOLLOW,
    0o600,
  );
  const stat = await file.stat();
  if (stat.uid !== process.getuid?.() || stat.mode & 0o077) {
    await file.close();
    throw new Error('Unsafe private file permissions');
  }
  return file;
}
