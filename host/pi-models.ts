// Host projection through Pi's public extension/model registry API.
interface Model {
  provider: string;
  id: string;
  api: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: unknown;
  contextWindow: number;
  maxTokens: number;
  compat?: Record<string, unknown>;
}
interface Context {
  model?: Model;
  modelRegistry: { getAll(): Model[] };
}
interface PiAPI {
  on(
    event: string,
    callback: (event: unknown, context: Context) => Promise<void>,
  ): void;
  registerProvider(id: string, options: Record<string, unknown>): void;
}
interface Provider {
  id: string;
  name: string;
  vendor: string;
  api: string;
  baseURL: string;
  models: {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
  }[];
}
export default function configurePi(pi: PiAPI): void {
  const providers = JSON.parse(
    process.env.TEKES_AGENT_WEB_PI_PROVIDERS ?? '[]',
  ) as Provider[];
  if (!Array.isArray(providers) || !providers.length)
    throw new Error('Web host has no selected Pi providers');
  const allowed = new Set(providers.map((p) => p.id));
  pi.on('session_start', async (_event, ctx) => {
    const catalog = ctx.modelRegistry.getAll();
    for (const provider of providers) {
      if (provider.api !== 'deepseek-responses')
        throw new Error('Unsupported host Pi provider dialect');
      const models = provider.models.map((declared) => {
        const base =
          catalog.find(
            (m) => m.provider === provider.vendor && m.id === declared.id,
          ) ??
          catalog.find(
            (m) => m.id === declared.id && m.api === 'openai-responses',
          );
        if (!base)
          throw new Error(`Pi model metadata unavailable: ${declared.id}`);
        return {
          id: declared.id,
          name: declared.name ?? base.name,
          reasoning: base.reasoning,
          input: base.input,
          cost: base.cost,
          contextWindow: declared.contextWindow ?? base.contextWindow,
          maxTokens: declared.maxTokens ?? base.maxTokens,
          compat: {
            ...base.compat,
            supportsDeveloperRole: false,
            supportsStrictMode: false,
            supportsLongCacheRetention: false,
          },
          ...(declared.id === 'deepseek-flash'
            ? {
                thinkingLevelMap: {
                  minimal: null,
                  low: 'low',
                  medium: null,
                  high: 'high',
                  xhigh: null,
                  max: 'max',
                },
              }
            : {}),
        };
      });
      pi.registerProvider(provider.id, {
        name: provider.name,
        api: 'openai-responses',
        baseUrl: provider.baseURL,
        apiKey: '${TEKES_AGENT_WEB_PI_KEY}',
        models,
      });
    }
  });
  pi.on('before_agent_start', async (_event, ctx) => {
    if (!ctx.model || !allowed.has(ctx.model.provider))
      throw new Error(
        'Select a model from the configured Pi provider before submitting',
      );
  });
}
