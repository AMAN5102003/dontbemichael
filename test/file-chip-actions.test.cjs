'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const source = read('src/renderer/src/components/FileChip.tsx');
const tree = ts.createSourceFile('FileChip.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'copyPath') handler = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(handler, 'test the actual Copy path handler');
const compiled = ts.transpileModule(`const ${handler};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

// Like ai-engines-clear-key.test.cjs, exercise the component's IPC handler
// without a DOM. Main still owns path validation and canonical resolution.
function setup({ fresh, result = { ok: true }, checkError, clipboardError, copy = 'idle' } = {}) {
  const state = { status: 'idle', closed: false, gone: [], copied: [], checks: [] };
  const who = { raisedBy: 'kelly', assignee: 'kelly' };
  const cth = {
    askFiles: async (paths, context) => {
      state.checks.push({ paths, context });
      if (checkError) throw checkError;
      return fresh ? [fresh] : [];
    },
    copyToClipboard: async (text) => {
      state.copied.push(text);
      if (clipboardError) throw clipboardError;
      return result;
    }
  };
  const copyPath = new Function('window', 'path', 'who', 'setCopy', 'close', 'onGone', 'copy', `${compiled}\nreturn copyPath;`)(
    { cth }, 'Reports/Weekly summary.csv', who,
    (value) => { state.status = value; }, () => { state.closed = true; },
    (value) => { state.gone.push(value); }, copy
  );
  return { copyPath, state, who };
}

test('Copy path resolves the full path afresh and copies it exactly, including spaces on Mac and Windows', async () => {
  for (const full of ['/Users/Owner/My Office/Reports/Weekly summary.csv', 'C:\\My Office\\Reports\\Weekly summary.csv']) {
    const { copyPath, state, who } = setup({ fresh: { verdict: 'open', tab: true, path: full } });
    await copyPath();
    assert.deepEqual(state.checks, [{ paths: ['Reports/Weekly summary.csv'], context: who }]);
    assert.deepEqual(state.copied, [full]);
    assert.equal(state.status, 'done');
    assert.equal(state.closed, false, 'keep the success feedback visible');
  }
});

test('a reveal-only file can have its full path copied without being opened', async () => {
  const { copyPath, state } = setup({ fresh: { verdict: 'reveal', tab: false, path: '/Office/Archive.zip' } });
  await copyPath();
  assert.deepEqual(state.copied, ['/Office/Archive.zip']);
  assert.equal(state.status, 'done');
});

test('a removed file, an out-of-office file or an absent check never copies an unchecked path', async () => {
  for (const fresh of [undefined, { verdict: 'missing', tab: false, path: 'Reports/Weekly summary.csv' }]) {
    const { copyPath, state } = setup({ fresh });
    await copyPath();
    assert.deepEqual(state.copied, []);
    assert.deepEqual(state.gone, ['Reports/Weekly summary.csv']);
    assert.equal(state.closed, true);
  }
});

test('failed clipboard writes and IPC failures show a retry message, never success', async () => {
  const fresh = { verdict: 'open', tab: true, path: '/Office/Weekly summary.csv' };
  for (const failure of [{ result: { ok: false } }, { clipboardError: new Error('denied') }, { checkError: new Error('IPC gone') }]) {
    const { copyPath, state } = setup({ fresh, ...failure });
    await copyPath();
    assert.equal(state.status, 'error');
    assert.equal(state.closed, false);
    assert.deepEqual(state.gone, []);
  }
});

test('another click while copying cannot send another clipboard request', async () => {
  const { copyPath, state } = setup({ copy: 'busy' });
  await copyPath();
  assert.deepEqual(state.checks, []);
  assert.deepEqual(state.copied, []);
});

test('file actions use an accessible menu outside clipping cards and translated owner text', () => {
  assert.match(source, /createPortal\([\s\S]*document\.body/);
  assert.match(source, /aria-haspopup="menu" aria-expanded=\{open\}/);
  assert.match(source, /e\.key === 'Escape'[\s\S]*e\.stopPropagation\(\); close\(\);/);
  assert.match(source, /if \(missing\) \{[\s\S]*?<span[\s\S]*?\n  \}/);
  assert.match(source, /\{check && <FileActions/);
  for (const locale of ['en', 'zh-CN', 'ar']) {
    const strings = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`)).askMe;
    for (const key of ['fileActionsLabel', 'fileCopyPath', 'filePathCopied', 'fileCopyFailed']) assert.ok(strings[key], `${locale}: ${key}`);
    assert.match(strings.fileActionsLabel, /\{\{name\}\}/);
  }
});
