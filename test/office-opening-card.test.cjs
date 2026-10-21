'use strict';

/**
 * The office opening (DESIGN.md 7.24, owner 2026-10-17): while the team clocks
 * in after launch, the desks are dark, so a card over the floor says so and
 * counts who is in, from the same rule the stage uses for the dark desks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('who is clocking in: the marker, for at most a minute each, forgotten once in', () => {
  // Value: protects=the card and the dark desks agree on who is still arriving, and neither outlasts the one minute cap; fails_when=the cap is dropped, someone in stays counted, or a marker seen again restarts the clock; why_new=new shared rule (moved from StudioStage); seam=pure clockingIn()
  const { clockingIn: rule, CLOCK_IN_CAP_MS } = loadTs('src/renderer/src/shell/clockingIn.ts');
  const M = read('src/renderer/src/store/store.ts').match(/export const ACTION_CLOCKING_IN = '([^']+)';/)[1];
  const clockingIn = (team, since, now) => rule(team, since, now, M);
  const since = new Map();
  const team = [{ id: 'god', action: M }, { id: 'oscar', action: M }, { id: 'pam', action: 'idle' }];
  assert.deepEqual([...clockingIn(team, since, 1000)].sort(), ['god', 'oscar']);
  team[1].action = '';
  assert.deepEqual([...clockingIn(team, since, 2000)], ['god'], 'Oscar is in');
  assert.equal(since.has('oscar'), false);
  assert.deepEqual([...clockingIn(team, since, 1000 + CLOCK_IN_CAP_MS)], [], 'the cap lights the last desk');
  assert.equal(CLOCK_IN_CAP_MS, 60_000);
});

test('the floor shows the opening card on every launch, and the stage uses the same rule for the dark desks', () => {
  // Value: protects=the opening minute has words (DESIGN.md principle 3) instead of a dark, silent floor; fails_when=the card is not mounted, only mounts on the office view (the pill would stop moving on), or the stage counts differently; why_new=owner report 2026-10-17, reworked in the design review 2026-10-18; seam=source pins (no DOM harness)
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /<TeamClockingIn show=\{floorView === 'office'\} \/>/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(stage, /import \{ useClockingIn \} from '@\/hooks\/useClockingIn';/);
  assert.doesNotMatch(stage, /function useClockingIn\(/, 'one rule, shared');
  const card = read('src/renderer/src/components/TeamClockingIn.tsx');
  assert.match(card, /const arriving = useClockingIn\(agents\);/);
  assert.match(card, /t\('office\.clockedInCount', \{ count: inCount, total \}\)/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const v = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).office.clockedInCount;
    assert.equal(typeof v, 'string', loc);
    assert.match(v, /\{\{count\}\}/);
    assert.match(v, /\{\{total\}\}/);
    assert.doesNotMatch(v, /[–—]| - /, loc);
  }
});

const O = loadTs('src/renderer/src/shell/clockingIn.ts');
const M = read('src/renderer/src/store/store.ts').match(/export const ACTION_CLOCKING_IN = '([^']+)';/)[1];
const member = (id, action = '') => ({ id, name: id[0].toUpperCase() + id.slice(1), action });
const input = (team, extra = {}) => ({ team, arriving: team.filter((a) => a.action === M).length, michaelStarting: false, restoring: false, marker: M, ...extra });

test('the opening ends once: Everyone\'s in for 2 s, or who is missing at the cap for 4 s, then over for the session', () => {
  // Value: protects=design review 2A, 3A and 4A; fails_when=the end state is skipped, lasts the wrong time, names the wrong people, or a mid-day clocking in reopens it; why_new=new phase; seam=pure nextOpening() with now passed in; no_claim=the fade (CSS)
  const t0 = 1_000_000;
  let o = { kind: 'opening', since: t0 };
  const team = [member('god'), member('toby', M), member('ryan', M)];
  assert.equal(O.nextOpening(o, input(team), t0 + 10_000), o, 'still arriving');
  team[1].action = ''; team[2].action = '';
  o = O.nextOpening(o, input(team), t0 + 20_000);
  assert.deepEqual(o, { kind: 'done', at: t0 + 20_000, total: 3 });
  assert.equal(O.nextOpening(o, input(team), t0 + 20_000 + O.DONE_SHOWN_MS - 1), o, 'shown 2 s');
  o = O.nextOpening(o, input(team), t0 + 20_000 + O.DONE_SHOWN_MS);
  assert.deepEqual(o, { kind: 'over' });
  const hire = [...team, member('oscar', M)];
  assert.equal(O.nextOpening(o, input(hire), t0 + 3_600_000), o, 'a hire at 2 PM does not reopen it');
  assert.equal(O.DONE_SHOWN_MS, 2_000);
  assert.equal(O.SHORT_SHOWN_MS, 4_000);

  // At the cap: nobody is arriving any more, but Toby still carries the marker.
  const capped = [member('god'), member('toby', M), member('pam')];
  o = O.nextOpening({ kind: 'opening', since: t0 }, input(capped, { arriving: 0 }), t0 + 61_000);
  assert.deepEqual(o, { kind: 'short', at: t0 + 61_000, total: 3, missing: ['Toby'] });
  assert.equal(O.nextOpening(o, input(capped, { arriving: 0 }), t0 + 61_000 + O.SHORT_SHOWN_MS - 1), o, 'shown 4 s');
  assert.deepEqual(O.nextOpening(o, input(capped, { arriving: 0 }), t0 + 61_000 + O.SHORT_SHOWN_MS), { kind: 'over' });
});

test('the opening waits for the saved team: never before the restore has had its chance, nor while it runs', () => {
  // Value: protects=a fresh launch prunes dead terminals and restores them 2.5 s later, so the card must not say Everyone's in with only Michael on the floor; fails_when=the settle time is dropped or a running restore is ignored; why_new=new phase; seam=pure nextOpening()
  const t0 = 1_000_000;
  const o = { kind: 'opening', since: t0 };
  const onlyMichael = [member('god')];
  assert.equal(O.nextOpening(o, input(onlyMichael), t0 + O.OPENING_SETTLE_MS - 1), o, 'settling');
  const restoreDelay = Number(read('src/renderer/src/hooks/useRestoreTeam.ts').match(/export const AUTO_RESTORE_DELAY_MS = ([\d_]+);/)[1].replace(/_/g, ''));
  assert.ok(O.OPENING_SETTLE_MS > restoreDelay, 'longer than the automatic restore delay');
  assert.equal(O.nextOpening(o, input(onlyMichael, { restoring: true }), t0 + 30_000), o, 'a restore is running');
  const store = read('src/renderer/src/hooks/useRestoreTeam.ts');
  assert.match(store, /restoring = true;\n\s+note = null;\n\s+\/\/ The team coming back is an opening: the card and the pill say so\.\n\s+useStore\.getState\(\)\.reopenOffice\(\);/, 'a Restore team opens again');
});

test('an office with no team ends quietly once Michael is in, and waits while he starts', () => {
  // Value: protects=the empty floor keeps its own card, and the pill does not say Opening forever; fails_when=an empty office flashes Everyone's in or never ends; why_new=new phase; seam=pure nextOpening()
  const t0 = 1_000_000;
  const o = { kind: 'opening', since: t0 };
  assert.equal(O.nextOpening(o, input([], { michaelStarting: true }), t0 + 30_000), o);
  assert.deepEqual(O.nextOpening(o, input([]), t0 + 30_000), { kind: 'over' });
});

test('who is still coming: roster order, the first three, and how many more', () => {
  // Value: protects=the names line ties the card to the dark desks; fails_when=order changes, more than three show, or the count is wrong; why_new=new line; seam=pure stillOut() and namesShown()
  const team = [member('god'), member('toby', M), member('ryan', M), member('oscar', M), member('nick', M), member('sadiq', M)];
  assert.deepEqual(O.stillOut(team, M), ['Toby', 'Ryan', 'Oscar', 'Nick', 'Sadiq']);
  assert.deepEqual(O.namesShown(O.stillOut(team, M)), { names: ['Toby', 'Ryan', 'Oscar'], more: 2 });
  assert.deepEqual(O.namesShown(['Toby']), { names: ['Toby'], more: 0 });
});

test('the card: one shared look for the opening and Michael\'s start, colored, clickable through, and quiet for screen readers', () => {
  // Value: protects=design review D2 B, 5A, 6A and 7A; fails_when=the card goes back to white, the title leaves t-view, Michael's card drifts, the floor is blocked, or the live region reads every count; why_new=new component; seam=source pins (no DOM harness)
  const card = read('src/renderer/src/components/OpeningCard.tsx');
  assert.match(card, /indigo: \{ ring: 'var\(--cth-indigo\)', fill: 'var\(--cth-indigo-soft\)'/);
  assert.match(card, /green: \{ ring: 'var\(--cth-green\)', fill: 'var\(--cth-green-soft\)'/);
  assert.match(card, /amber: \{ ring: 'var\(--cth-amber\)', fill: 'var\(--cth-amber-soft\)'/);
  assert.match(card, /fontSize: 20, lineHeight: '26px', fontWeight: 600/, 't-view');
  assert.match(card, /pointerEvents: 'none'/);
  assert.match(card, /role="progressbar"/);
  assert.match(card, /<div role="status" aria-live="polite" className="cth-sr-only">\{say\}<\/div>/);
  const team = read('src/renderer/src/components/TeamClockingIn.tsx');
  assert.match(team, /if \(said\.current\?\.since !== opening\.since\) said\.current = /, 'announced once per opening');
  assert.match(team, /fadeAfterMs=\{DONE_SHOWN_MS - FADE_MS\}/);
  assert.match(team, /fadeAfterMs=\{SHORT_SHOWN_MS - FADE_MS\}/);
  assert.match(read('src/renderer/src/components/MichaelBooting.tsx'), /<OpeningCard tone="indigo" pulse title=\{title\} say=\{title\}/);
  assert.match(read('src/renderer/src/design/global.css'), /@keyframes cth-opening-out \{ to \{ opacity: 0; \} \}/);
});

test('the clock pill says Opening and the count while the office opens', () => {
  // Value: protects=design review 1A, the top bar agrees with the floor on every view; fails_when=the pill keeps saying Office open, or counts differently from the card; why_new=new pill state; seam=source pins
  const bar = read('src/renderer/src/shell/TopBar.tsx');
  assert.match(bar, /const opening = useStore\(\(s\) => s\.opening\.kind === 'opening'\);/);
  assert.match(bar, /const out = useStore\(\(s\) => stillOut\(s\.agents, ACTION_CLOCKING_IN\)\.length\);/);
  assert.match(bar, /\{opening \? t\('shell\.opening'\) : t\('shell\.officeOpen'\)\}/);
  assert.match(bar, /t\('shell\.openingCount', \{ count: total - out, total \}\)/);
});

test('Michael\'s start line comes from the language files', () => {
  // Value: protects=Chinese and Arabic offices read Michael's start in their language; fails_when=the English line is put back in the component; why_new=design review, ship; seam=source pin (no DOM harness)
  const booting = read('src/renderer/src/components/MichaelBooting.tsx');
  assert.match(booting, /line=\{t\('office\.opening\.michaelLine', \{ name: godName \}\)\}/);
  assert.doesNotMatch(booting, /settling into the corner office/);
});

test('every opening word in three languages, with no dash', () => {
  // Value: protects=the new words reach Chinese and Arabic offices; fails_when=a key is missing or uses a dash; why_new=new words; seam=locale files
  const keys = ['title', 'announce', 'stillComing', 'stillComingMore', 'nameSep', 'allIn', 'missingOne', 'missingMore', 'michael', 'michaelLine'];
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of keys) {
      assert.equal(typeof j.office.opening[k], 'string', `${loc} ${k}`);
      assert.doesNotMatch(j.office.opening[k], /[–—]| - /, `${loc} ${k}`);
    }
    for (const k of ['opening', 'openingCount']) assert.equal(typeof j.shell[k], 'string', `${loc} shell.${k}`);
  }
});
