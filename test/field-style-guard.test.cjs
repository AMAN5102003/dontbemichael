'use strict';

/**
 * One field style for the whole app (docs/designs/app-style-rollout.md AS5):
 * group names, field labels, hints and soft panels come from
 * components/fieldText.tsx, so a screen cannot drift back to its own copy.
 *
 * The guard reads every renderer .tsx file one style object at a time and
 * flags the three shapes the rollout retired:
 *   upper  small capitals (textTransform uppercase)
 *   label  an inline label: 10 to 14 px, weight 600, in a grey ink
 *   ring   a group card: white, r-xl, ringed in the line color
 * Pills (r-pill), buttons (cursor pointer) and monospace text are not labels.
 * Cards, chat, the floor and the terminal keep their own type (FILE_EXCEPTIONS);
 * any other pill or badge says so with a `style-guard: micro` comment in its
 * style object.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src/renderer/src');
const SHARED = 'components/fieldText.tsx';
const FILE_EXCEPTIONS = [
  // Cards: the Kanban, Ask me, Needs you, foundation and mail proposal cards.
  'components/TasksKanban.tsx', 'components/AskMeTab.tsx', 'shell/NeedsYouBoard.tsx',
  'components/FoundationCard.tsx', 'components/MailProposalCards.tsx',
  // Chat.
  'components/ThreadsPanel.tsx', 'components/MessageQueueComposer.tsx',
  // The floor, and the voice overlays drawn on it.
  'scene/', 'realtime/',
  // The terminal and the code editor.
  'ide/', 'components/CodeEditor.tsx'
];

function tsxFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** The style object around `at`: from the `{` before it to the `}` after it. */
function objectAt(src, at) {
  return [src.lastIndexOf('{', at), src.indexOf('}', at)];
}

function kind(obj) {
  if (/style-guard: micro/.test(obj)) return null;
  if (/r-pill|cursor: 'pointer'|font-mono/.test(obj)) return null;
  if (/textTransform: 'uppercase'/.test(obj)) return 'upper';
  if (/fontWeight: 600/.test(obj) && /fontSize: 1(0|0\.5|1|1\.5|2|2\.5|3|4)\b/.test(obj) && /color: 'var\(--cth-ink-(2|3|500|700)\)'/.test(obj)) return 'label';
  if (/background: 'var\(--cth-card\)'/.test(obj) && /r-xl/.test(obj) && /inset 0 0 0 1px var\(--cth-line\)'/.test(obj)) return 'ring';
  return null;
}

function violations(src) {
  const found = [];
  const seen = new Set();
  for (const m of src.matchAll(/textTransform: 'uppercase'|fontWeight: 600|inset 0 0 0 1px var\(--cth-line\)'/g)) {
    const [a, b] = objectAt(src, m.index);
    if (seen.has(a)) continue;
    seen.add(a);
    const k = kind(src.slice(a, b + 1));
    if (k) found.push(`${k} at line ${src.slice(0, a).split('\n').length}`);
  }
  return found;
}

test('no screen writes its own label, small caps or ringed group card', () => {
  // Value: protects=AS5, the rollout stays done as screens are added; fails_when=a 10 to 14 px grey 600 label, small capitals or a white ringed group card appears outside fieldText and the named exceptions; why_new=T6 of app-style-rollout.md; seam=none; no_claim=reads source, not the rendered page
  const bad = [];
  for (const f of tsxFiles(ROOT)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (rel === SHARED || FILE_EXCEPTIONS.some((x) => rel === x || (x.endsWith('/') && rel.startsWith(x)))) continue;
    for (const v of violations(fs.readFileSync(f, 'utf8'))) bad.push(`${rel}: ${v}`);
  }
  assert.deepEqual(bad, [], 'use fieldLabel, groupName, hint or Panel from fieldText, or mark a pill or badge with style-guard: micro');
});

test('the guard catches each retired shape and lets the allowed ones through', () => {
  // Value: protects=the guard itself; fails_when=a regex change lets an old label through or flags a pill, button or marked badge; why_new=the guard is new; seam=none; no_claim=none beyond protects
  assert.deepEqual(violations("<span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--cth-ink-500)' }}>"), ['upper at line 1']);
  assert.deepEqual(violations("<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)' }}>"), ['label at line 1']);
  assert.deepEqual(violations("<div style={{ background: 'var(--cth-card)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line)' }}>"), ['ring at line 1']);
  assert.deepEqual(violations("<span style={{ /* style-guard: micro */ fontSize: 10, textTransform: 'uppercase' }}>"), []);
  assert.deepEqual(violations("<span style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--cth-r-pill)', color: 'var(--cth-ink-3)' }}>"), [], 'a pill');
  assert.deepEqual(violations("<button style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--cth-ink-2)' }}>"), [], 'a button');
  assert.deepEqual(violations("<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink)' }}>"), [], 'ink, the field label color');
});
