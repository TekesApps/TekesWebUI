import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  QueueControls,
  queueEditUnavailableReason,
  type QueueControlsProps,
} from '../src/components/QueueControls';
import type { RunPresentation } from '../src/types';

const item: RunPresentation['queue'][number] = {
  id: 'input:9',
  placement: 'queued',
  message: { content: [{ type: 'text', text: 'original queue text' }] },
};

test('text-only queue contracts do not discard attachments or edit consumed placements', () => {
  const attached = {
    ...item,
    message: {
      content: [
        ...item.message!.content!,
        {
          type: 'file',
          attachment: { attachmentId: 'kept', name: 'proof.txt', bytes: 4 },
        },
      ],
    },
  };
  assert.equal(queueEditUnavailableReason(attached, 'pi'), null);
  assert.match(queueEditUnavailableReason(attached, 'tekes')!, /附件/);
  assert.match(queueEditUnavailableReason(attached, 'dsh')!, /附件/);
  assert.notEqual(
    queueEditUnavailableReason({ ...item, placement: 'dispatching' }, 'pi'),
    null,
  );
  assert.notEqual(
    queueEditUnavailableReason({ ...item, placement: 'steering' }, 'tekes'),
    null,
  );
  assert.equal(
    queueEditUnavailableReason({ ...item, placement: 'next-step' }, 'dsh'),
    null,
  );
});

test('queue edits keep failed drafts, fence operation scope and await public projections', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const calls: unknown[][] = [];
  let finish!: () => void;
  let failure = true;
  const edit = async (...args: unknown[]) => {
    calls.push(args);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (failure) throw new Error('mutation outcome unknown');
  };
  const props: QueueControlsProps = {
    address: { endpoint: 'kernel', sessionId: 'first' },
    connectionEpoch: 7,
    harnessKind: 'tekes',
    canUpdateQueue: true,
    queue: [item],
    onEdit: edit,
    onRemove: async () => {},
  };
  const render = () => root.render(createElement(QueueControls, props));
  const button = (text: string) =>
    [...dom.window.document.querySelectorAll('button')].find(
      (b) => b.textContent === text,
    )!;
  const area = () => dom.window.document.querySelector('textarea');
  try {
    await act(async () => render());
    await act(async () => button('编辑排队消息').click());
    assert.equal(area()!.value, 'original queue text');
    await act(async () => {
      button('保存排队消息').click();
      button('保存排队消息').click();
    });
    assert.equal(calls.length, 1, 'pending mutation cannot be submitted twice');
    assert.equal(button('保存排队消息').disabled, true);
    assert.deepEqual(calls[0], [
      { endpoint: 'kernel', sessionId: 'first' },
      'input:9',
      7,
      'original queue text',
    ]);
    await act(async () => finish());
    assert.equal(
      area()!.value,
      'original queue text',
      'uncertain failure retains the editable draft',
    );
    assert.match(
      dom.window.document.body.textContent!,
      /mutation outcome unknown/,
    );
    failure = false;
    await act(async () => button('保存排队消息').click());
    props.address = { endpoint: 'kernel', sessionId: 'second' };
    await act(async () => render());
    assert.equal(area(), null, 'new session cannot inherit the old editor');
    await act(async () => button('编辑排队消息').click());
    await act(async () => finish());
    assert.notEqual(
      area(),
      null,
      'old completion does not close another session editor',
    );
    props.connectionEpoch = 8;
    await act(async () => render());
    assert.equal(
      area(),
      null,
      'reconnect retires the old editor even for the same session and item',
    );
    assert.match(
      dom.window.document.body.textContent!,
      /original queue text/,
      'RPC completion cannot alter the public queue projection',
    );
    props.canUpdateQueue = false;
    await act(async () => render());
    assert.equal(button('编辑排队消息'), undefined);
  } finally {
    finish?.();
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
