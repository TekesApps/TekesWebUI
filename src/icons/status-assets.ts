import type { IconName } from '@tekesui/icons';
import type { ThreadActivity } from '@tekesagentkit/client-contract';

/** Web presentation only. All artwork comes from the public TekesUI catalog. */
export const statusIcons = {
  running: 'tekes-progress',
  queued: 'tekes-queued-input',
  waitingForInput: 'tekes-waiting-user',
  completed: 'tekes-confirm',
  notStarted: 'tekes-pending-task',
  failed: 'tekes-error',
  cancelled: 'tekes-stop',
  idle: 'tekes-pause',
  unknown: 'tekes-agent-question',
  stale: 'tekes-refresh',
} as const satisfies Record<ThreadActivity['status'] | 'stale', IconName>;

export function statusGroupIcon(group: string): IconName {
  const status = group.startsWith('status:') ? group.slice(7) : '';
  return (
    (statusIcons as Record<string, IconName>)[status] || statusIcons.unknown
  );
}

/** Cancellation is informational, not failure; neutral states remain quiet. */
export const statusColorRoles = {
  running: 'status-running',
  queued: 'status-running',
  waitingForInput: 'status-waiting',
  completed: 'status-succeeded',
  notStarted: 'status-neutral',
  failed: 'status-failed',
  cancelled: 'status-info',
  idle: 'status-neutral',
  unknown: 'status-neutral',
  stale: 'status-waiting',
} as const satisfies Record<keyof typeof statusIcons, string>;
export function statusGroupColor(group: string): string {
  return (
    (statusColorRoles as Record<string, string>)[group.slice(7)] ||
    'status-neutral'
  );
}
