'use strict';

/**
 * Closing time on the floor (docs/designs/closing-floor.md, owner 2026-10-03):
 * "as the agents are done, remove the name chip and other options to interact
 * with closed agents, as that is what closing really means."
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { stillIn, canOpen, columnAfterGoneHome } = loadTs('src/renderer/src/shell/closingFloor.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('a person who has gone home leaves the pod, and opens from nowhere', () => {
  // Value: protects=1A, 2A, 5A; fails_when=a gone-home person stays on the chip, a shared pod waits for everyone, or a gone-home person can still be opened; why_new=new; seam=none
  const pam = { id: 'pam' }; const erin = { id: 'erin' };
  assert.deepEqual(stillIn([pam, erin], new Set(['pam'])), [erin], 'per person');
  assert.deepEqual(stillIn([pam, erin], new Set(['pam', 'erin'])), []);
  assert.deepEqual(stillIn([pam], new Set()), [pam]);
  assert.equal(canOpen('pam', ['pam']), false);
  assert.equal(canOpen('god', ['pam']), true, 'Michael is never in the list (3A)');
});

test('an open panel on someone who goes home closes, to Needs you while anything waits', () => {
  // Value: protects=4A; fails_when=the panel stays open on a gone-home person or opens the board with nothing waiting; why_new=new; seam=none
  assert.equal(columnAfterGoneHome('person', 'pam', ['pam'], true), 'board');
  assert.equal(columnAfterGoneHome('person', 'pam', ['pam'], false), 'closed');
  assert.equal(columnAfterGoneHome('person', 'erin', ['pam'], false), null);
  assert.equal(columnAfterGoneHome('board', 'pam', ['pam'], false), null);
});

test('the store, the stage and the app follow the rule, and Cancel brings everything back', () => {
  // Value: protects=5A 6A 7A 8A wiring; fails_when=select ignores the list, Cancel leaves people gone, the chip stays clickable, or mail tags keep full strength; why_new=new; seam=source pins, the renderer has no DOM harness
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /select: \(id\) => \{ attemptLeave\(canOpen\(id, get\(\)\.goneHome\) \? \{ selectedId: id, rightColumn: 'person' \} : null, \(\) => set\(\(s\) => \{\n\s*if \(!canOpen\(id, s\.goneHome\)\) return \{\};/);
  assert.match(store, /: s\.selectedId && !canOpen\(s\.selectedId, s\.goneHome\)/);
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /setGoneHome\(r\.phase === 'cancelled' \? \[\] : \[\.\.\.\(r\.confirmed \?\? \[\]\), \.\.\.\(r\.excused \?\? \[\]\)\]\)/, 'Cancel empties it (7A)');
  assert.match(app, /document\.querySelector<HTMLElement>\('\[data-closing-bar\]'\)\?\.focus/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(stage, /const present = stillIn\(pod\.members, closing\?\.out \?\? NOBODY\);/);
  assert.match(stage, /className="cth-st-gone" aria-hidden="true" ref=\{\(el\) => el\?\.setAttribute\('inert', ''\)\}/);
  assert.match(stage, /away: away\.has\(a\.id\) \|\| !!closing\?\.out\.has\(a\.id\)/);
  assert.equal((stage.match(/\|\| \(!!owner && !!closing\?\.out\.has\(owner\.id\)\)/g) ?? []).length, 2, 'post and tag dim (6A)');
  const css = read('src/renderer/src/design/global.css');
  assert.match(css, /\.cth-st-gone \{ pointer-events: none; animation: cth-st-gone 1\.4s var\(--cth-ease\) forwards; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.cth-st-gone \{ animation: none;/);
});

test('closing time switches to the office floor as it starts', () => {
  // Value: protects=the owner sees the office close, from any tab; fails_when=the switch is dropped or fires on every progress tick; why_new=closing used to leave a file or Tasks tab in front; seam=source pin
  const app = read('src/renderer/src/App.tsx');
  // Not saved as the remembered view (review 2026-10-12): the next launch opens where the owner left off.
  assert.match(app, /if \(phase === 'started'\) useStore\.setState\(\{ floorView: 'office' \}\);/);
});

test('nobody who has gone home trades banter, and a closed office has none', () => {
  // Value: protects=no paper plane or envelope flies to or from a dark office at closing time; fails_when=a gone person is a chat candidate, their busy status still blocks the pod, or banter runs once the office is closed; why_new=owner 2026-10-03: ghost mail flew between offices already down; seam=source pin for the stage wiring
  const { chatCandidates } = loadTs('src/renderer/src/shell/closingFloor.ts');
  const busy = new Set(['working', 'thinking']);
  const p = (id, status = 'idle', action = '') => ({ id, status, action });
  const pods = [
    { members: [p('pam'), p('jim')] },
    { members: [p('oscar'), p('kevin', 'working')] },
    { members: [p('toby')] },
    { members: [p('erin', 'idle', 'clocking in…')] }
  ];
  const ids = (gone) => chatCandidates(pods, new Set(gone), busy, 'clocking in…').map((a) => a.id);
  assert.deepEqual(ids([]), ['pam', 'jim', 'toby'], 'busy pods and people clocking in are left out, as before');
  assert.deepEqual(ids(['pam', 'toby']), ['jim'], 'gone home is out');
  assert.deepEqual(ids(['kevin']), ['pam', 'jim', 'oscar', 'toby'], 'someone gone home no longer makes their pod busy');
  assert.deepEqual(ids(['pam', 'jim', 'oscar', 'kevin', 'toby']), []);
  const stage = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/scene/studio/StudioStage.tsx'), 'utf8');
  assert.match(stage, /const closing = useClosingLights\(\);\n\s+const quote = useIdleQuote\(plan\.pods, paused \|\| !!closing\?\.all, life\.throwNote, accentOf, closing\?\.out \?\? NOBODY\);/);
  assert.match(stage, /const quietPeople = \(\) => chatCandidates\(live\.current\.pods, live\.current\.gone, ACTIVE, ACTION_CLOCKING_IN\);/);
});
