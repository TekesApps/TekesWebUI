import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Pencil,
  Sparkles,
  X,
} from 'lucide-react';
import {
  displayError,
  folderName,
  preference,
  savePreference,
  scrollPolicy,
} from './state';
import type { Workspace } from './workspace';
import { Transcript } from './components/Transcript';
import { ActionCard } from './components/ActionCard';
import { Dialog } from './components/Dialog';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import {
  Menu as PopupMenu,
  MenuItem,
  MenuLabel,
  ChoiceMenu,
} from './components/ui/Menu';

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span
      className={large ? 'brand-mark large' : 'brand-mark'}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
const phaseLabels: Record<string, string> = {
  loading: '读取中',
  idle: '已完成',
  running: '正在工作',
  waitingForInput: '等待确认',
  interrupted: '已中断',
  unavailable: '重新连接中',
  archived: '已归档',
};

export default function App({ workspace: w }: { workspace: Workspace }) {
  const s = useSyncExternalStore(w.subscribe, w.snapshot);
  const [settings, setSettings] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [mobile, setMobile] = useState(false);
  const [renaming, setRenaming] = useState(false),
    [rename, setRename] = useState(''),
    [renameBusy, setRenameBusy] = useState(false),
    [renameError, setRenameError] = useState('');
  const [appearance, setAppearance] = useState(
    preference('tekes.web.appearance') || 'system',
  );
  const [token, setToken] = useState(''),
    [directory, setDirectory] = useState(false),
    [help, setHelp] = useState(false);
  const [atBottom, setAtBottom] = useState(true),
    [historyBusy, setHistoryBusy] = useState(false);
  const prompt = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true),
    previousKey = useRef('');
  const key = w.key(),
    selectedEndpoint = s.endpoints.find(
      (e) => e.id === (s.selected?.endpoint || s.newEndpoint),
    );
  const row =
    s.selected &&
    s.inventories
      .get(s.selected.endpoint)
      ?.find((e) => e.sessionId === s.selected?.sessionId)?.summary;
  const title = s.selected
    ? w.titles.title(s.selected.endpoint, s.selected.sessionId, row || {})
    : '新建会话';
  const cwd = s.selected ? row?.cwd || s.hostWorkspace : s.cwd;
  const ready = s.endpoints.filter((e) => e.connection === 'ready').length;
  const health = !s.authenticated
    ? '尚未连接'
    : ready === s.endpoints.length && ready
      ? '所有 Agent 已连接'
      : ready
        ? `${ready}/${s.endpoints.length} 个 Agent 已连接`
        : '正在重新连接';
  const selectedModel = s.models.find(
    (m) => m.provider === s.model?.provider && m.id === s.model.model,
  );

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme =
        appearance === 'system'
          ? matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : appearance;
    };
    const media = matchMedia('(prefers-color-scheme: dark)');
    apply();
    media.addEventListener('change', apply);
    savePreference('tekes.web.appearance', appearance);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        w.newSession();
        setMobile(false);
        requestAnimationFrame(() => prompt.current?.focus());
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSidebar(true);
        setMobile(true);
      }
      if (event.key === 'Escape') {
        setMobile(false);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  useLayoutEffect(() => {
    const node = prompt.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
    }
  }, [s.draft, key]);
  useLayoutEffect(() => {
    if (previousKey.current !== key) {
      followBottom.current = true;
      setAtBottom(true);
      previousKey.current = key;
    }
    const selection = window.getSelection();
    const selected =
      selection &&
      !selection.isCollapsed &&
      scroll.current?.contains(selection.anchorNode);
    if (scroll.current && followBottom.current && !selected)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [s.view, key]);
  const newSession = (path?: string, endpoint?: string) => {
    w.newSession(path, endpoint);
    setMobile(false);
    setDirectory(false);
    requestAnimationFrame(() => prompt.current?.focus());
  };
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!w.canSend()) return;
    followBottom.current = true;
    setAtBottom(true);
    void w.submit();
  }
  async function loadEarlier() {
    const node = scroll.current;
    if (!node || historyBusy) return;
    const previousHeight = node.scrollHeight,
      top = node.scrollTop,
      previousAddress = w.key();
    followBottom.current = false;
    setHistoryBusy(true);
    await w.earlier();
    requestAnimationFrame(() => {
      if (w.key() === previousAddress)
        node.scrollTop = top + node.scrollHeight - previousHeight;
    });
    setHistoryBusy(false);
  }
  const composer = (
    <Composer workspace={w} state={s} prompt={prompt} onSubmit={submit} />
  );

  return (
    <div
      className={`app-shell ${sidebar ? '' : 'sidebar-hidden'} ${mobile ? 'mobile-open' : ''}`}
    >
      {mobile && (
        <button
          className="scrim"
          aria-label="关闭侧栏"
          onClick={() => setMobile(false)}
        />
      )}
      <Sidebar
        workspace={w}
        state={s}
        health={health}
        onNew={newSession}
        onSelect={() => {
          setMobile(false);
        }}
        onSettings={() => setSettings(true)}
        onHelp={() => setHelp(true)}
        onCollapse={() => {
          setSidebar(false);
          setMobile(false);
        }}
      />
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button show-sidebar"
            aria-label="切换侧栏"
            onClick={() => {
              setSidebar(!sidebar);
              setMobile(!mobile);
            }}
          >
            <Menu size={18} />
          </button>
          <div className="breadcrumb">
            <FolderOpen size={15} />
            <span title={cwd}>
              {s.selected ? folderName(cwd) : '个人工作空间'}
            </span>
            {s.selected && (
              <>
                <ChevronRight size={12} />
                <h1>{title}</h1>
              </>
            )}
          </div>
          <div className="topbar-right">
            {s.selected && (
              <>
                <span
                  className={`run-status ${s.view?.run.phase === 'running' ? 'active' : ''}`}
                >
                  {phaseLabels[s.view?.run.phase || 'loading'] || ''}
                </span>
                <span className="harness-badge">{selectedEndpoint?.name}</span>
                <PopupMenu
                  label="会话操作"
                  trigger={
                    <button className="icon-button" aria-label="会话操作">
                      <MoreHorizontal size={19} />
                    </button>
                  }
                >
                  <MenuLabel>会话操作</MenuLabel>
                  <MenuItem
                    icon={<Pencil size={15} />}
                    disabled={
                      !selectedEndpoint?.capabilities?.methods?.includes(
                        'session.rename',
                      )
                    }
                    onSelect={() => {
                      setRename(title);
                      setRenameError('');
                      setRenaming(true);
                    }}
                  >
                    重命名
                  </MenuItem>
                  <MenuItem
                    icon={<Archive size={15} />}
                    disabled={
                      !selectedEndpoint?.capabilities?.supportsArchiveSession ||
                      !!s.view?.run.canCancel
                    }
                    onSelect={() => {
                      void w.archive();
                    }}
                  >
                    归档会话
                  </MenuItem>
                </PopupMenu>
              </>
            )}
            {!s.selected && <span className="web-label">WEB WORKSPACE</span>}
          </div>
        </header>
        {s.error && s.authenticated && (
          <div className="error-banner" role="alert">
            <span>{s.error}</span>
            <button
              className="icon-button"
              aria-label="关闭错误提示"
              onClick={w.dismissError}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!s.selected ? (
          <div className="welcome-scroll">
            <section className="welcome">
              <div className="welcome-heading">
                <BrandMark large />
                <div className="eyebrow">留出空间，专注创造</div>
                <h1>把想法，变成进展。</h1>
                <p>从一个问题开始，也可以交给我一项完整的工作。</p>
              </div>
              {composer}
              <div className="workspace-context">
                <button
                  className="directory-toggle"
                  aria-expanded={directory}
                  onClick={() => setDirectory(!directory)}
                >
                  <Folder size={14} />
                  <span>{folderName(s.cwd)}</span>
                  <ChevronDown size={12} />
                </button>
                <span className="context-separator" />
                本地工作空间
              </div>
              {directory && (
                <div className="directory-editor">
                  <label htmlFor="cwd">工作目录</label>
                  <input
                    id="cwd"
                    aria-label="工作目录"
                    defaultValue={s.cwd}
                    key={s.cwd}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== s.cwd)
                        newSession(e.target.value.trim(), s.newEndpoint);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                  <small>使用当前 Agent 获授权访问的目录。</small>
                </div>
              )}
              <div className="suggestions">
                <button
                  onClick={() => {
                    w.setDraft(
                      '请先了解当前项目的结构，概括它的用途，并指出接下来值得关注的地方。',
                    );
                    prompt.current?.focus();
                  }}
                >
                  <FolderOpen size={17} />
                  <span>了解一个项目</span>
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => {
                    w.setDraft(
                      '帮我把下面的想法整理成一个清晰、可执行的计划：\n\n',
                    );
                    prompt.current?.focus();
                  }}
                >
                  <Sparkles size={17} />
                  <span>梳理一个想法</span>
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => {
                    w.setDraft(
                      '请帮我检查当前项目，找出一个有实际影响的问题，说明原因并提出修复建议。',
                    );
                    prompt.current?.focus();
                  }}
                >
                  <Check size={17} />
                  <span>解决一个问题</span>
                  <ArrowUp size={13} />
                </button>
              </div>
              <p className="welcome-note">
                <span className="health-dot" />
                关闭浏览器后，任务仍在后台继续。
              </p>
            </section>
            <div className="welcome-footer">
              TekesWebUI <span>·</span> 为专注的工作而建
            </div>
          </div>
        ) : (
          <>
            <div
              className="conversation-scroll"
              ref={scroll}
              tabIndex={0}
              aria-label="会话内容"
              onScroll={() => {
                if (!scroll.current) return;
                const selection = window.getSelection();
                followBottom.current = scrollPolicy(
                  scroll.current,
                  !!selection &&
                    !selection.isCollapsed &&
                    !!scroll.current.contains(selection.anchorNode),
                );
                setAtBottom(followBottom.current);
              }}
            >
              <div className="conversation">
                {s.view?.transcript?.hasMoreBefore && (
                  <button
                    className="history-button"
                    disabled={historyBusy}
                    onClick={() => void loadEarlier()}
                  >
                    {historyBusy ? '读取中…' : '加载更早消息'}
                  </button>
                )}
                <Transcript view={s.view} />
                {s.view?.run.actionables.map((action) => (
                  <ActionCard
                    key={`${action.id}:${action.revision}`}
                    action={action}
                    workspace={w}
                  />
                ))}
              </div>
            </div>
            <div className="composer-dock">
              {!atBottom && (
                <button
                  className="jump-bottom icon-button"
                  aria-label="回到最新消息"
                  onClick={() => {
                    followBottom.current = true;
                    setAtBottom(true);
                    if (scroll.current)
                      scroll.current.scrollTop = scroll.current.scrollHeight;
                  }}
                >
                  <ArrowDown size={17} />
                </button>
              )}
              <div className="composer-inner">
                {composer}
                <div className="composer-caption">
                  <span>
                    Enter 发送 <span>·</span> Shift Enter 换行
                  </span>
                  <span title={selectedModel?.id}>
                    {selectedEndpoint?.name} <span>·</span> 后台持续运行
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
      {!s.authenticated && (
        <Dialog title="连接到你的工作空间">
          <div className="auth-mark">
            <LockKeyhole size={24} />
          </div>
          <p className="dialog-description">
            通过本机宿主安全连接到 Agent。会话和任务将在后台持续运行。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void w.connect(token);
            }}
          >
            <label htmlFor="token">浏览器访问令牌</label>
            <input
              id="token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="输入访问令牌"
              required
              disabled={s.connecting}
            />
            {s.error && (
              <p className="inline-error" role="alert">
                {s.error}
              </p>
            )}
            <button className="primary full-width" disabled={s.connecting}>
              {s.connecting ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  正在连接…
                </>
              ) : (
                '连接工作空间'
              )}
            </button>
          </form>
          <p className="dialog-note">
            从 CLI 启动入口打开页面，可自动完成认证。
          </p>
        </Dialog>
      )}
      {settings && (
        <Dialog title="连接与设置" onClose={() => setSettings(false)}>
          <div className="connections">
            {s.endpoints.map((e) => (
              <div className="connection-row" key={e.id}>
                <span
                  className={`health-dot ${e.connection !== 'ready' ? 'warning' : ''}`}
                />
                <strong>{e.name}</strong>
                <span>
                  {e.connection === 'ready'
                    ? e.host?.product.version || '已连接'
                    : '重新连接中'}
                </span>
                {typeof e.connection === 'object' && (
                  <small>{e.connection.failed}</small>
                )}
              </div>
            ))}
          </div>
          <div className="settings-row">
            外观
            <ChoiceMenu
              label="外观"
              side="bottom"
              value={appearance}
              options={[
                { value: 'system', label: '跟随系统' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ]}
              onChange={setAppearance}
            />
          </div>
          <p className="dialog-note">
            App 与浏览器通过同一个 AgentKit
            服务访问会话。模型、权限与后台进程由本机宿主管理。
          </p>
        </Dialog>
      )}
      {help && (
        <Dialog title="在浏览器中工作" onClose={() => setHelp(false)}>
          <div className="help-copy">
            <p>
              使用左侧文件夹查找 App 中的会话，也可以切换 Agent 创建新会话。
            </p>
            <p>
              发送前选择真实模型。任务由后台宿主运行，关闭页面不会停止执行；回来后选择同一会话即可查看进展。
            </p>
            <p>⌘K 搜索会话，Enter 发送，Shift Enter 换行。</p>
          </div>
        </Dialog>
      )}
      {renaming && (
        <Dialog
          title="重命名会话"
          onClose={() => {
            if (!renameBusy) setRenaming(false);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (renameBusy) return;
              setRenameBusy(true);
              try {
                await w.rename(rename);
                setRenaming(false);
              } catch (error) {
                setRenameError(displayError(error));
              } finally {
                setRenameBusy(false);
              }
            }}
          >
            <label htmlFor="rename">会话名称</label>
            <input
              id="rename"
              autoFocus
              required
              maxLength={300}
              value={rename}
              onChange={(e) => setRename(e.target.value)}
            />
            {renameError && (
              <p className="inline-error" role="alert">
                {renameError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={renameBusy}
                onClick={() => setRenaming(false)}
              >
                取消
              </button>
              <button className="primary" disabled={renameBusy}>
                保存
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
