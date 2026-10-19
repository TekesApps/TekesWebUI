import type { IconName } from '@tekesui/icons';
/** Only semantic glyph projection lives here. AgentKit owns actions and policy. */
export const threadActionIcons: Readonly<Record<string, IconName>> = {
  pin: 'tekes-pin',
  unpin: 'tekes-pinned',
  rename: 'tekes-edit',
  fork: 'tekes-fork',
  copy: 'tekes-copy',
  archive: 'tekes-archive',
  unarchive: 'tekes-archive',
};
