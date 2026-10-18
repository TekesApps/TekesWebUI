import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Folder,
  Menu,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { Workspace, WorkspaceState } from '../workspace';
import {
  addressKey,
  formatTimestamp,
  groupSessions,
  preference,
  savePreference,
  shortAge,
  timestampMillis,
  type SessionSort,
} from '../state';
import { Tooltip } from './Tooltip';

export function Sidebar({
  workspace: w,
  state: s,
  health,
  onNew,
  onSelect,
  onSettings,
  onHelp,
  onCollapse,
}: {
  workspace: Workspace;
  state: WorkspaceState;
  health: string;
  onNew: (cwd?: string, endpoint?: string) => void;
  onSelect: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onCollapse: () => void;
}) {
  const [searching, setSearching] = useState(false),
    [query, setQuery] = useState(''),
    [options, setOptions] = useState(false);
  const [sort, setSort] = useState<SessionSort>(() => {
    const saved = preference('tekes.web.sidebar.sort');
    return ['recentActivity', 'titleAscending', 'titleDescending'].includes(
      saved || '',
    )
      ? (saved as SessionSort)
      : 'recentActivity';
  });
  const [grouping, setGrouping] = useState(
    preference('tekes.web.sidebar.grouping') !== 'false',
  );
  const [filter, setFilter] = useState(''),
    [running, setRunning] = useState(false),
    [limit, setLimit] = useState(8);
  const [collapsed, setCollapsed] = useState(new Set<string>()),
    [pages, setPages] = useState<Record<string, number>>({});
  const [, tick] = useState(0),
    search = useRef<HTMLInputElement>(null),
    optionsRoot = useRef<HTMLDivElement>(null);
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
        setOptions(false);
        if (document.activeElement === search.current) {
          if (query) setQuery('');
          else setSearching(false);
        }
      }
    };
    const outside = (event: MouseEvent) => {
      if (!optionsRoot.current?.contains(event.target as Node))
        setOptions(false);
    };
    document.addEventListener('keydown', keyboard);
    document.addEventListener('click', outside);
    return () => {
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('click', outside);
    };
  }, [query]);
  const inventories = new Map(s.inventories);
  if (
    s.selected &&
    s.view?.run.connection.phase === 'connected' &&
    !s.view.transcript?.isStale
  ) {
    const address = s.selected,
      active =
        s.view.run.canCancel ||
        ['running', 'waitingForInput'].includes(s.view.run.phase);
    inventories.set(
      address.endpoint,
      (s.inventories.get(address.endpoint) || []).map((entry) =>
        entry.sessionId === address.sessionId && entry.summary
          ? { ...entry, summary: { ...entry.summary, running: active } }
          : entry,
      ),
    );
  }
  const groups = groupSessions(
    s.endpoints,
    inventories,
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
    ['recentActivity', '最近活动'],
    ['titleAscending', '标题 A–Z'],
    ['titleDescending', '标题 Z–A'],
  ];
  return (
    <aside className="sidebar" aria-label="会话导航">
      <div className="sidebar-brand">
        {searching ? (
          <div className="sidebar-search">
            <Search size={15} />
            <input
              ref={search}
              autoFocus
              type="search"
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query) setSearching(false);
              }}
            />
            <button
              className="icon-button"
              title="收起搜索 Esc"
              aria-label="收起搜索"
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
              title={`${total} 个活动会话`}
              onClick={() => onNew()}
            >
              <img src="/favicon.svg" width={22} height={22} alt="" />
              <span>Tekes</span>
            </button>
            <div className="sidebar-header-actions">
              <Tooltip content="搜索会话 · ⌘K">
                <button
                  className="icon-button"
                  aria-label="搜索会话"
                  onClick={() => setSearching(true)}
                >
                  <Search size={17} />
                </button>
              </Tooltip>
            </div>
          </>
        )}
        <div className="sidebar-options-root" ref={optionsRoot}>
          <Tooltip content="列表选项 · 排序、分组与筛选">
            <button
              className={`icon-button ${options ? 'active' : ''}`}
              aria-label="会话列表选项"
              aria-expanded={options}
              onClick={() => setOptions(!options)}
            >
              <SlidersHorizontal size={17} />
              {(filter || running) && <span className="option-dot" />}
            </button>
          </Tooltip>
          {options && (
            <div
              className="sidebar-options"
              role="dialog"
              aria-label="会话列表选项"
            >
              <div className="menu-section-label">排序</div>
              {sorts.map(([value, label]) => (
                <button
                  className="option-choice"
                  aria-pressed={sort === value}
                  key={value}
                  onClick={() => {
                    setSort(value);
                    setOptions(false);
                  }}
                >
                  <span>{label}</span>
                  {sort === value && <Check size={14} />}
                </button>
              ))}
              <div className="menu-separator" />
              <div className="menu-section-label">分组</div>
              {[
                [true, '按文件夹'],
                [false, '不分组'],
              ].map(([value, label]) => (
                <button
                  className="option-choice"
                  aria-pressed={grouping === value}
                  key={String(value)}
                  onClick={() => {
                    setGrouping(value as boolean);
                    setOptions(false);
                  }}
                >
                  <span>{label}</span>
                  {grouping === value && <Check size={14} />}
                </button>
              ))}
              <div className="menu-separator" />
              <label className="option-field">
                Harness
                <select
                  aria-label="筛选 Harness"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">全部</option>
                  {s.endpoints.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="option-checkbox">
                <input
                  type="checkbox"
                  checked={running}
                  onChange={(e) => setRunning(e.target.checked)}
                />
                仅运行中
              </label>
            </div>
          )}
        </div>
      </div>
      <button className="new-chat" onClick={() => onNew()}>
        <Plus size={17} />
        <span>新建会话</span>
        <kbd>⌘ ↵</kbd>
      </button>
      {(query || filter || running) && (
        <div className="list-filter-summary">
          <span>
            {groups.reduce((n, g) => n + g.entries.length, 0)} 个结果
            {filter
              ? ` · ${s.endpoints.find((e) => e.id === filter)?.name || ''}`
              : ''}
            {running ? ' · 运行中' : ''}
          </span>
          <button
            aria-label="清除筛选"
            title="清除筛选"
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
        aria-label={grouping ? '按文件夹分组的会话' : '所有会话'}
      >
        {groups.slice(0, query ? groups.length : limit).map((group) => (
          <section
            className={`folder-group ${!grouping ? 'ungrouped' : ''}`}
            key={group.key}
          >
            {grouping && (
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
                  <Folder size={14} />
                  <span>{group.name}</span>
                </button>
                <button
                  className="icon-button folder-add"
                  aria-label={`在 ${group.name} 新建会话`}
                  title="在此文件夹新建会话"
                  onClick={() =>
                    onNew(
                      group.path || s.hostWorkspace,
                      group.entries[0]?.endpoint,
                    )
                  }
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            {(!grouping || !collapsed.has(group.key) || !!query) && (
              <>
                {group.entries
                  .slice(
                    0,
                    query
                      ? group.entries.length
                      : pages[group.key] || (grouping ? 5 : 30),
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
                        {updated && <span>最后活动 · {updated}</span>}
                        {created && <span>创建时间 · {created}</span>}
                        {entry.row.cwd && (
                          <span className="tooltip-path">{entry.row.cwd}</span>
                        )}
                      </>
                    );
                    return (
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
                          {entry.row.running ? (
                            <span className="running-dot" aria-label="运行中" />
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
                    );
                  })}
                {!query &&
                  group.entries.length >
                    (pages[group.key] || (grouping ? 5 : 30)) && (
                    <button
                      className="list-more"
                      onClick={() =>
                        setPages({
                          ...pages,
                          [group.key]:
                            (pages[group.key] || (grouping ? 5 : 30)) + 20,
                        })
                      }
                    >
                      更多会话
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
              ? '正在读取会话…'
              : query
                ? '没有找到匹配的会话'
                : '你的会话会出现在这里'}
          </p>
        )}
        {!query && groups.length > limit && (
          <button
            className="list-more more-folders"
            onClick={() => setLimit(limit + 12)}
          >
            显示更多文件夹
          </button>
        )}
      </nav>
      <div className="sidebar-bottom">
        <Tooltip content={health}>
          <button
            className="sidebar-settings"
            aria-label="连接与设置"
            onClick={onSettings}
          >
            <span
              className={`health-dot ${s.endpoints.some((e) => e.connection !== 'ready') || !s.authenticated ? 'warning' : ''}`}
            />
            <span>连接与设置</span>
            <Settings2 size={15} />
          </button>
        </Tooltip>
        <Tooltip content="使用帮助">
          <button
            className="icon-button"
            aria-label="使用帮助"
            onClick={onHelp}
          >
            <CircleHelp size={16} />
          </button>
        </Tooltip>
        <Tooltip content="收起侧栏">
          <button
            className="icon-button"
            aria-label="收起侧栏"
            onClick={onCollapse}
          >
            <Menu size={16} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
