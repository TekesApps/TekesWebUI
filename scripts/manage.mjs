// Small dependency-free entry point; ordinary start/stop never invoke a build.
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const manager = fileURLToPath(
  new URL('../dist-host/manage.cjs', import.meta.url),
);
const command = process.argv[2] ?? 'start';
if (
  !(await access(manager).then(
    () => true,
    () => false,
  ))
) {
  if (command !== 'setup') {
    console.error('First run: npm ci && npm run setup');
    process.exit(1);
  }
  const build = spawnSync('npm', ['run', 'host:build'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const child = spawnSync(
  process.execPath,
  [manager, command, ...process.argv.slice(3)],
  { stdio: 'inherit' },
);
if (child.error) console.error('Unable to run the TekesWebUI service manager');
process.exit(child.status ?? 1);
