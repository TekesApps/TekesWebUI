import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HarnessLogo, harnessAssets } from '../src/components/HarnessLogo';

test('Harness logos retain the original App artwork rather than letter placeholders', async () => {
  const originals = [
    [
      'pi',
      'light',
      'abd66e7868b2d24f0f0895f9237ee8a6dcb22337583b0dc54aeb595acecb4d6b',
    ],
    [
      'dsh',
      'light',
      'fca80eb03bbad5b211d364ac80cd2f9d2d5f58a8e223c48ec905c6a7d8fe3879',
    ],
    [
      'dsh',
      'dark',
      '2e24e720c9b8be30f30692628a37031696195fd797b9028ba231b8187fcc337b',
    ],
  ] as const;
  for (const [kind, appearance, expected] of originals) {
    const asset = harnessAssets[kind];
    const url =
      appearance === 'dark' && 'dark' in asset ? asset.dark : asset.light;
    const data = await readFile(new URL(url));
    assert.equal(createHash('sha256').update(data).digest('hex'), expected);
  }
  assert.equal(harnessAssets.tekes.light, '/app-icon.png');
  const png = await readFile('public/app-icon.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  for (const kind of ['tekes', 'pi', 'dsh']) {
    const markup = renderToStaticMarkup(createElement(HarnessLogo, { kind }));
    assert.match(markup, /<img[^>]+alt=""/);
    assert.match(markup, /aria-hidden="true"/);
    assert.doesNotMatch(markup, />[TDπ]</);
    if (kind === 'dsh') assert.match(markup, /harness-logo-dark/);
  }
  assert.equal(
    renderToStaticMarkup(createElement(HarnessLogo, { kind: 'unrecognized' })),
    '',
  );
});
