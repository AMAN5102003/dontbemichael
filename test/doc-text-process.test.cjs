'use strict';

// The knowledge store reads uploads in a process of its own, with a time limit,
// so a big or crafted file never freezes the app (TODOS: "Parse documents off
// the main thread").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const loadTs = require('./load-ts.cjs');

const { extractDocumentText } = loadTs('src/main/docText.ts');
const { extractDocumentTextApart, parseExtraction } = loadTs('src/main/docTextProcess.ts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-doc-text-process-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (name, data) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, data);
  return p;
};

// doc-text run from its TypeScript source, as the built script would run.
const cli = write('doc-text.cjs', `require(${JSON.stringify(path.join(__dirname, 'load-ts.cjs'))})('src/main/docTextCli.ts');`);
const docText = { file: process.execPath, args: [cli] };

test('a Word file read in its own process gives the same result as reading it here', async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const file = write('quote.docx', Buffer.from(zipSync({
    'word/document.xml': strToU8(`<w:document ${W}><w:body><w:p><w:r><w:t>Catering for 40, delivered.</w:t></w:r></w:p></w:body></w:document>`)
  })));
  const apart = await extractDocumentTextApart(file, docText);
  assert.equal(apart.kind, 'text');
  assert.equal(apart.text, 'Catering for 40, delivered.');
  assert.deepEqual(apart, await extractDocumentText(file));
});

test('plain text passes through, and a file it can not read keeps its own reason', async () => {
  assert.deepEqual(await extractDocumentTextApart(write('notes.txt', 'Deliveries on Tuesdays'), docText), { kind: 'passthrough' });
  const r = await extractDocumentTextApart(write('menu.numbers', 'PK\u0003\u0004'), docText);
  assert.equal(r.kind, 'unreadable');
  assert.match(r.reason, /Numbers files can't be read yet/);
});

test('a parse that runs too long is stopped, with a plain reason', async () => {
  const hang = { file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)', '--'] };
  const t0 = Date.now();
  const r = await extractDocumentTextApart(write('huge.pdf', '%PDF'), hang, 300);
  assert.deepEqual(r, { kind: 'unreadable', reason: 'This file took too long to read. Try a smaller one, or split it.' });
  assert.ok(Date.now() - t0 < 5000);
});

test('a parse that crashes, or answers with something else, is a plain failure', async () => {
  const crash = { file: process.execPath, args: ['-e', 'process.exit(3)', '--'] };
  const failed = { kind: 'unreadable', reason: 'This file could not be read. It may be damaged.' };
  assert.deepEqual(await extractDocumentTextApart(write('bad.pdf', '%PDF'), crash), failed);
  const missing = { file: path.join(tmp, 'no-such-node'), args: [] };
  assert.deepEqual(await extractDocumentTextApart(write('bad2.pdf', '%PDF'), missing), failed);
});

test('only a well formed answer is taken', () => {
  assert.equal(parseExtraction(''), null);
  assert.equal(parseExtraction('not json'), null);
  assert.equal(parseExtraction('null'), null);
  assert.equal(parseExtraction('{"kind":"text","text":"x"}'), null, 'text without its fields');
  assert.equal(parseExtraction('{"kind":"unreadable","reason":7}'), null);
  assert.deepEqual(parseExtraction('{"kind":"text","text":"x","extractor":"e","modality":"m","mime":"t","extra":1}'), { kind: 'text', text: 'x', extractor: 'e', modality: 'm', mime: 't' });
});

test('the knowledge store reads uploads through the separate process', () => {
  // Value: protects=ingestFile never parses in the main process when the built script is there; fails_when=ingestFile calls extractDocumentText directly again; why_new=knowledge.ts needs Electron to load; seam=source pin
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/knowledge.ts'), 'utf8');
  assert.match(src, /const ex = await this\.readDocument\(srcPath\);/);
  assert.match(src, /return extractDocumentTextApart\(srcPath, \{ file: process\.execPath, args: \[script\], env: \{ \.\.\.process\.env, ELECTRON_RUN_AS_NODE: '1' \} \}\);/);
});
