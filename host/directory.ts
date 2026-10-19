import { realpath, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { cleanEnvironment } from './private.js';

const PICKER_SCRIPT = `on run argv
try
set selectedFolder to choose folder with prompt (item 2 of argv) default location (POSIX file (item 1 of argv))
return POSIX path of selectedFolder
on error number -128
return ""
end try
end run
`;
export type NativePicker = (
  initial: string,
  prompt: string,
  signal?: AbortSignal,
) => Promise<string>;
export const nativePicker: NativePicker = (initial, prompt, signal) =>
  new Promise((resolve, reject) => {
    if (process.platform !== 'darwin')
      return reject(
        new Error('Native directory selection currently requires macOS'),
      );
    const child = spawn('/usr/bin/osascript', ['-', initial, prompt], {
      env: cleanEnvironment(),
      stdio: ['pipe', 'pipe', 'ignore'],
      signal,
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Directory picker timed out'));
    }, 600000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (Buffer.byteLength(output) > 16384) {
        child.kill();
        reject(new Error('Invalid directory picker response'));
      }
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(output.replace(/\n+$/, ''))
        : reject(new Error('Unable to open the local directory picker'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(PICKER_SCRIPT);
  });
export class DirectoryAuthority {
  readonly endpoints: Set<string>;
  private grants = new Set<string>();
  private picking = false;
  private abort = new AbortController();
  close(): void {
    this.abort.abort();
  }
  private constructor(
    endpoints: string[],
    readonly workspace: string,
    private picker: NativePicker,
  ) {
    this.endpoints = new Set(endpoints);
    for (const endpoint of endpoints)
      this.grants.add(JSON.stringify([endpoint, workspace]));
  }
  static async create(
    endpoints: string[],
    workspace: string,
    picker = nativePicker,
  ): Promise<DirectoryAuthority> {
    return new DirectoryAuthority(endpoints, await realpath(workspace), picker);
  }
  async directory(
    endpoint: unknown,
    path: unknown = this.workspace,
  ): Promise<string> {
    if (typeof endpoint !== 'string' || !this.endpoints.has(endpoint))
      throw new Error(
        'Directory selection is unavailable for this host endpoint',
      );
    if (path === null || path === undefined) path = this.workspace;
    if (
      typeof path !== 'string' ||
      !path ||
      path.length > 4096 ||
      !isAbsolute(path)
    )
      throw new Error('Expected an absolute directory path');
    const directory = await realpath(path);
    if (!(await stat(directory)).isDirectory())
      throw new Error('The selected path is not a directory');
    return directory;
  }
  async pick(
    endpoint: unknown,
    path?: unknown,
    language?: unknown,
  ): Promise<string | null> {
    if (typeof endpoint !== 'string' || !this.endpoints.has(endpoint))
      throw new Error(
        'Directory selection is unavailable for this host endpoint',
      );
    if (this.picking) throw new Error('A directory picker is already open');
    this.picking = true;
    try {
      const initial = await this.directory(endpoint, path).catch(() =>
        realpath(homedir()),
      );
      const selected = await this.picker(
        initial,
        language === 'en' ? 'Choose a working directory' : '选择工作目录',
        this.abort.signal,
      );
      if (!selected) return null;
      const directory = await this.directory(endpoint, selected);
      await access(directory, constants.R_OK);
      this.grants.add(JSON.stringify([endpoint, directory]));
      return directory;
    } finally {
      this.picking = false;
    }
  }
  async execution(
    endpoint: unknown,
    path: unknown,
    template: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const directory = await this.directory(endpoint, path);
    if (!this.grants.has(JSON.stringify([endpoint, directory])))
      throw new Error(
        'Choose this working directory in the directory dialog before creating a session',
      );
    return {
      ...template,
      cwd: directory,
      read_roots: [directory],
      writable_roots: [directory],
    };
  }
}
