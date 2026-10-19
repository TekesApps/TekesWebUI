import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { Composer } from '../src/components/Composer';
import { Workspace } from '../src/workspace';

test('sending retains the editor and toolbar footprint instead of inserting a feedback row', () => {
  const workspace = new Workspace();
  const state = { ...workspace.snapshot(), draft: '发送这条消息' };
  const render = (changes: Partial<typeof state>) =>
    new JSDOM(
      renderToStaticMarkup(
        createElement(Composer, {
          workspace,
          state: { ...state, ...changes },
          prompt: createRef<HTMLTextAreaElement>(),
          onSubmit() {},
        }),
      ),
    ).window.document;
  const idle = render({});
  for (const submissionStage of ['正在发送', '正在创建会话', '上传附件 1/2']) {
    const busy = render({ busy: true, submissionStage });
    assert.equal(busy.querySelector('textarea')?.value, state.draft);
    assert.equal(
      busy.querySelector('form')?.children.length,
      idle.querySelector('form')?.children.length,
    );
    assert.equal(busy.querySelector('.composer-feedback'), null);
    assert.equal(
      busy.querySelector('.composer-toolbar [role="status"]')?.textContent,
      submissionStage,
    );
    assert.equal(
      busy.querySelectorAll('.composer-model-controls button').length,
      idle.querySelectorAll('.composer-model-controls button').length,
    );
  }
  assert.equal(
    render({ controlsError: '读取失败' }).querySelector(
      '.composer-feedback.error',
    )?.textContent,
    '读取失败',
  );
});
