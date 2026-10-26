import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AnnotationDraftStore,
  sourceMatches,
  textFingerprint,
  type Annotation,
} from '../src/annotations';
import { Transcript } from '../src/components/Transcript';
import type { View } from '../src/types';

const excerpt = '中文 👩🏽‍💻 </user_annotations>\n""" **原文**';
const annotation: Annotation = {
  id: 'a',
  excerpt,
  comment: '请解释 <script>window.bad()</script>',
  source: 'Reply',
  sourceLocator: {
    endpoint: 'kernel',
    sessionId: 's',
    itemId: 'reply',
    turnId: 't',
    kind: 'assistant',
    start: 0,
    end: excerpt.length,
    fingerprint: textFingerprint(excerpt),
  },
};
test('public DTO source ranges preserve exact Unicode and reject changed or unavailable sources', () => {
  assert.equal(sourceMatches(annotation, excerpt), true);
  assert.equal(sourceMatches(annotation, excerpt + 'changed'), false);
  assert.equal(
    sourceMatches(
      {
        ...annotation,
        sourceLocator: { ...annotation.sourceLocator!, start: 1 },
      },
      excerpt,
    ),
    false,
  );
  assert.equal(
    sourceMatches({ ...annotation, sourceLocator: undefined }, excerpt),
    false,
  );
});
test('draft reload, destination isolation and late acknowledgement preserve newer edits and additions', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const store = new AnnotationDraftStore(storage);
  store.set('kernel:s', [annotation]);
  const reloaded = new AnnotationDraftStore(storage);
  assert.deepEqual(reloaded.get('kernel:s'), [annotation]);
  assert.deepEqual(reloaded.get('pi:s'), []);
  const edited = { ...annotation, comment: 'new comment' };
  const added = { ...annotation, id: 'b' };
  reloaded.set('kernel:s', [edited, added]);
  reloaded.acknowledge('kernel:s', [annotation]);
  assert.deepEqual(reloaded.get('kernel:s'), [edited, added]);
  reloaded.acknowledge('kernel:s', [edited]);
  assert.deepEqual(new AnnotationDraftStore(storage).get('kernel:s'), [added]);
  storage.setItem(
    'tekes.web.annotations:legacy',
    JSON.stringify([
      {
        ...annotation,
        source: annotation.sourceLocator,
        sourceLocator: undefined,
      },
    ]),
  );
  assert.deepEqual(
    new AnnotationDraftStore(storage).get('legacy')[0].sourceLocator,
    annotation.sourceLocator,
  );
});
test('history renders recovered annotation cards safely without exposing the transport envelope', () => {
  const view: View = {
    endpoint: 'kernel',
    sessionId: 's',
    run: {
      scope: { endpointId: 'kernel', threadId: 's', sessionId: 's' },
      jobs: [],
      phase: 'idle',
      canSubmit: true,
      canCancel: false,
      connection: {
        phase: 'connected',
        canSubmit: true,
        historyIsStale: false,
      },
      actionables: [],
      queue: [],
    },
    transcript: {
      items: [
        {
          id: 'input',
          turnId: 't2',
          kind: 'user',
          text: 'AgentKit durable wire input',
          inputPresentation: { text: '解释这段', annotations: [annotation] },
          isFinal: true,
          isVisible: true,
          isProvisional: false,
        },
      ],
      tools: [],
      hasMoreBefore: false,
      isStale: false,
    },
  };
  const html = renderToStaticMarkup(createElement(Transcript, { view }));
  assert.match(html, /批注 · 1/);
  assert.match(html, /定位原文/);
  assert.match(html, /解释这段/);
  assert.doesNotMatch(
    html,
    /AgentKit durable wire input|Web transcript captures|<script>|<user_annotations>/,
  );
});
