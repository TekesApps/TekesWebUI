import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Folder,
  FolderOpen,
  Menu,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from './ui/Icons';
import type { Workspace, WorkspaceState } from '../workspace';
import type { Address } from '../types';
import { TekesIcon } from './ui/TekesIcon';
import { statusGroupIcon, statusGroupColor } from '../icons/status-assets';
import { SessionActions } from './SessionActions';
import {
  addressKey,
  formatTimestamp,
  groupSessions,
  preference,
  savePreference,
  shortAge,
  timestampMillis,
  type SessionSort,
  type SessionGrouping,
  sessionGroupingPreference,
  sessionActivity,
} from '../state';
import { Tooltip } from './Tooltip';
import {
  Menu as PopupMenu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
} from './ui/Menu';

export function Sidebar({
  workspace: w,
  state: s,
  health,
  onNew,
  onSelect,
  onRename,
  onSettings,
  onHelp,
  onCollapse,
}: {
  workspace: Workspace;
  state: WorkspaceState;
  health: string;
  onNew: (cwd?: string, endpoint?: string) => void;
  onSelect: () => void;
  onRename: (address: Address, title: string, actionId: string) => void;
  onSettings: () => void;
  onHelp: () => void;
  onCollapse: () => void;
}) {
  const [searching, setSearching] = useState(false),
    [query, setQuery] = useState('');
  const [sort, setSort] = useState<SessionSort>(() => {
    const saved = preference('tekes.web.sidebar.sort');
    return ['recentActivity', 'titleAscending', 'titleDescending'].includes(
      saved || '',
    )
      ? (saved as SessionSort)
      : 'recentActivity';
  });
  const [grouping, setGrouping] = useState<SessionGrouping>(() =>
    sessionGroupingPreference(preference('tekes.web.sidebar.grouping')),
  );
  const [filter, setFilter] = useState(''),
    [running, setRunning] = useState(false),
    [limit, setLimit] = useState(8);
  const [collapsed, setCollapsed] = useState(new Set<string>()),
    [pages, setPages] = useState<Record<string, number>>({});
  const [, tick] = useState(0),
    search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    savePreference('tekes.web.sidebar.sort', sort);
    savePreference('tekes.web.sidebar.grouping', String(grouping));
    setPages({});
    setLimit(8);
  }, [sort, grouping]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
        requestAnimationFrame(() => {
          search.current?.focus();
          search.current?.select();
        });
      }
      if (event.key === 'Escape') {
        if (document.activeElement === search.current) {
          if (query) setQuery('');
          else setSearching(false);
        }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
    };
  }, [query]);
  const groups = groupSessions(
    s.endpoints,
    s.inventories,
    query,
    filter,
    running,
    (endpoint, entry) =>
      w.titles.title(endpoint, entry.sessionId, entry.summary),
    { sort, grouping },
  );
  const total = [...s.inventories.values()]
    .flat()
    .filter(
      (e) =>
        e.summary && !e.summary.ephemeral && e.summary.status !== 'archived',
    ).length;
  const sorts: [SessionSort, string][] = [
    ['recentActivity', t('最近活动')],
    ['titleAscending', t('标题 A–Z')],
    ['titleDescending', t('标题 Z–A')],
  ];
  return (
    <aside className="sidebar" aria-label={t('会话导航')}>
      <div className="sidebar-brand">
        {searching ? (
          <div className="sidebar-search">
            <Search size={15} />
            <input
              ref={search}
              autoFocus
              type="search"
              aria-label={t('搜索会话')}
              placeholder={t('搜索会话')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query) setSearching(false);
              }}
            />
            <button
              className="icon-button"
              title={t('收起搜索 Esc')}
              aria-label={t('收起搜索')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSearching(false);
                setQuery('');
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <button
              className="brand"
              title={t('{0} 个活动会话', total)}
              onClick={() => onNew()}
            >
              <img src="/app-icon.png" width={22} height={22} alt="" />
              <span>Tekes</span>
            </button>
            <div className="sidebar-header-actions">
              <Tooltip content={t('搜索会话 · ⌘K')}>
                <button
                  className="icon-button"
                  aria-label={t('搜索会话')}
                  onClick={() => setSearching(true)}
                >
                  <Search size={17} />
                </button>
              </Tooltip>
            </div>
          </>
        )}
        <PopupMenu
          label={t('会话列表选项')}
          trigger={
            <button className="icon-button" aria-label={t('会话列表选项')}>
              <SlidersHorizontal size={17} />
              {(filter || running) && <span className="option-dot" />}
            </button>
          }
        >
          <MenuLabel>{t('会话列表')}</MenuLabel>
          <MenuSub label={t('排序')}>
            {sorts.map(([value, label]) => (
              <MenuItem
                key={value}
                selected={sort === value}
                onSelect={() => setSort(value)}
              >
                {label}
              </MenuItem>
            ))}
          </MenuSub>
          <MenuSub label={t('分组')}>
            {(
              [
                ['folder', t('按文件夹')],
                ['status', t('按状态')],
                ['none', t('不分组')],
              ] as const
            ).map(([value, label]) => (
              <MenuItem
                key={value}
                selected={grouping === value}
                onSelect={() => setGrouping(value)}
              >
                {label}
              </MenuItem>
            ))}
          </MenuSub>
          <MenuSub label={t('筛选 Harness')}>
            <MenuItem selected={!filter} onSelect={() => setFilter('')}>
              {t('全部 Harness')}
            </MenuItem>
            {s.endpoints.map((e) => (
              <MenuItem
                key={e.id}
                selected={filter === e.id}
                onSelect={() => setFilter(e.id)}
              >
                {e.name}
              </MenuItem>
            ))}
          </MenuSub>
          <MenuSeparator />
          <MenuItem selected={running} onSelect={() => setRunning(!running)}>
            {t('仅显示运行中')}
          </MenuItem>
        </PopupMenu>
      </div>
      <button className="new-chat" onClick={() => onNew()}>
        <Plus size={17} />
        <span>{t('新建会话')}</span>
        <kbd>⌘ ↵</kbd>
      </button>
      {(query || filter || running) && (
        <div className="list-filter-summary">
          <span>
            {groups.reduce((n, g) => n + g.entries.length, 0)}
            {t(' 个结果')}
            {filter
              ? ` · ${s.endpoints.find((e) => e.id === filter)?.name || ''}`
              : ''}
            {running ? t(' · 运行中') : ''}
          </span>
          <button
            aria-label={t('清除筛选')}
            title={t('清除筛选')}
            onClick={() => {
              setQuery('');
              setFilter('');
              setRunning(false);
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <nav
        className="thread-list"
        aria-label={
          grouping === 'status'
            ? t('按状态分组的会话')
            : grouping === 'folder'
              ? t('按文件夹分组的会话')
              : t('所有会话')
        }
      >
        {groups.slice(0, query ? groups.length : limit).map((group) => (
          <section
            className={`folder-group ${grouping === 'none' ? 'ungrouped' : ''}`}
            key={group.key}
          >
            {(grouping !== 'none' || group.key === 'pinned') && (
              <div className="folder-heading">
                <button
                  className="folder-toggle"
                  title={group.path}
                  aria-expanded={!collapsed.has(group.key) || !!query}
                  onClick={() => {
                    const next = new Set(collapsed);
                    next.has(group.key)
                      ? next.delete(group.key)
                      : next.add(group.key);
                    setCollapsed(next);
                  }}
                >
                  {collapsed.has(group.key) && !query ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                  {group.key === 'pinned' ? (
                    <TekesIcon name="tekes-pin" size={14} />
                  ) : grouping === 'status' ? (
                    <TekesIcon
                      name={statusGroupIcon(group.key)}
                      size={14}
                      style={{ color: `var(--${statusGroupColor(group.key)})` }}
                    />
                  ) : collapsed.has(group.key) && !query ? (
                    <Folder size={14} />
                  ) : (
                    <FolderOpen size={14} />
                  )}
                  <span>{group.name}</span>
                </button>
                {grouping === 'folder' && group.key !== 'pinned' && (
                  <button
                    className="icon-button folder-add"
                    aria-label={t('在 {0} 新建会话', group.name)}
                    title={t('在此文件夹新建会话')}
                    onClick={() =>
                      onNew(
                        group.path || s.hostWorkspace,
                        group.entries[0]?.endpoint,
                      )
                    }
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            )}
            {((grouping === 'none' && group.key !== 'pinned') ||
              !collapsed.has(group.key) ||
              !!query) && (
              <>
                {group.entries
                  .slice(
                    0,
                    query
                      ? group.entries.length
                      : pages[group.key] || (grouping === 'none' ? 30 : 5),
                  )
                  .map((entry) => {
                    const selected =
                      s.selected?.endpoint === entry.endpoint &&
                      s.selected.sessionId === entry.sessionId;
                    const updated = formatTimestamp(entry.row.updatedAt),
                      created = formatTimestamp(entry.row.createdAt);
                    const tooltip = (
                      <>
                        <strong>{entry.title}</strong>
                        <span>{entry.agent}</span>
                        {updated && (
                          <span>
                            {t('最后活动 · ')}
                            {updated}
                          </span>
                        )}
                        {created && (
                          <span>
                            {t('创建时间 · ')}
                            {created}
                          </span>
                        )}
                        {entry.row.cwd && (
                          <span className="tooltip-path">{entry.row.cwd}</span>
                        )}
                      </>
                    );
                    return (
                      <div
                        className="thread-row"
                        key={addressKey(entry.endpoint, entry.sessionId)}
                      >
                        <Tooltip
                          key={addressKey(entry.endpoint, entry.sessionId)}
                          content={tooltip}
                          side="right"
                          block
                        >
                          <button
                            className={`thread ${selected ? 'selected' : ''}`}
                            aria-current={selected ? 'page' : undefined}
                            onClick={() => {
                              void w.select({
                                endpoint: entry.endpoint,
                                sessionId: entry.sessionId,
                              });
                              onSelect();
                            }}
                          >
                            <span className="thread-label">{entry.title}</span>
                            {sessionActivity(entry) === 'running' ? (
                              <span
                                className="running-dot"
                                aria-label={t('运行中')}
                              />
                            ) : (
                              <time
                                className="thread-time"
                                dateTime={
                                  timestampMillis(entry.row.updatedAt)
                                    ? new Date(
                                        timestampMillis(entry.row.updatedAt),
                                      ).toISOString()
                                    : undefined
                                }
                              >
                                {shortAge(entry.row.updatedAt)}
                              </time>
                            )}
                          </button>
                        </Tooltip>
                        <SessionActions
                          compact
                          workspace={w}
                          state={s}
                          address={{
                            endpoint: entry.endpoint,
                            sessionId: entry.sessionId,
                          }}
                          title={entry.title}
                          onRename={onRename}
                        />
                      </div>
                    );
                  })}
                {!query &&
                  group.entries.length >
                    (pages[group.key] || (grouping === 'none' ? 30 : 5)) && (
                    <button
                      className="list-more"
                      onClick={() =>
                        setPages({
                          ...pages,
                          [group.key]:
                            (pages[group.key] ||
                              (grouping === 'none' ? 30 : 5)) + 20,
                        })
                      }
                    >
                      {t('更多会话')}
                      <ChevronDown size={11} />
                    </button>
                  )}
              </>
            )}
          </section>
        ))}
        {!groups.length && (
          <p className="list-empty">
            {s.connecting
              ? t('正在读取会话…')
              : query
                ? t('没有找到匹配的会话')
                : t('你的会话会出现在这里')}
          </p>
        )}
        {!query && groups.length > limit && (
          <button
            className="list-more more-folders"
            onClick={() => setLimit(limit + 12)}
          >
            {grouping === 'folder' ? t('显示更多文件夹') : t('显示更多分组')}
          </button>
        )}
      </nav>
      <div className="sidebar-bottom">
        <Tooltip content={health}>
          <button
            className="sidebar-settings"
            aria-label={t('连接与设置')}
            onClick={onSettings}
          >
            <span
              className={`health-dot ${s.endpoints.some((e) => e.connection !== 'ready') || !s.authenticated ? 'warning' : ''}`}
            />
            <span>{t('连接与设置')}</span>
            <Settings2 size={15} />
          </button>
        </Tooltip>
        <Tooltip content={t('使用帮助')}>
          <button
            className="icon-button"
            aria-label={t('使用帮助')}
            onClick={onHelp}
          >
            <CircleHelp size={16} />
          </button>
        </Tooltip>
        <Tooltip content={t('收起侧栏')}>
          <button
            className="icon-button"
            aria-label={t('收起侧栏')}
            onClick={onCollapse}
          >
            <Menu size={16} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
