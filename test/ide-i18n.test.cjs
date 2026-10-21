'use strict';

// The file editor and the IDE's image preview, empty state and loaders still
// had English written into the code, in an app that ships Arabic and Chinese.
// Structural checks: the renderer has no DOM test harness here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const FILES = [
  'src/renderer/src/components/CodeEditor.tsx',
  'src/renderer/src/ide/ImagePreview.tsx',
  'src/renderer/src/ide/MonacoDiff.tsx',
  'src/renderer/src/ide/MonacoEditor.tsx',
  'src/renderer/src/ide/IdePanel.tsx'
];

test('the editor and IDE views have no English tooltips, labels or loaders written in', () => {
  for (const f of FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(title|aria-label)="[A-Za-z]/, f);
    assert.doesNotMatch(src, />(loading[^<]*|copy path|nothing open)</, f);
    assert.doesNotMatch(src, /'(saved|save|err)' :|: '(save|err)'\}/, `${f}: the save button's words`);
  }
  assert.doesNotMatch(read('src/renderer/src/ide/IdePanel.tsx'), /Pick a file from the tree/);
});

test('every new string is in each language', () => {
  const keys = ['copyAbsolutePath', 'openInIde', 'saveFailed', 'loading', 'loadingEditor', 'nothingOpen', 'nothingOpenHint'];
  for (const locale of ['en', 'zh-CN', 'ar']) {
    const ide = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`)).idePanel;
    for (const k of keys) assert.ok(ide[k], `${locale} idePanel.${k}`);
  }
});
