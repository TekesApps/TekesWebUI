import { useEffect, useRef, useState } from 'react';
import type { Address, Json } from '../types';
import ReactMarkdown from 'react-markdown';
import { displayError } from '../state';
import { t } from '../i18n';

export interface CatalogCommand {
  name: string;
  title: string;
  description: string;
  argumentHint: string | null;
  supportsAttachments: boolean;
}
export interface CatalogSkill {
  id: string;
  name: string;
  title: string;
  description: string;
  selectable: boolean;
  unavailableReason?: string | null;
}
export interface ResourceCatalog {
  endpointId: string;
  sessionId: string;
  connectionEpoch: number;
  canRunCommands: boolean;
  commands: CatalogCommand[];
  skills: CatalogSkill[];
}
export interface CommandReceipt {
  commandId: string;
  accepted: true;
  text: string | null;
}
export interface CatalogTool {
  name: string;
  description: string;
  arguments: Json;
  availability: string;
  backend: string;
  effect: Json;
  source: { kind: string; [key: string]: Json };
}
interface ResourceScope {
  endpointId: string;
  sessionId: string;
  connectionEpoch: number;
}
export interface ToolCatalog extends ResourceScope {
  catalogDigest: string;
  tools: CatalogTool[];
}
export interface ToolResolution extends ResourceScope {
  catalogDigest: string;
  tool: CatalogTool;
}
export interface SkillResourceReference {
  kind: 'skill';
  sessionId: string;
  name: string;
  contentDigest: string;
}
export interface SkillResource {
  reference: SkillResourceReference;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}
export interface SkillResourcePage extends ResourceScope {
  items: SkillResource[];
  next: string | null;
}
export interface SkillResourceRead extends ResourceScope {
  reference: SkillResourceReference;
  uri: string;
  content:
    | { kind: 'text'; text: string; mimeType: string }
    | { kind: 'binary'; blobBase64: string; mimeType: string };
}
export interface ToolReader {
  load: (address: Address, connectionEpoch: number) => Promise<ToolCatalog>;
  resolve: (
    address: Address,
    connectionEpoch: number,
    name: string,
    catalogDigest: string,
  ) => Promise<ToolResolution>;
}
export interface SkillResourceReader {
  list: (
    address: Address,
    connectionEpoch: number,
    after?: string,
  ) => Promise<SkillResourcePage>;
  read: (
    address: Address,
    connectionEpoch: number,
    resource: SkillResource,
  ) => Promise<SkillResourceRead>;
}
export interface ResourcePickerProps {
  address: Address;
  connectionEpoch: number;
  load: (address: Address, connectionEpoch: number) => Promise<ResourceCatalog>;
  run: (
    address: Address,
    connectionEpoch: number,
    command: CatalogCommand,
    argumentsText: string,
  ) => Promise<CommandReceipt>;
  selectSkill: (address: Address, skill: CatalogSkill) => void;
  selectedSkillIds?: readonly string[];
  tools?: ToolReader;
  resources?: SkillResourceReader;
}

