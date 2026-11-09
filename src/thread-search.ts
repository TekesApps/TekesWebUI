import { displayError } from './state';

export type ThreadSearchVisibility = 'active' | 'archived' | 'all';
export interface ThreadSearchItem {
  sessionId: string;
  title: string;
  updatedAt: string;
  archived: boolean;
  asOfSeq: number;
  score: number;
  matchClass: 'exact' | 'prefix' | 'tokens';
}
export interface ThreadSearchPage {
  endpointId: string;
  connectionEpoch: number;
  query: string;
  visibility: ThreadSearchVisibility;
  sessionId?: string;
  items: ThreadSearchItem[];
  nextCursor?: string;
  reachedEnd: boolean;
  catalogDigest: string;
}
export interface ThreadSearchQuery {
  query: string;
  visibility: ThreadSearchVisibility;
  limit: number;
  after?: string;
  sessionId?: string;
}
export type ThreadSearchLoader = (
  endpointId: string,
  query: ThreadSearchQuery,
) => Promise<ThreadSearchPage>;
export interface ThreadSearchScope {
  endpointId: string;
  query: string;
  visibility: ThreadSearchVisibility;
  sessionId?: string;
}

/** Validate the public service reply once before keeping a typed result page. */
export function readThreadSearchPage(value: unknown): ThreadSearchPage {
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new Error('Invalid title search result');
    return v as Record<string, unknown>;
  };
  const page = object(value);
  if (
    typeof page.endpointId !== 'string' ||
    !page.endpointId ||
    !Number.isSafeInteger(page.connectionEpoch) ||
    Number(page.connectionEpoch) < 0 ||
    typeof page.query !== 'string' ||
    !['active', 'archived', 'all'].includes(String(page.visibility)) ||
    (page.sessionId !== undefined &&
      (typeof page.sessionId !== 'string' || !page.sessionId)) ||
    typeof page.catalogDigest !== 'string' ||
    !/^sha256-[0-9a-f]{64}$/.test(page.catalogDigest) ||
    typeof page.reachedEnd !== 'boolean' ||
    !Array.isArray(page.items) ||
    (page.reachedEnd
      ? page.nextCursor !== undefined
      : typeof page.nextCursor !== 'string' ||
        !page.nextCursor ||
        !page.items.length)
  )
    throw new Error('Invalid title search page');
  const seen = new Set<string>();
  for (const value of page.items) {
    const item = object(value);
    if (
      typeof item.sessionId !== 'string' ||
      !item.sessionId ||
      seen.has(item.sessionId) ||
      typeof item.title !== 'string' ||
      typeof item.updatedAt !== 'string' ||
      typeof item.archived !== 'boolean' ||
      !Number.isSafeInteger(item.asOfSeq) ||
      Number(item.asOfSeq) < 0 ||
      ![
        ['exact', 3000],
        ['prefix', 2000],
        ['tokens', 1000],
      ].some(
        ([kind, score]) => item.matchClass === kind && item.score === score,
      ) ||
      (page.visibility === 'active' && item.archived) ||
      (page.visibility === 'archived' && !item.archived) ||
      (page.sessionId !== undefined && item.sessionId !== page.sessionId)
    )
      throw new Error('Invalid title search item');
    seen.add(item.sessionId);
  }
  return value as ThreadSearchPage;
}

export interface ThreadSearchState {
  items: ThreadSearchItem[];
  page: ThreadSearchPage | null;
  loading: boolean;
  searched: boolean;
  error: string;
}
const empty = (): ThreadSearchState => ({
  items: [],
  page: null,
  loading: false,
  searched: false,
  error: '',
});

/** One ranked query owns its cursor; another query cannot inherit a late page. */
export class ThreadSearchController {
  private state = empty();
  private generation = 0;
  private scope: ThreadSearchScope | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly load: ThreadSearchLoader) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: ThreadSearchState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  reset = () => {
    this.generation++;
    this.scope = null;
    this.publish(empty());
  };
  search = async (scope: ThreadSearchScope) => {
    const generation = ++this.generation;
    this.scope = { ...scope };
    this.publish({ ...empty(), loading: true, searched: true });
    await this.read(generation, this.scope);
  };
  more = async () => {
    const { page, loading, error } = this.state;
    if (!this.scope || !page?.nextCursor || loading || error) return;
    this.publish({ ...this.state, loading: true, error: '' });
    await this.read(this.generation, this.scope, page);
  };
  private async read(
    generation: number,
    scope: ThreadSearchScope,
    previous?: ThreadSearchPage,
  ) {
    try {
      const page = readThreadSearchPage(
        await this.load(scope.endpointId, {
          query: scope.query,
          visibility: scope.visibility,
          limit: 25,
          ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
          ...(previous ? { after: previous.nextCursor } : {}),
        }),
      );
      if (generation !== this.generation) return;
      if (
        page.endpointId !== scope.endpointId ||
        page.query !== scope.query ||
        page.visibility !== scope.visibility ||
        page.sessionId !== scope.sessionId ||
        (previous &&
          (page.connectionEpoch !== previous.connectionEpoch ||
            page.catalogDigest !== previous.catalogDigest ||
            page.nextCursor === previous.nextCursor))
      )
        throw new Error('Title search source changed; search again');
      if (previous) {
        const existing = new Set(
          this.state.items.map((item) => item.sessionId),
        );
        if (page.items.some((item) => existing.has(item.sessionId)))
          throw new Error(
            'Title search returned a repeated page; search again',
          );
      }
      this.publish({
        items: previous ? [...this.state.items, ...page.items] : page.items,
        page,
        loading: false,
        searched: true,
        error: '',
      });
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          ...this.state,
          loading: false,
          error: displayError(error),
        });
    }
  }
}
