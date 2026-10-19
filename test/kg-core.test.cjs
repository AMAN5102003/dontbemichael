'use strict';
/**
 * Knowledge Graph core + agent-CLI tests. Self-contained, no test framework —
 * run with `node test/kg-core.test.cjs` (mirrors test/slack.test.cjs).
 * Exercises: tokenize/chunk/score, the ingest→store→search round-trip for the
 * two v1 modalities (text + image), list/get/remove, and the real `kg.cjs` CLI
 * an agent invokes (proving the out-of-process retrieval path end to end).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const kg = require('../src/main/kg-core.cjs');
const CLI = path.join(__dirname, '..', 'resources', 'kg.cjs');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures++; console.log(`  ✗ ${name}\n     ${err && err.message}`); }
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kg-test-'));
}
function writeFixture(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

(async () => {
  console.log('knowledge-graph core tests');

  // ─── tokenize ───────────────────────────────────────────────────────────
  test('tokenize lowercases, splits on non-alphanumerics, drops stop-words and 1-char tokens', () => {
    const toks = kg.tokenize('The Refund-Policy is X, valid for 30 days!');
    assert.ok(toks.includes('refund'), 'has refund');
    assert.ok(toks.includes('policy'), 'has policy');
    assert.ok(toks.includes('30'), 'keeps numbers');
    assert.ok(!toks.includes('the'), 'drops stop-word "the"');
    assert.ok(!toks.includes('is'), 'drops stop-word "is"');
    assert.ok(!toks.includes('x'), 'drops 1-char token');
  });

  test('tokenize keeps words in any script, with their marks, and pairs Chinese and Japanese characters', () => {
    // Value: protects=a document in Arabic, Hindi, Chinese or an accented language is searchable by its words; fails_when=tokenize keeps only a-z and 0-9; why_new=those documents had no tokens, so keyword search never found them; seam=none
    assert.deepStrictEqual(kg.tokenize('سياسة الاسترداد'), ['سياسة', 'الاسترداد'], 'Arabic words');
    assert.deepStrictEqual(kg.tokenize('वापसी नीति'), ['वापसी', 'नीति'], 'Hindi words keep their vowel signs');
    assert.deepStrictEqual(kg.tokenize('Rückgabe réception'), ['rückgabe', 'réception'], 'accented letters stay in the word');
    assert.deepStrictEqual(kg.tokenize('Re\u0301ception'), ['r\u00e9ception'], 'a decomposed accent matches the composed one');
    assert.deepStrictEqual(kg.tokenize('退款政策'), ['退', '款', '政', '策', '退款', '款政', '政策'], 'a Chinese run becomes its characters and character pairs');
    assert.deepStrictEqual(kg.tokenize('税'), ['税'], 'a lone Chinese character is a token');
    assert.deepStrictEqual(kg.tokenize('SKU42の在庫'), ['sku42', 'の', '在', '庫', 'の在', '在庫'], 'Latin and Japanese in one word split apart');
    assert.deepStrictEqual(kg.tokenize('コーヒー'), ['コ', 'ー', 'ヒ', 'ー', 'コー', 'ーヒ', 'ヒー'], 'the Japanese long vowel mark stays in its word');
    assert.deepStrictEqual(kg.tokenize('It\u2019s the refund policy'), kg.tokenize("It's the refund policy"), 'a curly quote changes no English token');
  });

  test('search finds documents written in Arabic, Hindi, Chinese and German by their own words', () => {
    // Value: protects=company knowledge in the owner's language is found by keyword search; fails_when=non Latin text indexes no tokens; why_new=search returned nothing for these documents; seam=a temp store
    const root = tmpRoot();
    const docs = {
      ar: ['سياسة الاسترداد: يمكن للعملاء استرداد أموالهم خلال ثلاثين يوما.', 'الاسترداد'],
      hi: ['वापसी नीति: ग्राहक तीस दिनों के भीतर पैसे वापस पा सकते हैं।', 'वापसी नीति'],
      zh: ['退款政策：客户可在三十天内退款。', '退款'],
      de: ['Rückgabe innerhalb von dreißig Tagen möglich.', 'Rückgabe'],
    };
    const ids = {};
    for (const [lang, [text]] of Object.entries(docs)) ids[lang] = kg.ingest(root, { text, title: `policy ${lang}` }).docId;
    for (const [lang, [, query]] of Object.entries(docs)) {
      const hits = kg.search(root, query);
      assert.strictEqual(hits.length, 1, `${lang}: exactly its own document`);
      assert.strictEqual(hits[0].docId, ids[lang], `${lang}: the right document`);
    }
    const tax = kg.ingest(root, { text: '消费税的申报流程说明', title: 'tax' }).docId;
    assert.deepStrictEqual(kg.search(root, '税').map((h) => h.docId), [tax], 'one Chinese character finds the word it is part of');
  });

  // ─── detectModality ─────────────────────────────────────────────────────
  test('detectModality buckets by extension', () => {
    assert.strictEqual(kg.detectModality('a/b/notes.md'), 'text');
    assert.strictEqual(kg.detectModality('logo.PNG'), 'image');
    assert.strictEqual(kg.detectModality('report.pdf'), 'pdf');
    assert.strictEqual(kg.detectModality('data.csv'), 'sheet');
    assert.strictEqual(kg.detectModality('main.ts'), 'code');
    assert.strictEqual(kg.detectModality('weird.xyz'), 'text'); // unknown → text
  });

  // ─── chunkText ──────────────────────────────────────────────────────────
  test('chunkText returns one chunk for short text and multiple for long text', () => {
    assert.deepStrictEqual(kg.chunkText(''), []);
    assert.deepStrictEqual(kg.chunkText('short note'), ['short note']);
    const long = ('paragraph alpha. '.repeat(120) + '\n\n').repeat(6); // ~12k chars
    const chunks = kg.chunkText(long, { size: 1000, overlap: 100 });
    assert.ok(chunks.length > 5, `expected several chunks, got ${chunks.length}`);
    for (const c of chunks) assert.ok(c.length <= 1500, `chunk under cap: ${c.length}`);
  });

  test('chunkText always terminates and covers the text (deterministic)', () => {
    const text = 'word '.repeat(5000);
    const a = kg.chunkText(text, { size: 800, overlap: 120 });
    const b = kg.chunkText(text, { size: 800, overlap: 120 });
    assert.deepStrictEqual(a, b, 'deterministic');
    assert.ok(a.join(' ').includes('word'), 'covers content');
  });

  // ─── scoreChunk ─────────────────────────────────────────────────────────
  test('scoreChunk: 0 when no term matches, higher for title + phrase matches', () => {
    const terms = kg.tokenize('refund policy');
    const none = kg.scoreChunk({ title: 'Holidays', text: 'office closed friday' }, terms, 'refund policy');
    assert.strictEqual(none, 0);
    const body = kg.scoreChunk({ title: 'Holidays', text: 'our refund policy is generous' }, terms, 'refund policy');
    const titled = kg.scoreChunk({ title: 'Refund Policy', text: 'our refund policy is generous' }, terms, 'refund policy');
    assert.ok(body > 0, 'body match scores');
    assert.ok(titled > body, 'title match boosts above body-only');
  });

  // ─── ingest → search round-trip: TEXT modality ──────────────────────────
  test('ingest a markdown doc, then search finds it with a snippet', () => {
    const root = tmpRoot();
    const src = writeFixture(root, 'refund-policy.md',
      '# Refund Policy 2026\n\nCustomers may request a full refund within 30 days of purchase. '
      + 'Refunds for enterprise plans require manager approval.\n');
    const { docId, chunkCount, meta } = kg.ingest(root, { srcPath: src, tags: ['policy', 'support'] });
    assert.ok(docId, 'returns a docId');
    assert.ok(chunkCount >= 1, 'at least one chunk');
    assert.strictEqual(meta.modality, 'text');
    assert.strictEqual(meta.title, 'Refund Policy 2026', 'title derived from heading');
    // store layout exists
    assert.ok(fs.existsSync(path.join(root, 'index.jsonl')), 'index.jsonl written');
    assert.ok(fs.existsSync(path.join(root, 'docs', docId, 'text.md')), 'text.md written');
    assert.ok(fs.existsSync(path.join(root, 'docs', docId, 'meta.json')), 'meta.json written');
    assert.ok(fs.existsSync(path.join(root, 'docs', docId, 'original.md')), 'original copied');

    const hits = kg.search(root, 'refund within 30 days');
    assert.ok(hits.length >= 1, 'finds the doc');
    assert.strictEqual(hits[0].docId, docId);
    assert.ok(/refund/i.test(hits[0].snippet), 'snippet contains the match');
  });

  // ─── ingest → search round-trip: IMAGE modality (metadata-level) ────────
  test('ingest an image by metadata (no OCR) and find it by caption/tags', () => {
    const root = tmpRoot();
    // a tiny fake binary file standing in for an image artifact
    const img = path.join(root, 'org-chart.png');
    fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const { docId, meta } = kg.ingest(root, {
      srcPath: img, title: 'Company Org Chart',
      caption: 'Engineering reports to the CTO; Sales reports to the CRO.',
      tags: ['orgchart', 'leadership']
    });
    assert.strictEqual(meta.modality, 'image');
    assert.strictEqual(meta.extractor, 'image-meta@1');
    assert.ok(fs.existsSync(path.join(root, 'docs', docId, 'original.png')), 'binary retained for future OCR');

    const byCaption = kg.search(root, 'who does engineering report to');
    assert.ok(byCaption.some((h) => h.docId === docId), 'found via caption text');
    const byTag = kg.search(root, 'orgchart leadership');
    assert.ok(byTag.some((h) => h.docId === docId), 'found via tags');
  });

  // ─── list / getDoc / removeDoc ──────────────────────────────────────────
  test('list, get, and remove manage the corpus and prune the index', () => {
    const root = tmpRoot();
    const a = kg.ingest(root, { text: 'Alpha document about onboarding new hires.', title: 'Onboarding' });
    const b = kg.ingest(root, { text: 'Beta document about the deployment runbook.', title: 'Runbook' });

    const docs = kg.list(root);
    assert.strictEqual(docs.length, 2, 'two docs listed');

    const got = kg.getDoc(root, a.docId);
    assert.ok(got && /onboarding/i.test(got.text), 'getDoc returns full text');
    assert.strictEqual(kg.getDoc(root, 'nope'), null, 'unknown id → null');

    assert.strictEqual(kg.removeDoc(root, a.docId), true);
    assert.strictEqual(kg.list(root).length, 1, 'one doc after remove');
    assert.strictEqual(kg.search(root, 'onboarding').length, 0, 'removed doc no longer searchable');
    assert.ok(kg.search(root, 'deployment runbook').some((h) => h.docId === b.docId), 'other doc intact');

    const s = kg.stats(root);
    assert.strictEqual(s.docCount, 1);
  });

  test('search returns [] for empty query or empty store', () => {
    const root = tmpRoot();
    assert.deepStrictEqual(kg.search(root, 'anything'), [], 'empty store');
    kg.ingest(root, { text: 'hello world', title: 'Greeting' });
    assert.deepStrictEqual(kg.search(root, '   '), [], 'blank query');
  });

  // ─── the real agent CLI (out-of-process retrieval path) ─────────────────
  console.log('knowledge-graph agent CLI (kg.cjs) tests');

  test('agent runs `kg search` against KG_ROOT and gets ranked, attributed results', () => {
    const root = tmpRoot();
    kg.ingest(root, {
      srcPath: writeFixture(root, 'pto.md',
        '# PTO Policy\n\nFull-time employees accrue 20 days of paid time off per year. '
        + 'Unused PTO rolls over up to 5 days.\n'),
      tags: ['hr', 'pto']
    });
    const res = spawnSync(process.execPath, [CLI, 'search', 'how much paid time off'],
      { encoding: 'utf8', env: { ...process.env, KG_ROOT: root } });
    assert.strictEqual(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
    assert.ok(/PTO Policy/.test(res.stdout), 'CLI surfaces the title');
    assert.ok(/20 days/.test(res.stdout), 'CLI surfaces the matching passage');
    assert.ok(/id:/.test(res.stdout), 'CLI surfaces a doc id for `kg get`');
  });

  test('agent `kg search --json` is machine-parseable', () => {
    const root = tmpRoot();
    kg.ingest(root, { text: 'The wifi password is hunter2 for the guest network.', title: 'Wifi' });
    const res = spawnSync(process.execPath, [CLI, 'search', 'guest wifi password', '--json'],
      { encoding: 'utf8', env: { ...process.env, KG_ROOT: root } });
    assert.strictEqual(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed) && parsed.length >= 1, 'JSON array of hits');
    assert.strictEqual(parsed[0].title, 'Wifi');
  });

  test('agent CLI degrades gracefully when KG_ROOT is unset (flag off)', () => {
    const env = { ...process.env };
    delete env.KG_ROOT;
    const res = spawnSync(process.execPath, [CLI, 'search', 'anything'], { encoding: 'utf8', env });
    assert.strictEqual(res.status, 0, 'exits 0 (non-fatal) when KG is off');
    assert.ok(/not configured|off|unavailable/i.test(res.stderr + res.stdout), 'explains it is off');
  });

  // ─── summary ────────────────────────────────────────────────────────────
  if (failures > 0) {
    console.log(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nAll knowledge-graph tests passed');
})();
