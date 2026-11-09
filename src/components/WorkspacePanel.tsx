import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { displayError } from '../state';
import {
  workspaceFileText,
  workspaceTextBase64,
  type WorkspaceCall,
  type WorkspaceCapabilities,
  type WorkspaceFile,
  type WorkspaceListing,
  type WorkspaceGitStatus,
  type WorkspaceGitBranches,
  type WorkspaceGitDiff,
  type WorkspaceGitLog,
  type WorkspaceGitNavigator,
  type WorkspaceMethod,
} from '../workspace-service';

export interface WorkspacePanelProps {
  connectionId: string;
  workspaceId: string;
  label: string;
  call: WorkspaceCall;
}

/** A host-provided identity owns the form; changing it retires every old response. */
export function WorkspacePanel(props: WorkspacePanelProps) {
  return (
    <WorkspaceForm
      key={JSON.stringify([props.connectionId, props.workspaceId])}
      {...props}
    />
  );
}

function WorkspaceForm({ workspaceId, label, call }: WorkspacePanelProps) {
  const callbacks = useRef(call);
  callbacks.current = call;
  const mounted = useRef(false);
  const readingFile = useRef(0);
  const inFlight = useRef(false);
  const [capabilities, setCapabilities] =
    useState<WorkspaceCapabilities | null>(null);
  const [tab, setTab] = useState<'files' | 'git'>('files');
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [draft, setDraft] = useState('');
  const [fileFresh, setFileFresh] = useState(false);
  const [repositoryPath, setRepositoryPath] = useState('');
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [branches, setBranches] = useState<WorkspaceGitBranches | null>(null);
  const [history, setHistory] = useState<WorkspaceGitLog | null>(null);
  const [navigator, setNavigator] = useState<WorkspaceGitNavigator | null>(
    null,
  );
  const [diff, setDiff] = useState<WorkspaceGitDiff | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [message, setMessage] = useState('');
  const commitDrafts = useRef(new Map<string, string>());
  const [remote, setRemote] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const fileRef = useRef(file);
  fileRef.current = file;
  const supports = (method: WorkspaceMethod) =>
    capabilities?.methods.includes(method) === true;
  const allowed = (method: WorkspaceMethod, operation?: string) =>
    !!capabilities?.mutations &&
    supports(method) &&
    (!operation ||
      capabilities.allowedGitOperations?.includes(operation) === true);
  const request = <T,>(
    method: WorkspaceMethod,
    payload: Record<string, unknown> = {},
  ): Promise<T> =>
    callbacks.current(
      method,
      method === 'capabilities' ? {} : { ...payload, workspaceId },
      crypto.randomUUID(),
    ) as Promise<T>;

  async function loadListing(nextPath: string, search = '') {
    const value = await request<WorkspaceListing>(
      search ? 'filesSearch' : 'filesList',
      search ? { query: search, limit: 200 } : { path: nextPath, limit: 200 },
    );
    if (!mounted.current) return;
    if (
      value.workspaceId !== workspaceId ||
      (!search && value.path !== nextPath)
    )
      throw new Error(t('工作区文件来源已变化，请重新读取。'));
    setListing(value);
    setPath(nextPath);
  }
  async function readFile(nextPath: string, discard = true) {
    const generation = ++readingFile.current;
    const value = await request<WorkspaceFile>('filesRead', {
      path: nextPath,
      maxBytes: 0,
    });
    if (!mounted.current || generation !== readingFile.current) return;
    if (value.workspaceId !== workspaceId || value.path !== nextPath)
      throw new Error(t('工作区文件来源已变化，请重新读取。'));
    const text = workspaceFileText(value);
    const prior = fileRef.current;
    if (
      !discard &&
      prior?.path === nextPath &&
      draftRef.current !== workspaceFileText(prior) &&
      prior.revision !== value.revision &&
      draftRef.current !== text
    ) {
      setFileFresh(false);
      throw new Error(
        t('文件已被其他操作修改。草稿已保留，请核对后放弃草稿并重新读取。'),
      );
    }
    setFile(value);
    setFileFresh(true);
    if (
      discard ||
      draftRef.current === text ||
      prior?.revision !== value.revision
    )
      setDraft(text ?? '');
  }
  async function loadGit(
    caps = capabilities,
    nextRepositoryPath = repositoryPath,
  ) {
    if (!caps) return;
    const has = (method: WorkspaceMethod) => caps.methods.includes(method);
    const repository = has('gitRepository')
      ? await request<{ isRepository: boolean }>('gitRepository', {
          repositoryPath: nextRepositoryPath,
        })
      : null;
    if (repository && typeof repository.isRepository !== 'boolean')
      throw new Error(t('Git 仓库状态无效，请刷新。'));
    const hasRepository = repository?.isRepository !== false;
    const [nextStatus, nextBranches, nextHistory, nextNavigator] =
      await Promise.all([
        hasRepository && has('gitStatus')
          ? request<WorkspaceGitStatus>('gitStatus', {
              repositoryPath: nextRepositoryPath,
            })
          : null,
        hasRepository && has('gitBranches')
          ? request<WorkspaceGitBranches>('gitBranches', {
              repositoryPath: nextRepositoryPath,
            })
          : null,
        hasRepository && has('gitLog')
          ? request<WorkspaceGitLog>('gitLog', {
              repositoryPath: nextRepositoryPath,
              limit: 20,
              offset: 0,
            })
          : null,
        has('gitChangesNavigator')
          ? request<WorkspaceGitNavigator>('gitChangesNavigator', {
              includeClean: false,
            })
          : null,
      ]);
    if (!mounted.current) return;
    if (!hasRepository) setNotice(t('工作区根目录不是 Git 仓库。'));
    if (nextRepositoryPath !== repositoryPath) {
      commitDrafts.current.set(repositoryPath, message);
      setMessage(commitDrafts.current.get(nextRepositoryPath) || '');
      setNewBranch('');
    }
    setRepositoryPath(nextRepositoryPath);
    setStatus(nextStatus);
    setBranches(nextBranches);
    setHistory(nextHistory);
    setNavigator(nextNavigator);
    setSelectedPaths((selected) =>
      nextRepositoryPath !== repositoryPath
        ? []
        : selected.filter((entry) =>
            nextStatus?.changes.some((change) => change.path === entry),
          ),
    );
    setBranch(nextStatus?.branch || '');
    setRemote((current) =>
      nextStatus?.remotes.includes(current)
        ? current
        : nextStatus?.remotes[0] || '',
    );
    setDiff(null);
  }
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const caps = await request<WorkspaceCapabilities>('capabilities');
      if (!mounted.current) return;
      if (caps.version !== 1) throw new Error(t('工作区服务版本不受支持。'));
      setCapabilities(caps);
      if (tab === 'files' && caps.methods.includes('filesList'))
        await loadListing(path, query.trim());
      if (fileRef.current && caps.methods.includes('filesRead'))
        await readFile(fileRef.current.path, false);
      if (tab === 'git') await loadGit(caps);
      if (mounted.current) {
        setVerified(true);
        setNotice('');
      }
    } catch (cause) {
      if (mounted.current) {
        setVerified(false);
        setError(displayError(cause));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      readingFile.current++;
    };
  }, []);

  async function readAction(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setError(displayError(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function mutate(
    method: WorkspaceMethod,
    payload: Record<string, unknown>,
    after: () => Promise<void>,
  ) {
    const operation =
      method === 'gitChangeBranch'
        ? `branch.${String(payload.operation)}`
        : method === 'gitCommit'
          ? 'commit'
          : method === 'gitPush'
            ? 'push'
            : undefined;
    if (inFlight.current || !verified || !allowed(method, operation)) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setVerified(false);
    let acknowledged = false;
    try {
      await request(method, payload);
      acknowledged = true;
      if (!mounted.current) return;
      setNotice(t('操作已确认，正在读取工作区状态。'));
      await after();
      if (mounted.current) {
        setVerified(true);
        setNotice(t('工作区状态已更新。'));
      }
    } catch (cause) {
      if (mounted.current) {
        setError(displayError(cause));
        setNotice(
          acknowledged
            ? t('操作已确认，但读取状态失败。请刷新核对，操作不会自动重发。')
            : t('操作结果尚未确认。请刷新核对后再操作，草稿已保留。'),
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const fileText = file ? workspaceFileText(file) : null;
  const canSave =
    !!file &&
    fileText !== null &&
    !!file.revision &&
    fileFresh &&
    allowed('filesWrite') &&
    verified &&
    !busy &&
    new TextEncoder().encode(draft).byteLength <= 4 * 1024 * 1024;
  return (
    <section
      className="family-panel workspace-panel"
      aria-label={t('工作区文件与 Git')}
    >
      <div className="family-heading">
        <h3>{label}</h3>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {t('刷新工作区')}
        </button>
      </div>
      <div role="tablist" aria-label={t('工作区视图')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          disabled={busy}
          onClick={() => setTab('files')}
        >
          {t('文件')}
        </button>
        {capabilities?.methods.some((method) => method.startsWith('git')) && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'git'}
            disabled={busy}
            onClick={() => {
              setTab('git');
              void readAction(() => loadGit());
            }}
          >
            {t('Git')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!capabilities && <p>{t('正在读取工作区权限。')}</p>}
      {tab === 'files' && capabilities && (
        <>
          {!supports('filesList') && <p>{t('宿主未提供文件浏览。')}</p>}
          {supports('filesSearch') && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void readAction(() => loadListing(path, query.trim()));
              }}
            >
              <label>
                {t('搜索工作区文件')}
                <input
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                {t('搜索')}
              </button>
            </form>
          )}
          {listing && (
            <>
              <p>
                {listing.path || '/'}{' '}
                {listing.truncated && t('列表未完整显示。')}
              </p>
              {path && !query.trim() && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void readAction(() =>
                      loadListing(path.split('/').slice(0, -1).join('/')),
                    )
                  }
                >
                  {t('上一级目录')}
                </button>
              )}
              <ul>
                {listing.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        (entry.kind !== 'directory' && !supports('filesRead'))
                      }
                      onClick={() =>
                        void readAction(() =>
                          entry.kind === 'directory'
                            ? loadListing(entry.path)
                            : readFile(entry.path),
                        )
                      }
                    >
                      {entry.name}
                      {entry.kind === 'directory' ? '/' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {file && (
            <div>
              <h4>{file.path}</h4>
              {fileText === null ? (
                <p>
                  {t(
                    '此文件不是完整可编辑的 UTF-8 文本，仅可在专用查看器中打开。',
                  )}
                </p>
              ) : (
                <label>
                  {t('文件内容')}
                  <textarea
                    value={draft}
                    disabled={busy}
                    readOnly={!allowed('filesWrite')}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </label>
              )}
              {supports('filesWrite') && !allowed('filesWrite') && (
                <p>{t('宿主未授予文件写入权限。')}</p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void readAction(() => readFile(file.path, true))}
              >
                {supports('filesWrite')
                  ? t('放弃草稿并重新读取')
                  : t('重新读取文件')}
              </button>
              {supports('filesWrite') && (
                <button
                  type="button"
                  disabled={!canSave || draft === fileText}
                  onClick={() => {
                    const submitted = draft;
                    void mutate(
                      'filesWrite',
                      {
                        path: file.path,
                        content: workspaceTextBase64(submitted),
                        expectedRevision: file.revision,
                      },
                      async () => {
                        await readFile(file.path, false);
                      },
                    );
                  }}
                >
                  {t('保存文件')}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {tab === 'git' && capabilities && (
        <>
          {!supports('gitStatus') && <p>{t('宿主未提供 Git 状态。')}</p>}
          {navigator?.repositories.some(
            (entry) => typeof entry.repositoryPath === 'string',
          ) && (
            <label>
              {t('Git 仓库')}
              <select
                aria-label={t('Git 仓库')}
                value={repositoryPath}
                disabled={busy}
                onChange={(event) => {
                  const selected = event.target.value;
                  void readAction(() => loadGit(capabilities, selected));
                }}
              >
                <option value="">{t('工作区根目录')}</option>
                {navigator.repositories
                  .filter(
                    (entry) =>
                      entry.repositoryPath && entry.repositoryPath !== '',
                  )
                  .map((entry) => (
                    <option
                      key={entry.repositoryPath}
                      value={entry.repositoryPath}
                    >
                      {entry.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {status && (
            <>
              <p>
                {status.branch || t('分离的 HEAD')} ·{' '}
                {t('领先 {0}，落后 {1}', status.ahead, status.behind)}
              </p>
              <ul>
                {status.changes.map((change) => (
                  <li key={change.path}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedPaths.includes(change.path)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelectedPaths((current) =>
                            event.target.checked
                              ? [...current, change.path]
                              : current.filter((path) => path !== change.path),
                          )
                        }
                      />
                      {change.path} {change.isConflict && t('存在冲突')}
                    </label>
                  </li>
                ))}
              </ul>
              {supports('gitDiff') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void readAction(async () => {
                      const result = await request<WorkspaceGitDiff>(
                        'gitDiff',
                        {
                          repositoryPath,
                          scope: 'all',
                          paths: selectedPaths,
                        },
                      );
                      if (mounted.current) setDiff(result);
                    })
                  }
                >
                  {t('查看所选差异')}
                </button>
              )}
              {diff && (
                <>
                  <p>
                    {diff.isBinary && t('包含二进制差异。')}
                    {diff.truncated && t('差异未完整显示。')}
                  </p>
                  <pre>{diff.unifiedDiff}</pre>
                </>
              )}
              {branches && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate(
                      'gitChangeBranch',
                      { repositoryPath, operation: 'switch', name: branch },
                      () => loadGit(),
                    );
                  }}
                >
                  <label>
                    {t('切换分支')}
                    <select
                      value={branch}
                      disabled={
                        busy || !allowed('gitChangeBranch', 'branch.switch')
                      }
                      onChange={(event) => setBranch(event.target.value)}
                    >
                      {branches.branches.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={
                      busy ||
                      !verified ||
                      !allowed('gitChangeBranch', 'branch.switch') ||
                      branch === status.branch
                    }
                  >
                    {t('切换分支')}
                  </button>
                </form>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(
                    'gitChangeBranch',
                    {
                      repositoryPath,
                      operation: 'create',
                      name: newBranch,
                    },
                    () => loadGit(),
                  );
                }}
              >
                <label>
                  {t('新分支名称')}
                  <input
                    value={newBranch}
                    disabled={
                      busy || !allowed('gitChangeBranch', 'branch.create')
                    }
                    onChange={(event) => setNewBranch(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !verified ||
                    !newBranch.trim() ||
                    !allowed('gitChangeBranch', 'branch.create')
                  }
                >
                  {t('创建并切换分支')}
                </button>
              </form>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(
                    'gitCommit',
                    { repositoryPath, message, paths: selectedPaths },
                    () => loadGit(),
                  );
                }}
              >
                <label>
                  {t('提交说明')}
                  <textarea
                    value={message}
                    disabled={busy || !allowed('gitCommit', 'commit')}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !verified ||
                    !message.trim() ||
                    !selectedPaths.length ||
                    !allowed('gitCommit', 'commit')
                  }
                >
                  {t('提交所选文件')}
                </button>
              </form>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate('gitPush', { repositoryPath, remote }, () =>
                    loadGit(),
                  );
                }}
              >
                <label>
                  {t('推送远端')}
                  <select
                    value={remote}
                    disabled={busy || !allowed('gitPush', 'push')}
                    onChange={(event) => setRemote(event.target.value)}
                  >
                    {status.remotes.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={
                    busy || !verified || !remote || !allowed('gitPush', 'push')
                  }
                >
                  {t('推送当前分支')}
                </button>
              </form>
            </>
          )}
          {history && (
            <div>
              <h4>{t('提交历史')}</h4>
              <ol>
                {history.commits.map((entry) => (
                  <li key={entry.id}>
                    {entry.id.slice(0, 8)} {entry.subject} · {entry.author} ·{' '}
                    {entry.date}
                  </li>
                ))}
              </ol>
              {history.nextOffset !== null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void readAction(async () => {
                      const next = await request<WorkspaceGitLog>('gitLog', {
                        repositoryPath,
                        limit: 20,
                        offset: history.nextOffset,
                        head: history.head,
                      });
                      if (mounted.current)
                        setHistory({
                          ...next,
                          commits: [...history.commits, ...next.commits],
                        });
                    })
                  }
                >
                  {t('加载更多提交')}
                </button>
              )}
            </div>
          )}
          {navigator && (
            <div>
              <h4>{t('工作区变更')}</h4>
              {navigator.repositories.map((repository) => (
                <details key={repository.repositoryRoot}>
                  <summary>
                    {repository.name} · {repository.branch}
                  </summary>
                  <ul>
                    {repository.uncommitted.map((entry) => (
                      <li key={entry.path}>
                        {entry.path} {entry.status} {entry.additions ?? '—'} /{' '}
                        {entry.deletions ?? '—'}
                      </li>
                    ))}
                  </ul>
                  <ul>
                    {repository.unpushedCommits.map((entry) => (
                      <li key={entry.commit}>
                        {entry.shortCommit} {entry.subject}
                      </li>
                    ))}
                  </ul>
                  {repository.unpushedCommitsTruncated && (
                    <p>{t('未推送提交未完整显示。')}</p>
                  )}
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
