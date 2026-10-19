import { useEffect, useState } from 'react';
import type { ThreadActionDefinition } from '@tekesagentkit/client-contract';
import type { Address } from '../types';
import type { Workspace, WorkspaceState } from '../workspace';
import { addressKey } from '../state';
import { Check, MoreHorizontal } from './ui/Icons';
import { TekesIcon } from './ui/TekesIcon';
import { threadActionIcons } from '../icons/thread-action-assets';
import { Menu, MenuItem, MenuLabel } from './ui/Menu';

/** Render the AgentKit definition verbatim; no action catalog or capability policy here. */
export function SessionActions({
  workspace: w,
  state: s,
  address,
  title,
  onRename,
  compact = false,
}: {
  workspace: Workspace;
  state: WorkspaceState;
  address: Address;
  title: string;
  onRename: (address: Address, title: string, actionId: string) => void;
  compact?: boolean;
}) {
  const key = addressKey(address.endpoint, address.sessionId);
  const definition = s.threadActions.get(key),
    error = s.threadActionErrors.get(key);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => setCopied(false), [key]);
  const label = compact ? `会话操作：${title}` : '会话操作';
  function activate(action: ThreadActionDefinition) {
    if (action.interaction === 'rename')
      onRename({ ...address }, title, action.id);
    else if (action.interaction === 'copy') {
      if (typeof action.copyText !== 'string') {
        w.actionFailed(new Error('AgentKit 未提供复制内容。'));
        return;
      }
      if (!navigator.clipboard?.writeText) {
        w.actionFailed(new Error('当前浏览器无法写入剪贴板。'));
        return;
      }
      void navigator.clipboard
        .writeText(action.copyText)
        .then(() => setCopied(true))
        .catch(w.actionFailed);
    } else if (action.interaction === 'execute')
      void w.performThreadAction(address, action.id).catch(w.actionFailed);
  }
  return (
    <Menu
      label={label}
      onOpenChange={(open) => {
        if (open) void w.loadThreadActions(address).catch(() => {});
      }}
      trigger={
        <button
          type="button"
          className={`icon-button ${compact ? 'thread-menu-trigger' : ''}`}
          aria-label={copied ? '已复制会话 ID' : label}
          title={copied ? '已复制会话 ID' : '会话操作'}
        >
          {copied ? (
            <Check size={compact ? 16 : 19} />
          ) : (
            <MoreHorizontal size={compact ? 16 : 19} />
          )}
        </button>
      }
    >
      <MenuLabel>{definition?.label || '会话操作'}</MenuLabel>
      {error ? (
        <MenuItem disabled onSelect={() => {}} description={error}>
          无法读取操作
        </MenuItem>
      ) : definition ? (
        definition.items.map((action) => (
          <MenuItem
            key={action.id}
            icon={
              <TekesIcon
                name={threadActionIcons[action.icon] || 'tekes-more'}
                size={15}
                className={action.icon === 'moveUp' ? 'thread-action-up' : ''}
              />
            }
            disabled={!action.enabled}
            description={action.disabledReason}
            onSelect={() => activate(action)}
          >
            {action.label}
          </MenuItem>
        ))
      ) : (
        <MenuItem disabled onSelect={() => {}}>
          正在读取操作…
        </MenuItem>
      )}
    </Menu>
  );
}