/** Session-scoped, on-demand discovery. Selecting a skill never submits a prompt. */
export function ResourcePicker({
  address,
  connectionEpoch,
  load,
  run,
  selectSkill,
  selectedSkillIds = [],
  tools,
  resources,
}: ResourcePickerProps) {
  const key = JSON.stringify([
    address.endpoint,
    address.sessionId,
    connectionEpoch,
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const generation = useRef(0);
  const mounted = useRef(true);
  const pending = useRef<{ key: string; generation: number } | null>(null);
  const [catalog, setCatalog] = useState<ResourceCatalog | null>(null);
  const [catalogKey, setCatalogKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [commandName, setCommandName] = useState('');
  const [argumentsText, setArgumentsText] = useState('');
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [resultText, setResultText] = useState('');
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<'commands' | 'tools' | 'resources'>(
    'commands',
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    setCatalog(null);
    setTab('commands');
    setCatalogKey('');
    setLoading(true);
    setError('');
    setQuery('');
    setCommandName('');
    setArgumentsText('');
    setRunning(false);
    setCompleted(false);
    setResultText('');
    pending.current = null;
    void load(address, connectionEpoch)
      .then((value) => {
        if (
          !active ||
          currentKey.current !== key ||
          request !== generation.current
        )
          return;
        if (
          value.endpointId !== address.endpoint ||
          value.sessionId !== address.sessionId ||
          value.connectionEpoch !== connectionEpoch
        )
          throw new Error(t('命令目录的会话来源已变化，请重新加载。'));
        setCatalog(value);
        setCatalogKey(key);
      })
      .catch((cause) => {
        if (
          active &&
          currentKey.current === key &&
          request === generation.current
        )
          setError(displayError(cause));
      })
      .finally(() => {
        if (
          active &&
          currentKey.current === key &&
          request === generation.current
        )
          setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, reload, load]);

  const visible = catalogKey === key ? catalog : null;
  const needle = query.trim().toLocaleLowerCase();
  const matches = (entry: {
    name: string;
    title: string;
    description: string;
  }) =>
    `${entry.name}\n${entry.title}\n${entry.description}`
      .toLocaleLowerCase()
      .includes(needle);
  const command = visible?.commands.find((entry) => entry.name === commandName);

  async function execute() {
    if (!command || !visible?.canRunCommands || pending.current?.key === key)
      return;
    const owner = { key, generation: generation.current };
    pending.current = owner;
    setRunning(true);
    setError('');
    setCompleted(false);
    try {
      const receipt = await run(
        address,
        connectionEpoch,
        command,
        argumentsText,
      );
      if (
        mounted.current &&
        currentKey.current === owner.key &&
        generation.current === owner.generation
      ) {
        setCompleted(true);
        setResultText(receipt.text || '');
      }
    } catch (cause) {
      if (
        mounted.current &&
        currentKey.current === owner.key &&
        generation.current === owner.generation
      )
        setError(displayError(cause));
    } finally {
      if (pending.current === owner) pending.current = null;
      if (
        mounted.current &&
        currentKey.current === owner.key &&
        generation.current === owner.generation
      )
        setRunning(false);
    }
  }

  const tabs =
    tools || resources ? (
      <nav aria-label={t('会话资源')}>
        <button
          type="button"
          aria-pressed={tab === 'commands'}
          onClick={() => setTab('commands')}
        >
          {t('命令与 Skills')}
        </button>
        {tools && (
          <button
            type="button"
            aria-pressed={tab === 'tools'}
            onClick={() => setTab('tools')}
          >
            {t('工具目录')}
          </button>
        )}
        {resources && (
          <button
            type="button"
            aria-pressed={tab === 'resources'}
            onClick={() => setTab('resources')}
          >
            {t('Skill 资源')}
          </button>
        )}
      </nav>
    ) : null;
  if (tab === 'tools' && tools)
    return (
      <section className="resource-picker">
        {tabs}
        <ToolInspector
          key={key}
          address={address}
          connectionEpoch={connectionEpoch}
          reader={tools}
        />
      </section>
    );
  if (tab === 'resources' && resources)
    return (
      <section className="resource-picker">
        {tabs}
        <SkillResources
          key={key}
          address={address}
          connectionEpoch={connectionEpoch}
          reader={resources}
        />
      </section>
    );
  return (
    <section className="resource-picker" aria-label={t('命令与 Skills')}>
      {tabs}
      <div className="section-heading">
        <h3>{t('命令与 Skills')}</h3>
        <button
          type="button"
          disabled={loading || running}
          onClick={() => setReload((n) => n + 1)}
        >
          {t('重新加载')}
        </button>
      </div>
      <input
        type="search"
        aria-label={t('搜索命令与 Skills')}
        placeholder={t('搜索命令与 Skills')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {loading && <p role="status">{t('读取中…')}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {visible && (
        <>
          <h4>{t('命令')}</h4>
          {!visible.commands.length && <p>{t('此会话没有可用命令。')}</p>}
          <ul>
            {visible.commands.filter(matches).map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  disabled={running}
                  aria-pressed={entry.name === commandName}
                  onClick={() => {
                    setCommandName(entry.name);
                    setArgumentsText('');
                    setCompleted(false);
                    setError('');
                  }}
                >
                  /{entry.name} — {entry.title}
                </button>
                {entry.description && <p>{entry.description}</p>}
              </li>
            ))}
          </ul>
          {command && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void execute();
              }}
            >
              <label>
                {t('命令参数')}
                <textarea
                  value={argumentsText}
                  placeholder={command.argumentHint || ''}
                  disabled={running}
                  onChange={(event) => {
                    setArgumentsText(event.target.value);
                    setCompleted(false);
                  }}
                />
              </label>
              {!visible.canRunCommands && (
                <p>{t('此会话当前不能执行命令。')}</p>
              )}
              <button
                type="submit"
                disabled={!visible.canRunCommands || running}
              >
                {running ? t('执行中…') : t('执行命令')}
              </button>
              {completed && (
                <p role="status">{resultText || t('命令已提交。')}</p>
              )}
            </form>
          )}
          <h4>Skills</h4>
          <p>{t('选择 Skill 后随本会话的下一条消息发送。')}</p>
          {!visible.skills.length && <p>{t('此会话没有可用 Skills。')}</p>}
          <ul>
            {visible.skills.filter(matches).map((skill) => (
              <li key={skill.id}>
                <button
                  type="button"
                  disabled={!skill.selectable || running}
                  aria-pressed={selectedSkillIds.includes(skill.id)}
                  onClick={() => selectSkill(address, skill)}
                >
                  {skill.title}
                </button>
                {skill.description && <p>{skill.description}</p>}
                {!skill.selectable && (
                  <p>{t('此 Skill 需要通过 Harness 专用入口调用。')}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function sameResourceScope(
  value: ResourceScope,
  address: Address,
  epoch: number,
) {
  return (
    value.endpointId === address.endpoint &&
    value.sessionId === address.sessionId &&
    value.connectionEpoch === epoch
  );
}
function resourceIdentity(resource: SkillResource) {
  return JSON.stringify([
    resource.reference.sessionId,
    resource.reference.name,
    resource.reference.contentDigest,
    resource.uri,
  ]);
}
function ToolInspector({
  address,
  connectionEpoch,
  reader,
}: {
  address: Address;
  connectionEpoch: number;
  reader: ToolReader;
}) {
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [selected, setSelected] = useState<CatalogTool | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    setCatalog(null);
    setSelected(null);
    void reader
      .load(address, connectionEpoch)
      .then((value) => {
        if (id !== request.current) return;
        if (!sameResourceScope(value, address, connectionEpoch))
          throw new Error(t('工具目录的会话来源已变化。'));
        setCatalog(value);
      })
      .catch((cause) => {
        if (id === request.current) setError(displayError(cause));
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [
    address.endpoint,
    address.sessionId,
    connectionEpoch,
    reader.load,
    reload,
  ]);
  async function open(tool: CatalogTool) {
    if (!catalog) return;
    const id = ++request.current;
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const value = await reader.resolve(
        address,
        connectionEpoch,
        tool.name,
        catalog.catalogDigest,
      );
      if (id !== request.current) return;
      if (
        !sameResourceScope(value, address, connectionEpoch) ||
        value.catalogDigest !== catalog.catalogDigest ||
        value.tool.name !== tool.name
      )
        throw new Error(t('工具目录已变化，请重新加载。'));
      setSelected(value.tool);
    } catch (cause) {
      if (id === request.current) setError(displayError(cause));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  return (
    <section aria-label={t('工具目录')}>
      <div className="section-heading">
        <h3>{t('工具目录')}</h3>
        <button
          type="button"
          disabled={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          {t('重新加载')}
        </button>
      </div>
      <p>{t('这里只读展示本会话的工具定义与来源。')}</p>
      {loading && <p role="status">{t('读取中…')}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul>
        {catalog?.tools.map((tool) => (
          <li key={tool.name}>
            <button
              type="button"
              disabled={loading}
              onClick={() => void open(tool)}
            >
              {tool.name}
            </button>
            <p>{tool.description}</p>
          </li>
        ))}
      </ul>
      {selected && (
        <article aria-label={selected.name}>
          <h4>{selected.name}</h4>
          <p>{selected.description}</p>
          <dl>
            <dt>{t('可用性')}</dt>
            <dd>{selected.availability}</dd>
            <dt>{t('来源')}</dt>
            <dd>
              <pre>{JSON.stringify(selected.source, null, 2)}</pre>
            </dd>
            <dt>{t('效果')}</dt>
            <dd>
              <pre>{JSON.stringify(selected.effect, null, 2)}</pre>
            </dd>
          </dl>
          <h4>{t('参数结构')}</h4>
          <pre>{JSON.stringify(selected.arguments, null, 2)}</pre>
        </article>
      )}
      {catalog && !catalog.tools.length && <p>{t('此会话没有可用工具。')}</p>}
    </section>
  );
}
function SkillResources({
  address,
  connectionEpoch,
  reader,
}: {
  address: Address;
  connectionEpoch: number;
  reader: SkillResourceReader;
}) {
  const [items, setItems] = useState<SkillResource[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [read, setRead] = useState<SkillResourceRead | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageFailed, setPageFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const activeRead = useRef(0);
  const pendingPage = useRef(false);
  useEffect(() => {
    const id = ++generation.current;
    pendingPage.current = true;
    setItems([]);
    setNext(null);
    setRead(null);
    setError('');
    setLoading(true);
    setPageFailed(false);
    void reader
      .list(address, connectionEpoch)
      .then((page) => {
        if (id !== generation.current) return;
        if (
          !sameResourceScope(page, address, connectionEpoch) ||
          page.items.some(
            (item) => item.reference.sessionId !== address.sessionId,
          )
        )
          throw new Error(t('资源目录的会话来源已变化。'));
        setItems(page.items);
        setNext(page.next);
      })
      .catch((cause) => {
        if (id === generation.current) {
          setError(displayError(cause));
          setPageFailed(true);
        }
      })
      .finally(() => {
        if (id === generation.current) {
          setLoading(false);
          pendingPage.current = false;
        }
      });
    return () => {
      generation.current++;
      activeRead.current++;
    };
  }, [
    address.endpoint,
    address.sessionId,
    connectionEpoch,
    reader.list,
    reload,
  ]);
  async function more() {
    if (!next || pendingPage.current || pageFailed) return;
    const id = generation.current;
    const cursor = next;
    pendingPage.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await reader.list(address, connectionEpoch, cursor);
      if (id !== generation.current) return;
      if (
        !sameResourceScope(page, address, connectionEpoch) ||
        page.items.some(
          (item) => item.reference.sessionId !== address.sessionId,
        )
      )
        throw new Error(t('资源目录的会话来源已变化。'));
      const seen = new Set(items.map(resourceIdentity));
      if (
        page.next === cursor ||
        page.items.some((item) => seen.has(resourceIdentity(item)))
      )
        throw new Error(t('资源分页已变化，请重新加载。'));
      setItems([...items, ...page.items]);
      setNext(page.next);
    } catch (cause) {
      if (id === generation.current) {
        setError(displayError(cause));
        setPageFailed(true);
      }
    } finally {
      if (id === generation.current) {
        pendingPage.current = false;
        setLoading(false);
      }
    }
  }
  async function open(item: SkillResource) {
    const id = ++activeRead.current;
    const owner = generation.current;
    setRead(null);
    setError('');
    try {
      const value = await reader.read(address, connectionEpoch, item);
      if (id !== activeRead.current || owner !== generation.current) return;
      if (
        !sameResourceScope(value, address, connectionEpoch) ||
        resourceIdentity({
          ...item,
          reference: value.reference,
          uri: value.uri,
        }) !== resourceIdentity(item)
      )
        throw new Error(t('资源内容的来源已变化。'));
      setRead(value);
    } catch (cause) {
      if (id === activeRead.current && owner === generation.current)
        setError(displayError(cause));
    }
  }
  return (
    <section aria-label={t('Skill 资源')}>
      <div className="section-heading">
        <h3>{t('Skill 资源')}</h3>
        <button
          type="button"
          disabled={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          {t('重新加载')}
        </button>
      </div>
      {loading && <p role="status">{t('读取中…')}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul>
        {items.map((item) => (
          <li key={resourceIdentity(item)}>
            <button type="button" onClick={() => void open(item)}>
              {item.name}
            </button>
            {item.description && <p>{item.description}</p>}
            <small>
              {item.reference.name} ·{' '}
              {item.mimeType || 'application/octet-stream'}
            </small>
          </li>
        ))}
      </ul>
      {next && (
        <button
          type="button"
          disabled={loading || pageFailed}
          onClick={() => void more()}
        >
          {t('加载更多资源')}
        </button>
      )}
      {!loading && !items.length && !error && (
        <p>{t('此会话没有 Skill 资源。')}</p>
      )}
      {read && (
        <article aria-label={read.uri}>
          <h4>{read.uri}</h4>
          <p>{read.content.mimeType}</p>
          {read.content.kind === 'binary' ? (
            <p>{t('此资源为二进制内容，不能作为文本编辑。')}</p>
          ) : read.content.mimeType === 'text/markdown' ? (
            <div className="markdown">
              <ReactMarkdown>{read.content.text}</ReactMarkdown>
            </div>
          ) : (
            <pre>{read.content.text}</pre>
          )}
        </article>
      )}
    </section>
  );
}
