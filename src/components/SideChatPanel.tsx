import { useEffect, useRef, useState } from 'react';
import type { Address } from '../types';
import type { SideChat, SideChatOperations, SideChatState } from '../sidechat';
import { displayError } from '../state';
import { t } from '../i18n';

export interface SideChatPanelProps {
  address: Address;
  operations: SideChatOperations;
  activeSessionId?: string;
  /** The host selects the real child address and reuses its full Run/Composer. */
  onOpen: (chat: SideChat) => Promise<void>;
  /** Called only after discard or authoritative absence, including offscreen. */
  onClosed: (chat: SideChat) => Promise<void>;
  onParent?: () => Promise<void>;
}

/** Navigation never closes a SideChat. Only the explicit discard button does. */
export function SideChatPanel(props: SideChatPanelProps) {
  return (
    <ParentSideChats
      key={JSON.stringify([props.address.endpoint, props.address.sessionId])}
      {...props}
    />
  );
}

function ParentSideChats({
  address,
  operations,
  activeSessionId,
  onOpen,
  onClosed,
  onParent,
}: SideChatPanelProps) {
  const [snapshot, setSnapshot] = useState<SideChatState | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const callbacks = useRef({ operations, onOpen, onClosed, onParent });
  callbacks.current = { operations, onOpen, onClosed, onParent };

  function accept(next: SideChatState) {
    if (
      next.endpointId !== address.endpoint ||
      next.parentSessionId !== address.sessionId ||
      next.chats.some(
        (chat) =>
          chat.parent.endpointId !== address.endpoint ||
          chat.parent.sessionId !== address.sessionId ||
          chat.scope.endpointId !== address.endpoint ||
          chat.scope.threadId !== chat.scope.sessionId ||
          chat.scope.sessionId === address.sessionId,
      )
    )
      throw new Error(t('临时会话来源已变化，请重新读取。'));
    if (mounted.current) {
      setSnapshot(next);
      setFresh(true);
    }
  }

  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      accept(await callbacks.current.operations.load());
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
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function create() {
    if (!snapshot || !fresh || !snapshot.supported || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const previous = new Set(snapshot.chats.map((chat) => chat.handle));
    try {
      const result = await callbacks.current.operations.create(
        snapshot.connectionEpoch,
        crypto.randomUUID(),
      );
      accept(result);
      const created = result.chats.find((chat) => !previous.has(chat.handle));
      // A late fork belongs to its original parent; it remains in the owner
      // but must not navigate a parent selected after this request began.
      if (mounted.current && created) await callbacks.current.onOpen(created);
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

  async function close(chat: SideChat) {
    if (!fresh || pending.current || chat.phase !== 'ready') return;
    pending.current = true;
    setBusy(true);
    setError('');
    const closed = callbacks.current.onClosed;
    try {
      const result = await callbacks.current.operations.close(
        chat,
        crypto.randomUUID(),
      );
      accept(result);
      if (!result.removedHandles?.includes(chat.handle))
        throw new Error(t('服务未确认临时分支已丢弃，请先核对。'));
      // Cleanup remains bound to this pointer even if the panel unmounted.
      // The callback must not clear a different currently selected draft.
      await closed(chat);
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

  async function reconcile() {
    if (!snapshot || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const original = snapshot.chats;
    const closed = callbacks.current.onClosed;
    try {
      const result = await callbacks.current.operations.reconcile(
        snapshot.connectionEpoch,
      );
      accept(result);
      for (const chat of original)
        if (result.removedHandles?.includes(chat.handle)) await closed(chat);
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

  async function open(chat: SideChat) {
    if (pending.current || !fresh) return;
    setError('');
    try {
      await callbacks.current.onOpen(chat);
    } catch (cause) {
      if (mounted.current) setError(displayError(cause));
    }
  }

  return (
    <section className="family-panel" aria-label={t('临时分支')}>
      <header className="family-heading">
        <h3>{t('临时分支')}</h3>
        {onParent && activeSessionId !== address.sessionId && (
          <button
            disabled={busy}
            onClick={() => {
              void callbacks.current.onParent?.().catch((cause) => {
                if (mounted.current) setError(displayError(cause));
              });
            }}
          >
            {t('返回主会话')}
          </button>
        )}
        <button disabled={busy} onClick={() => void refresh()}>
          {t('刷新临时分支')}
        </button>
        <button disabled={busy || !snapshot} onClick={() => void reconcile()}>
          {t('核对临时分支')}
        </button>
      </header>
      <p>{t('临时分支使用独立草稿；打开后复用完整会话编辑器。')}</p>
      {snapshot && !snapshot.supported && (
        <p>{t('此 Harness 当前不支持临时分支。')}</p>
      )}
      {snapshot?.unknownCreation && (
        <p role="alert">
          {t('创建结果未知，请先核对，不能重复创建。')}{' '}
          {snapshot.unknownCreation}
        </p>
      )}
      {snapshot?.chats.map((chat) => {
        const usable =
          fresh &&
          snapshot.supported &&
          chat.phase === 'ready' &&
          chat.connectionEpoch === snapshot.connectionEpoch;
        return (
          <div className="family-row" key={chat.handle}>
            <strong>{chat.title}</strong>
            {chat.error && <span role="alert">{chat.error}</span>}
            {chat.phase === 'unknown' && (
              <span>{t('结果未知，请先核对。')}</span>
            )}
            {chat.phase === 'closing' && <span>{t('正在结算并关闭…')}</span>}
            <button
              disabled={busy || !usable}
              aria-current={
                activeSessionId === chat.scope.sessionId ? 'page' : undefined
              }
              onClick={() => void open(chat)}
            >
              {t('打开临时分支')}
            </button>
            <button disabled={busy || !usable} onClick={() => void close(chat)}>
              {t('关闭并丢弃临时分支')}
            </button>
          </div>
        );
      })}
      <button
        disabled={
          busy ||
          !fresh ||
          !snapshot?.supported ||
          snapshot.creating ||
          !!snapshot.unknownCreation
        }
        onClick={() => void create()}
      >
        {snapshot?.creating ? t('正在创建临时分支…') : t('新建临时分支')}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
