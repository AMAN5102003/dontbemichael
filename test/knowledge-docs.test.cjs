'use strict';

/**
 * Company knowledge documents in Settings (owner, 2026-10-19): the list, Open
 * in the owner's own app, and a save there read in again so agents search the
 * new version. Company foundations opens as a read only copy.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const kg = require('../src/main/kg-core.cjs');
const { KnowledgeEdits, MAX_WATCHED } = loadTs('src/main/knowledgeEdits.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kg-docs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a stored copy opens and a reindex replaces the text and index lines, keeping the copy', (t) => {
  const dir = tmp(t);
  const root = path.join(dir, 'kg');
  const src = path.join(dir, 'prices.md');
  fs.writeFileSync(src, 'Large pizza costs 14 dollars.');
  const { docId } = kg.ingest(root, { srcPath: src, title: 'Price list' });
  const other = kg.ingest(root, { text: 'Opening hours are noon to ten.', title: 'Hours' }).docId;
  const f = kg.docFile(root, docId);
  assert.equal(f.kind, 'original');
  assert.equal(path.basename(f.path), 'original.md');
  assert.equal(kg.docFile(root, other).kind, 'text', 'pasted text opens its text');
  assert.equal(kg.docFile(root, 'nope'), null);

  fs.writeFileSync(f.path, 'Large pizza costs 16 dollars now.');
  const meta = kg.reindex(root, docId, { text: fs.readFileSync(f.path, 'utf8'), bytes: 33 });
  assert.ok(meta.updatedAt);
  assert.equal(meta.bytes, 33);
  assert.equal(kg.search(root, '16 dollars')[0].docId, docId);
  assert.equal(kg.search(root, '14').length, 0, 'the old lines are gone');
  assert.equal(kg.search(root, 'noon')[0].docId, other, 'other documents untouched');
  assert.ok(fs.existsSync(f.path), 'the edited copy stays');
  assert.equal(kg.reindex(root, 'nope', { text: 'x' }), null);
});

function edits(t, over = {}) {
  const dir = tmp(t);
  const file = path.join(dir, 'original.md');
  fs.writeFileSync(file, 'v1');
  const calls = { opened: [], reindexed: [], changed: [] };
  const e = new KnowledgeEdits({
    docFile: (id) => (id === 'doc' ? { path: file, meta: { title: 'Price list', tags: [] } } : id === 'found' ? { path: file, meta: { title: 'Company foundations', tags: ['foundations'] } } : null),
    reindex: async (id) => { calls.reindexed.push(id); if (over.fail) throw new Error('The file could not be opened.'); },
    openPath: async (p) => { calls.opened.push(p); return ''; },
    tempDir: () => dir,
    changed: (id, error) => calls.changed.push({ id, error }),
    intervalMs: 50
  });
  t.after(() => e.stopAll());
  return { e, file, dir, calls };
}

test('Open watches the copy: new content is read in once, the same bytes never', async (t) => {
  const o = edits(t);
  assert.deepEqual(await o.e.open('doc'), { ok: true, readOnly: false });
  assert.deepEqual(o.calls.opened, [o.file]);
  await o.e.check('doc');
  assert.deepEqual(o.calls.reindexed, [], 'unchanged: nothing read in');
  fs.writeFileSync(o.file, 'v2');
  await o.e.check('doc');
  await o.e.check('doc');
  assert.deepEqual(o.calls.reindexed, ['doc'], 'once per change');
  assert.deepEqual(o.calls.changed, [{ id: 'doc', error: undefined }]);
  assert.deepEqual(await o.e.open('nope'), { ok: false, error: 'missing' });
  o.e.stop('doc');
  assert.deepEqual(o.e.watching(), []);
});

test('a save that cannot be read says why and keeps watching', async (t) => {
  const o = edits(t, { fail: true });
  await o.e.open('doc');
  fs.writeFileSync(o.file, 'broken');
  await o.e.check('doc');
  assert.match(o.calls.changed[0].error, /could not be opened/);
  assert.deepEqual(o.e.watching(), ['doc']);
});

test('Company foundations opens as a read only copy and is never watched', async (t) => {
  const o = edits(t);
  assert.deepEqual(await o.e.open('found'), { ok: true, readOnly: true });
  const copy = o.calls.opened[0];
  assert.notEqual(copy, o.file);
  assert.equal(path.basename(copy), 'Company foundations.md');
  if (process.platform !== 'win32') assert.equal(fs.statSync(copy).mode & 0o222, 0, 'no write bits');
  assert.deepEqual(o.e.watching(), []);
  // Opening it again replaces the old read only copy.
  assert.deepEqual(await o.e.open('found'), { ok: true, readOnly: true });
  assert.ok(MAX_WATCHED >= 10);
});

test('Settings lists the documents with Open, and a removed document stops being watched', () => {
  const list = read('src/renderer/src/components/KnowledgeDocList.tsx');
  assert.match(list, /window\.cth\.kgList\(\)/);
  assert.match(list, /window\.cth\.kgOpen\?\.\(d\.id\)/);
  assert.match(list, /settings\.memory\.docs\.readOnly/);
  assert.match(read('src/renderer/src/components/SettingsModal.tsx'), /<KnowledgeDocList refreshKey=\{kgDocCount\} \/>/);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('kg:open'/);
  assert.match(main, /if \(typeof id === 'string'\) knowledgeEdits\.stop\(id\);/);
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const docs = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`)).settings.memory.docs;
    for (const text of Object.values(docs)) assert.doesNotMatch(text, /[–—]| - /, `${lang}: ${text}`);
  }
});

test('an edited document is mirrored again for search by meaning, and its new time changes the signature', (t) => {
  const { KnowledgeManager } = loadTsWithElectron();
  const dir = tmp(t);
  const root = path.join(dir, 'kg');
  const m = new KnowledgeManager();
  m.root = () => root;
  assert.equal(m.hasDocuments(), false, 'empty: members are not pointed at it');
  const { docId } = kg.ingest(root, { text: 'Large pizza costs 14 dollars.', title: 'Price list' });
  assert.equal(m.hasDocuments(), true);
  const first = m.meaningMirror();
  const file = path.join(first.dir, `${docId}.md`);
  assert.match(fs.readFileSync(file, 'utf8'), /14 dollars/);
  fs.utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  kg.reindex(root, docId, { text: 'Large pizza costs 16 dollars.' });
  const second = m.meaningMirror();
  assert.match(fs.readFileSync(file, 'utf8'), /16 dollars/);
  assert.notEqual(second.signature, first.signature);
});

function loadTsWithElectron() {
  const electron = require.resolve('electron');
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isPackaged: false } } };
  return loadTs('src/main/knowledge.ts');
}
