'use strict';

/**
 * The watch for team members whose engine stops reporting (issue #326; design
 * SD1 to SD17, eng R1 to R7). Driven with a fake clock and fake side effects.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { SilentWatch } = loadTs('src/main/silentWatch.ts');
const S = loadTs('src/shared/silentEngine.ts');

const BEAT = 8000;

function rig({ platform = 'darwin', mayAutoRestart = true, restartOk = true } = {}) {
  const clock = { t: 1_000_000 };
  const log = { restarts: [], stops: [], events: [], changed: 0 };
  const watch = new SilentWatch({
    now: () => clock.t,
    platform,
    mayAutoRestart: () => mayAutoRestart,
    restart: (id, auto) => { log.restarts.push([id, auto]); return restartOk; },
    stop: (m) => log.stops.push(m.id),
    changed: () => { log.changed++; },
    event: (e) => log.events.push([e.type, e.episode.agentId, e.episode.state])
  });
  return { clock, log, watch };
}

const member = (over = {}) => ({
  id: 'kelly', ptyId: 'p-kelly', running: true, engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0',
  isMichael: false, reports: true, statusTicks: true, hasOutput: true, lastOutputAt: 0, lastInputAt: 0, ...over
});

/** Run beats until `ms` have passed, with the member's output fresh at each beat. */
function run(r, ms, m, { busy = true } = {}) {
  const end = r.clock.t + ms;
  while (r.clock.t < end) {
    r.clock.t += BEAT;
    r.watch.beat([{ ...m, lastOutputAt: busy ? r.clock.t - 1000 : m.lastOutputAt }]);
  }
}

test('a member that checks in is never flagged; the clock starts at the first output, not at spawn', () => {
  // Value: protects=no card for a healthy start or a slow one; fails_when=the clock starts at spawn or a check in is ignored; why_new=outside voice 1; seam=none; no_claim=real engines
  const r = rig();
  r.watch.beat([member({ hasOutput: false })]);
  run(r, 5 * 60_000, member({ hasOutput: false }), { busy: false });
  assert.equal(r.watch.list().length, 0, 'no output yet: no clock');
  r.watch.beat([member()]);
  r.watch.noteHook('kelly');
  run(r, 2 * 60_000, member());
  assert.equal(r.watch.list().length, 0);
});

test('never checked in: Michael restarts it once, then the card if that did not help (SD11)', () => {
  // Value: protects=one automatic restart, then the card in its failed state; fails_when=no restart, a second restart, or no card; why_new=new; seam=none; no_claim=the window's respawn (faked)
  const r = rig();
  run(r, 60_000 + 2 * BEAT, member());
  assert.deepEqual(r.log.restarts, [['kelly', true]]);
  assert.equal(r.watch.episode('kelly').state, 'restarting');
  run(r, 60_000 + 3 * BEAT, member());
  assert.equal(r.watch.episode('kelly').state, 'failed');
  assert.equal(r.log.restarts.length, 1, 'never a second automatic restart');
  assert.deepEqual(r.log.stops, [], 'Claude on a Mac has a sandbox: not stopped');
});

test('a late check in closes the card; a blip on one beat never raises one', () => {
  // Value: protects=the card closes on its own and two beats are needed; fails_when=a hook does not resolve or one beat raises; why_new=SD9; seam=none; no_claim=none beyond protects
  const r = rig({ mayAutoRestart: false });
  run(r, 60_000 + BEAT, member());
  assert.equal(r.watch.list().length, 0, 'one beat over the line is not enough');
  r.clock.t += BEAT; r.watch.beat([member({ lastOutputAt: r.clock.t })]);
  assert.equal(r.watch.episode('kelly').state, 'open', 'past the restart limit: the card asks the owner');
  r.watch.noteHook('kelly');
  assert.equal(r.watch.list().length, 0);
  assert.deepEqual(r.log.events.map((e) => e[0]), ['opened', 'resolved']);
});

