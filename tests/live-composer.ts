/** Opt-in real-host acceptance. Creates and archives only its own temporary threads. */
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace';

const host = process.env.TEKES_HOST_URL,
  token = process.env.TEKES_BROWSER_TOKEN;
if (!host || !token)
  throw new Error(
    'Set TEKES_HOST_URL and TEKES_BROWSER_TOKEN for explicit real-host acceptance.',
  );
const url = new URL(host);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.protocol, 'http:');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  nativeFetch(new URL(String(input), url), init);
const w = new Workspace();
async function until(condition: () => boolean, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error(
        `Acceptance timeout: ${w.snapshot().error || w.snapshot().controlsError || 'authority did not settle'}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
try {
  await w.connect(token);
  assert.equal(w.snapshot().authenticated, true);
  const kinds = (process.env.TEKES_TEST_HARNESSES || 'tekes,pi,dsh').split(',');
  for (const kind of kinds) {
    const endpoint = w.snapshot().endpoints.find((e) => e.kind === kind);
    assert.ok(endpoint);
    w.newSession(w.snapshot().hostWorkspace, endpoint.id);
    await until(
      () => !w.snapshot().controlsLoading && !w.snapshot().modelLoading,
    );
    assert.equal(w.snapshot().controlsError, '');
    const presets = w.snapshot().presets.get(endpoint.id)!.presets;
    const preset = presets.find(
      (p) =>
        p.id ===
        (kind === 'tekes' ? 'coding' : kind === 'dsh' ? 'minimal' : 'default'),
    );
    assert.ok(preset);
    w.choosePreset(preset.id);
    const model = w.snapshot().models.find((m) => m.id === 'deepseek-flash');
    assert.ok(model);
    await w.chooseModel({
      provider: model.provider,
      model: model.id,
      reasoningEffort: model.reasoning?.efforts.find((e) => e.id === 'low')?.id,
    });
    const marker = `WEB_ATTACHMENT_${crypto.randomUUID().slice(0, 8)}`;
    w.addFiles([
      new File([marker + '\n'], 'tekes-web-ui-attachment.txt', {
        type: 'text/plain',
      }),
    ]);
    w.setDraft(
      '这是一次附件验证。请读取附件文件中的唯一验证标记，并只回复该标记，不要修改任何文件。',
    );
    assert.equal(w.canSend(), true);
    await w.submit();
    assert.equal(w.snapshot().error, '');
    assert.ok(w.snapshot().selected);
    await until(
      () =>
        w.snapshot().view?.run.phase === 'idle' &&
        !!w
          .snapshot()
          .view?.transcript?.items.some(
            (i) => i.kind === 'assistant' && i.text.includes(marker),
          ),
      150000,
    );
    assert.equal(w.snapshot().attachments.length, 0);
    assert.equal(w.snapshot().draft, '');
    assert.equal(w.snapshot().preset, preset.id);
    console.log(
      `${endpoint.name}: preset ${preset.id}, real ${model.id}, uploaded file read correctly, acknowledgement cleared only submitted input.`,
    );
    // Wait for the Harness's worker admission boundary, beyond the final transcript frame.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await until(() => !w.snapshot().view?.run.canCancel);
    await w.archive();
    assert.equal(w.snapshot().error, '');
    assert.equal(w.snapshot().selected, null);
  }
} finally {
  w.dispose();
}
