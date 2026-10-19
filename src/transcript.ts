import { t } from './i18n';
import type { Item, Json, Tool, View } from './types';

// Semantic roles mirror ClientKit TranscriptToolDisplay. Browser glyphs use the TekesUI Gallery SVG catalog.
export const toolFamilies = {
  write: 'write',
  edit: 'write',
  apply_patch: 'write',
  str_replace_editor: 'write',
  read: 'read',
  read_image: 'read',
  session_event_read: 'read',
  shell: 'shell',
  bash: 'shell',
  pwsh: 'shell',
  grep: 'search',
  glob: 'search',
  tool_search: 'search',
  lsp: 'search',
  session_search: 'search',
  session_event_search: 'search',
  cordis_inspect_list: 'search',
  cordis_inspect_query: 'search',
  cordis_inspect_self: 'search',
  web_search: 'webSearch',
  web_fetch: 'webFetch',
  fetch: 'webFetch',
  verify: 'verify',
  task: 'task',
  workflow: 'task',
  todo_write: 'task',
  create_goal: 'task',
  get_goal: 'task',
  update_goal: 'task',
  ralph: 'task',
  subagent: 'subagent',
  interrupt_agent: 'subagent',
  list_agents: 'subagent',
  send_message: 'subagent',
  brief: 'brief',
  ask_user_question: 'askUser',
  ask_user_questions: 'askUser',
  skill: 'skill',
  report: 'report',
  memorize: 'memorize',
  job: 'job',
  job_kill: 'job',
  job_list: 'job',
  job_output: 'job',
  context: 'context',
  session_event_trace: 'context',
  session_trace: 'context',
  note: 'note',
  recall: 'recall',
  think: 'think',
  compact: 'compact',
  // Public Harness aliases; they retain the same semantic role.
  read_file: 'read',
  write_file: 'write',
  edit_file: 'write',
  exec_command: 'shell',
  run_command: 'shell',
  search: 'search',
  search_files: 'search',
  list_files: 'search',
  spawn_agent: 'subagent',
  send_message_to_agent: 'subagent',
} as const;
export type ToolRole =
  (typeof toolFamilies)[keyof typeof toolFamilies] | 'unknown';
