import { t, intlLocale } from './i18n';
import type { Catalog, Endpoint, Session, Summary } from './types';

export const addressKey = (endpoint: string, session = '', cwd = '') =>
  JSON.stringify([endpoint, session, session ? '' : cwd]);
export function sessionTitle(row: Summary = {}) {
  const value = row.projections?.values?.title;
  const title =
    row.title || (typeof value === 'string' ? value : value?.title) || row.name;
  return typeof title === 'string' && title.trim() ? title.trim() : t('新会话');
}
export const folderName = (path = '') =>
  path.split('/').filter(Boolean).at(-1) ||
  (path === '/' ? '/' : t('其他会话'));
export function timestampMillis(value?: string | number) {
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value))
    return Date.parse(value) || 0;
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number * (number < 100000000000 ? 1000 : 1)
    : 0;
}
export function formatTimestamp(value?: string | number, timeZone?: string) {
  const millis = timestampMillis(value);
  return millis && Number.isFinite(new Date(millis).getTime())
    ? new Intl.DateTimeFormat(intlLocale(), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZone,
      }).format(millis)
    : '';
}
/** Calendar-day relative labels; DST and UTC offsets must not become elapsed-day guesses. */
export function formatMessageTime(
  value?: string | number,
  now = Date.now(),
  timeZone?: string,
) {
  const millis = timestampMillis(value);
  if (
    !millis ||
    !Number.isFinite(new Date(millis).getTime()) ||
    !Number.isFinite(new Date(now).getTime())
  )
    return '';
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone,
  });
  const day = (time: number) => {
    const parts = dayFormatter.formatToParts(time);
    const number = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    return (
      Date.UTC(number('year'), number('month') - 1, number('day')) / 86_400_000
    );
  };
  const days = day(now) - day(millis);
  const clock = new Intl.DateTimeFormat(intlLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(millis);
  const label =
    days === 0
      ? t('今天')
      : days === 1
        ? t('昨天')
        : days > 1 && days <= 7
          ? new Intl.DateTimeFormat(intlLocale(), {
              weekday: 'long',
              timeZone,
            }).format(millis)
          : new Intl.DateTimeFormat(intlLocale(), {
              month: intlLocale().startsWith('zh') ? 'long' : 'short',
              day: 'numeric',
              timeZone,
            }).format(millis);
  return `${label} ${clock}`;
}
export function shortAge(value?: string | number, now = Date.now()) {
  const millis = timestampMillis(value);
  if (!millis) return '';
  const elapsed = Math.max(0, now - millis);
  if (elapsed < 60_000) return t('刚刚');
  if (elapsed < 3_600_000) return t('{0} 分钟前', Math.floor(elapsed / 60_000));
  if (elapsed < 86_400_000)
    return t('{0} 小时前', Math.floor(elapsed / 3_600_000));
  const date = new Date(millis),
    current = new Date(now);
  const days =
    (Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) -
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
    86_400_000;
  if (days === 1) return t('昨天');
  if (days < 7) return t('{0} 天前', days);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
interface Entry {
  endpoint: string;
  sessionId: string;
  title: string;
  row: Summary;
  agent: string;
  activity?: Session['activity'];
}
interface Group {
  key: string;
  path: string;
  name: string;
  updatedAt: number;
  entries: Entry[];
}
export type SessionSort =
  'recentActivity' | 'titleAscending' | 'titleDescending';
export type SessionGrouping = 'folder' | 'status' | 'none';
export function sessionGroupingPreference(
  saved: string | null | undefined,
): SessionGrouping {
  return saved === 'status'
    ? 'status'
    : saved === 'none' || saved === 'false'
      ? 'none'
      : 'folder';
}
const statusGroups = {
  running: '运行中',
  queued: '排队中',
  waitingForInput: '等待输入',
  completed: '已完成',
  notStarted: '未开始',
  failed: '失败',
  cancelled: '已取消',
  idle: '未运行',
  unknown: '状态未知',
  stale: '状态待更新',
};
export function sessionActivity(entry: Session): keyof typeof statusGroups {
  if (entry.activity?.isStale) return 'stale';
  return entry.activity?.status || 'unknown';
}
export interface ListOptions {
  sort?: SessionSort;
  grouping?: SessionGrouping;
}
export function groupSessions(
  endpoints: Pick<Endpoint, 'id' | 'name'>[],
  inventories: Map<string, Session[]>,
  query = '',
  harness = '',
  runningOnly = false,
  titleFor = (_endpoint: string, entry: Session) => sessionTitle(entry.summary),
  options: ListOptions = {},
) {
  const groups = new Map<string, Group>(),
    needle = query.trim().toLocaleLowerCase(),
    mode = options.grouping || 'folder';
  for (const endpoint of endpoints) {
    if (harness && endpoint.id !== harness) continue;
    for (const entry of inventories.get(endpoint.id) || []) {
      const row = entry.summary;
      if (
        !row ||
        row.ephemeral ||
        row.status === 'archived' ||
        (runningOnly && sessionActivity(entry) !== 'running')
      )
        continue;
      const path = row.cwd || '',
        title = titleFor(endpoint.id, entry);
      if (
        needle &&
        ![title, path, endpoint.name]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle)
      )
        continue;
      const pinned = entry.pin?.pinned === true,
        status = sessionActivity(entry);
      const key = pinned
        ? 'pinned'
        : mode === 'none'
          ? 'all'
          : mode === 'status'
            ? `status:${status}`
            : path || `endpoint:${endpoint.id}`;
      if (!groups.has(key))
        groups.set(key, {
          key,
          path: pinned || mode !== 'folder' ? '' : path,
          name: pinned
            ? t('置顶')
            : mode === 'status'
              ? t(statusGroups[status])
              : mode === 'none'
                ? t('所有会话')
                : path
                  ? folderName(path)
                  : endpoint.name,
          updatedAt: 0,
          entries: [],
        });
      const group = groups.get(key)!;
      group.updatedAt = Math.max(
        group.updatedAt,
        timestampMillis(row.updatedAt),
      );
      group.entries.push({
        endpoint: endpoint.id,
        sessionId: entry.sessionId,
        title,
        row,
        agent: endpoint.name,
        activity: entry.activity,
      });
    }
  }
  const direction = options.sort === 'titleDescending' ? -1 : 1;
  const titleSort =
    options.sort === 'titleAscending' || options.sort === 'titleDescending';
  return [...groups.values()]
    .sort((a, b) =>
      a.key === 'pinned'
        ? -1
        : b.key === 'pinned'
          ? 1
          : mode === 'status'
            ? Object.keys(statusGroups).indexOf(a.key.slice(7)) -
              Object.keys(statusGroups).indexOf(b.key.slice(7))
            : titleSort
              ? direction *
                  a.name.localeCompare(b.name, intlLocale(), {
                    numeric: true,
                  }) || a.key.localeCompare(b.key)
              : b.updatedAt - a.updatedAt || a.key.localeCompare(b.key),
    )
    .map((group) => ({
      ...group,
      entries: group.entries.sort(
        (a, b) =>
          (titleSort
            ? direction *
              a.title.localeCompare(b.title, intlLocale(), { numeric: true })
            : timestampMillis(b.row.updatedAt) -
              timestampMillis(a.row.updatedAt)) ||
          addressKey(a.endpoint, a.sessionId).localeCompare(
            addressKey(b.endpoint, b.sessionId),
          ),
      ),
    }));
}
export class TitleReceipts {
  readonly values = new Map<string, { title: string; sequence: number }>();
  remember(endpoint: string, session: string, title: string, sequence: number) {
    if (Number.isSafeInteger(sequence) && sequence >= 0)
      this.values.set(addressKey(endpoint, session), { title, sequence });
  }
  title(endpoint: string, session: string, row: Summary = {}) {
    const key = addressKey(endpoint, session),
      receipt = this.values.get(key);
    if (!receipt) return sessionTitle(row);
    if (Number(row.projections?.asOfSeq ?? -1) >= receipt.sequence) {
      this.values.delete(key);
      return sessionTitle(row);
    }
    return receipt.title;
  }
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export class DraftStore {
  values = new Map<string, string>();
  constructor(private storage?: StorageLike) {
    try {
      this.values = new Map(
        JSON.parse(storage?.getItem('tekes.web.drafts') || '[]'),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  get(key: string) {
    return this.values.get(key) || '';
  }
  set(key: string, text: string) {
    if (text) this.values.set(key, text);
    else this.values.delete(key);
    try {
      this.storage?.setItem(
        'tekes.web.drafts',
        JSON.stringify([...this.values].slice(-40)),
      );
    } catch {
      /* Keep memory drafts. */
    }
  }
  clearIfUnchanged(key: string, submitted: string) {
    if (this.get(key) === submitted) this.set(key, '');
  }
}
export function catalogModels(catalog: Catalog = {}) {
  return (catalog.groups || catalog.providers || []).flatMap((group) =>
    (group.models || []).map((model) => ({ ...model, provider: group.id })),
  );
}
export function safeLink(raw: string) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function displayError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('execution directory must match'))
    return t('当前 Agent 仅允许使用宿主配置的默认工作目录。');
  if (/timed out|timeout|reconcile mutation/i.test(message))
    return t(
      '请求未能确认完成。操作可能已经提交，请先检查会话和结果，再决定是否重试。',
    );
  if (message.startsWith('remote: ')) {
    try {
      const details = JSON.parse(message.slice(8));
      return String(details.message || t('Agent 未能完成请求，请稍后重试。'));
    } catch {
      /* Already readable. */
    }
  }
  return message;
}
export function shouldSend(event: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}) {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey
  );
}
export function scrollPolicy(
  element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
  hasSelection = false,
) {
  return (
    !hasSelection &&
    element.scrollHeight - element.scrollTop - element.clientHeight < 64
  );
}
export function preference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Optional preference. */
  }
}
export function browserStorage() {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
}
