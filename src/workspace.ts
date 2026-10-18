import { AgentClient, AuthenticationError, observe } from './api';
import {
  creationPreset,
  fileBase64,
  readPresets,
  validateFiles,
} from './composer';
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
  PresetCatalog,
  AttachmentPolicy,
  PendingAttachment,
  UploadReceipt,
} from './types';

export interface WorkspaceState {
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
  presets: Map<string, PresetCatalog>;
  preset: string | null;
  controlsLoading: boolean;
  controlsError: string;
  attachmentPolicy: AttachmentPolicy | null;
  attachments: PendingAttachment[];
  submissionStage: string;
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
    presets: new Map(),
    preset: null,
    controlsLoading: false,
    controlsError: '',
    attachmentPolicy: null,
    attachments: [],
    submissionStage: '',
  };
  private listeners = new Set<() => void>();
  private client: AgentClient | null = null;
  private observations: AbortController[] = [];
  private viewAbort?: AbortController;
  private epoch = 0;
  private bootEpoch = 0;
  private pending = new Set<string>();
  private creationIDs = new Map<string, string>();
  private submissionIDs = new Map<string, { id: string; signature: string }>();
  private attachmentDrafts = new Map<string, PendingAttachment[]>();
  private presetChoices = new Map<string, string>();
  private modelChoices = new Map<string, ModelChoice>();
  private presetRequests = new Map<string, Promise<PresetCatalog>>();
  private uploadReceipts = new Map<string, UploadReceipt>();
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
      attachments: this.attachmentDrafts.get(this.key()) || [],
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
    this.presetRequests.clear();
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
        presets: new Map(),
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
        void this.presetCatalog(endpoint).catch(() => {});
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
      preset: null,
      controlsError: '',
      attachmentPolicy: null,
    });
    savePreference('tekes.web.selection', 'null');
    this.restoreDraft();
    if (endpoint) {
      void this.loadModels(endpoint, undefined, this.epoch);
      void this.loadControls(endpoint, undefined, this.epoch);
    }
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
      preset: null,
      controlsError: '',
      attachmentPolicy: null,
    });
    savePreference('tekes.web.selection', JSON.stringify(address));
    this.restoreDraft();
    const client = this.clientOrThrow();
    void this.loadControls(address.endpoint, address.sessionId, epoch);
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
      const remembered = !sessionId ? this.modelChoices.get(this.key()) : null;
      const chosen =
        models.find(
          (m) =>
            m.id === (remembered || current)?.model &&
            m.provider === (remembered || current)?.provider,
        ) || (!sessionId ? models[0] : undefined);
      if (epoch === this.epoch)
        this.update({
          models,
          model: chosen
            ? {
                provider: chosen.provider,
                model: chosen.id,
                ...((remembered || current)?.reasoningEffort
                  ? {
                      reasoningEffort: (remembered || current)!.reasoningEffort,
                    }
                  : {}),
              }
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
    this.modelChoices.set(this.key(), model);
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
      !s.controlsLoading &&
      !s.controlsError &&
      !!s.model &&
      (!!s.draft.trim() || !!s.attachments.length) &&
      (s.selected ? !!s.view?.run.canSubmit : s.cwd.startsWith('/'))
    );
  }
  async submit() {
    if (!this.canSend()) return;
    const key = this.key(),
      text = this.state.draft,
      desiredModel = this.state.model;
    const files = [...this.state.attachments],
      desiredPreset = this.state.preset;
    const endpoint = this.state.endpoints.find(
      (e) => e.id === (this.state.selected?.endpoint || this.state.newEndpoint),
    )!;
    const target = this.state.selected
      ? { ...this.state.selected }
      : { endpoint: this.state.newEndpoint, sessionId: '' };
    const cwd = this.state.cwd,
      epoch = this.epoch,
      client = this.clientOrThrow();
    let targetKey = key;
    this.pending.add(key);
    this.update({
      busy: true,
      error: '',
      submissionStage: target.sessionId ? '正在发送' : '正在创建会话',
    });
    try {
      if (!target.sessionId) {
        if (!this.creationIDs.has(key))
          this.creationIDs.set(key, crypto.randomUUID());
        const created = await client.call<{ sessionId: string }>(
          target.endpoint,
          'session.create',
          { cwd, ...creationPreset(endpoint, desiredPreset) },
          this.creationIDs.get(key),
        );
        target.sessionId = created.sessionId;
        this.creationIDs.delete(key);
        targetKey = addressKey(target.endpoint, target.sessionId);
        if (desiredPreset) this.presetChoices.set(targetKey, desiredPreset);
        this.drafts.set(targetKey, text);
        this.drafts.clearIfUnchanged(key, text);
        this.pending.add(targetKey);
        this.attachmentDrafts.set(targetKey, files);
        const submittedIDs = new Set(files.map((f) => f.id));
        this.attachmentDrafts.set(
          key,
          (this.attachmentDrafts.get(key) || []).filter(
            (f) => !submittedIDs.has(f.id),
          ),
        );
        if (epoch === this.epoch) await this.select(target);
        if (!desiredModel) throw new Error('会话已创建，请选择模型后发送。');
        await client.call(target.endpoint, 'session.selectModel', {
          sessionId: target.sessionId,
          ...desiredModel,
        });
        if (this.key() === targetKey)
          await this.loadModels(target.endpoint, target.sessionId, this.epoch);
      }
      const content: Record<string, unknown>[] = text.trim()
        ? [{ type: 'text', text }]
        : [];
      for (let i = 0; i < files.length; i++) {
        const attachment = files[i],
          uploadKey = `${targetKey}:${attachment.id}`;
        if (this.key() === targetKey)
          this.update({ submissionStage: `上传附件 ${i + 1}/${files.length}` });
        let uploaded = this.uploadReceipts.get(uploadKey);
        if (!uploaded) {
          uploaded = await client.call<UploadReceipt>(
            target.endpoint,
            'session.uploadFile',
            {
              sessionId: target.sessionId,
              name: attachment.file.name,
              mediaType: attachment.file.type || 'application/octet-stream',
              data: await fileBase64(attachment.file),
            },
            attachment.id,
          );
          if (
            !uploaded.receiptId ||
            uploaded.file.bytes !== attachment.file.size
          )
            throw new Error('附件上传回执无效，文件仍保留在输入框中。');
          this.uploadReceipts.set(uploadKey, uploaded);
        }
        content.push({ type: 'file', receiptId: uploaded.receiptId });
      }
      if (this.key() === targetKey)
        this.update({ submissionStage: '正在发送' });
      const signature = JSON.stringify([text, files.map((f) => f.id)]);
      let receipt = this.submissionIDs.get(targetKey);
      if (!receipt || receipt.signature !== signature) {
        receipt = { signature, id: crypto.randomUUID() };
        this.submissionIDs.set(targetKey, receipt);
      }
      await client.call(
        target.endpoint,
        'session.prompt',
        {
          sessionId: target.sessionId,
          mode: 'queue',
          content,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        receipt.id,
      );
      this.drafts.clearIfUnchanged(targetKey, text);
      this.submissionIDs.delete(targetKey);
      const submittedIDs = new Set(files.map((f) => f.id));
      this.attachmentDrafts.set(
        targetKey,
        (this.attachmentDrafts.get(targetKey) || []).filter(
          (f) => !submittedIDs.has(f.id),
        ),
      );
      for (const file of files)
        this.uploadReceipts.delete(`${targetKey}:${file.id}`);
    } catch (error) {
      this.fail(error);
    } finally {
      this.pending.delete(key);
      this.pending.delete(targetKey);
      this.restoreDraft();
      this.update({ submissionStage: '' });
    }
  }
  private async presetCatalog(endpoint: Endpoint): Promise<PresetCatalog> {
    let request = this.presetRequests.get(endpoint.id);
    if (!request) {
      const client = this.clientOrThrow(),
        bootEpoch = this.bootEpoch;
      request = readPresets(client, endpoint)
        .then((catalog) => {
          if (bootEpoch === this.bootEpoch) {
            const presets = new Map(this.state.presets);
            presets.set(endpoint.id, catalog);
            this.update({ presets });
          }
          return catalog;
        })
        .catch((error) => {
          if (this.presetRequests.get(endpoint.id) === request)
            this.presetRequests.delete(endpoint.id);
          throw error;
        });
      this.presetRequests.set(endpoint.id, request);
    }
    return request;
  }
  private async loadControls(
    endpointID: string,
    sessionId: string | undefined,
    epoch: number,
  ) {
    const endpoint = this.state.endpoints.find((e) => e.id === endpointID);
    if (!endpoint) return;
    this.update({ controlsLoading: true });
    try {
      const [catalog, policy] = await Promise.all([
        this.presetCatalog(endpoint),
        endpoint.capabilities?.methods?.includes('attachments.policy')
          ? this.clientOrThrow().call<AttachmentPolicy>(
              endpointID,
              'attachments.policy',
              sessionId ? { sessionId } : {},
            )
          : Promise.resolve(null),
      ]);
      if (epoch !== this.epoch) return;
      const remembered = this.presetChoices.get(this.key());
      const current = sessionId
        ? this.state.inventories
            .get(endpointID)
            ?.find((e) => e.sessionId === sessionId)?.summary
        : null;
      const selected = sessionId
        ? current?.agentPreset ||
          current?.initialPresetID ||
          current?.identityProfile ||
          current?.preset?.layers?.[0]?.id ||
          current?.preset?.base ||
          remembered ||
          null
        : catalog.presets.find(
            (p) => p.id === remembered && !p.broken && !p.unavailableReason,
          )?.id ||
          catalog.defaultID ||
          catalog.presets.find((p) => p.id === 'general')?.id ||
          catalog.presets.find((p) => !p.broken && !p.unavailableReason)?.id ||
          null;
      this.update({
        preset: selected,
        attachmentPolicy: policy,
        controlsError: '',
      });
    } catch (error) {
      if (epoch === this.epoch)
        this.update({ controlsError: displayError(error) });
    } finally {
      if (epoch === this.epoch) this.update({ controlsLoading: false });
    }
  }
  choosePreset = (preset: string) => {
    if (this.state.selected || this.state.busy) return;
    const catalog = this.state.presets.get(this.state.newEndpoint);
    if (
      !catalog?.presets.some(
        (p) => p.id === preset && !p.broken && !p.unavailableReason,
      )
    )
      return;
    this.presetChoices.set(this.key(), preset);
    this.update({ preset });
  };
  async presetConfiguration(): Promise<string> {
    const endpoint = this.state.selected?.endpoint || this.state.newEndpoint,
      id = this.state.preset;
    const preset = this.state.presets
      .get(endpoint)
      ?.presets.find((p) => p.id === id);
    if (this.state.selected && !id)
      return '当前 Harness 没有报告此会话的初始预设。';
    return (
      preset?.configurationText ||
      preset?.description ||
      '此 Harness 没有提供该预设的配置文本。'
    );
  }
  addFiles = (files: File[]) => {
    if (this.state.busy) return;
    const endpoint = this.state.endpoints.find(
      (e) => e.id === (this.state.selected?.endpoint || this.state.newEndpoint),
    );
    if (!endpoint?.capabilities?.methods?.includes('session.uploadFile')) {
      this.fail(new Error('当前 Harness 不支持附件上传。'));
      return;
    }
    try {
      const existing = this.attachmentDrafts.get(this.key()) || [];
      validateFiles(
        files,
        existing.map((f) => f.file),
        this.state.attachmentPolicy,
      );
      const attachments = [
        ...existing,
        ...files.map((file) => ({ id: crypto.randomUUID(), file })),
      ];
      this.attachmentDrafts.set(this.key(), attachments);
      this.update({ attachments });
    } catch (error) {
      this.fail(error);
    }
  };
  removeFile = (id: string) => {
    if (this.state.busy) return;
    const attachments = this.state.attachments.filter((f) => f.id !== id);
    this.attachmentDrafts.set(this.key(), attachments);
    this.update({ attachments });
  };
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
