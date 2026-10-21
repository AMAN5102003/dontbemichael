'use strict';

/**
 * Lookup tables keyed by outside text read only their own keys. A plain
 * `table[key]` also finds Object.prototype members, so a file named
 * `notes.constructor`, an agent status or caption "constructor", or a work
 * style heading "# __proto__" got a function or an object back (PR #185 fixed
 * the image table; these are the others).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { ownValue } = loadTs('src/shared/ownValue.ts');
const { extractDocumentText } = loadTs('src/main/docText.ts');
const { plainFallback } = loadTs('src/shared/workStyleText.ts');
const { ownerChangeNote, reopenedNote, untriagedNote } = loadTs('src/shared/ownerRequests.ts');
const kg = require('../src/main/kg-core.cjs');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const PROTO = ['constructor', '__proto__', 'hasOwnProperty', 'toString'];

test('ownValue finds a table\'s own keys and nothing from Object.prototype', () => {
  // Value: protects=the one helper every outside keyed lookup uses; fails_when=it falls back to a plain index; why_new=new helper; seam=none; no_claim=none beyond protects
  const table = { done: 'Done', todo: 'To do' };
  assert.equal(ownValue(table, 'done'), 'Done');
  for (const k of PROTO) assert.equal(ownValue(table, k), undefined, k);
});

test('file names like notes.constructor get the unknown fallbacks, not prototype members', async () => {
  // Value: protects=kg-core mime and docText advice and mime for any extension; fails_when=mimeFor or EXPORT_ADVICE or MIME go back to a plain index; why_new=only imageTypes had the fix; seam=none; no_claim=none beyond protects
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-value-'));
  try {
    for (const ext of ['constructor', '__proto__']) {
      const file = path.join(dir, `notes.${ext}`);
      fs.writeFileSync(file, 'plain words\n');
      assert.equal(kg.extractText({ srcPath: file, modality: 'text', source: 'notes' }).mime, 'application/octet-stream', ext);
      const doc = await extractDocumentText(file);
      assert.notEqual(typeof doc.reason, 'function', ext);
      assert.notEqual(doc.kind, 'unreadable', `${ext} is plain text, not a format with export advice`);
    }
    const md = path.join(dir, 'notes.md');
    fs.writeFileSync(md, '# Notes\n');
    assert.equal(kg.extractText({ srcPath: md, modality: 'text', source: 'notes' }).mime, 'text/markdown');
    const pages = path.join(dir, 'plan.pages');
    fs.writeFileSync(pages, 'x');
    assert.match((await extractDocumentText(pages)).reason, /Apple Pages files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agent written statuses and headings named like prototype members stay plain text', () => {
  // Value: protects=Michael's notes and the plain work style never print a function; fails_when=STATUS_WORDS or HEADING_LABEL go back to a plain index; why_new=no test fed these keys; seam=none; no_claim=none beyond protects
  for (const k of ['constructor', '__proto__']) {
    const reopened = reopenedNote({ id: 'c1' }, k).body;
    assert.match(reopened, new RegExp(`out of Done to ${k} by an agent`), k);
    assert.doesNotMatch(reopened, /function|\[object/, k);
    assert.doesNotMatch(untriagedNote({ id: 'c1' }, k).body, /function|\[object/, k);
    assert.doesNotMatch(ownerChangeNote({ id: 'c1' }, { kind: 'moved', from: k, to: 'todo' }).body, /function|\[object/, k);
    const plain = plainFallback(`# ${k}\nAnswer the phone.`);
    assert.match(plain, new RegExp(`^${k}:$`, 'm'), k);
    assert.doesNotMatch(plain, /function|\[object|native code/, k);
  }
  assert.equal(reopenedNote({ id: 'c1' }, 'doing').body.includes('out of Done to Doing by an agent'), true, 'known statuses still read as words');
});

test('the activity caption and the model key lookup read own keys only', () => {
  // Value: protects=an agent caption "constructor" and a model prefix "constructor/x" find nothing; fails_when=OFFICE_WORDS or PREFIX_BACKEND go back to a plain index; why_new=renderer store and main index cannot load here; seam=none; no_claim=behavior (source assertions; the helper is tested above)
  assert.match(read('src/renderer/src/store/store.ts'), /const said = ownValue\(OFFICE_WORDS, plain\);/);
  assert.match(read('src/main/index.ts'), /const scoped = ownValue\(PREFIX_BACKEND, prefix\);/);
});

test('saving or clearing an engine key accepts only the known backends', () => {
  // Value: protects=a backend named "constructor" or "toString" is refused as unknown, not saved as apikey:constructor; fails_when=providerKey:set or providerKey:clear go back to `in BACKEND_KEY_ENV`; why_new=the a8dc657 sweep missed these two; seam=none; no_claim=behavior (source assertions; main index cannot load here, the helper is tested above)
  const src = read('src/main/index.ts');
  assert.match(src, /typeof p\.backend !== 'string' \|\| !ownValue\(BACKEND_KEY_ENV, p\.backend\)/);
  assert.match(src, /typeof backend !== 'string' \|\| !ownValue\(BACKEND_KEY_ENV, backend\)/);
  assert.doesNotMatch(src, /\bin BACKEND_KEY_ENV\b/);
});
