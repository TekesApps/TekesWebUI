import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import App from '../src/App';
import { Workspace } from '../src/workspace';
import { setLocale, t } from '../src/i18n';
import type { View } from '../src/types';

test('completed, active and waiting chats report the same current phase above and below the transcript', () => {
  const workspace = new Workspace();
  const state = workspace.snapshot();
  state.authenticated = true;
  state.selected = { endpoint: 'pi', sessionId: 'history' };
  state.endpoints = [{ id: 'pi', kind: 'pi', name: 'Pi', connection: 'ready' }];
  const view: View = {
    ...state.selected,
    run: {
      scope: { endpointId: 'pi', threadId: 'history', sessionId: 'history' },
      connectionEpoch: 1,
      phase: 'idle',
      canSubmit: true,
      canCancel: false,
      canUpdateQueue: false,
      jobs: [],
      queue: [],
      actionables: [],
      connection: {
        phase: 'connected',
        canSubmit: true,
        historyIsStale: false,
      },
    },
    transcript: {
      items: [
        {
          id: 'reply',
          turnId: 'old-turn',
          kind: 'assistant',
          text: 'Completed historical reply',
          isVisible: true,
          isFinal: true,
          isProvisional: false,
        },
      ],
      tools: [],
      hasMoreBefore: false,
      isStale: false,
    },
  };
  state.view = view;
  try {
    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale);
      for (const [phase, label] of [
        ['idle', '未运行'],
        ['running', '正在工作'],
        ['waitingForInput', '等待确认'],
      ] as const) {
        view.run.phase = phase;
        const document = new JSDOM(
          renderToStaticMarkup(createElement(App, { workspace })),
        ).window.document;
        const header = document.querySelector('.topbar .run-status')!;
        const footer = document.querySelector(
          '.composer-caption > span:last-child',
        )!;
        assert.equal(header.textContent, t(label));
        assert.ok(
          footer.textContent?.trim().endsWith(t(label)),
          `${phase}: ${footer.textContent}`,
        );
        assert.doesNotMatch(
          footer.textContent!,
          /后台持续运行|Runs in the background/,
        );
      }
    }
  } finally {
    setLocale('zh-CN');
    workspace.dispose();
  }
});
