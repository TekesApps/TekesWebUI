import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { GoalPanel, type GoalPanelProps } from '../src/components/GoalPanel';
import type { GoalAction, GoalSnapshot } from '../src/goals';
import { getLocale, setLocale } from '../src/i18n';

function snapshot(sessionId = 'one'): GoalSnapshot {
  return {
    endpointId: 'pi',
    sessionId,
    connectionEpoch: 8,
    goal: {
      ref: { id: `goal-${sessionId}`, revision: 3 },
      objective: `Goal ${sessionId}`,
      phase: 'paused',
      activation: 'disarmed',
      maxGoalRounds: 4,
      roundsStarted: 2,
      blockedReason: { code: 'budget', message: 'Waiting for budget' },
    },
    capabilities: {
      canCreate: true,
      canEdit: true,
      canPause: false,
      canResume: true,
      canClear: true,
      canSetCreateBudget: true,
      createMayRun: false,
      resumeMayRun: true,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture(
  check: (context: {
    container: HTMLElement;
    render: (props: GoalPanelProps) => Promise<void>;
    button: (label: string) => HTMLButtonElement;
    enterObjective: (value: string) => Promise<void>;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const locale = getLocale();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await check({
      container,
      render: (props) =>
        act(async () => root.render(createElement(GoalPanel, props))),
      button: (label) => {
        const result = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].find((button) => button.textContent === label);
        assert.ok(result, `Missing button ${label}`);
        return result;
      },
      enterObjective: (value) =>
        act(async () => {
          const input =
            container.querySelector<HTMLTextAreaElement>('textarea')!;
          Object.getOwnPropertyDescriptor(
            dom.window.HTMLTextAreaElement.prototype,
            'value',
          )!.set!.call(input, value);
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        }),
    });
  } finally {
    await act(async () => root.unmount());
    setLocale(locale);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

test('Goal actions retain authority, edited drafts and no automatic retry after a failed mutation', async () => {
  await fixture(async ({ container, render, button, enterObjective }) => {
    const pending = deferred<unknown>();
    const calls: GoalAction[] = [];
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      load: async () => snapshot(),
      act: async (action) => {
        calls.push(action);
        return pending.promise;
      },
    });
    assert.match(container.textContent!, /Waiting for budget/);
    assert.match(container.textContent!, /已启动 2 轮/);
    assert.match(container.textContent!, /Harness 可能自动调用模型/);
    assert.ok(button('恢复目标并启动'));
    await enterObjective('Edited objective');
    await act(async () => {
      button('保存目标').click();
      button('保存目标').click();
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      sessionId: 'one',
      connectionEpoch: 8,
      action: 'edit',
      ref: { id: 'goal-one', revision: 3 },
      objective: 'Edited objective',
      maxGoalRounds: undefined,
    });
    await act(async () => pending.reject(new Error('revision conflict')));
    assert.match(
      container.querySelector('[role="alert"]')!.textContent!,
      /revision conflict/,
    );
    assert.equal(
      container.querySelector('textarea')!.value,
      'Edited objective',
    );
    assert.equal(calls.length, 1);
  });
});

test('an acknowledged action with failed refresh is never resent and requires only a new read', async () => {
  await fixture(async ({ container, render, button, enterObjective }) => {
    let reads = 0;
    let actions = 0;
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      load: async () => {
        if (++reads === 2) throw new Error('read disconnected');
        return snapshot();
      },
      act: async () => {
        actions++;
        return { acknowledged: true };
      },
    });
    await enterObjective('Keep draft through refresh failure');
    await act(async () => button('保存目标').click());
    assert.equal(actions, 1);
    assert.equal(reads, 2);
    assert.equal(
      container.querySelector('textarea')!.value,
      'Keep draft through refresh failure',
    );
    assert.match(container.textContent!, /操作已确认；状态读取失败/);
    assert.equal(button('保存目标').disabled, true);
    await act(async () => button('刷新目标').click());
    assert.equal(reads, 3);
    assert.equal(
      actions,
      1,
      'refresh must only read, never resend the accepted mutation',
    );
    assert.equal(button('保存目标').disabled, false);
    assert.equal(
      container.querySelector('textarea')!.value,
      'Keep draft through refresh failure',
    );
  });
});

test('late Goal reads and mutation completions cannot populate another session', async () => {
  await fixture(async ({ container, render, button }) => {
    const oldRead = deferred<GoalSnapshot>();
    const oldAction = deferred<unknown>();
    await render({
      address: { endpoint: 'pi', sessionId: 'old' },
      load: () => oldRead.promise,
      act: async () => {},
    });
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      load: async () => snapshot(),
      act: () => oldAction.promise,
    });
    await act(async () => button('恢复目标并启动').click());
    await render({
      address: { endpoint: 'pi', sessionId: 'two' },
      load: async () => snapshot('two'),
      act: async () => {},
    });
    await act(async () => {
      oldRead.resolve(snapshot('old'));
      oldAction.resolve({ acknowledged: true });
    });
    assert.equal(container.querySelector('textarea')!.value, 'Goal two');
    assert.doesNotMatch(container.textContent!, /操作已确认/);
    assert.equal(button('保存目标').disabled, false);
  });
});

test('Goal capability gates keep unsupported creation read-only and reject cross-session snapshots', async () => {
  await fixture(async ({ container, render }) => {
    const read = snapshot();
    read.goal = null;
    read.capabilities.canCreate = false;
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      load: async () => read,
      act: async () => {
        assert.fail('must not mutate');
      },
    });
    assert.match(container.textContent!, /尚未提供新建目标/);
    assert.equal(container.querySelector('button[type="submit"]'), null);
    assert.equal(container.querySelector('textarea')!.disabled, true);
    await render({
      address: { endpoint: 'pi', sessionId: 'two' },
      load: async () => read,
      act: async () => {},
    });
    assert.match(
      container.querySelector('[role="alert"]')!.textContent!,
      /目标来源已变化/,
    );
    assert.equal(container.querySelector('textarea'), null);
  });
});

test('Goal creation exposes automatic execution and budget only when the Harness supports them', async () => {
  await fixture(async ({ container, render, button, enterObjective }) => {
    const initial = snapshot();
    initial.goal = null;
    initial.capabilities.canSetCreateBudget = false;
    initial.capabilities.createMayRun = true;
    const calls: GoalAction[] = [];
    const accepted = deferred<unknown>();
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      load: async () => initial,
      act: async (value) => {
        calls.push(value);
        return accepted.promise;
      },
    });
    assert.equal(container.querySelector('input[type="number"]'), null);
    await enterObjective('New objective');
    await act(async () => button('创建目标并启动').click());
    assert.deepEqual(calls, [
      {
        sessionId: 'one',
        connectionEpoch: 8,
        action: 'create',
        objective: 'New objective',
        maxGoalRounds: undefined,
      },
    ]);
    await act(async () => accepted.resolve({ acknowledged: true }));
    assert.equal(calls.length, 1);
  });
});
