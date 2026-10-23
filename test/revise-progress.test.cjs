'use strict';

/**
 * While a job change is worked out, the box shows where it is and what is
 * written so far (owner, 2026-10-23: "this can take a min and for business
 * owner to wait without knowing if it is even doing anything is a very bad
 * user experience"). Real steps from the hidden run, the answer read as it is
 * written, and no hidden thinking, which made the wait 12 to 35 seconds of
 * model time instead of about 7.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const HM = loadTs('src/main/hiddenModel.ts');
const W = loadTs('src/main/workStyleConvert.ts');
const T = loadTs('src/shared/workStyleText.ts');

const run = HM.runHiddenModel;
test.after(() => { HM.runHiddenModel = run; });

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const ctx = { name: 'Pam', title: 'Customer Support', business: { name: 'Sunrise Bakery' }, manager: 'Michael' };
const deps = { engine: 'claude', command: 'claude', cwd: os.tmpdir() };

test('the preview reads a half written answer: summary lines, plain words, or the question', () => {
  // Value: protects=the owner reads the change while it is written; fails_when=a cut off answer shows nothing, escapes show as backslashes, or the instructions leak into the preview; why_new=revisePreview is new; seam=pure reader
  const empty = { summary: [], plain: '', question: '' };
  assert.deepEqual(T.revisePreview(''), empty);
  assert.deepEqual(T.revisePreview('{"kind": "ok", "summ'), empty, 'nothing readable yet');
  assert.deepEqual(T.revisePreview('{"kind": "ok", "summary": ["Pam will now answer refund emails.", "Pam will ask'),
    { summary: ['Pam will now answer refund emails.', 'Pam will ask'], plain: '', question: '' }, 'the line being written shows too');
  assert.deepEqual(
    T.revisePreview('{"kind":"ok","summary":["A."],"plain":"The job:\\nAnswers \\"refund\\" emails\\u00e9 and'),
    { summary: ['A.'], plain: 'The job:\nAnswers "refund" emailsé and', question: '' });
  assert.equal(T.revisePreview('{"kind":"ok","summary":[],"plain":"Ends mid escape \\').plain, 'Ends mid escape');
  assert.equal(T.revisePreview('{"kind":"ok","summary":[],"plain":"Half \\u00').plain, 'Half');
  assert.deepEqual(T.revisePreview('{"kind": "question", "question": "Refunds go to Michael today. Should'),
    { summary: [], plain: '', question: 'Refunds go to Michael today. Should' });
  const done = T.revisePreview('```json\n{"kind":"ok","summary":["A.","B."],"plain":"P.","handles":null,"instructions":"You work at Sunrise Bakery."}\n```');
  assert.deepEqual(done, { summary: ['A.', 'B.'], plain: 'P.', question: '' }, 'never the instructions');
  assert.equal(T.revisePreview(`{"summary":[${Array.from({ length: 12 }, (_, i) => `"s${i}"`).join(',')}]}`).summary.length, 8, 'as many lines as the preview keeps');
});

test('the answer is asked for with the summary and plain words first, ahead of the instructions', () => {
  // Value: protects=the owner has something to read early in the wait; fails_when=the prompt puts the long instructions first again; why_new=key order is new; seam=prompt text
  const p = T.toRevisePrompt({ ctx, instructions: 'x', handles: '', changes: ['y'] });
  const shape = p.split('\n').find((l) => l.startsWith('Shape 1'));
  assert.match(shape, /keys in this order/);
  const at = (k) => shape.indexOf(`"${k}"`);
  assert.ok(at('summary') < at('plain') && at('plain') < at('handles') && at('handles') < at('instructions'), shape);
});

test('the run reports starting, reading and writing with a preview, and runs without hidden thinking', async () => {
  // Value: protects=the box steps are real and the wait is short; fails_when=no step reaches the box, thinking is on, or a broken listener breaks the run; why_new=onProgress is new; seam=stubbed hidden model
  const seen = [];
  let opts;
  HM.runHiddenModel = async (_prompt, o) => {
    opts = o;
    o.onPromptSent();
    o.onScreenText('{"kind":"ok","summary":["Pam will ask');
    return { ok: false, error: 'failed' };
  };
  await W.reviseWorkStyle({ ctx, current: { instructions: 'x', handles: '' }, changes: ['y'] }, { ...deps, onProgress: (p) => seen.push(p) });
  assert.equal(opts.thinking, false, 'no hidden thinking');
  assert.deepEqual(seen, [
    { stage: 'starting' },
    { stage: 'reading' },
    { stage: 'writing', preview: { summary: ['Pam will ask'], plain: '', question: '' } }
  ]);
  const r = await W.reviseWorkStyle({ ctx, current: { instructions: 'x', handles: '' }, changes: ['y'] }, { ...deps, onProgress: () => { throw new Error('boom'); } });
  assert.deepEqual(r, { kind: 'error', reason: 'failed' }, 'a broken listener only loses the steps');
});

test('both runners say when the prompt is taken; main sends the steps to the run that asked', () => {
  // Value: protects=the reading step is real on Claude and Codex, and steps reach only their own box; fails_when=the hook is dropped or the channel loses its request id; why_new=onPromptSent and the progress channel are new; seam=none; no_claim=source pins, not a live run
  const claude = read('src/main/hiddenClaude.ts');
  const send = claude.slice(claude.indexOf('const sendPrompt = () => {'), claude.indexOf('// Pictures first'));
  assert.match(send, /promptSent = true;[\s\S]*try \{ opts\.onPromptSent\?\.\(\); \} catch/);
  assert.match(read('src/main/hiddenModel.ts'), /child\.stdin\?\.end\(prompt\);\s*try \{ opts\.onPromptSent\?\.\(\); \} catch/);
  const main = read('src/main/index.ts');
  assert.match(main, /onProgress: \(p\) => \{\s*if \(!rev\.requestId \|\| evt\.sender\.isDestroyed\(\)\) return;\s*evt\.sender\.send\(`workStyle:progress:\$\{rev\.requestId\}`, p\);/);
  assert.match(read('src/preload/index.ts'), /const channel = `workStyle:progress:\$\{requestId\}`;/);
});

test('the box shows the three steps and what is written so far, and stops listening when the run ends', () => {
  // Value: protects=the owner sees movement and words, not a still sentence; fails_when=the old one line note comes back, the steps are not announced, or a listener outlives its run; why_new=Working is new; seam=none; no_claim=source pins, rendered live by hand
  const src = read('src/renderer/src/components/JobChangeReview.tsx');
  const start = src.slice(src.indexOf('const start = async'), src.indexOf('useEffect(() => { if (p.autoRun)'));
  assert.match(start, /const off = window\.cth\.onWorkStyleProgress\?\.\(requestId, \(progress\) => \{\s*if \(runId\.current !== requestId\) return;/);
  assert.ok(start.indexOf('off?.();') > start.indexOf('await p.run('), 'unsubscribed once the run answers');
  assert.match(src, /const STEPS = \['starting', 'reading', 'writing'\] as const;/);
  assert.match(src, /<ol role="status"/, 'the steps are announced');
  assert.match(src, /<div aria-live="off"/, 'the words are not');
  assert.doesNotMatch(src, /workingNote/);
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const jc = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).jobChange;
    for (const k of ['starting', 'reading', 'writing']) {
      assert.ok(jc.steps[k], `${loc} ${k}`);
      assert.doesNotMatch(jc.steps[k], /[—–]| - /, `${loc} ${k} has no dashes`);
    }
    assert.ok(jc.soFar, `${loc} soFar`);
    assert.equal(jc.workingNote, undefined, `${loc} drops the old note`);
  }
});

test('going wide or back mid change keeps the run and the typed words', () => {
  // Value: protects=a run survives the panel's expand button (owner, 2026-10-23: going wide lost the progress and the words); fails_when=the two layouts render the change box under different parents again, so React remounts it, its unmount stops the run and the typed text is lost; why_new=the layout switch remounted it; seam=none; no_claim=source pin on the tree shape, checked live by hand
  const src = read('src/renderer/src/components/EditAgentModal.tsx');
  const body = src.slice(src.indexOf('{/* One tree for both layouts'), src.indexOf('</Dialog>', src.indexOf('{/* One tree for both layouts')));
  assert.equal((body.match(/\{changeRow\}/g) ?? []).length, 1, 'the change box is rendered in one place');
  assert.match(body, /<div key="job" style=\{column\}>\s*<Panel id="job">\s*\{handlesRow\}\s*\{workStyleRow\}\s*<\/Panel>\s*\{changeRow\}\s*<\/div>/);
  assert.ok(body.indexOf('<div key="side"') < body.indexOf('<div key="job"'), 'the job column keeps its place');
  assert.doesNotMatch(body, /\{wide \? \(/, 'no second tree per layout');
});