test('mid work silence counts only on Claude, and never while the owner types (SD9)', () => {
  // Value: protects=no false card on a long Codex or Gemini turn or during Talk 1:1; fails_when=non Claude members are watched mid work or typing counts as busy; why_new=SD9, outside voice 3; seam=none; no_claim=real engines
  for (const engine of ['codex', 'gemini']) {
    const r = rig();
    r.watch.beat([member({ engine, statusTicks: false })]);
    r.watch.noteHook('kelly');
    run(r, 10 * 60_000, member({ engine, statusTicks: false }));
    assert.equal(r.watch.list().length, 0, engine);
  }
  const typing = rig();
  typing.watch.beat([member()]);
  typing.watch.noteHook('kelly');
  const end = typing.clock.t + 10 * 60_000;
  while (typing.clock.t < end) { typing.clock.t += BEAT; typing.watch.beat([member({ lastOutputAt: typing.clock.t, lastInputAt: typing.clock.t - 2000 })]); }
  assert.equal(typing.watch.list().length, 0, 'the owner typing in Talk 1:1');
  const quiet = rig();
  quiet.watch.beat([member()]);
  quiet.watch.noteHook('kelly');
  run(quiet, 3 * 60_000 + 2 * BEAT, member());
  assert.equal(quiet.watch.episode('kelly').kind, 'quiet');
  assert.equal(quiet.watch.episode('kelly').state, 'open', 'mid work: never restarted on its own');
  assert.deepEqual(quiet.log.restarts, []);
});

test('Gemini 0.60 and later: no automatic restart, the failed card at once, and stopped on every platform (R2, R6)', () => {
  // Value: protects=no restart that cannot help, and no unguarded member; fails_when=a known version is restarted or a Gemini member keeps running; why_new=R2 R6; seam=none; no_claim=real Gemini (version faked)
  for (const platform of ['darwin', 'win32']) {
    const r = rig({ platform });
    run(r, 60_000 + 2 * BEAT, member({ engine: 'gemini', engineLabel: 'Gemini CLI', version: '0.63.0', statusTicks: false }));
    assert.deepEqual(r.log.restarts, [], platform);
    assert.equal(r.watch.episode('kelly').state, 'failed');
    assert.equal(r.watch.episode('kelly').stopped, true);
    assert.deepEqual(r.log.stops, ['kelly']);
  }
  const old = rig();
  run(old, 60_000 + 2 * BEAT, member({ engine: 'gemini', version: '0.59.2', statusTicks: false }));
  assert.deepEqual(old.log.restarts, [['kelly', true]], 'an older Gemini keeps the one restart');
});

test('Claude on Windows is stopped when silence is confirmed; Michael never is (SD6, SD13)', () => {
  // Value: protects=the stop rule and Michael's exemptions; fails_when=Windows Claude runs on, or Michael is restarted or stopped; why_new=SD6 SD13; seam=none; no_claim=none beyond protects
  const win = rig({ platform: 'win32', mayAutoRestart: false });
  run(win, 60_000 + 2 * BEAT, member());
  assert.deepEqual(win.log.stops, ['kelly']);
  assert.deepEqual(S.silentButtons({ state: 'open', stopped: true, michael: false }), ['restart', 'keep']);
  const mi = rig({ platform: 'win32' });
  run(mi, 60_000 + 2 * BEAT, member({ id: 'god', isMichael: true }));
  assert.deepEqual(mi.log.restarts, []);
  assert.deepEqual(mi.log.stops, []);
  assert.equal(mi.watch.episode('god').state, 'open');
});

