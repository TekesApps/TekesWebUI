import { spawn } from 'node:child_process';
import { cleanEnvironment } from './private.js';
import { exec } from './config.js';

export const KEYCHAIN_SERVICE = 'com.tekesapps.TekesWebUI.providers';
export async function readCredential(
  account: string,
): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  try {
    const { stdout } = await exec(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      {
        env: cleanEnvironment(),
        timeout: 30000,
        maxBuffer: 65536,
      },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
function quoted(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid credential value');
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
export async function saveCredential(
  account: string,
  secret: string,
): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('Credential persistence currently requires macOS Keychain');
  const command = `add-generic-password -U -s ${quoted(KEYCHAIN_SERVICE)} -a ${quoted(account)} -w ${quoted(secret)}\n`;
  await new Promise<void>((resolve, reject) => {
    // Interactive security mode receives the key through stdin, never argv or a file.
    const child = spawn('/usr/bin/security', ['-i'], {
      env: cleanEnvironment(),
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Keychain write timed out'));
    }, 30000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Unable to access Keychain'));
    });
    child.stdin.on('error', () => {});
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error('Unable to save provider key in Keychain'));
    });
    child.stdin.end(command);
  });
  if ((await readCredential(account)) !== secret)
    throw new Error('Keychain did not retain the provider credential');
}
export async function providerCredential(
  environment: string,
  account: string,
): Promise<string> {
  const secret =
    process.env[environment]?.trim() || (await readCredential(account));
  if (!secret)
    throw new Error(
      'Provider key unavailable. Run npm run setup to configure Keychain, or supply the configured credential environment.',
    );
  return secret;
}