export function toolRole(name: string): ToolRole {
  const family = name.split('.')[0]!;
  if (family.startsWith('terminal_')) return 'shell';
  if (family.startsWith('schedule_')) return 'job';
  return toolFamilies[family as keyof typeof toolFamilies] || 'unknown';
}
export function humanize(name: string): string {
  const action = name.startsWith('mcp__') ? name.split('__').at(-1)! : name;
  const drawing: Record<string, string> = {
    dxf_context: t('读取图纸上下文'),
    dxf_move: t('移动图元'),
    dxf_delete: t('删除图元'),
    dxf_create_line: t('绘制直线'),
    dxf_change_text: t('修改图纸文字'),
  };
  return (
    drawing[action] ||
    action.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
  );
}
export function object(value: Json | undefined): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}
export function firstLine(value: Json | undefined): string | undefined {
  return typeof value === 'string'
    ? value
        .trim()
        .split(/[\r\n]/)[0]
        ?.replace(/\s+/g, ' ') || undefined
    : undefined;
}
export function resultText(value: Json | undefined): string {
  if (typeof value === 'string') return value;
  const record = object(value);
  if (Array.isArray(record.content))
    return (
      record.content
        .map((part) => firstLineType(object(part).text))
        .filter(Boolean)
        .join('\n') || JSON.stringify(value, null, 2)
    );
  if (typeof record.output === 'string') return record.output;
  return value == null ? '' : JSON.stringify(value, null, 2);
}
function firstLineType(value: Json | undefined) {
  return typeof value === 'string' ? value : '';
}
export type ToolState = 'running' | 'ok' | 'error' | 'stopped' | 'unknown';
const runningPhases = new Set(['will', 'doing', 'running', 'pending']);
const stoppedPhases = new Set([
  'interrupted',
  'stopped',
  'cancelled',
  'canceled',
]);
const donePhases = new Set(['done', 'completed', 'succeeded', 'success', 'ok']);
export function toolState(tool: Tool, live: boolean): ToolState {
  let parsed = tool.result;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as Json;
    } catch {
      /* ordinary text output */
    }
  }
  const result = object(parsed),
    text = resultText(tool.result);
  if (
    tool.phase === 'failed' ||
    tool.phase === 'error' ||
    result.isError === true ||
    result.is_error === true
  )
    return 'error';
  if (stoppedPhases.has(tool.phase)) return 'stopped';
  if (runningPhases.has(tool.phase)) return live ? 'running' : 'stopped';
  if (donePhases.has(tool.phase)) {
    const exit = result.exitCode ?? result.exit_code;
    if (
      (Array.isArray(result.steps) &&
        result.steps.some((step) => {
          const record = object(step);
          return typeof record.exit_code === 'number' && record.exit_code !== 0;
        })) ||
      (typeof exit === 'number' && exit !== 0) ||
      typeof result.signal === 'string' ||
      /\n\[exit code: -?[1-9]\d*\]$|\n\[killed by signal: [^\]]+\]$/.test(text)
    )
      return 'error';
    return 'ok';
  }
  return 'unknown';
}
export const toolStateLabels: Record<ToolState, string> = {
  running: '执行中',
  ok: '已完成',
  error: '失败',
  stopped: '已停止',
  unknown: '状态未知',
};
export function toolSummary(tool: Tool): string | undefined {
  const args = object(tool.arguments),
    role = toolRole(tool.name);
  const keys =
    role === 'shell'
      ? ['description', 'command', 'cmd', 'script']
      : ['read', 'write'].includes(role)
        ? ['path', 'file_path']
        : ['search', 'webSearch'].includes(role)
          ? ['query', 'pattern', 'url']
          : role === 'webFetch'
            ? ['url']
            : ['description', 'title', 'query', 'path', 'url'];
  for (const key of keys) {
    const value = firstLine(args[key]);
    if (value) return value;
  }
  if (Array.isArray(args.queries))
    return args.queries.map(firstLine).filter(Boolean).join(', ') || undefined;
  // Never turn arbitrary payload fields (credentials/source bodies) into a row preview.
  return undefined;
}
export function visibleItem(item: Item): boolean {
  return (
    item.isVisible &&
    item.kind !== 'reasoning' &&
    item.kind !== 'usage' &&
    (!!item.text.trim() || !!item.attachments?.length)
  );
}
export function partitionTurn(items: Item[], tools: Tool[]) {
  const inputs = items.filter((i) => i.kind === 'user');
  const output = items.filter(
    (i) => i.kind === 'assistant' && (i.isFinal || !tools.length),
  );
  const activity = items.filter(
    (i) => i.kind !== 'user' && !output.includes(i),
  );
  return { inputs, output, activity };
}
export function liveTurnID(view: View): string | undefined {
  if (
    view.transcript?.isStale ||
    view.run.connection.phase !== 'connected' ||
    !['running', 'waitingForInput'].includes(view.run.phase)
  )
    return undefined;
  return (
    view.transcript?.turns?.at(-1)?.id ||
    view.transcript?.items.at(-1)?.turnId ||
    view.transcript?.tools.at(-1)?.turnId
  );
}
export function turnStatus(view: View, id: string): string {
  return (
    view.transcript?.turns?.find((t) => t.id === id)?.status ||
    (liveTurnID(view) === id
      ? view.run.phase
      : view.run.phase === 'running'
        ? 'completed'
        : view.run.phase)
  );
}
export function thinkingStatus(view: View): boolean {
  const turn = liveTurnID(view);
  if (
    !turn ||
    view.run.phase !== 'running' ||
    view.transcript?.tools.some(
      (t) => t.turnId === turn && toolState(t, true) === 'running',
    )
  )
    return false;
  const items =
    view.transcript?.items.filter((i) => i.turnId === turn && i.isVisible) ||
    [];
  const latest = items
    .filter((i) => !!i.reasoning || i.kind === 'reasoning')
    .at(-1);
  return (
    !!latest &&
    latest.isProvisional &&
    !latest.reasoningEnded &&
    !latest.text.trim() &&
    !items.slice(items.indexOf(latest) + 1).some((i) => !!i.text.trim())
  );
}

/** Only the selected connected turn's provider-reported count; never a text estimate. */
export function liveOutputTokens(view: View): number | undefined {
  const id = liveTurnID(view);
  if (!id || view.run.phase !== 'running') return undefined;
  const count = view.transcript?.turns?.find((turn) => turn.id === id)
    ?.liveUsage?.outputTokens;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
    ? count
    : undefined;
}
