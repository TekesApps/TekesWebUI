import { useEffect, useId, useRef, useState } from 'react';
import type { Address } from '../types';
import type { GoalAction, GoalSnapshot } from '../goals';
import { displayError } from '../state';
import { t } from '../i18n';

export interface GoalPanelProps {
  address: Address;
  load: () => Promise<GoalSnapshot>;
  act: (action: GoalAction) => Promise<unknown>;
}

/** A new address owns a new form and cannot receive a previous session's reads. */
export function GoalPanel(props: GoalPanelProps) {
  return (
    <SessionGoalPanel
      key={JSON.stringify([props.address.endpoint, props.address.sessionId])}
      {...props}
    />
  );
}

function SessionGoalPanel({ address, load, act }: GoalPanelProps) {
  const [snapshot, setSnapshot] = useState<GoalSnapshot | null>(null);
  const [objective, setObjective] = useState('');
  const [rounds, setRounds] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const callbacks = useRef({ load, act });
  callbacks.current = { load, act };
  const objectiveId = useId();
  const roundsId = useId();

  async function read(adoptDraft: boolean) {
    const result = await callbacks.current.load();
    if (!mounted.current) return;
    if (
      result.endpointId !== address.endpoint ||
      result.sessionId !== address.sessionId
    )
      throw new Error(t('目标来源已变化，请重新读取。'));
    setSnapshot(result);
    setFresh(true);
    if (adoptDraft) {
      setObjective(result.goal?.objective || '');
      setRounds(String(result.goal?.maxGoalRounds ?? ''));
    }
  }

  async function refresh(adoptDraft = snapshot === null) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await read(adoptDraft);
      if (mounted.current) setNotice('');
    } catch (cause) {
      if (mounted.current) {
        setFresh(false);
        setError(displayError(cause));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    return () => {
      mounted.current = false;
    };
  }, []);

  async function perform(action: GoalAction['action']) {
    if (pending.current || !snapshot || !fresh) return;
    const capability = {
      create: snapshot.capabilities.canCreate,
      edit: snapshot.capabilities.canEdit,
      pause: snapshot.capabilities.canPause,
      resume: snapshot.capabilities.canResume,
      clear: snapshot.capabilities.canClear,
    }[action];
    if (!capability) return;
    const editsObjective = action === 'create' || action === 'edit';
    const maxGoalRounds =
      action === 'create' &&
      snapshot.capabilities.canSetCreateBudget &&
      rounds.trim()
        ? Number(rounds)
        : undefined;
    if (
      editsObjective &&
      (!objective.trim() ||
        (maxGoalRounds !== undefined &&
          (!Number.isSafeInteger(maxGoalRounds) ||
            maxGoalRounds < 1 ||
            maxGoalRounds > 10000)))
    ) {
      setError(t('请填写目标，轮数须为 1 至 10000 的整数。'));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await callbacks.current.act({
        sessionId: address.sessionId,
        connectionEpoch: snapshot.connectionEpoch,
        action,
        ...(snapshot.goal ? { ref: snapshot.goal.ref } : {}),
        ...(editsObjective
          ? { objective: objective.trim(), maxGoalRounds }
          : {}),
      });
      if (!mounted.current) return;
      // Acknowledgement is not a new Goal snapshot. An unsuccessful read must not
      // leave old revisions available for another mutation or resend the action.
      setFresh(false);
      setNotice(t('操作已确认，正在读取目标状态。'));
      try {
        await read(true);
        if (mounted.current) setNotice(t('目标状态已更新。'));
      } catch (cause) {
        if (mounted.current) {
          setNotice(t('操作已确认；状态读取失败，请刷新。操作不会自动重发。'));
          setError(displayError(cause));
        }
      }
    } catch (cause) {
      if (mounted.current) {
        setFresh(false);
        setNotice(t('操作结果尚未确认，请刷新核对后再操作。'));
        setError(displayError(cause));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const goal = snapshot?.goal;
  const capabilities = snapshot?.capabilities;
  const phaseLabels = {
    active: '进行中',
    paused: '已暂停',
    blocked: '受阻',
    complete: '已完成',
  };
  const activationLabels = {
    active: '已启用',
    inactive: '未启用',
    armed: '自动续跑已启用',
    disarmed: '自动续跑未启用',
  };
  const editable = !!(goal ? capabilities?.canEdit : capabilities?.canCreate);
  return (
    <section className="family-panel" aria-label={t('会话目标')}>
      <div className="family-heading">
        <strong>{t('会话目标')}</strong>
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {t('刷新目标')}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="dialog-note" role="status">
          {notice}
        </p>
      )}
      {!snapshot && <p>{busy ? t('读取中…') : t('尚未读取目标。')}</p>}
      {snapshot && (
        <>
          {goal ? (
            <>
              <p>
                {t(
                  '状态：{0} · {1}',
                  t(phaseLabels[goal.phase]),
                  t(activationLabels[goal.activation]),
                )}
              </p>
              {goal.roundsStarted != null && (
                <p>{t('已启动 {0} 轮', goal.roundsStarted)}</p>
              )}
              {goal.maxGoalRounds != null && (
                <p>{t('最多 {0} 轮', goal.maxGoalRounds)}</p>
              )}
              {goal.blockedReason && (
                <p role="status">{goal.blockedReason.message}</p>
              )}
            </>
          ) : (
            <p>{t('此会话尚未设置目标。')}</p>
          )}
          {!editable && (
            <p className="dialog-note">
              {goal
                ? t('此目标当前只读。')
                : t('此 Harness 尚未提供新建目标。')}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(goal ? 'edit' : 'create');
            }}
          >
            <label htmlFor={objectiveId}>{t('目标内容')}</label>
            <textarea
              id={objectiveId}
              value={objective}
              disabled={!editable || busy || !fresh}
              onChange={(event) => setObjective(event.target.value)}
            />
            {!goal && editable && capabilities?.canSetCreateBudget && (
              <>
                <label htmlFor={roundsId}>{t('最多轮数（可选）')}</label>
                <input
                  id={roundsId}
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={rounds}
                  disabled={busy || !fresh}
                  onChange={(event) => setRounds(event.target.value)}
                />
              </>
            )}
            <div className="dialog-actions">
              {editable && (
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !fresh || !objective.trim()}
                >
                  {goal
                    ? t('保存目标')
                    : capabilities?.createMayRun
                      ? t('创建目标并启动')
                      : t('创建目标')}
                </button>
              )}
              {goal && capabilities?.canPause && (
                <button
                  type="button"
                  disabled={busy || !fresh}
                  onClick={() => void perform('pause')}
                >
                  {t('暂停目标')}
                </button>
              )}
              {goal && capabilities?.canResume && (
                <button
                  type="button"
                  disabled={busy || !fresh}
                  onClick={() => void perform('resume')}
                >
                  {capabilities.resumeMayRun
                    ? t('恢复目标并启动')
                    : t('恢复目标')}
                </button>
              )}
              {goal && capabilities?.canClear && (
                <button
                  type="button"
                  disabled={busy || !fresh}
                  onClick={() => void perform('clear')}
                >
                  {t('清除目标')}
                </button>
              )}
            </div>
          </form>
          {((!goal && capabilities?.createMayRun) ||
            (goal && capabilities?.canResume && capabilities.resumeMayRun)) && (
            <p className="dialog-note">
              {t('启动目标后，Harness 可能自动调用模型并继续执行。')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
