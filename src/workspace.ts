import { AgentClient, AuthenticationError, observe } from './api';
import {
  addressKey,
  browserStorage,
  catalogModels,
  displayError,
  DraftStore,
  preference,
  savePreference,
  TitleReceipts,
} from './state';
import type {
  Address,
  Catalog,
  Endpoint,
  Inventory,
  Model,
  ModelChoice,
  Session,
  View,
} from './types';

interface WorkspaceState {
  endpoints: Endpoint[];
  inventories: Map<string, Session[]>;
  selected: Address | null;
  view: View | null;
  hostWorkspace: string;
  newEndpoint: string;
  cwd: string;
  models: Model[];
  model: ModelChoice | null;
  modelLoading: boolean;
  draft: string;
  busy: boolean;
  error: string;
  authenticated: boolean;
  connecting: boolean;
}

/** View state only. AgentKit and the Harnesses own sessions and execution lifetime. */
export class Workspace {
  private state: WorkspaceState = {
    endpoints: [],
    inventories: new Map(),
    selected: null,
    view: null,
    hostWorkspace: '',
    newEndpoint: '',
    cwd: '',
    models: [],
    model: null,
    modelLoading: false,
    draft: '',
    busy: false,
    error: '',
    authenticated: false,
    connecting: false,
  };
  private listeners = new Set<() => void>();
  private client: AgentClient | null = null;
  private observations: AbortController[] = [];
  private viewAbort?: AbortController;
  private epoch = 0;
  private bootEpoch = 0;
  private pending = new Set<string>();
  private creationIDs = new Map<string, string>();
  private submissionIDs = new Map<string, { id: string; text: string }>();
  readonly titles = new TitleReceipts();
  readonly drafts = new DraftStore(browserStorage());
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  key() {
    const s = this.state;
    return s.selected
      ? addressKey(s.selected.endpoint, s.selected.sessionId)
      : addressKey(s.newEndpoint, '', s.cwd);
  }
  private clientOrThrow() {
    if (!this.client) throw new AuthenticationError('请先连接本机服务。');
    return this.client;
  }
  private fail = (error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof AuthenticationError) {
      this.dispose();
      this.update({
        authenticated: false,
        connecting: false,
        modelLoading: false,
      });
    }
    this.update({ error: displayError(error) });
  };
  dismissError = () => this.update({ error: '' });
  setDraft = (draft: string) => {
    this.drafts.set(this.key(), draft);
    this.update({ draft });
  };
  private restoreDraft() {
    this.update({
      draft: this.drafts.get(this.key()),
      busy: this.pending.has(this.key()),
    });
  }
  dispose() {
    ++this.bootEpoch;
    ++this.epoch;
    this.observations.forEach((a) => a.abort());
    this.observations = [];
    this.viewAbort?.abort();
  }

  async connect(token: string) {
    this.dispose();
    const epoch = this.bootEpoch;
    const client = new AgentClient(token.trim());
    this.client = client;
    this.update({ connecting: true, error: '' });
    try {
      const [endpoints, info] = await Promise.all([
        client.unary<Endpoint[]>({ op: 'endpoints' }),
        client.unary<{ workspace: string }>({ op: 'host.info' }),
      ]);
      if (epoch !== this.bootEpoch) return;
      try {
        browserStorage()?.setItem('tekes.agentkit.token', token.trim());
      } catch {
        /* In-memory authentication still works. */
      }
      this.update({
        authenticated: true,
        connecting: false,
        endpoints,
        inventories: new Map(),
        hostWorkspace: info.workspace,
      });
      let remembered: Address | null = null;
      try {
        remembered = JSON.parse(
          preference('tekes.web.selection') || 'null',
        ) as Address | null;
      } catch {
        /* Optional. */
      }
      this.newSession(
        info.workspace,
        endpoints.find((e) => e.kind === 'tekes')?.id || endpoints[0]?.id || '',
      );
      const restoreEpoch = this.epoch;
      let restored = false;
      for (const endpoint of endpoints) {
        const abort = new AbortController();
        this.observations.push(abort);
        void observe<Inventory>(
          client,
          { endpoint: endpoint.id, target: 'state' },
          (inventory) => {
            if (epoch !== this.bootEpoch) return;
            const inventories = new Map(this.state.inventories);
            inventories.set(endpoint.id, inventory.sessions);
            this.update({
              inventories,
              endpoints: this.state.endpoints.map((e) =>
                e.id === endpoint.id ? inventory.description : e,
              ),
            });
            if (this.epoch !== restoreEpoch) restored = true;
            if (
              !restored &&
              remembered?.endpoint === endpoint.id &&
              inventory.sessions.some(
                (e) =>
                  e.sessionId === remembered?.sessionId &&
                  e.summary?.status !== 'archived',
              )
            ) {
              restored = true;
              void this.select(remembered);
            }
          },
          (error) => {
            if (epoch !== this.bootEpoch) return;
            this.update({
              endpoints: this.state.endpoints.map((e) =>
                e.id === endpoint.id
                  ? { ...e, connection: { failed: '连接已断开，正在重连' } }
                  : e,
              ),
            });
            this.fail(error);
          },
          abort.signal,
        );
      }
    } catch (error) {
      if (epoch === this.bootEpoch) {
        this.update({ connecting: false });
        this.fail(error);
      }
    }
  }

  newSession = (
    cwd = this.state.hostWorkspace,
    endpoint = this.state.newEndpoint || this.state.endpoints[0]?.id || '',
  ) => {
    ++this.epoch;
    this.viewAbort?.abort();
    this.update({
      selected: null,
      view: null,
      cwd,
      newEndpoint: endpoint,
      model: null,
      models: [],
      error: '',
    });
    savePreference('tekes.web.selection', 'null');
    this.restoreDraft();
    if (endpoint) void this.loadModels(endpoint, undefined, this.epoch);
  };
  async select(address: Address) {
    ++this.epoch;
    const epoch = this.epoch;
    this.viewAbort?.abort();
    const abort = new AbortController();
    this.viewAbort = abort;
    this.update({
      selected: address,
      view: null,
      model: null,
      models: [],
      error: '',
    });
    savePreference('tekes.web.selection', JSON.stringify(address));
    this.restoreDraft();
    const client = this.clientOrThrow();
    void observe<View>(
      client,
      { ...address, target: 'view' },
      (value) => {
        if (epoch === this.epoch) this.update({ view: value });
      },
      (error) => {
        if (epoch === this.epoch) {
          // A broken observer must immediately disable submission until fresh authority returns.
          this.update({
            view: this.state.view
              ? {
                  ...this.state.view,
                  run: {
                    ...this.state.view.run,
                    canSubmit: false,
                    canCancel: false,
                  },
                }
              : null,
          });
          this.fail(error);
        }
      },
      abort.signal,
    );
    return this.loadModels(address.endpoint, address.sessionId, epoch);
  }
  private async loadModels(
    endpoint: string,
    sessionId: string | undefined,
    epoch: number,
  ) {
    if (epoch === this.epoch) this.update({ modelLoading: true });
    try {
      const catalog = await this.clientOrThrow().call<Catalog>(
        endpoint,
        sessionId ? 'session.models' : 'models.list',
        sessionId ? { sessionId } : {},
      );
      const models = catalogModels(catalog),
        current = catalog.current || catalog.selected;
      const chosen =
        models.find(
          (m) => m.id === current?.model && m.provider === current.provider,
        ) || (!sessionId ? models[0] : undefined);
      if (epoch === this.epoch)
        this.update({
          models,
          model: chosen
            ? { provider: chosen.provider, model: chosen.id }
            : null,
        });
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    } finally {
      if (epoch === this.epoch) this.update({ modelLoading: false });
    }
  }
  async chooseModel(model: ModelChoice) {
    const { selected } = this.state,
      epoch = this.epoch;
    this.update({ model });
    if (!selected) return;
    this.update({ modelLoading: true });
    try {
      await this.clientOrThrow().call(
        selected.endpoint,
        'session.selectModel',
        { sessionId: selected.sessionId, ...model },
      );
    } catch (error) {
      this.fail(error);
    } finally {
      if (epoch === this.epoch)
        await this.loadModels(selected.endpoint, selected.sessionId, epoch);
    }
  }
  canSend() {
    const s = this.state,
      endpoint = s.endpoints.find(
        (e) => e.id === (s.selected?.endpoint || s.newEndpoint),
      );
    return (
      s.authenticated &&
      endpoint?.connection === 'ready' &&
      !s.busy &&
      !s.modelLoading &&
      !!s.model &&
      !!s.draft.trim() &&
      (s.selected ? !!s.view?.run.canSubmit : s.cwd.startsWith('/'))
    );
  }
  async submit() {
    if (!this.canSend()) return;
    const key = this.key(),
      text = this.state.draft,
      desiredModel = this.state.model;
    const target = this.state.selected
      ? { ...this.state.selected }
      : { endpoint: this.state.newEndpoint, sessionId: '' };
    const cwd = this.state.cwd,
      epoch = this.epoch,
      client = this.clientOrThrow();
    let targetKey = key;
    this.pending.add(key);
    this.update({ busy: true, error: '' });
    try {
      if (!target.sessionId) {
        if (!this.creationIDs.has(key))
          this.creationIDs.set(key, crypto.randomUUID());
        const created = await client.call<{ sessionId: string }>(
          target.endpoint,
          'session.create',
          { cwd },
          this.creationIDs.get(key),
        );
        target.sessionId = created.sessionId;
        this.creationIDs.delete(key);
        targetKey = addressKey(target.endpoint, target.sessionId);
        this.drafts.set(targetKey, text);
        this.drafts.clearIfUnchanged(key, text);
        this.pending.add(targetKey);
        if (epoch === this.epoch) await this.select(target);
        if (!desiredModel) throw new Error('会话已创建，请选择模型后发送。');
        await client.call(target.endpoint, 'session.selectModel', {
          sessionId: target.sessionId,
          ...desiredModel,
        });
        if (this.key() === targetKey)
          await this.loadModels(target.endpoint, target.sessionId, this.epoch);
      }
      let receipt = this.submissionIDs.get(targetKey);
      if (!receipt || receipt.text !== text) {
        receipt = { text, id: crypto.randomUUID() };
        this.submissionIDs.set(targetKey, receipt);
      }
      await client.call(
        target.endpoint,
        'session.prompt',
        {
          sessionId: target.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        receipt.id,
      );
      this.drafts.clearIfUnchanged(targetKey, text);
      this.submissionIDs.delete(targetKey);
    } catch (error) {
      this.fail(error);
    } finally {
      this.pending.delete(key);
      this.pending.delete(targetKey);
      this.restoreDraft();
    }
  }
  async cancel() {
    const s = this.state.selected;
    if (!s || !this.state.view?.run.canCancel) return;
    try {
      await this.clientOrThrow().call(s.endpoint, 'session.cancel', {
        sessionId: s.sessionId,
      });
    } catch (error) {
      this.fail(error);
    }
  }
  async rename(title: string) {
    const s = this.state.selected;
    if (!s || !title.trim()) return;
    const result = await this.clientOrThrow().call<{
      title?: string;
      seq: number;
    }>(s.endpoint, 'session.rename', {
      sessionId: s.sessionId,
      title: title.trim(),
    });
    this.titles.remember(
      s.endpoint,
      s.sessionId,
      result.title || title.trim(),
      result.seq,
    );
    this.update({});
  }
  async archive() {
    const s = this.state.selected;
    if (!s || this.state.view?.run.canCancel) return;
    try {
      await this.clientOrThrow().call(s.endpoint, 'session.archive', {
        sessionId: s.sessionId,
      });
      if (this.key() === addressKey(s.endpoint, s.sessionId)) this.newSession();
    } catch (error) {
      this.fail(error);
    }
  }
  async earlier() {
    const s = this.state.selected;
    if (!s) return;
    try {
      await this.clientOrThrow().unary({ op: 'earlier', ...s });
    } catch (error) {
      this.fail(error);
    }
  }
  async respond(
    actionableId: string,
    expectedRevision: number,
    outcome: unknown,
  ) {
    const s = this.state.selected;
    if (!s) return;
    await this.clientOrThrow().unary({
      op: 'respond',
      endpoint: s.endpoint,
      actionableId,
      expectedRevision,
      outcome,
    });
  }
}
