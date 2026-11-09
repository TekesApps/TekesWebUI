import type { HarnessWorkspaceReadResponse } from '@tekesagentkit/client-contract/workspace';
import type { SideChat, SideChatOperations, SideChatState } from './sidechat';
import {
  presetSignature,
  type SessionPreset,
  type SessionPresetResolution,
  type SessionPresetDefaults,
  type PresetDescriptionSnapshot,
  type PresetPreviewSnapshot,
} from './session-presets';
import type { RecoverySnapshot, RecoveryRequest } from './recovery';
import type { ThreadSearchPage, ThreadSearchQuery } from './thread-search';
import {
  WorkspaceServiceError,
  type WorkspaceDescriptor,
  type WorkspaceInventory,
  type WorkspaceCallRequest,
  type WorkspaceCallResponse,
  type WorkspaceMethod,
} from './workspace-service';
import type { FeedbackSnapshot, FeedbackAction } from './feedback';
import type { ContextSnapshot } from './context-details';
import type {
  HarnessSettingsSnapshot,
  HarnessSettingsMutation,
} from './harness-settings';
import type { GoalAction, GoalSnapshot } from './goals';
import type {
  ResourceCatalog,
  ToolCatalog,
  ToolResolution,
  SkillResource,
  SkillResourcePage,
  SkillResourceRead,
  CatalogCommand,
  CatalogSkill,
  CommandReceipt,
} from './components/ResourcePicker';
import { t, getLocale } from './i18n';
import type {
  ThreadActionsPresentation,
  ThreadActionRequest,
  ThreadActionOutcome,
} from '@tekesagentkit/client-contract';
import {
  validatePermissions,
  type PermissionPolicy,
  type PermissionModeState,
} from './permissions';
import { AgentClient, AuthenticationError, observe } from './api';
import {
  AnnotationDraftStore,
  annotationLimit,
  isAnnotation,
  type Annotation,
} from './annotations';
import type {
  AnnotationInput,
  AnnotationCompilation,
} from '@tekesagentkit/client-contract';
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
  isHarnessArchivedSession,
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
  FamilySnapshot,
  ChildPane,
  ChildViewFrame,
} from './types';

export interface HarnessWorkspaceSource extends WorkspaceDescriptor {
  provider: 'harness';
  address: Address;
  connectionEpoch: number;
}
export interface AdvancedPresetDraft {
  endpointId: string;
  cwd: string;
  connectionEpoch: number;
  preset: SessionPreset;
  resolution: SessionPresetResolution;
}
export interface WorkspaceState {
  endpoints: Endpoint[];
  inventories: Map<string, Session[]>;
  archivedInventories: Map<string, Session[]>;
  selected: Address | null;
  view: View | null;
  hostWorkspace: string;
  workspaceServiceAvailable: boolean;
  workspaceServices: WorkspaceDescriptor[];
  workspaceServicesLoading: boolean;
  workspaceServicesError: string;
  directoryEndpoints: string[];
  directoryPicking: boolean;
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
  advancedPreset: AdvancedPresetDraft | null;
  controlsLoading: boolean;
  controlsError: string;
  attachmentPolicy: AttachmentPolicy | null;
  attachments: PendingAttachment[];
  annotations: Annotation[];
  skills: CatalogSkill[];
  submissionStage: string;
  permissionPolicy: PermissionPolicy | null;
  permissionMode: string | null;
  permissionLoading: boolean;
  permissionError: string;
  threadActions: Map<string, ThreadActionsPresentation>;
  threadActionErrors: Map<string, string>;
}