test('Keep working unchecked: no card, mail by handoff, ends on a report or a new version; Check again looks afresh (SD5, SD12)', () => {
  // Value: protects=the owner's keep is visible and ends on its own; fails_when=a kept member still has a card, mail is held, or the keep never ends; why_new=SD5; seam=none; no_claim=none beyond protects
  const r = rig({ platform: 'win32', mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member({ engine: 'gemini', version: '0.63.0', statusTicks: false }));
  r.watch.keep(['kelly']);
  assert.deepEqual(r.log.restarts, [['kelly', false]], 'it was stopped: keeping it starts it again');
  assert.equal(S.silentCards(r.watch.list()).length, 0);
  assert.equal(S.mailFor(r.watch.episode('kelly')), 'handoff');
  r.watch.beat([member({ engine: 'gemini', version: '0.64.0', statusTicks: false })]);
  assert.equal(r.watch.list().length, 0, 'a new version: the keep ends');
  const again = rig({ mayAutoRestart: false });
  run(again, 60_000 + 2 * BEAT, member());
  again.watch.keep(['kelly']);
  again.watch.checkAgain('kelly');
  assert.equal(again.watch.list().length, 0);
});

test('reopening the app: Checking until the restored member starts, then Done or back as it was (SD8)', () => {
  // Value: protects=no stale alarm and no lost one after a relaunch; fails_when=a restored member is flagged before it starts, or a still silent one is forgotten; why_new=SD8, outside voice 6; seam=none; no_claim=the KV store (faked)
  const r = rig({ mayAutoRestart: false });
  r.watch.restore([{ agentId: 'kelly', kind: 'never', state: 'failed', engine: 'gemini', engineLabel: 'Gemini CLI', version: '0.63.0', stopped: true, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1 }]);
  assert.equal(r.watch.episode('kelly').state, 'checking');
  run(r, 5 * 60_000, member({ running: false, hasOutput: false, engine: 'gemini', version: '0.63.0', statusTicks: false }), { busy: false });
  assert.equal(r.watch.episode('kelly').state, 'checking', 'not started yet: still Checking');
  run(r, 60_000 + 2 * BEAT, member({ engine: 'gemini', version: '0.63.0', statusTicks: false }));
  assert.equal(r.watch.episode('kelly').state, 'failed');
  const ok = rig();
  ok.watch.restore([{ agentId: 'kelly', kind: 'quiet', state: 'open', engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0', stopped: false, isMichael: false, since: 1, lastCheckInAt: 1, startedAt: 1 }]);
  ok.watch.noteHook('kelly');
  assert.equal(ok.watch.list().length, 0);
});

test('a hookless custom command is never watched, and a removed member drops off its card (R4)', () => {
  // Value: protects=the regression contract for hookless commands, and removal; fails_when=a hookless member is carded or a removed one lingers; why_new=R4; seam=none; no_claim=none beyond protects
  const r = rig();
  run(r, 10 * 60_000, member({ reports: false }));
  assert.equal(r.watch.list().length, 0);
  const g = rig({ mayAutoRestart: false });
  run(g, 60_000 + 2 * BEAT, member());
  g.watch.beat([]);
  assert.equal(g.watch.list().length, 0);
});

test('cards group by engine and version, Michael first, and show the state that asks the most', () => {
  // Value: protects=one card per cause (SD3) and Michael's own card (SD6); fails_when=grouping splits a shared cause or hides a failed member; why_new=SD3; seam=none; no_claim=none beyond protects
  const ep = (agentId, over = {}) => ({ agentId, kind: 'never', state: 'open', engine: 'gemini', engineLabel: 'Gemini CLI', version: '0.63.0', stopped: false, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1, ...over });
  const cards = S.silentCards([ep('kelly'), ep('dwight', { state: 'failed' }), ep('oscar', { state: 'kept' }), ep('god', { isMichael: true, engine: 'claude' }), ep('pam', { engine: 'claude', version: '2.1.0' })]);
  assert.deepEqual(cards.map((c) => c.key), ['michael', 'gemini@0.63.0', 'claude@2.1.0']);
  assert.deepEqual(cards[1].agentIds, ['kelly', 'dwight']);
  assert.equal(cards[1].state, 'failed');
  assert.deepEqual(S.silentButtons(cards[1]), ['changeEngine', 'keep']);
  assert.deepEqual(S.silentButtons(cards[0]), ['restart']);
});

test('known never reporting versions, one row per entry; versions compare by number', () => {
  // Value: protects=R6's list; fails_when=a listed version is missed or an older one matches; why_new=R6; seam=none; no_claim=none beyond protects
  assert.equal(S.neverReports('gemini', '0.60.0'), true);
  assert.equal(S.neverReports('gemini', '0.63.0'), true);
  assert.equal(S.neverReports('gemini', '1.2.0'), true);
  assert.equal(S.neverReports('gemini', '0.59.9'), false);
  assert.equal(S.neverReports('gemini', null), false, 'unknown keeps the restart');
  assert.equal(S.neverReports('claude', '9.0.0'), false);
  assert.equal(S.versionAtLeast('0.100.0', '0.60.0'), true);
});
