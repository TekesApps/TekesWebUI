import { SideChatPanel } from './components/SideChatPanel';
import { HarnessLogo } from './components/HarnessLogo';
import { TekesIcon } from './components/ui/TekesIcon';
import { PresetEditor } from './components/PresetEditor';
import { RecoveryPanel } from './components/RecoveryPanel';
import { WorkspacePanel } from './components/WorkspacePanel';
import { HarnessSettings } from './components/HarnessSettings';
import { ContextDetails } from './components/ContextDetails';
import { t, useLocale, setLocale } from './i18n';
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
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Sparkles,
  X,
} from './components/ui/Icons';
import {
  displayError,
  folderName,
  preference,
  savePreference,
  scrollPolicy,
} from './state';
import type { Workspace } from './workspace';
import type { Address } from './types';
import { SessionActions } from './components/SessionActions';
import { Transcript } from './components/Transcript';
import { AnnotationCapture } from './components/Annotations';
import { ActionCard } from './components/ActionCard';
import { Dialog } from './components/Dialog';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { SidebarDivider } from './components/SidebarDivider';
import { FamilyPanel } from './components/FamilyPanel';
import { GoalPanel } from './components/GoalPanel';
import { ResourcePicker } from './components/ResourcePicker';
import {
  Menu as PopupMenu,
  MenuItem,
  MenuLabel,
  ChoiceMenu,
} from './components/ui/Menu';

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <img
      className={large ? 'brand-mark large' : 'brand-mark'}
      src="/app-icon.png"
      alt=""
    />
  );
}
const phaseLabels: Record<string, string> = {
  loading: '读取中',
  idle: '未运行',
  running: '正在工作',
  waitingForInput: '等待确认',
  interrupted: '已中断',
  unavailable: '重新连接中',
  archived: '已归档',
};