/** View state only. AgentKit and the Harnesses own sessions and execution lifetime. */
export class Workspace {
  private state: WorkspaceState = {
    endpoints: [],
    inventories: new Map(),
    archivedInventories: new Map(),
    selected: null,
    view: null,
    hostWorkspace: '',
    workspaceServiceAvailable: false,
    workspaceServices: [],
    workspaceServicesLoading: false,
    workspaceServicesError: '',
    directoryEndpoints: [],
    directoryPicking: false,
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
    advancedPreset: null,
    controlsLoading: false,
    controlsError: '',
    attachmentPolicy: null,
    attachments: [],
    annotations: [],
    skills: [],
    submissionStage: '',
    permissionPolicy: null,
    permissionMode: null,
    permissionLoading: false,
    permissionError: '',
    threadActions: new Map(),
    threadActionErrors: new Map(),
  };
  private listeners = new Set<() => void>();
  private client: AgentClient | null = null;
  private observations: AbortController[] = [];
  private viewAbort?: AbortController;
  private epoch = 0;
  private bootEpoch = 0;
  private pending = new Set<string>();
  private submissionStages = new Map<string, string>();
  private creationIDs = new Map<string, string>();
  private submissionIDs = new Map<string, { id: string; signature: string }>();
  private skillDrafts = new Map<string, CatalogSkill[]>();
  private sideChats = new Map<string, SideChat>();
  private attachmentDrafts = new Map<string, PendingAttachment[]>();
  private permissionChoices = new Map<string, string>();
  private permissionUpdates = new Map<string, Promise<void>>();
  private permissionRead = 0;
  private advancedPresets = new Map<string, AdvancedPresetDraft>();
  private advancedPreviews = new Map<string, AdvancedPresetDraft>();
  private unverifiedPresetSessions = new Map<
    string,
    {
      digest: string;
      connectionEpoch: number;
      defaults?: SessionPresetDefaults;
    }
  >();
  private presetChoices = new Map<string, string>();
  private modelChoices = new Map<string, ModelChoice>();
  private presetRequests = new Map<string, Promise<PresetCatalog>>();
  private actionReads = new Map<string, Promise<ThreadActionsPresentation>>();
  private actionReceipts = new Map<string, string>();
  private actionRequests = new Map<string, Promise<ThreadActionOutcome>>();
  private reconnectRequests = new Map<string, Promise<void>>();
  private workspaceInventoryRead = 0;
  private uploadReceipts = new Map<string, UploadReceipt>();
  readonly titles = new TitleReceipts();
  readonly drafts = new DraftStore(browserStorage());
  readonly annotationDrafts = new AnnotationDraftStore(browserStorage());
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
  sideChatOrigin(address = this.state.selected): SideChat | undefined {
    return address
      ? this.sideChats.get(addressKey(address.endpoint, address.sessionId))
      : undefined;
  }
  sideChatOperations(parent: Address): SideChatOperations {
    const client = this.clientOrThrow(),
      boot = this.bootEpoch;
    const request = async (
      method: string,
      payload: Record<string, unknown>,
      rpcId?: string,
    ) => {
      const result = await client.call<SideChatState>(
        parent.endpoint,
        method,
        { ...payload, parentSessionId: parent.sessionId },
        rpcId,
      );
      if (boot !== this.bootEpoch)
        throw new Error(t('临时会话来源已变化，请重新读取。'));
      return result;
    };
    return {
      load: () => request('agent.sideChat.state', {}),
      create: (connectionEpoch, rpcId) =>
        request('agent.sideChat.create', { connectionEpoch }, rpcId),
      close: (chat, rpcId) =>
        request(
          'agent.sideChat.close',
          { handle: chat.handle, connectionEpoch: chat.connectionEpoch },
          rpcId,
        ),
      reconcile: (connectionEpoch) =>
        request('agent.sideChat.reconcile', { connectionEpoch }),
    };
  }
  openSideChat = async (chat: SideChat): Promise<void> => {
    if (
      chat.scope.endpointId !== chat.parent.endpointId ||
      chat.scope.threadId !== chat.scope.sessionId
    )
      throw new Error(t('临时会话来源已变化，请重新读取。'));
    this.sideChats.set(
      addressKey(chat.scope.endpointId, chat.scope.sessionId),
      structuredClone(chat),
    );
    await this.select({
      endpoint: chat.scope.endpointId,
      sessionId: chat.scope.sessionId,
    });
  };
  closedSideChat = async (chat: SideChat): Promise<void> => {
    const key = addressKey(chat.scope.endpointId, chat.scope.sessionId);
    if (this.sideChats.get(key)?.handle !== chat.handle) return;
    this.sideChats.delete(key);
    this.drafts.set(key, '');
    this.annotationDrafts.set(key, []);
    this.attachmentDrafts.delete(key);
    this.skillDrafts.delete(key);
    this.submissionIDs.delete(key);
    for (const upload of this.uploadReceipts.keys())
      if (upload.startsWith(key + ':')) this.uploadReceipts.delete(upload);
    if (this.key() === key)
      await this.select({
        endpoint: chat.parent.endpointId,
        sessionId: chat.parent.sessionId,
      });
  };
  feedbackSnapshot = (address: Address, itemId: string) =>
    this.clientOrThrow().call<FeedbackSnapshot>(
      address.endpoint,
      'agent.feedback.read',
      { sessionId: address.sessionId, itemId },
    );
  feedbackAction = (address: Address, action: FeedbackAction) =>
    this.clientOrThrow().call(address.endpoint, 'agent.feedback.action', {
      ...action,
      sessionId: address.sessionId,
    });
  threadSearch = (endpoint: string, query: ThreadSearchQuery) => {
    const source = this.state.endpoints.find((row) => row.id === endpoint);
    if (source?.connection !== 'ready' || source.connectionEpoch === undefined)
      throw new Error(t('连接来源已变化，请重新读取。'));
    return this.clientOrThrow().call<ThreadSearchPage>(
      endpoint,
      'agent.threadSearch',
      { ...query, connectionEpoch: source.connectionEpoch },
    );
  };
  recoverySnapshot = (address: Address, connectionEpoch: number) =>
    this.clientOrThrow().call<RecoverySnapshot>(
      address.endpoint,
      'agent.recovery.read',
      { sessionId: address.sessionId, connectionEpoch },
    );
  recoverSession = (address: Address, request: RecoveryRequest) =>
    this.clientOrThrow().call(address.endpoint, 'agent.recovery.run', {
      ...request,
      sessionId: address.sessionId,
    });
  toolCatalog = (address: Address, connectionEpoch: number) =>
    this.clientOrThrow().call<ToolCatalog>(
      address.endpoint,
      'agent.tools.list',
      { sessionId: address.sessionId, connectionEpoch },
    );
  resolveTool = (
    address: Address,
    connectionEpoch: number,
    name: string,
    catalogDigest: string,
  ) =>
    this.clientOrThrow().call<ToolResolution>(
      address.endpoint,
      'agent.tools.resolve',
      { sessionId: address.sessionId, connectionEpoch, name, catalogDigest },
    );
  skillResources = (
    address: Address,
    connectionEpoch: number,
    after?: string,
  ) =>
    this.clientOrThrow().call<SkillResourcePage>(
      address.endpoint,
      'agent.resources.list',
      {
        sessionId: address.sessionId,
        connectionEpoch,
        ...(after ? { after } : {}),
      },
    );
  readSkillResource = (
    address: Address,
    connectionEpoch: number,
    resource: SkillResource,
  ) =>
    this.clientOrThrow().call<SkillResourceRead>(
      address.endpoint,
      'agent.resources.read',
      {
        sessionId: address.sessionId,
        connectionEpoch,
        reference: resource.reference,
        uri: resource.uri,
      },
    );
  contextSnapshot = (address: Address, connectionEpoch: number) =>
    this.clientOrThrow().call<ContextSnapshot>(
      address.endpoint,
      'agent.context.read',
      { sessionId: address.sessionId, connectionEpoch },
    );
  harnessSettings = (address: Address, connectionEpoch: number) =>
    this.clientOrThrow().call<HarnessSettingsSnapshot>(
      address.endpoint,
      'agent.settings.read',
      { sessionId: address.sessionId, connectionEpoch },
    );
  mutateHarnessSettings = (
    address: Address,
    request: HarnessSettingsMutation,
  ) =>
    this.clientOrThrow().call(address.endpoint, 'agent.settings.mutate', {
      ...request,
      sessionId: address.sessionId,
    });
  refreshWorkspaceServices = async (): Promise<void> => {
    if (!this.state.workspaceServiceAvailable) return;
    const epoch = this.bootEpoch,
      read = ++this.workspaceInventoryRead;
    this.update({ workspaceServicesLoading: true, workspaceServicesError: '' });
    try {
      const inventory = await this.clientOrThrow().unary<WorkspaceInventory>({
        op: 'workspace.list',
      });
      if (epoch !== this.bootEpoch || read !== this.workspaceInventoryRead)
        return;
      if (!Array.isArray(inventory.workspaces))
        throw new Error(t('工作区目录无效，请刷新。'));
      const identities = new Set<string>();
      for (const entry of inventory.workspaces) {
        if (
          !entry ||
          typeof entry.connectionId !== 'string' ||
          !entry.connectionId ||
          typeof entry.workspaceId !== 'string' ||
          !entry.workspaceId ||
          typeof entry.title !== 'string'
        )
          throw new Error(t('工作区目录无效，请刷新。'));
        const key = JSON.stringify([entry.connectionId, entry.workspaceId]);
        if (identities.has(key)) throw new Error(t('工作区目录无效，请刷新。'));
        identities.add(key);
      }
      this.update({ workspaceServices: inventory.workspaces });
    } catch (error) {
      if (epoch === this.bootEpoch && read === this.workspaceInventoryRead)
        this.update({ workspaceServicesError: displayError(error) });
    } finally {
      if (epoch === this.bootEpoch && read === this.workspaceInventoryRead)
        this.update({ workspaceServicesLoading: false });
    }
  };
  harnessWorkspaceSource = (): HarnessWorkspaceSource | null => {
    const address = this.state.selected;
    if (!address) return null;
    const endpoint = this.state.endpoints.find(
      (entry) => entry.id === address.endpoint,
    );
    const connectionEpoch =
      this.state.view?.endpoint === address.endpoint &&
      this.state.view.sessionId === address.sessionId
        ? this.state.view.run.connectionEpoch
        : endpoint?.connectionEpoch;
    if (
      endpoint?.kind !== 'dsh' ||
      endpoint.connection !== 'ready' ||
      !endpoint.capabilities?.methods?.includes('agent.workspace.read') ||
      !Number.isSafeInteger(connectionEpoch)
    )
      return null;
    return {
      provider: 'harness',
      connectionId: JSON.stringify([
        'harness',
        address.endpoint,
        address.sessionId,
        connectionEpoch,
      ]),
      workspaceId: address.sessionId,
      title: t('DSH 会话文件（只读）'),
      address: { ...address },
      connectionEpoch: connectionEpoch!,
    };
  };
  harnessWorkspaceCall = async (
    source: HarnessWorkspaceSource,
    method: WorkspaceMethod,
    request: Record<string, unknown>,
    rpcId: string,
  ): Promise<unknown> => {
    if (!['capabilities', 'filesList', 'filesRead'].includes(method))
      throw new Error(t('此 Harness 文件接口只支持读取。'));
    const current = this.harnessWorkspaceSource();
    if (
      !current ||
      current.connectionId !== source.connectionId ||
      current.workspaceId !== source.workspaceId
    )
      throw new Error(t('Harness 文件来源已变化，请重新读取。'));
    const { workspaceId, ...body } = request;
    if (workspaceId !== undefined && workspaceId !== source.workspaceId)
      throw new Error(t('Harness 文件来源已变化，请重新读取。'));
    const boot = this.bootEpoch,
      selection = this.epoch;
    const result =
      await this.clientOrThrow().call<HarnessWorkspaceReadResponse>(
        source.address.endpoint,
        'agent.workspace.read',
        {
          sessionId: source.address.sessionId,
          connectionEpoch: source.connectionEpoch,
          method,
          request: body,
        },
        rpcId,
      );
    if (
      boot !== this.bootEpoch ||
      selection !== this.epoch ||
      this.harnessWorkspaceSource()?.connectionId !== source.connectionId ||
      result.provider !== 'harness' ||
      result.endpointId !== source.address.endpoint ||
      result.sessionId !== source.address.sessionId ||
      result.workspaceId !== source.workspaceId ||
      result.connectionEpoch !== source.connectionEpoch ||
      result.method !== method
    )
      throw new Error(t('Harness 文件来源已变化，请重新读取。'));
    if ('error' in result) {
      const error =
        result.error && typeof result.error === 'object'
          ? (result.error as {
              code?: unknown;
              message?: unknown;
              details?: unknown;
            })
          : null;
      throw new WorkspaceServiceError(
        typeof error?.code === 'string' ? error.code : 'remote-error',
        typeof error?.message === 'string'
          ? error.message
          : typeof result.error === 'string'
            ? result.error
            : t('Harness 文件读取失败。'),
        error?.details ?? result.error,
      );
    }
    if (!('result' in result)) throw new Error(t('Harness 文件响应缺少结果。'));
    return result.result;
  };
  workspaceServiceCall = async (
    connectionId: string,
    workspaceId: string,
    method: WorkspaceMethod,
    request: Record<string, unknown>,
    rpcId: string,
  ): Promise<unknown> => {
    if (
      !this.state.workspaceServiceAvailable ||
      !this.state.workspaceServices.some(
        (entry) =>
          entry.connectionId === connectionId &&
          entry.workspaceId === workspaceId,
      )
    )
      throw new Error(t('工作区连接不在宿主授权目录中。'));
    const epoch = this.bootEpoch;
    const { workspaceId: requestedWorkspace, ...body } = request;
    if (requestedWorkspace !== undefined && requestedWorkspace !== workspaceId)
      throw new Error(t('工作区请求来源已变化。'));
    const wire = {
      op: 'workspace.call',
      connectionId,
      workspaceId,
      method,
      request: body,
      rpcId,
    } as WorkspaceCallRequest;
    const response =
      await this.clientOrThrow().unary<WorkspaceCallResponse>(wire);
    if (epoch !== this.bootEpoch)
      throw new Error(t('工作区连接已变化，请刷新。'));
    if ('error' in response)
      throw new WorkspaceServiceError(
        response.error.code,
        response.error.message,
        response.error.details,
      );
    return response.result;
  };
  private advancedPresetScope() {
    if (this.state.selected) return null;
    const endpoint = this.state.endpoints.find(
      (entry) => entry.id === this.state.newEndpoint,
    );
    if (!endpoint || !Number.isSafeInteger(endpoint.connectionEpoch))
      return null;
    return {
      endpointId: endpoint.id,
      cwd: this.state.cwd,
      connectionEpoch: endpoint.connectionEpoch!,
    };
  }
  private presetScopeKey(scope: {
    endpointId: string;
    cwd: string;
    connectionEpoch: number;
  }) {
    return JSON.stringify([scope.endpointId, scope.cwd, scope.connectionEpoch]);
  }
  private currentAdvancedPreset(): AdvancedPresetDraft | null {
    if (this.state.selected) return null;
    const scope = this.advancedPresetScope();
    if (scope) {
      const current = this.advancedPresets.get(this.presetScopeKey(scope));
      if (current) return current;
    }
    return (
      [...this.advancedPresets.values()]
        .reverse()
        .find(
          (entry) =>
            entry.endpointId === this.state.newEndpoint &&
            entry.cwd === this.state.cwd,
        ) || null
    );
  }
  describeAdvancedPreset = async (
    endpointId: string,
    cwd: string,
    connectionEpoch: number,
  ): Promise<PresetDescriptionSnapshot> => {
    const scope = { endpointId, cwd, connectionEpoch },
      key = this.presetScopeKey(scope),
      epoch = this.epoch;
    if (
      !this.advancedPresetScope() ||
      this.presetScopeKey(this.advancedPresetScope()!) !== key
    )
      throw new Error(t('预设来源已变化，请重新打开。'));
    const result = await this.clientOrThrow().call<PresetDescriptionSnapshot>(
      endpointId,
      'agent.preset.describe',
      { connectionEpoch },
    );
    if (
      epoch !== this.epoch ||
      this.presetScopeKey(
        this.advancedPresetScope() || {
          endpointId: '',
          cwd: '',
          connectionEpoch: -1,
        },
      ) !== key ||
      result.endpointId !== endpointId ||
      result.connectionEpoch !== connectionEpoch
    )
      throw new Error(t('预设来源已变化，请重新打开。'));
    return result;
  };
  previewAdvancedPreset = async (
    endpointId: string,
    cwd: string,
    connectionEpoch: number,
    preset: SessionPreset,
  ): Promise<PresetPreviewSnapshot> => {
    const scope = { endpointId, cwd, connectionEpoch },
      key = this.presetScopeKey(scope),
      epoch = this.epoch;
    if (
      !this.advancedPresetScope() ||
      this.presetScopeKey(this.advancedPresetScope()!) !== key
    )
      throw new Error(t('预设来源已变化，请重新打开。'));
    const captured = structuredClone(preset);
    this.advancedPreviews.delete(key);
    const result = await this.clientOrThrow().call<PresetPreviewSnapshot>(
      endpointId,
      'agent.preset.preview',
      { cwd, connectionEpoch, preset: captured },
    );
    if (
      epoch !== this.epoch ||
      !this.advancedPresetScope() ||
      this.presetScopeKey(this.advancedPresetScope()!) !== key ||
      result.endpointId !== endpointId ||
      result.connectionEpoch !== connectionEpoch ||
      presetSignature(result.preset) !== presetSignature(captured) ||
      !result.resolution.digest
    )
      throw new Error(t('预设预览与当前草稿不一致，请重新预览。'));
    this.advancedPreviews.set(
      key,
      structuredClone({
        ...scope,
        preset: result.preset,
        resolution: result.resolution,
      }),
    );
    return result;
  };
  applyAdvancedPreset = (
    endpointId: string,
    cwd: string,
    connectionEpoch: number,
    preset: SessionPreset,
    resolution: SessionPresetResolution,
  ) => {
    const scope = { endpointId, cwd, connectionEpoch },
      key = this.presetScopeKey(scope),
      preview = this.advancedPreviews.get(key);
    if (
      this.state.busy ||
      !this.advancedPresetScope() ||
      this.presetScopeKey(this.advancedPresetScope()!) !== key ||
      !preview ||
      presetSignature(preview.preset) !== presetSignature(preset) ||
      JSON.stringify(preview.resolution) !== JSON.stringify(resolution)
    )
      throw new Error(t('预设预览已失效，请重新预览。'));
    this.advancedPresets.set(key, structuredClone(preview));
    this.update({ advancedPreset: this.currentAdvancedPreset() });
  };
  clearAdvancedPreset = () => {
    if (this.state.selected || this.state.busy) return;
    for (const [key, entry] of this.advancedPresets)
      if (
        entry.endpointId === this.state.newEndpoint &&
        entry.cwd === this.state.cwd
      ) {
        this.advancedPresets.delete(key);
        this.advancedPreviews.delete(key);
      }
    this.update({ advancedPreset: null });
  };
  private waitForPresetDigest(
    target: Address,
    digest: string,
    connectionEpoch: number,
  ): Promise<void> {
    const boot = this.bootEpoch;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.listeners.delete(check);
        error ? reject(error) : resolve();
      };
      const check = () => {
        const endpoint = this.state.endpoints.find(
          (entry) => entry.id === target.endpoint,
        );
        if (
          boot !== this.bootEpoch ||
          endpoint?.connectionEpoch !== connectionEpoch ||
          endpoint.connection !== 'ready'
        ) {
          finish(new Error(t('预设创建连接已变化，消息未发送。')));
          return;
        }
        const actual = this.state.inventories
          .get(target.endpoint)
          ?.find((entry) => entry.sessionId === target.sessionId)?.summary
          ?.preset?.digest;
        if (typeof actual === 'string' && actual)
          finish(
            actual === digest
              ? undefined
              : new Error(t('已创建会话的预设与预览不一致，消息未发送。')),
          );
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              t(
                '会话已创建，但预设身份尚未确认。请核对会话后再发送，不能重新创建。',
              ),
            ),
          ),
        5000,
      );
      this.listeners.add(check);
      check();
    });
  }
  goalSnapshot = (address: Address) =>
    this.clientOrThrow().call<GoalSnapshot>(
      address.endpoint,
      'agent.goal.read',
      { sessionId: address.sessionId },
    );
  goalAction = (address: Address, action: GoalAction) =>
    this.clientOrThrow().call(address.endpoint, 'agent.goal.action', {
      ...action,
      sessionId: address.sessionId,
    });
  resourceCatalog = (address: Address, connectionEpoch: number) =>
    this.clientOrThrow().call<ResourceCatalog>(
      address.endpoint,
      'agent.catalog',
      { sessionId: address.sessionId, connectionEpoch },
    );
  runCommand = (
    address: Address,
    connectionEpoch: number,
    command: CatalogCommand,
    argumentsText: string,
  ) =>
    this.clientOrThrow().call<CommandReceipt>(
      address.endpoint,
      'agent.command.run',
      {
        sessionId: address.sessionId,
        connectionEpoch,
        name: command.name,
        arguments: argumentsText,
        attachments: [],
      },
    );
  selectSkill = (address: Address, skill: CatalogSkill) => {
    const key = addressKey(address.endpoint, address.sessionId);
    if (!skill.selectable || this.key() !== key) return;
    const current = this.skillDrafts.get(key) || [];
    if (!current.some((entry) => entry.id === skill.id))
      this.skillDrafts.set(key, [...current, skill]);
    this.restoreDraft();
  };
  removeSkill = (id: string) => {
    this.skillDrafts.set(
      this.key(),
      (this.skillDrafts.get(this.key()) || []).filter(
        (skill) => skill.id !== id,
      ),
    );
    this.restoreDraft();
  };
  editQueuedInput = async (
    address: Address,
    itemId: string,
    connectionEpoch: number,
    text: string,
  ): Promise<void> => {
    await this.clientOrThrow().call(address.endpoint, 'agent.queue.edit', {
      sessionId: address.sessionId,
      itemId,
      connectionEpoch,
      text,
    });
  };
  familySnapshot = (address: Address) =>
    this.clientOrThrow().call<FamilySnapshot>(
      address.endpoint,
      'agent.familySnapshot',
      {
        sessionId: address.sessionId,
      },
    );
  followFamily = (
    address: Address,
    receive: (frame: FamilySnapshot) => void,
    signal: AbortSignal,
  ) =>
    this.clientOrThrow().follow<FamilySnapshot>(
      {
        endpoint: address.endpoint,
        target: {
          kind: 'familyView',
          parentSessionId: address.sessionId,
        },
      },
      receive,
      signal,
    );
  childDraft = (address: Address, childId: string) =>
    this.drafts.get(
      JSON.stringify([
        'family-child',
        address.endpoint,
        address.sessionId,
        childId,
      ]),
    );
  setChildDraft = (address: Address, childId: string, draft: string) =>
    this.drafts.set(
      JSON.stringify([
        'family-child',
        address.endpoint,
        address.sessionId,
        childId,
      ]),
      draft,
    );
  clearChildDraftIfUnchanged = (
    address: Address,
    childId: string,
    submitted: string,
  ) =>
    this.drafts.clearIfUnchanged(
      JSON.stringify([
        'family-child',
        address.endpoint,
        address.sessionId,
        childId,
      ]),
      submitted,
    );
  openChild = (address: Address, childId: string) =>
    this.clientOrThrow().call<ChildPane>(address.endpoint, 'agent.child.open', {
      parentSessionId: address.sessionId,
      childId,
    });
  followChild = (
    address: Address,
    pane: Pick<ChildPane, 'handle' | 'childId'>,
    receive: (frame: ChildViewFrame) => void,
    signal: AbortSignal,
  ) =>
    this.clientOrThrow().follow<ChildViewFrame>(
      {
        endpoint: address.endpoint,
        target: {
          kind: 'childView',
          handle: pane.handle,
          parentSessionId: address.sessionId,
          childId: pane.childId,
        },
      },
      receive,
      signal,
    );
  earlierChild = (address: Address, pane: ChildPane, rpcId: string) =>
    this.clientOrThrow().call<{
      loaded: boolean;
      transcript: ChildPane['transcript'];
      run: ChildPane['run'];
      connectionEpoch: number;
      handle: string;
    }>(
      address.endpoint,
      'agent.child.earlier',
      {
        parentSessionId: address.sessionId,
        childId: pane.childId,
        handle: pane.handle,
      },
      rpcId,
    );
  promptChild = (
    address: Address,
    pane: ChildPane,
    text: string,
    rpcId: string,
  ) =>
    this.clientOrThrow().call(
      address.endpoint,
      'agent.child.prompt',
      {
        parentSessionId: address.sessionId,
        childId: pane.childId,
        handle: pane.handle,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
      rpcId,
    );
  cancelChild = (address: Address, pane: ChildPane, rpcId: string) =>
    this.clientOrThrow().call(
      address.endpoint,
      'agent.child.cancel',
      {
        parentSessionId: address.sessionId,
        childId: pane.childId,
        handle: pane.handle,
      },
      rpcId,
    );
  removeQueuedInput = (
    address: Address,
    itemId: string,
    connectionEpoch: number,
  ) =>
    this.clientOrThrow().call(
      address.endpoint,
      'agent.queue.remove',
      {
        sessionId: address.sessionId,
        itemId,
        connectionEpoch,
      },
      crypto.randomUUID(),
    );
  private clientOrThrow() {
    if (!this.client) throw new AuthenticationError(t('请先连接本机服务。'));
    return this.client;
  }
  reconnectEndpoint = (endpointId: string): Promise<void> => {
    const pending = this.reconnectRequests.get(endpointId);
    if (pending) return pending;
    const client = this.clientOrThrow();
    const epoch = this.bootEpoch;
    const request = Promise.resolve().then(async () => {
      try {
        const description = await client.unary<Endpoint>({
          op: 'reconnect',
          endpoint: endpointId,
        });
        if (epoch === this.bootEpoch && this.client === client)
          this.update({
            endpoints: this.state.endpoints.map((endpoint) =>
              endpoint.id === endpointId ? description : endpoint,
            ),
            error: '',
          });
      } catch (error) {
        if (epoch === this.bootEpoch && this.client === client)
          this.fail(error);
      } finally {
        if (this.reconnectRequests.get(endpointId) === request)
          this.reconnectRequests.delete(endpointId);
      }
    });
    this.reconnectRequests.set(endpointId, request);
    return request;
  };
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
  saveAnnotation = (annotation: Annotation) => {
    if (!isAnnotation(annotation)) {
      this.update({ error: t('批注内容无效或过长，请重新选择。') });
      return;
    }
    const current = this.annotationDrafts.get(this.key());
    if (
      current.length >= annotationLimit &&
      !current.some((a) => a.id === annotation.id)
    ) {
      this.update({ error: t('最多添加 50 条批注。') });
      return;
    }
    const annotations = current.some((a) => a.id === annotation.id)
      ? current.map((a) => (a.id === annotation.id ? annotation : a))
      : [...current, annotation];
    this.annotationDrafts.set(this.key(), annotations);
    this.update({ annotations });
  };
  removeAnnotation = (id: string) => {
    const annotations = this.annotationDrafts
      .get(this.key())
      .filter((a) => a.id !== id);
    this.annotationDrafts.set(this.key(), annotations);
    this.update({ annotations });
  };
  private restoreDraft() {
    this.update({
      draft: this.drafts.get(this.key()),
      busy: this.pending.has(this.key()),
      submissionStage: this.submissionStages.get(this.key()) || '',
      attachments: this.attachmentDrafts.get(this.key()) || [],
      annotations: this.annotationDrafts.get(this.key()),
      skills: this.skillDrafts.get(this.key()) || [],
      advancedPreset: this.currentAdvancedPreset(),
    });
  }
  private setSubmissionStage(key: string, stage: string) {
    this.submissionStages.set(key, stage);
    if (this.key() === key) this.update({ submissionStage: stage });
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
    this.sideChats.clear();
    this.advancedPreviews.clear();
    this.advancedPresets.clear();
    this.actionReads.clear();
    this.update({
      connecting: true,
      error: '',
      workspaceServiceAvailable: false,
      workspaceServices: [],
      workspaceServicesLoading: false,
      workspaceServicesError: '',
    });
    try {
      const [endpoints, info] = await Promise.all([
        client.unary<Endpoint[]>({ op: 'endpoints' }),
        client.unary<{
          workspace: string;
          workspaceService?: boolean;
          directoryPicker?: { endpoints: string[] };
        }>({ op: 'host.info' }),
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
        archivedInventories: new Map(),
        permissionPolicy: null,
        permissionMode: null,
        permissionLoading: false,
        permissionError: '',
        threadActions: new Map(),
        threadActionErrors: new Map(),
        hostWorkspace: info.workspace,
        workspaceServiceAvailable: info.workspaceService === true,
        directoryEndpoints: info.directoryPicker?.endpoints || [],
        directoryPicking: false,
        presets: new Map(),
      });
      if (info.workspaceService === true) void this.refreshWorkspaceServices();
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
            const archivedInventories = new Map(this.state.archivedInventories);
            archivedInventories.set(
              endpoint.id,
              inventory.archivedSessions || [],
            );
            this.update({
              inventories,
              archivedInventories,
              endpoints: this.state.endpoints.map((e) =>
                e.id === endpoint.id ? inventory.description : e,
              ),
            });
            if (!this.state.selected)
              this.update({ advancedPreset: this.currentAdvancedPreset() });
            if (this.epoch !== restoreEpoch) restored = true;
            if (
              !restored &&
              remembered?.endpoint === endpoint.id &&
              [
                ...inventory.sessions,
                ...(inventory.archivedSessions || []),
              ].some(
                (e) =>
                  e.sessionId === remembered?.sessionId &&
                  !isHarnessArchivedSession(e),
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
                  ? { ...e, connection: { failed: t('连接已断开，正在重连') } }
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

  async pickDirectory(): Promise<string | null> {
    const {
      newEndpoint: endpoint,
      cwd,
      selected,
      directoryPicking,
    } = this.state;
    if (selected || directoryPicking) return null;
    if (!this.state.directoryEndpoints.includes(endpoint)) {
      this.fail(
        new Error(t('当前宿主尚未提供本地目录选择，请更新宿主后重新连接。')),
      );
      return null;
    }
    const epoch = this.epoch,
      boot = this.bootEpoch;
    this.update({ directoryPicking: true, error: '' });
    try {
      const result = await this.clientOrThrow().unary<{ path: string | null }>({
        op: 'host.pickDirectory',
        endpoint,
        path: cwd,
        language: getLocale(),
      });
      if (
        epoch !== this.epoch ||
        this.state.selected ||
        this.state.newEndpoint !== endpoint
      )
        return null;
      if (
        result.path !== null &&
        (typeof result.path !== 'string' || !result.path.startsWith('/'))
      )
        throw new Error(t('宿主返回的目录无效，请重新选择。'));
      return result.path;
    } catch (error) {
      if (epoch === this.epoch) {
        const message = error instanceof Error ? error.message : String(error);
        this.fail(
          new Error(
            message.includes('directory picker is already open')
              ? t('已有目录选择窗口打开，请先完成或取消该窗口。')
              : message.includes('Unable to open the local directory picker')
                ? t('无法打开本地目录选择框，请重试。')
                : message,
          ),
        );
      }
      return null;
    } finally {
      if (boot === this.bootEpoch) this.update({ directoryPicking: false });
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
      permissionPolicy: null,
      permissionMode: null,
      permissionLoading: false,
      permissionError: '',
    });
    savePreference('tekes.web.selection', 'null');
    this.restoreDraft();
    if (endpoint) {
      void this.loadModels(endpoint, undefined, this.epoch);
      void this.loadControls(endpoint, undefined, this.epoch);
    }
  };
  sessionEntry = (address: Address): Session | undefined =>
    this.state.inventories
      .get(address.endpoint)
      ?.find((entry) => entry.sessionId === address.sessionId) ||
    this.state.archivedInventories
      .get(address.endpoint)
      ?.find((entry) => entry.sessionId === address.sessionId);
  async select(address: Address) {
    const entry = this.sessionEntry(address);
    if (entry && isHarnessArchivedSession(entry)) {
      this.fail(
        new Error(t('此会话已在原 Harness 归档，请在原 Harness 中管理。')),
      );
      return;
    }
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
      permissionPolicy: null,
      permissionMode: null,
      permissionLoading: false,
      permissionError: '',
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
      return catalog;
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    } finally {
      if (epoch === this.epoch) this.update({ modelLoading: false });
    }
  }
  async chooseModel(model: ModelChoice) {
    if (
      !this.state.selected &&
      this.currentAdvancedPreset()?.resolution.defaults
    ) {
      this.fail(
        new Error(t('启动模型由高级预设决定，请修改高级预设或先清除它。')),
      );
      return;
    }
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
      !s.permissionLoading &&
      !s.permissionError &&
      !this.permissionUpdates.has(this.key()) &&
      (!!s.model ||
        (!s.selected && !!this.currentAdvancedPreset()?.resolution.defaults)) &&
      (!this.currentAdvancedPreset() ||
        this.currentAdvancedPreset()!.connectionEpoch ===
          this.advancedPresetScope()?.connectionEpoch) &&
      (!!s.draft.trim() ||
        !!s.attachments.length ||
        !!s.annotations.length ||
        !!s.skills.length) &&
      (s.selected ? !!s.view?.run.canSubmit : s.cwd.startsWith('/'))
    );
  }
  async submit() {
    if (!this.canSend()) return;
    const key = this.key(),
      text = this.state.draft,
      desiredModel = this.state.model;
    const sideChat = this.sideChats.get(key);
    const desiredPermission = this.permissionChoices.get(key);
    const permissionPolicy = this.state.permissionPolicy;
    const attachmentPolicy = this.state.attachmentPolicy;
    const existingPermission = this.state.selected
      ? this.state.permissionMode
      : desiredPermission;
    const wasExisting = !!this.state.selected;
    const files = [...this.state.attachments],
      desiredPreset = this.state.preset;
    const advancedPreset = this.currentAdvancedPreset()
      ? structuredClone(this.currentAdvancedPreset()!)
      : null;
    const annotations = [...this.state.annotations];
    const skills = [...this.state.skills];
    const connectionEpoch = this.state.view?.run.connectionEpoch;
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
    let createdPresetCatalog: Catalog | undefined;
    const initialStage = target.sessionId ? t('正在发送') : t('正在创建会话');
    this.pending.add(key);
    this.submissionStages.set(key, initialStage);
    this.update({
      busy: true,
      error: '',
      submissionStage: initialStage,
    });
    try {
      if (
        annotations.length &&
        !endpoint.capabilities?.methods?.includes('composer.compileAnnotations')
      )
        throw new Error(
          t(
            '当前 AgentKit 尚未提供批注接口，请升级并重新连接。批注仍保留在输入框中。',
          ),
        );
      if (!target.sessionId) {
        if (
          advancedPreset &&
          (!this.advancedPresetScope() ||
            this.presetScopeKey(advancedPreset) !==
              this.presetScopeKey(this.advancedPresetScope()!))
        )
          throw new Error(t('预设预览已失效，请重新预览。'));
        if (!this.creationIDs.has(key))
          this.creationIDs.set(key, crypto.randomUUID());
        const created = await client.call<{ sessionId: string }>(
          target.endpoint,
          'session.create',
          {
            cwd,
            ...(advancedPreset
              ? { preset: advancedPreset.preset }
              : creationPreset(endpoint, desiredPreset)),
          },
          this.creationIDs.get(key),
        );
        if (typeof created.sessionId !== 'string' || !created.sessionId)
          throw new Error(
            t('创建结果未包含会话身份。请核对会话列表，消息未发送。'),
          );
        target.sessionId = created.sessionId;
        if (advancedPreset)
          this.unverifiedPresetSessions.set(
            addressKey(target.endpoint, target.sessionId),
            {
              digest: advancedPreset.resolution.digest,
              connectionEpoch: advancedPreset.connectionEpoch,
              defaults: advancedPreset.resolution.defaults,
            },
          );
        if (desiredPermission) {
          await client.call(target.endpoint, 'approvals.select', {
            sessionId: target.sessionId,
            mode: desiredPermission,
          });
          const effective = await client.call<PermissionModeState>(
            target.endpoint,
            'approvals.mode',
            { sessionId: target.sessionId },
          );
          if (effective.mode !== desiredPermission)
            throw new Error(t('权限尚未生效，消息未发送'));
        }
        this.creationIDs.delete(key);
        targetKey = addressKey(target.endpoint, target.sessionId);
        if (desiredPreset) this.presetChoices.set(targetKey, desiredPreset);
        this.drafts.set(targetKey, text);
        this.drafts.clearIfUnchanged(key, text);
        this.pending.add(targetKey);
        this.submissionStages.set(
          targetKey,
          this.submissionStages.get(key) || '',
        );
        this.attachmentDrafts.set(targetKey, files);
        this.annotationDrafts.set(targetKey, annotations);
        this.annotationDrafts.acknowledge(key, annotations);
        const submittedIDs = new Set(files.map((f) => f.id));
        this.attachmentDrafts.set(
          key,
          (this.attachmentDrafts.get(key) || []).filter(
            (f) => !submittedIDs.has(f.id),
          ),
        );
        const createdCatalog =
          epoch === this.epoch ? await this.select(target) : undefined;
        if (advancedPreset?.resolution.defaults) {
          createdPresetCatalog =
            createdCatalog ||
            (await client.call<Catalog>(target.endpoint, 'session.models', {
              sessionId: target.sessionId,
            }));
        } else {
          if (!desiredModel)
            throw new Error(t('会话已创建，请选择模型后发送。'));
          await client.call(target.endpoint, 'session.selectModel', {
            sessionId: target.sessionId,
            ...desiredModel,
          });
          if (this.key() === targetKey)
            await this.loadModels(
              target.endpoint,
              target.sessionId,
              this.epoch,
            );
        }
      }
      const unverifiedPreset = this.unverifiedPresetSessions.get(
        addressKey(target.endpoint, target.sessionId),
      );
      if (unverifiedPreset) {
        if (unverifiedPreset.defaults) {
          const catalog =
            createdPresetCatalog ||
            (await client.call<Catalog>(target.endpoint, 'session.models', {
              sessionId: target.sessionId,
            }));
          const actual = catalog.current || catalog.selected,
            expected = unverifiedPreset.defaults;
          if (
            !actual ||
            actual.provider !== expected.provider ||
            actual.model !== expected.model ||
            (expected.reasoningEffort &&
              actual.reasoningEffort !== expected.reasoningEffort)
          )
            throw new Error(
              t('已创建会话的启动模型尚未与预设一致，消息未发送。'),
            );
        }
        await this.waitForPresetDigest(
          target,
          unverifiedPreset.digest,
          unverifiedPreset.connectionEpoch,
        );
        this.unverifiedPresetSessions.delete(
          addressKey(target.endpoint, target.sessionId),
        );
      }
      const compiledText = annotations.length
        ? (
            await client.call<AnnotationCompilation>(
              target.endpoint,
              'composer.compileAnnotations',
              { text, annotations } satisfies AnnotationInput,
            )
          ).text
        : text;
      let content: Record<string, unknown>[] = compiledText.trim()
        ? [{ type: 'text', text: compiledText }]
        : [];
      for (let i = 0; i < files.length; i++) {
        const attachment = files[i],
          uploadKey = `${targetKey}:${attachment.id}`;
        const mediaType = attachment.file.type || 'application/octet-stream';
        if (
          mediaType.toLowerCase().startsWith('image/') &&
          attachmentPolicy?.inlineMediaTypes.some(
            (accepted) => accepted.toLowerCase() === mediaType.toLowerCase(),
          )
        ) {
          content.push({
            type: 'image',
            mediaType,
            data: await fileBase64(attachment.file),
            name: attachment.file.name,
          });
          continue;
        }
        this.setSubmissionStage(
          targetKey,
          t('上传附件 {0}/{1}', i + 1, files.length),
        );
        let uploaded = this.uploadReceipts.get(uploadKey);
        if (!uploaded) {
          uploaded = await client.call<UploadReceipt>(
            target.endpoint,
            'session.uploadFile',
            {
              sessionId: target.sessionId,
              name: attachment.file.name,
              mediaType,
              data: await fileBase64(attachment.file),
            },
            attachment.id,
          );
          if (
            !uploaded.receiptId ||
            uploaded.file.bytes !== attachment.file.size
          )
            throw new Error(t('附件上传回执无效，文件仍保留在输入框中。'));
          this.uploadReceipts.set(uploadKey, uploaded);
        }
        content.push({ type: 'file', receiptId: uploaded.receiptId });
      }
      if (skills.length) {
        const compiled = await client.call<{
          kind: string;
          content: Record<string, unknown>[];
        }>(target.endpoint, 'agent.skills.compile', {
          sessionId: target.sessionId,
          connectionEpoch,
          text: compiledText,
          skillIds: skills.map((skill) => skill.id),
          attachments: content.filter((part) => part.type !== 'text'),
        });
        if (compiled.kind !== 'prompt' || !Array.isArray(compiled.content))
          throw new Error(t('技能编译结果无效，消息未发送。'));
        content = compiled.content;
      }
      if (permissionPolicy?.threadLevel.length) {
        const effective = await client.call<PermissionModeState>(
          target.endpoint,
          'approvals.mode',
          { sessionId: target.sessionId },
        );
        validatePermissions(permissionPolicy, effective.mode);
        if (this.key() === targetKey) {
          ++this.permissionRead;
          this.update({
            permissionMode: effective.mode,
            permissionLoading: false,
          });
        }
        if (
          (wasExisting || desiredPermission !== undefined) &&
          effective.mode !== existingPermission
        )
          throw new Error(t('权限已发生变化，请确认后重新发送'));
      }
      this.setSubmissionStage(targetKey, t('正在发送'));
      const signature = JSON.stringify([content, files.map((f) => f.id)]);
      let receipt = this.submissionIDs.get(targetKey);
      if (!receipt || receipt.signature !== signature) {
        receipt = { signature, id: crypto.randomUUID() };
        this.submissionIDs.set(targetKey, receipt);
      }
      await client.call(
        target.endpoint,
        sideChat ? 'agent.sideChat.prompt' : 'session.prompt',
        {
          ...(sideChat
            ? {
                parentSessionId: sideChat.parent.sessionId,
                handle: sideChat.handle,
                connectionEpoch: sideChat.connectionEpoch,
              }
            : { sessionId: target.sessionId }),
          mode: 'queue',
          content,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        receipt.id,
      );
      this.drafts.clearIfUnchanged(targetKey, text);
      this.annotationDrafts.acknowledge(targetKey, annotations);
      const submittedSkills = new Set(skills.map((skill) => skill.id));
      this.skillDrafts.set(
        targetKey,
        (this.skillDrafts.get(targetKey) || []).filter(
          (skill) => !submittedSkills.has(skill.id),
        ),
      );
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
      this.submissionStages.delete(key);
      this.submissionStages.delete(targetKey);
      this.restoreDraft();
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
        // Permission authority is read through the same Session Endpoint as other inputs.
        this.presetCatalog(endpoint),
        endpoint.capabilities?.methods?.includes('attachments.policy')
          ? this.clientOrThrow().call<AttachmentPolicy>(
              endpointID,
              'attachments.policy',
              sessionId ? { sessionId } : {},
            )
          : Promise.resolve(null),
        this.loadPermissions(endpoint, sessionId, epoch),
      ]);
      if (epoch !== this.epoch) return;
      const remembered = this.presetChoices.get(this.key());
      const current = sessionId
        ? this.sessionEntry({ endpoint: endpointID, sessionId })?.summary
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
  private async loadPermissions(
    endpoint: Endpoint,
    sessionId: string | undefined,
    epoch: number,
  ) {
    const read = ++this.permissionRead;
    const supported = [
      'approvals.policy',
      'approvals.mode',
      'approvals.select',
    ].every((m) => endpoint.capabilities?.methods?.includes(m));
    if (!supported) {
      if (epoch === this.epoch)
        this.update({
          permissionPolicy: null,
          permissionMode: null,
          permissionLoading: false,
          permissionError: '',
        });
      return;
    }
    const key = this.key();
    this.update({ permissionLoading: true });
    try {
      await this.permissionUpdates.get(key)?.catch(() => {});
      const client = this.clientOrThrow();
      const [policy, current] = await Promise.all([
        client.call<PermissionPolicy>(
          endpoint.id,
          'approvals.policy',
          sessionId ? { sessionId } : {},
        ),
        sessionId
          ? client.call<PermissionModeState>(endpoint.id, 'approvals.mode', {
              sessionId,
            })
          : Promise.resolve({ mode: null }),
      ]);
      const selected = sessionId
        ? current.mode
        : (this.permissionChoices.get(key) ?? null);
      validatePermissions(policy, selected);
      if (epoch === this.epoch && read === this.permissionRead)
        this.update({
          permissionPolicy: policy,
          permissionMode: selected,
          permissionError: '',
        });
    } catch (error) {
      if (epoch === this.epoch && read === this.permissionRead)
        this.update({
          permissionError: displayError(error),
          permissionMode: null,
        });
    } finally {
      if (epoch === this.epoch && read === this.permissionRead)
        this.update({ permissionLoading: false });
    }
  }
  choosePermission = async (mode: string) => {
    const s = this.state;
    if (
      s.busy ||
      s.permissionLoading ||
      !s.permissionPolicy?.threadLevel.some((o) => o.value === mode)
    )
      return;
    const key = this.key();
    if (!s.selected) {
      this.permissionChoices.set(key, mode);
      this.update({ permissionMode: mode, permissionError: '' });
      return;
    }
    const target = { ...s.selected },
      epoch = this.epoch,
      read = ++this.permissionRead;
    this.update({ permissionLoading: true, permissionError: '' });
    const operation = (async () => {
      try {
        const client = this.clientOrThrow();
        await client.call(target.endpoint, 'approvals.select', {
          sessionId: target.sessionId,
          mode,
        });
        const current = await client.call<PermissionModeState>(
          target.endpoint,
          'approvals.mode',
          { sessionId: target.sessionId },
        );
        validatePermissions(s.permissionPolicy!, current.mode);
        if (current.mode !== mode)
          throw new Error(t('权限尚未生效，消息未发送'));
        if (epoch === this.epoch && read === this.permissionRead)
          this.update({ permissionMode: current.mode, permissionError: '' });
      } catch (error) {
        if (epoch === this.epoch && read === this.permissionRead)
          this.update({
            permissionMode: null,
            permissionError: displayError(error),
          });
      } finally {
        if (epoch === this.epoch && read === this.permissionRead)
          this.update({ permissionLoading: false });
      }
    })();
    this.permissionUpdates.set(key, operation);
    try {
      await operation;
    } finally {
      this.permissionUpdates.delete(key);
    }
  };
  choosePreset = (preset: string) => {
    if (this.state.selected || this.state.busy) return;
    const catalog = this.state.presets.get(this.state.newEndpoint);
    if (
      !catalog?.presets.some(
        (p) => p.id === preset && !p.broken && !p.unavailableReason,
      )
    )
      return;
    this.clearAdvancedPreset();
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
      return t('当前 Harness 没有报告此会话的初始预设。');
    return (
      preset?.configurationText ||
      preset?.description ||
      t('此 Harness 没有提供该预设的配置文本。')
    );
  }
  addFiles = (files: File[]) => {
    if (this.state.busy) return;
    const endpoint = this.state.endpoints.find(
      (e) => e.id === (this.state.selected?.endpoint || this.state.newEndpoint),
    );
    if (!endpoint?.capabilities?.methods?.includes('session.uploadFile')) {
      this.fail(new Error(t('当前 Harness 不支持附件上传。')));
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
      const chat = this.sideChatOrigin(s);
      await this.clientOrThrow().call(
        s.endpoint,
        chat ? 'agent.sideChat.cancel' : 'session.cancel',
        chat
          ? {
              parentSessionId: chat.parent.sessionId,
              handle: chat.handle,
              connectionEpoch: chat.connectionEpoch,
            }
          : { sessionId: s.sessionId },
      );
    } catch (error) {
      this.fail(error);
    }
  }
  actionFailed = (error: unknown) => this.fail(error);
  loadThreadActions(address: Address): Promise<ThreadActionsPresentation> {
    const target = { ...address },
      key = addressKey(target.endpoint, target.sessionId);
    const pending = this.actionReads.get(key);
    if (pending) return pending;
    const epoch = this.bootEpoch;
    const errors = new Map(this.state.threadActionErrors);
    errors.delete(key);
    this.update({ threadActionErrors: errors });
    const request = (async () => {
      try {
        const endpoint = this.state.endpoints.find(
          (e) => e.id === target.endpoint,
        );
        if (!endpoint?.capabilities?.methods?.includes('thread.actions'))
          throw new Error(t('AgentKit 未提供会话操作接口，请升级服务。'));
        const definition =
          await this.clientOrThrow().call<ThreadActionsPresentation>(
            target.endpoint,
            'thread.actions',
            { sessionId: target.sessionId },
          );
        if (
          definition.endpoint !== target.endpoint ||
          definition.sessionId !== target.sessionId
        )
          throw new Error(t('会话操作目标不匹配。'));
        if (epoch === this.bootEpoch) {
          const actions = new Map(this.state.threadActions);
          actions.set(key, definition);
          this.update({ threadActions: actions });
        }
        return definition;
      } catch (error) {
        if (epoch === this.bootEpoch) {
          const errors = new Map(this.state.threadActionErrors);
          errors.set(key, displayError(error));
          this.update({ threadActionErrors: errors });
        }
        throw error;
      }
    })().finally(() => {
      if (this.actionReads.get(key) === request) this.actionReads.delete(key);
    });
    this.actionReads.set(key, request);
    return request;
  }
  performThreadAction(
    address: Address,
    actionId: string,
    title?: string,
  ): Promise<ThreadActionOutcome> {
    const target = { ...address },
      key = addressKey(target.endpoint, target.sessionId);
    const payload: ThreadActionRequest = {
      sessionId: target.sessionId,
      actionId,
      ...(title === undefined ? {} : { title }),
    };
    const signature = JSON.stringify([target.endpoint, payload]);
    const pending = this.actionRequests.get(signature);
    if (pending) return pending;
    if (!this.actionReceipts.has(signature))
      this.actionReceipts.set(signature, crypto.randomUUID());
    const epoch = this.epoch,
      boot = this.bootEpoch;
    const request = (async () => {
      const result = await this.clientOrThrow().call<ThreadActionOutcome>(
        target.endpoint,
        'thread.performAction',
        { ...payload },
        this.actionReceipts.get(signature),
      );
      this.actionReceipts.delete(signature);
      if (boot !== this.bootEpoch) return result;
      if (result.renamedTitle && typeof result.renameSeq === 'number')
        this.titles.remember(
          target.endpoint,
          target.sessionId,
          result.renamedTitle,
          result.renameSeq,
        );
      if (epoch === this.epoch) {
        if (result.navigation) await this.select(result.navigation);
        else if (result.clearSelection && this.key() === key) this.newSession();
      }
      this.update({ ...(result.warning ? { error: result.warning } : {}) });
      void this.loadThreadActions(target).catch(() => {});
      return result;
    })().finally(() => {
      if (this.actionRequests.get(signature) === request)
        this.actionRequests.delete(signature);
    });
    this.actionRequests.set(signature, request);
    return request;
  }
  async earlier() {
    const s = this.state.selected;
    if (!s) return false;
    const epoch = this.epoch,
      connectionEpoch = this.state.view?.run.connectionEpoch;
    const stillCurrent = () =>
      epoch === this.epoch &&
      connectionEpoch === this.state.view?.run.connectionEpoch;
    try {
      const result = await this.clientOrThrow().unary<{ loaded: boolean }>({
        op: 'earlier',
        ...s,
      });
      return stillCurrent() && result.loaded;
    } catch (error) {
      if (stillCurrent()) this.fail(error);
      return false;
    }
  }
  async respond(
    actionableId: string,
    expectedRevision: number,
    outcome: unknown,
  ) {
    const s = this.state.selected;
    if (!s) return;
    await this.respondAt(s.endpoint, actionableId, expectedRevision, outcome);
  }
  async respondAt(
    endpoint: string,
    actionableId: string,
    expectedRevision: number,
    outcome: unknown,
  ) {
    await this.clientOrThrow().unary({
      op: 'respond',
      endpoint,
      actionableId,
      expectedRevision,
      outcome,
    });
  }
}
