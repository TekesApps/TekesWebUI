import { SessionActions } from './SessionActions';
import type { Workspace, WorkspaceState } from '../workspace';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import type { Address, Endpoint } from '../types';
import {
  ThreadSearchController,
  type ThreadSearchLoader,
  type ThreadSearchVisibility,
} from '../thread-search';

export function ThreadSearch({
  endpoints,
  load,
  onSelect,
  workspace,
  state: workspaceState,
  onRename,
}: {
  endpoints: Endpoint[];
  load: ThreadSearchLoader;
  onSelect: (address: Address) => void;
  workspace?: Workspace;
  state?: WorkspaceState;
  onRename?: (address: Address, title: string, actionId: string) => void;
}) {
  const available = endpoints.filter((endpoint) =>
    endpoint.capabilities?.methods?.includes('agent.threadSearch'),
  );
  const [chosenEndpoint, setChosenEndpoint] = useState('');
  const endpointId = available.some(
    (endpoint) => endpoint.id === chosenEndpoint,
  )
    ? chosenEndpoint
    : available[0]?.id || '';
  const endpoint = available.find((item) => item.id === endpointId);
  const ready = endpoint?.connection === 'ready';
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] =
    useState<ThreadSearchVisibility>('active');
  const loader = useRef(load);
  loader.current = load;
  const [controller] = useState(
    () =>
      new ThreadSearchController((id, request) => loader.current(id, request)),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    controller.reset();
    return controller.reset;
  }, [
    controller,
    endpointId,
    endpoint?.connectionEpoch,
    query,
    visibility,
    ready,
  ]);
  const queryScope = JSON.stringify([
    endpointId,
    endpoint?.connectionEpoch,
    query,
    visibility,
    ready,
  ]);
  const latestQueryScope = useRef(queryScope);
  latestQueryScope.current = queryScope;
  const search = () => {
    if (ready && query.trim())
      void controller.search({ endpointId, query, visibility });
  };
  return (
    <section className="thread-list" aria-label={t('名称检索')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <label>
          {t('Harness')}
          <select
            aria-label={t('名称检索 Harness')}
            value={endpointId}
            onChange={(event) => setChosenEndpoint(event.target.value)}
          >
            {available.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('检索范围')}
          <select
            aria-label={t('名称检索范围')}
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as ThreadSearchVisibility)
            }
          >
            <option value="active">{t('活动会话')}</option>
            <option value="archived">{t('已归档会话')}</option>
            <option value="all">{t('全部会话')}</option>
          </select>
        </label>
        <label>
          {t('会话名称')}
          <input
            type="search"
            aria-label={t('检索会话名称')}
            placeholder={t('输入会话名称')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!ready || !query.trim() || state.loading}
        >
          {state.loading ? t('读取中…') : t('检索')}
        </button>
      </form>
      <p className="list-empty">{t('按会话名称检索，不搜索消息正文。')}</p>
      {!available.length && (
        <p className="list-empty">{t('当前 Harness 未提供名称检索。')}</p>
      )}
      {available.length > 0 && !ready && (
        <p className="list-empty">{t('连接就绪后可检索。')}</p>
      )}
      {state.error && (
        <div role="alert">
          <p>{state.error}</p>
          <button
            onClick={search}
            disabled={!ready || !query.trim() || state.loading}
          >
            {t('重新搜索')}
          </button>
        </div>
      )}
      <ol aria-label={t('名称检索结果')}>
        {state.items.map((item) => {
          const harnessArchived =
            item.organization?.harnessArchived ?? item.archived;
          const archivedInApp = item.organization?.applicationArchived === true;
          return (
            <li className="thread-row" key={item.sessionId}>
              <button
                className="thread"
                disabled={!ready || harnessArchived}
                title={
                  harnessArchived
                    ? t('此会话已在原 Harness 归档，请在原 Harness 中管理。')
                    : undefined
                }
                onClick={() =>
                  onSelect({ endpoint: endpointId, sessionId: item.sessionId })
                }
              >
                <span className="thread-label">{item.title}</span>
                {archivedInApp && !harnessArchived && (
                  <small>{t('应用内归档')}</small>
                )}
              </button>
              {harnessArchived ? (
                <small className="list-empty">
                  {t('原 Harness 归档，请在原 Harness 中管理。')}
                </small>
              ) : (
                workspace &&
                workspaceState &&
                onRename && (
                  <SessionActions
                    compact
                    workspace={workspace}
                    state={workspaceState}
                    address={{
                      endpoint: endpointId,
                      sessionId: item.sessionId,
                    }}
                    title={item.title}
                    onRename={onRename}
                    onPerformed={() => {
                      if (latestQueryScope.current === queryScope) search();
                    }}
                  />
                )
              )}
            </li>
          );
        })}
      </ol>
      {state.searched &&
        !state.loading &&
        !state.error &&
        !state.items.length && (
          <p className="list-empty">
            {state.page?.reachedEnd
              ? t('没有找到匹配的会话名称。')
              : t('当前页无可见会话，可继续加载。')}
          </p>
        )}
      {state.page?.nextCursor && !state.error && (
        <button
          className="list-more"
          disabled={state.loading || !ready}
          onClick={() => void controller.more()}
        >
          {state.loading ? t('读取中…') : t('加载更多')}
        </button>
      )}
    </section>
  );
}