export default function App({ workspace: w }: { workspace: Workspace }) {
  const language = useLocale();
  const s = useSyncExternalStore(w.subscribe, w.snapshot, w.snapshot);
  const [settings, setSettings] = useState(false),
    [familyOpen, setFamilyOpen] = useState(false),
    [workspacePanelOpen, setWorkspacePanelOpen] = useState(false),
    [advancedPresetOpen, setAdvancedPresetOpen] = useState(false),
    [workspaceChoice, setWorkspaceChoice] = useState({
      scope: '',
      identity: '',
    }),
    [toolsPanel, setToolsPanel] = useState<
      | 'goal'
      | 'catalog'
      | 'settings'
      | 'context'
      | 'recovery'
      | 'sideChat'
      | null
    >(null),
    [sidebar, setSidebar] = useState(true),
    [mobile, setMobile] = useState(false);
  const [reconnecting, setReconnecting] = useState<Set<string>>(
    () => new Set(),
  );
  const [renameTarget, setRenameTarget] = useState<
    (Address & { actionId: string }) | null
  >(null);
  const [renaming, setRenaming] = useState(false),
    [rename, setRename] = useState(''),
    [renameBusy, setRenameBusy] = useState(false),
    [renameError, setRenameError] = useState('');
  const [appearance, setAppearance] = useState(
    preference('tekes.web.appearance') || 'system',
  );
  const [token, setToken] = useState(''),
    [help, setHelp] = useState(false);
  const [atBottom, setAtBottom] = useState(true),
    [historyBusy, setHistoryBusy] = useState(false);
  const prompt = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true),
    previousKey = useRef('');
  const harnessWorkspace = w.harnessWorkspaceSource();
  const workspaceOptions = [
    ...(harnessWorkspace
      ? [{ ...harnessWorkspace, source: 'harness' as const }]
      : []),
    ...s.workspaceServices.map((entry) => ({
      ...entry,
      title: t('本地宿主：{0}', entry.title),
      source: 'local' as const,
    })),
  ];
  const workspaceSelectionScope = w.key();
  const selectedWorkspace =
    workspaceOptions.find(
      (entry) =>
        workspaceChoice.scope === workspaceSelectionScope &&
        JSON.stringify([entry.connectionId, entry.workspaceId]) ===
          workspaceChoice.identity,
    ) || workspaceOptions[0];
  const workspaceAvailable = !!harnessWorkspace || s.workspaceServiceAvailable;
  const key = w.key(),
    selectedEndpoint = s.endpoints.find(
      (e) => e.id === (s.selected?.endpoint || s.newEndpoint),
    );
  const runPhase = s.view?.run.phase || 'loading';
  const runLabel = t(phaseLabels[runPhase] || '');
  const row = s.selected && w.sessionEntry(s.selected)?.summary;
  const sideChat = w.sideChatOrigin();
  const sideChatParent = sideChat
    ? {
        endpoint: sideChat.parent.endpointId,
        sessionId: sideChat.parent.sessionId,
      }
    : s.selected;
  const title = s.selected
    ? sideChat?.title ||
      w.titles.title(s.selected.endpoint, s.selected.sessionId, row || {})
    : t('新建会话');
  const cwd = s.selected ? row?.cwd || s.hostWorkspace : s.cwd;
  const ready = s.endpoints.filter((e) => e.connection === 'ready').length;
  const health = !s.authenticated
    ? t('尚未连接')
    : ready === s.endpoints.length && ready
      ? t('所有 Agent 已连接')
      : ready
        ? t('{0}/{1} 个 Agent 已连接', ready, s.endpoints.length)
        : t('正在重新连接');
  const selectedModel = s.models.find(
    (m) => m.provider === s.model?.provider && m.id === s.model.model,
  );

  function openRename(address: Address, name: string, actionId: string) {
    setRenameTarget({ ...address, actionId });
    setRename(name);
    setRenameError('');
    setMobile(false);
    setRenaming(true);
  }

  function reconnectEndpoint(endpoint: string) {
    if (reconnecting.has(endpoint)) return;
    setReconnecting((current) => new Set(current).add(endpoint));
    void w.reconnectEndpoint(endpoint).finally(() => {
      setReconnecting((current) => {
        const next = new Set(current);
        next.delete(endpoint);
        return next;
      });
    });
  }

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
    const loaded = await w.earlier();
    requestAnimationFrame(() => {
      if (loaded && w.key() === previousAddress)
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
          aria-label={t('关闭侧栏')}
          onClick={() => setMobile(false)}
        />
      )}
      <Sidebar
        loadThreadSearch={w.threadSearch}
        workspace={w}
        state={s}
        health={health}
        onNew={newSession}
        onSelect={() => {
          setMobile(false);
        }}
        onRename={openRename}
        onSettings={() => setSettings(true)}
        onHelp={() => setHelp(true)}
        onCollapse={() => {
          setSidebar(false);
          setMobile(false);
        }}
      />
      {sidebar && <SidebarDivider />}
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button show-sidebar"
            aria-label={t('切换侧栏')}
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
              {s.selected ? folderName(cwd) : t('个人工作空间')}
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
                  className={`run-status ${runPhase === 'running' ? 'active' : ''}`}
                >
                  {runLabel}
                </span>
                <span className="harness-badge" title={selectedEndpoint?.name}>
                  <HarnessLogo kind={selectedEndpoint?.kind} size={14} />
                  <span className="harness-badge-name">
                    {selectedEndpoint?.name}
                  </span>
                </span>
                <button
                  className={`icon-button topbar-action family-toggle${familyOpen ? ' active' : ''}`}
                  type="button"
                  aria-label={familyOpen ? t('关闭任务') : t('任务')}
                  title={familyOpen ? t('关闭任务') : t('任务')}
                  aria-expanded={familyOpen}
                  onClick={() => setFamilyOpen((value) => !value)}
                >
                  <TekesIcon name="tekes-task" size={16} />
                  <span className="topbar-action-label">{t('任务')}</span>
                </button>
                <PopupMenu
                  label={t('会话工具')}
                  trigger={
                    <button
                      type="button"
                      className={`icon-button topbar-action${toolsPanel ? ' active' : ''}`}
                      aria-label={t('会话工具')}
                      title={t('会话工具')}
                    >
                      <TekesIcon name="tekes-tools" size={16} />
                      <span className="topbar-action-label">
                        {t('会话工具')}
                      </span>
                      <ChevronDown
                        size={12}
                        className="topbar-action-chevron"
                      />
                    </button>
                  }
                >
                  {(
                    [
                      ['catalog', 'agent.catalog', t('命令与技能')],
                      ['goal', 'agent.goal.read', t('目标')],
                      ['settings', 'agent.settings.read', t('Harness 设置')],
                      ['context', 'agent.context.read', t('上下文')],
                      ['recovery', 'agent.recovery.read', t('恢复会话')],
                      ['sideChat', 'agent.sideChat.state', t('临时会话')],
                    ] as const
                  ).map(
                    ([panel, method, label]) =>
                      selectedEndpoint?.capabilities?.methods?.includes(
                        method,
                      ) && (
                        <MenuItem
                          key={panel}
                          selected={toolsPanel === panel}
                          onSelect={() =>
                            setToolsPanel(toolsPanel === panel ? null : panel)
                          }
                        >
                          {label}
                        </MenuItem>
                      ),
                  )}
                </PopupMenu>
                <SessionActions
                  workspace={w}
                  state={s}
                  address={s.selected}
                  title={title}
                  onRename={openRename}
                />
              </>
            )}
            {workspaceAvailable && (
              <button
                className={`icon-button topbar-action${workspacePanelOpen ? ' active' : ''}`}
                type="button"
                aria-label={t('文件与 Git')}
                title={t('文件与 Git')}
                aria-expanded={workspacePanelOpen}
                onClick={() => setWorkspacePanelOpen((open) => !open)}
              >
                <TekesIcon name="tekes-files" size={16} />
                <span className="topbar-action-label">{t('文件')}</span>
              </button>
            )}
            {!s.selected && <span className="web-label">WEB WORKSPACE</span>}
          </div>
        </header>
        {s.error && s.authenticated && (
          <div className="error-banner" role="alert">
            <span>{t(s.error)}</span>
            <button
              className="icon-button"
              aria-label={t('关闭错误提示')}
              onClick={w.dismissError}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {workspacePanelOpen && workspaceAvailable ? (
          <div className="conversation-scroll">
            <div className="conversation">
              <div className="family-heading">
                <label>
                  {t('文件来源')}
                  <select
                    value={
                      selectedWorkspace
                        ? JSON.stringify([
                            selectedWorkspace.connectionId,
                            selectedWorkspace.workspaceId,
                          ])
                        : ''
                    }
                    onChange={(event) =>
                      setWorkspaceChoice({
                        scope: workspaceSelectionScope,
                        identity: event.target.value,
                      })
                    }
                    disabled={s.workspaceServicesLoading}
                  >
                    {workspaceOptions.map((entry) => (
                      <option
                        key={JSON.stringify([
                          entry.connectionId,
                          entry.workspaceId,
                        ])}
                        value={JSON.stringify([
                          entry.connectionId,
                          entry.workspaceId,
                        ])}
                      >
                        {entry.title}
                      </option>
                    ))}
                  </select>
                </label>
                {s.workspaceServiceAvailable && (
                  <button
                    type="button"
                    disabled={s.workspaceServicesLoading}
                    onClick={() => void w.refreshWorkspaceServices()}
                  >
                    {t('刷新工作区目录')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setWorkspacePanelOpen(false)}
                >
                  {t('返回会话')}
                </button>
              </div>
              {s.workspaceServicesLoading && (
                <p role="status">{t('正在读取工作区目录。')}</p>
              )}
              {s.workspaceServicesError && (
                <p role="alert" className="inline-error">
                  {s.workspaceServicesError}
                </p>
              )}
              {!s.workspaceServicesLoading &&
                !s.workspaceServicesError &&
                !selectedWorkspace && <p>{t('宿主尚未注册工作区。')}</p>}
              {selectedWorkspace && (
                <WorkspacePanel
                  connectionId={selectedWorkspace.connectionId}
                  workspaceId={selectedWorkspace.workspaceId}
                  label={selectedWorkspace.title}
                  call={(method, payload, rpcId) =>
                    selectedWorkspace.source === 'harness'
                      ? w.harnessWorkspaceCall(
                          selectedWorkspace,
                          method,
                          payload,
                          rpcId,
                        )
                      : w.workspaceServiceCall(
                          selectedWorkspace.connectionId,
                          selectedWorkspace.workspaceId,
                          method,
                          payload,
                          rpcId,
                        )
                  }
                />
              )}
            </div>
          </div>
        ) : !s.selected ? (
          <div className="welcome-scroll">
            <section className="welcome">
              <div className="welcome-heading">
                <BrandMark large />
                <div className="eyebrow">{t('留出空间，专注创造')}</div>
                <h1>{t('把想法，变成进展。')}</h1>
                <p>{t('从一个问题开始，也可以交给我一项完整的工作。')}</p>
              </div>
              {composer}
              {selectedEndpoint?.capabilities?.methods?.includes(
                'agent.preset.describe',
              ) &&
                selectedEndpoint.capabilities.methods.includes(
                  'agent.preset.preview',
                ) &&
                typeof selectedEndpoint.connectionEpoch === 'number' && (
                  <div className="advanced-preset-controls">
                    <button
                      type="button"
                      disabled={s.busy}
                      aria-expanded={advancedPresetOpen}
                      onClick={() => setAdvancedPresetOpen((open) => !open)}
                    >
                      {advancedPresetOpen
                        ? t('收起高级预设')
                        : t('高级会话预设')}
                    </button>
                    {s.advancedPreset && (
                      <div className="family-panel">
                        <p title={s.advancedPreset.resolution.digest}>
                          {t(
                            '已应用高级预设：{0}，{1} 层',
                            s.advancedPreset.resolution.base,
                            s.advancedPreset.resolution.layers.length,
                          )}
                        </p>
                        {s.advancedPreset.resolution.defaults && (
                          <p>
                            {t(
                              '启动模型由高级预设决定：{0} / {1}',
                              s.advancedPreset.resolution.defaults.provider,
                              s.advancedPreset.resolution.defaults.model,
                            )}
                          </p>
                        )}
                        {s.advancedPreset.connectionEpoch !==
                          selectedEndpoint.connectionEpoch && (
                          <p role="alert">
                            {t('高级预设预览已过期，请重新预览或清除。')}
                          </p>
                        )}
                        <button
                          type="button"
                          disabled={s.busy}
                          onClick={w.clearAdvancedPreset}
                        >
                          {t('清除高级预设，恢复普通预设')}
                        </button>
                      </div>
                    )}
                    {advancedPresetOpen && (
                      <PresetEditor
                        endpointId={selectedEndpoint.id}
                        cwd={s.cwd}
                        connectionEpoch={selectedEndpoint.connectionEpoch}
                        models={s.models}
                        initialPreset={s.advancedPreset?.preset}
                        describe={() =>
                          w.describeAdvancedPreset(
                            selectedEndpoint.id,
                            s.cwd,
                            selectedEndpoint.connectionEpoch!,
                          )
                        }
                        preview={(preset) =>
                          w.previewAdvancedPreset(
                            selectedEndpoint.id,
                            s.cwd,
                            selectedEndpoint.connectionEpoch!,
                            preset,
                          )
                        }
                        onApply={(preset, resolution) => {
                          try {
                            w.applyAdvancedPreset(
                              selectedEndpoint.id,
                              s.cwd,
                              selectedEndpoint.connectionEpoch!,
                              preset,
                              resolution,
                            );
                            setAdvancedPresetOpen(false);
                          } catch (cause) {
                            w.actionFailed(cause);
                          }
                        }}
                      />
                    )}
                  </div>
                )}
              <div className="workspace-context">
                <button
                  className="directory-toggle"
                  aria-haspopup="dialog"
                  aria-label={t('选择工作目录')}
                  title={s.cwd}
                  disabled={s.directoryPicking}
                  onClick={async () => {
                    const path = await w.pickDirectory();
                    if (path && path !== s.cwd) newSession(path, s.newEndpoint);
                  }}
                >
                  {s.directoryPicking ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Folder size={14} />
                  )}
                  <span>
                    {s.directoryPicking
                      ? t('正在选择目录…')
                      : folderName(s.cwd)}
                  </span>
                  <ChevronDown size={12} />
                </button>
                <span className="context-separator" />
                {t('本地工作空间')}
              </div>
              <div className="suggestions">
                <button
                  onClick={() => {
                    w.setDraft(
                      t(
                        '请先了解当前项目的结构，概括它的用途，并指出接下来值得关注的地方。',
                      ),
                    );
                    prompt.current?.focus();
                  }}
                >
                  <FolderOpen size={17} />
                  <span>{t('了解一个项目')}</span>
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => {
                    w.setDraft(
                      t('帮我把下面的想法整理成一个清晰、可执行的计划：\n\n'),
                    );
                    prompt.current?.focus();
                  }}
                >
                  <Sparkles size={17} />
                  <span>{t('梳理一个想法')}</span>
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => {
                    w.setDraft(
                      t(
                        '请帮我检查当前项目，找出一个有实际影响的问题，说明原因并提出修复建议。',
                      ),
                    );
                    prompt.current?.focus();
                  }}
                >
                  <Check size={17} />
                  <span>{t('解决一个问题')}</span>
                  <ArrowUp size={13} />
                </button>
              </div>
              <p className="welcome-note">
                <span className="health-dot" />
                {t('关闭浏览器后，任务仍在后台继续。')}
              </p>
            </section>
            <div className="welcome-footer">
              TekesWebUI <span>·</span>
              {t(' 为专注的工作而建')}
            </div>
          </div>
        ) : (
          <>
            <div
              className="conversation-scroll"
              data-harness={selectedEndpoint?.kind}
              ref={scroll}
              tabIndex={0}
              aria-label={t('会话内容')}
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
                {sideChat && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() =>
                      void w.select({
                        endpoint: sideChat.parent.endpointId,
                        sessionId: sideChat.parent.sessionId,
                      })
                    }
                  >
                    {t('返回父会话')}
                  </button>
                )}
                {toolsPanel === 'sideChat' &&
                  sideChatParent &&
                  selectedEndpoint?.capabilities?.methods?.includes(
                    'agent.sideChat.state',
                  ) && (
                    <SideChatPanel
                      address={sideChatParent}
                      operations={w.sideChatOperations(sideChatParent)}
                      activeSessionId={s.selected?.sessionId}
                      onOpen={w.openSideChat}
                      onClosed={w.closedSideChat}
                      onParent={
                        sideChat
                          ? async () => {
                              await w.select({
                                endpoint: sideChat.parent.endpointId,
                                sessionId: sideChat.parent.sessionId,
                              });
                            }
                          : undefined
                      }
                    />
                  )}
                {toolsPanel === 'goal' &&
                  s.selected &&
                  selectedEndpoint?.capabilities?.methods?.includes(
                    'agent.goal.read',
                  ) && (
                    <GoalPanel
                      address={s.selected}
                      load={() => w.goalSnapshot(s.selected!)}
                      act={(action) => w.goalAction(s.selected!, action)}
                    />
                  )}
                {toolsPanel === 'catalog' &&
                  s.selected &&
                  s.view &&
                  selectedEndpoint?.capabilities?.methods?.includes(
                    'agent.catalog',
                  ) && (
                    <ResourcePicker
                      address={s.selected}
                      connectionEpoch={s.view.run.connectionEpoch}
                      tools={
                        selectedEndpoint?.capabilities?.methods?.includes(
                          'agent.tools.list',
                        )
                          ? { load: w.toolCatalog, resolve: w.resolveTool }
                          : undefined
                      }
                      resources={
                        selectedEndpoint?.capabilities?.methods?.includes(
                          'agent.resources.list',
                        )
                          ? {
                              list: w.skillResources,
                              read: w.readSkillResource,
                            }
                          : undefined
                      }
                      load={w.resourceCatalog}
                      run={w.runCommand}
                      selectSkill={w.selectSkill}
                      selectedSkillIds={s.skills.map((skill) => skill.id)}
                    />
                  )}
                {toolsPanel === 'settings' &&
                  s.selected &&
                  s.view &&
                  selectedEndpoint?.capabilities?.methods?.includes(
                    'agent.settings.read',
                  ) && (
                    <HarnessSettings
                      endpointId={s.selected.endpoint}
                      sessionId={s.selected.sessionId}
                      load={() =>
                        w.harnessSettings(
                          s.selected!,
                          s.view!.run.connectionEpoch,
                        )
                      }
                      mutate={(request) =>
                        w.mutateHarnessSettings(s.selected!, request)
                      }
                    />
                  )}
                {toolsPanel === 'recovery' &&
                  s.selected &&
                  s.view &&
                  selectedEndpoint?.capabilities?.methods?.includes(
                    'agent.recovery.read',
                  ) && (
                    <RecoveryPanel
                      address={s.selected}
                      load={() =>
                        w.recoverySnapshot(
                          s.selected!,
                          s.view!.run.connectionEpoch,
                        )
                      }
                      run={(request) => w.recoverSession(s.selected!, request)}
                    />
                  )}
                {toolsPanel === 'context' && s.selected && s.view && (
                  <ContextDetails
                    address={s.selected}
                    load={() =>
                      w.contextSnapshot(
                        s.selected!,
                        s.view!.run.connectionEpoch,
                      )
                    }
                  />
                )}
                {familyOpen && s.selected && (
                  <FamilyPanel
                    key={`${s.selected.endpoint}:${s.selected.sessionId}`}
                    workspace={w}
                    address={s.selected}
                  />
                )}
                {s.view?.transcript?.hasMoreBefore && (
                  <button
                    className="history-button"
                    disabled={historyBusy}
                    onClick={() => void loadEarlier()}
                  >
                    {historyBusy ? t('读取中…') : t('加载更早消息')}
                  </button>
                )}
                <AnnotationCapture
                  key={key}
                  address={s.selected}
                  onAdd={w.saveAnnotation}
                >
                  <Transcript
                    view={s.view}
                    feedback={
                      selectedEndpoint?.capabilities?.methods?.includes(
                        'agent.feedback.read',
                      )
                        ? { read: w.feedbackSnapshot, act: w.feedbackAction }
                        : undefined
                    }
                    harnessKind={selectedEndpoint?.kind}
                    onEditQueued={
                      selectedEndpoint?.capabilities?.methods?.includes(
                        'agent.queue.edit',
                      )
                        ? w.editQueuedInput
                        : undefined
                    }
                    onRemoveQueued={async (
                      address,
                      itemId,
                      connectionEpoch,
                    ) => {
                      try {
                        await w.removeQueuedInput(
                          address,
                          itemId,
                          connectionEpoch,
                        );
                      } catch (error) {
                        w.actionFailed(error);
                      }
                    }}
                    onTurnAction={async (address, actionId) => {
                      try {
                        await w.performThreadAction(address, actionId);
                      } catch (error) {
                        w.actionFailed(error);
                      }
                    }}
                    annotations={s.annotations}
                    onSaveAnnotation={w.saveAnnotation}
                    onRemoveAnnotation={w.removeAnnotation}
                  />
                </AnnotationCapture>
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
              {s.skills.length > 0 && (
                <div className="selected-skills" aria-label={t('已选技能')}>
                  {s.skills.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => w.removeSkill(skill.id)}
                      aria-label={t('移除技能：{0}', skill.title)}
                    >
                      {skill.title} ×
                    </button>
                  ))}
                </div>
              )}
              {!atBottom && (
                <button
                  className="jump-bottom icon-button"
                  aria-label={t('回到最新消息')}
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
                    {t('Enter 发送 ')}
                    <span>·</span>
                    {t(' Shift Enter 换行')}
                  </span>
                  <span
                    className="composer-session-status"
                    role="status"
                    title={[
                      selectedModel?.id,
                      t('关闭浏览器后，任务仍在后台继续。'),
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  >
                    {selectedEndpoint?.name} <span>·</span> {runLabel}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
      {!s.authenticated && (
        <Dialog title={t('连接到你的工作空间')}>
          <div className="settings-row">
            {t('语言')}
            <ChoiceMenu
              label={t('语言')}
              side="bottom"
              value={language}
              options={[
                { value: 'zh-CN', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(value) => setLocale(value as 'zh-CN' | 'en')}
            />
          </div>
          <div className="auth-mark">
            <LockKeyhole size={24} />
          </div>
          <p className="dialog-description">
            {t('通过本机宿主安全连接到 Agent。会话和任务将在后台持续运行。')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void w.connect(token);
            }}
          >
            <label htmlFor="token">{t('浏览器访问令牌')}</label>
            <input
              id="token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('输入访问令牌')}
              required
              disabled={s.connecting}
            />
            {s.error && (
              <p className="inline-error" role="alert">
                {t(s.error)}
              </p>
            )}
            <button className="primary full-width" disabled={s.connecting}>
              {s.connecting ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  {t('正在连接…')}
                </>
              ) : (
                t('连接工作空间')
              )}
            </button>
          </form>
          <p className="dialog-note">
            {t('从 CLI 启动入口打开页面，可自动完成认证。')}
          </p>
        </Dialog>
      )}
      {settings && (
        <Dialog title={t('连接与设置')} onClose={() => setSettings(false)}>
          <div className="settings-row">
            {t('语言')}
            <ChoiceMenu
              label={t('语言')}
              side="bottom"
              value={language}
              options={[
                { value: 'zh-CN', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(value) => setLocale(value as 'zh-CN' | 'en')}
            />
          </div>
          <div className="connections">
            {s.endpoints.map((e) => (
              <div className="connection-row" key={e.id}>
                <span
                  className={`health-dot ${e.connection !== 'ready' ? 'warning' : ''}`}
                />
                <strong>{e.name}</strong>
                <span>
                  {e.connection === 'ready'
                    ? e.host?.product.version || t('已连接')
                    : typeof e.connection === 'object'
                      ? t('连接失败')
                      : t('重新连接中')}
                </span>
                {typeof e.connection === 'object' && (
                  <small>{e.connection.failed}</small>
                )}
                {e.canReconnect && (
                  <button
                    type="button"
                    disabled={reconnecting.has(e.id)}
                    onClick={() => reconnectEndpoint(e.id)}
                  >
                    {reconnecting.has(e.id) ? t('重新连接中') : t('重新连接')}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="settings-row">
            {t('外观')}
            <ChoiceMenu
              label={t('外观')}
              side="bottom"
              value={appearance}
              options={[
                { value: 'system', label: t('跟随系统') },
                { value: 'light', label: t('浅色') },
                { value: 'dark', label: t('深色') },
              ]}
              onChange={setAppearance}
            />
          </div>
          <p className="dialog-note">
            {t(
              'App 与浏览器通过同一个 AgentKit 服务访问会话。模型、权限与后台进程由本机宿主管理。',
            )}
          </p>
        </Dialog>
      )}
      {help && (
        <Dialog title={t('在浏览器中工作')} onClose={() => setHelp(false)}>
          <div className="help-copy">
            <p>
              {t(
                '使用左侧文件夹查找 App 中的会话，也可以切换 Agent 创建新会话。',
              )}
            </p>
            <p>
              {t(
                '发送前选择真实模型。任务由后台宿主运行，关闭页面不会停止执行；回来后选择同一会话即可查看进展。',
              )}
            </p>
            <p>{t('⌘K 搜索会话，Enter 发送，Shift Enter 换行。')}</p>
          </div>
        </Dialog>
      )}
      {renaming && (
        <Dialog
          title={t('重命名会话')}
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
                if (!renameTarget) return;
                await w.performThreadAction(
                  renameTarget,
                  renameTarget.actionId,
                  rename,
                );
                setRenaming(false);
              } catch (error) {
                setRenameError(displayError(error));
              } finally {
                setRenameBusy(false);
              }
            }}
          >
            <label htmlFor="rename">{t('会话名称')}</label>
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
                {t('取消')}
              </button>
              <button className="primary" disabled={renameBusy}>
                {t('保存')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
