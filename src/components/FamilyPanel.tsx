import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Address,
  ChildPane,
  ChildViewFrame,
  FamilySnapshot,
  RunPresentation,
  View,
} from '../types';
import type { Workspace } from '../workspace';
import { displayError } from '../state';
import { t } from '../i18n';
import { Transcript } from './Transcript';
import { ActionCard } from './ActionCard';
import { ArrowLeft, LoaderCircle } from './ui/Icons';

export function FamilyPanel({
  workspace,
  address,
}: {
  workspace: Workspace;
  address: Address;
}) {
  const [family, setFamily] = useState<FamilySnapshot | null>(null);
  const [pane, setPane] = useState<ChildPane | null>(null);
  const [transcript, setTranscript] = useState<ChildPane['transcript'] | null>(
    null,
  );
  const [run, setRun] = useState<RunPresentation | null>(null);
  const [draft, setDraft] = useState('');
  const [childLive, setChildLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parentKey = JSON.stringify([address.endpoint, address.sessionId]);
  const latestAddress = useRef(parentKey);
  latestAddress.current = parentKey;
  const latestPane = useRef(pane);
  latestPane.current = pane;

  useEffect(() => {
    let current = true;
    const observation = new AbortController();
    setFamily(null);
    setPane(null);
    setTranscript(null);
    setRun(null);
    setChildLive(false);
    setDraft('');
    setBusy(false);
    setError('');
    workspace
      .followFamily(
        address,
        (value) => {
          if (
            current &&
            value.endpointId === address.endpoint &&
            value.parentSessionId === address.sessionId &&
            value.summary.scope.endpointId === address.endpoint &&
            value.summary.scope.sessionId === address.sessionId
          )
            setFamily(value);
          else if (current) setError(t('任务来源已变化，请重新加载'));
        },
        observation.signal,
      )
      .then(() => {
        if (current && !observation.signal.aborted) {
          setError(t('任务状态连接已结束，请返回后重新打开。'));
        }
      })
      .catch((cause) => {
        if (current && !observation.signal.aborted)
          setError(displayError(cause));
      });
    return () => {
      current = false;
      observation.abort();
    };
  }, [workspace, parentKey]);

  useEffect(() => {
    if (!pane) return;
    const observation = new AbortController();
    let current = true;
    setChildLive(false);
    setTranscript(pane.transcript);
    setRun(pane.run);
    workspace
      .followChild(
        address,
        pane,
        (frame: ChildViewFrame) => {
          if (
            current &&
            frame.handle === pane.handle &&
            frame.endpointId === address.endpoint &&
            frame.parentSessionId === address.sessionId &&
            frame.childId === pane.childId &&
            frame.connectionEpoch === pane.connectionEpoch &&
            frame.run.scope.endpointId === address.endpoint &&
            frame.run.scope.sessionId === pane.childId
          ) {
            setTranscript(frame.transcript);
            setRun(frame.run);
            setChildLive(true);
          }
        },
        observation.signal,
      )
      .then(() => {
        if (current && !observation.signal.aborted) setChildLive(false);
      })
      .catch((cause) => {
        if (current && !observation.signal.aborted) {
          setChildLive(false);
          setError(displayError(cause));
        }
      });
    return () => {
      current = false;
      observation.abort();
    };
  }, [workspace, parentKey, pane?.handle]);

  const childSummary = useMemo(
    () =>
      new Map(
        (family?.summary.subagents || []).flatMap((item) =>
          item.sessionId ? [[item.sessionId, item] as const] : [],
        ),
      ),
    [family],
  );
  async function openChild(childId: string) {
    const requestAddress = parentKey;
    setBusy(true);
    setError('');
    try {
      const opened = await workspace.openChild(address, childId);
      if (
        opened.endpointId !== address.endpoint ||
        opened.parentSessionId !== address.sessionId ||
        opened.childId !== childId ||
        opened.run.scope.endpointId !== address.endpoint ||
        opened.run.scope.sessionId !== childId
      )
        throw new Error(t('子代理来源不匹配'));
      if (latestAddress.current !== requestAddress) return;
      setPane(opened);
      setTranscript(opened.transcript);
      setRun(opened.run);
      setChildLive(false);
      setDraft(workspace.childDraft(address, childId));
    } catch (cause) {
      if (latestAddress.current === requestAddress) {
        setChildLive(false);
        setError(displayError(cause));
      }
    } finally {
      if (latestAddress.current === requestAddress) setBusy(false);
    }
  }
  async function sendChild() {
    if (
      !pane ||
      !run?.canSubmit ||
      !childLive ||
      !draft.trim() ||
      busy ||
      pane.availability !== 'available'
    )
      return;
    const text = draft,
      rpcId = crypto.randomUUID();
    const requestAddress = parentKey;
    const requestHandle = pane.handle;
    const isCurrent = () =>
      latestAddress.current === requestAddress &&
      latestPane.current?.handle === requestHandle;
    setBusy(true);
    setError('');
    try {
      await workspace.promptChild(address, pane, text, rpcId);
      workspace.clearChildDraftIfUnchanged(address, pane.childId, text);
      if (isCurrent()) setDraft(workspace.childDraft(address, pane.childId));
    } catch (cause) {
      if (isCurrent()) {
        setChildLive(false);
        setError(displayError(cause));
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  async function loadEarlier() {
    if (!pane || !childLive || busy || !transcript?.hasMoreBefore) return;
    const requestAddress = parentKey;
    const requestHandle = pane.handle;
    setBusy(true);
    setError('');
    try {
      const result = await workspace.earlierChild(
        address,
        pane,
        crypto.randomUUID(),
      );
      if (
        result.handle !== pane.handle ||
        result.connectionEpoch !== pane.connectionEpoch ||
        result.run.scope.endpointId !== address.endpoint ||
        result.run.scope.sessionId !== pane.childId
      )
        throw new Error(t('子代理会话已重连，请重新打开'));
      if (
        latestAddress.current !== requestAddress ||
        latestPane.current?.handle !== requestHandle
      )
        return;
      setTranscript(result.transcript);
      setRun(result.run);
    } catch (cause) {
      if (
        latestAddress.current === requestAddress &&
        latestPane.current?.handle === requestHandle
      ) {
        setChildLive(false);
        setError(displayError(cause));
      }
    } finally {
      if (latestAddress.current === requestAddress) setBusy(false);
    }
  }
  async function cancelChild() {
    if (!pane || !childLive || busy) return;
    const requestAddress = parentKey;
    const requestHandle = pane.handle;
    const isCurrent = () =>
      latestAddress.current === requestAddress &&
      latestPane.current?.handle === requestHandle;
    setBusy(true);
    setError('');
    try {
      await workspace.cancelChild(address, pane, crypto.randomUUID());
    } catch (cause) {
      if (isCurrent()) {
        setChildLive(false);
        setError(displayError(cause));
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  const canMutateChild =
    !!pane &&
    !!run?.canSubmit &&
    childLive &&
    pane.availability === 'available';
  const childView: View | null =
    pane && transcript && run
      ? {
          endpoint: address.endpoint,
          sessionId: pane.childId,
          run,
          transcript: {
            ...transcript,
            turns:
              transcript.turns?.map((turn) => ({
                ...turn,
                footnoteActions: [],
              })) || [],
          },
        }
      : null;

  return (
    <section className="family-panel" aria-label={t('任务与子代理')}>
      {pane ? (
        <>
          <div className="family-heading">
            <button
              type="button"
              className="icon-button"
              aria-label={t('返回任务列表')}
              onClick={() => {
                setPane(null);
                setTranscript(null);
              }}
            >
              <ArrowLeft size={16} />
            </button>
            <strong>
              {childSummary.get(pane.childId)?.title || pane.childId}
            </strong>
            <span>
              {canMutateChild
                ? t('可继续')
                : pane.availability === 'available' && !childLive
                  ? t('连接已结束')
                  : pane.availability === 'oneShot'
                    ? t('单次任务')
                    : t('只读')}
            </span>
            {pane.availability === 'available' && !childLive && (
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                onClick={() => void openChild(pane.childId)}
              >
                {t('重新打开')}
              </button>
            )}
            {childLive &&
              run?.canCancel &&
              pane.availability === 'available' && (
                <button
                  type="button"
                  className="icon-button"
                  disabled={busy}
                  onClick={() => void cancelChild()}
                >
                  {t('取消子代理')}
                </button>
              )}
          </div>
          {transcript?.hasMoreBefore && (
            <button
              type="button"
              className="history-button"
              disabled={busy || !childLive}
              onClick={() => void loadEarlier()}
            >
              {busy ? t('读取中…') : t('加载更早消息')}
            </button>
          )}
          {childView && <Transcript view={childView} />}
          {childLive &&
            run?.actionables.map((action) => (
              <ActionCard
                key={`${action.id}:${action.revision}`}
                action={action}
                workspace={workspace}
                onRespond={async (current, outcome) => {
                  if (
                    !pane ||
                    !childLive ||
                    current.sessionId !== pane.childId ||
                    run?.scope.endpointId !== address.endpoint ||
                    run.scope.sessionId !== pane.childId
                  )
                    throw new Error(t('子代理会话已断开，请重新打开'));
                  await workspace.respondAt(
                    address.endpoint,
                    current.id,
                    current.revision,
                    outcome,
                  );
                }}
              />
            ))}
          {pane.availability === 'available' ? (
            <form
              className="child-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendChild();
              }}
            >
              <textarea
                aria-label={t('发送给子代理')}
                value={draft}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value);
                  workspace.setChildDraft(address, pane.childId, value);
                }}
                disabled={busy || !canMutateChild}
              />
              <button
                type="submit"
                disabled={busy || !canMutateChild || !draft.trim()}
              >
                {busy ? <LoaderCircle size={14} className="spin" /> : t('发送')}
              </button>
            </form>
          ) : (
            <p className="family-reason">
              {pane.availability === 'oneShot'
                ? t('这是单次子代理，只能查看结果。')
                : t('当前来源不支持继续操作。')}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="family-heading">
            <strong>{t('任务与子代理')}</strong>
            {busy && <LoaderCircle size={14} className="spin" />}
          </div>
          {!!family?.summary.tasks.length && (
            <div className="family-list">
              <h3>{t('任务')}</h3>
              {family.summary.tasks.map((task) => {
                const canOpen =
                  task.scope.endpointId === address.endpoint &&
                  task.scope.threadId === family.summary.scope.threadId &&
                  task.scope.sessionId !== address.sessionId;
                return (
                  <button
                    className="family-row family-child"
                    type="button"
                    key={task.id}
                    disabled={!canOpen}
                    title={
                      canOpen
                        ? t('打开任务会话')
                        : t('任务属于当前会话或来源不可用')
                    }
                    onClick={() =>
                      canOpen &&
                      void workspace.select({
                        endpoint: task.scope.endpointId,
                        sessionId: task.scope.sessionId,
                      })
                    }
                  >
                    <span>{task.name}</span>
                    {task.status && <small>{task.status}</small>}
                  </button>
                );
              })}
            </div>
          )}
          {!!family?.subagentCatalog?.entries.filter(
            (entry) => entry.kind === 'child',
          ).length && (
            <div className="family-list">
              <h3>{t('子代理')}</h3>
              {family.subagentCatalog.entries
                .filter((entry) => entry.kind === 'child')
                .map((entry) => {
                  const fact = childSummary.get(entry.id);
                  return (
                    <button
                      className="family-row family-child"
                      type="button"
                      key={entry.id}
                      disabled={busy}
                      onClick={() => void openChild(entry.id)}
                    >
                      <span>{fact?.title || entry.label || entry.id}</span>
                      <small>
                        {fact?.status || entry.mode || t('状态未知')}
                      </small>
                    </button>
                  );
                })}
            </div>
          )}
          {family &&
            !family.summary.tasks.length &&
            !family.subagentCatalog?.entries.some(
              (entry) => entry.kind === 'child',
            ) && (
              <p className="family-reason">
                {t('当前会话没有可读取的任务或子代理。')}
              </p>
            )}
        </>
      )}
      {error && (
        <p className="family-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
