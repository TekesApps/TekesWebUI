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
