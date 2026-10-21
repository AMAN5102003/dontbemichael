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

test('an idle member whose screen redraws is not quiet; only unbroken output for 3 minutes is', () => {
  // Value: protects=no false "not reporting" card on an idle member, which also held its mail and stalled closing time; fails_when=one redraw (a refit or resize) of an idle Claude screen, or redraws with pauses, open a quiet card; why_new=owner report 2026-10-17 (ten idle members flagged at once); seam=none; no_claim=real terminal output (lastOutputAt faked)
  const idle = rig();
  idle.watch.beat([member()]);
  idle.watch.noteHook('kelly');
  idle.clock.t += 2 * 3600_000; // two hours idle: no report, no output
  idle.watch.beat([member()]);
  // One redraw, then still.
  const redrawAt = idle.clock.t + 1000;
  for (let i = 0; i < 40; i++) { idle.clock.t += BEAT; idle.watch.beat([member({ lastOutputAt: redrawAt })]); }
  assert.equal(idle.watch.list().length, 0, 'one redraw of an idle screen');
  // Redraws with pauses longer than BUSY_FRESH_MS between them, for ten minutes.
  const end = idle.clock.t + 10 * 60_000;
  let last = idle.clock.t;
  while (idle.clock.t < end) {
    idle.clock.t += BEAT;
    if (idle.clock.t - last >= 3 * BEAT) last = idle.clock.t;
    idle.watch.beat([member({ lastOutputAt: last })]);
  }
  assert.equal(idle.watch.list().length, 0, 'redraws with pauses');
  // A working member printing all the while, with no report for 3 minutes: quiet.
  const busy = rig();
  busy.watch.beat([member()]);
  busy.watch.noteHook('kelly');
  busy.clock.t += 2 * 3600_000;
  busy.watch.beat([member()]);
  run(busy, 2 * 60_000, member());
  assert.equal(busy.watch.list().length, 0, 'not yet: two minutes of output');
  busy.watch.noteHook('kelly', 'Status');
  run(busy, 2 * 60_000 + 2 * BEAT, member());
  assert.equal(busy.watch.list().length, 0, 'a report restarts the stretch');
  run(busy, 2 * 60_000, member());
  assert.equal(busy.watch.episode('kelly').kind, 'quiet', 'unbroken output for 3 minutes since the last report');
  assert.ok(S.BUSY_FRESH_MS < S.QUIET_MS);
});

test('a member restarted after it was stopped keeps the reports it sent before the next beat', () => {
  // Value: protects=a restarted member (Research, or any stopped one) that checks in at once and then sits idle is not flagged "never checked in" and stopped; fails_when=reports landing between the stop and the next beat go to the old watch and are dropped when the new process is noticed; why_new=owner report 2026-10-17 (Pete paused although its SessionStart arrived); seam=none
  const r = rig({ mayAutoRestart: false });
  const pete = (over = {}) => member({ id: 'research', isResearch: true, ptyId: 'p-r', pid: 100, ...over });
  r.watch.beat([pete()]);
  r.watch.noteHook('research', 'SessionStart');
  r.clock.t += BEAT; r.watch.beat([pete()]);
  for (let i = 0; i < 4; i++) { r.clock.t += BEAT; r.watch.beat([pete({ running: false })]); }
  // Restarted: SessionStart, then a status tick, both before the next beat; then idle.
  r.watch.noteHook('research', 'SessionStart');
  r.watch.noteHook('research', 'Status');
  const firstOutput = r.clock.t + 1000;
  for (let i = 0; i < 20; i++) { r.clock.t += BEAT; r.watch.beat([pete({ pid: 200, lastOutputAt: firstOutput })]); }
  assert.equal(r.watch.list().length, 0, 'it checked in; no card');
  assert.deepEqual(r.log.stops, []);
  // The same process missed by one beat (no new pid): its report in between still counts.
  const s = rig({ mayAutoRestart: false });
  s.watch.beat([member()]);
  s.clock.t += BEAT; s.watch.beat([member({ running: false })]);
  s.watch.noteHook('kelly', 'SessionStart');
  for (let i = 0; i < 20; i++) { s.clock.t += BEAT; s.watch.beat([member({ lastOutputAt: 0 })]); }
  assert.equal(s.watch.list().length, 0);
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

test('the owner\'s Restart: the card waits on it, a stopped member starts again, and it fails only if it is still silent (SD4)', () => {
  // Value: protects=the Restart button's states; fails_when=Restart leaves the card open or stopped, counts as an automatic restart, restarts a kept member, changes a card when the window could not restart it, or a still silent member never reaches failed; why_new=SilentWatch.restart had no test; seam=none; no_claim=the window's respawn (faked)
  const r = rig({ platform: 'win32', mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member());
  assert.deepEqual([r.watch.episode('kelly').state, r.watch.episode('kelly').stopped], ['open', true], 'Windows: stopped, waiting on the owner');
  r.watch.restart(['kelly', 'nobody']);
  assert.deepEqual(r.log.restarts, [['kelly', false]], 'the owner\'s restart, never counted as automatic; an unknown id is skipped');
  const ep = r.watch.episode('kelly');
  assert.deepEqual([ep.state, ep.stopped, ep.restartTried], ['restarting', false, true]);
  assert.deepEqual(S.silentButtons(S.silentCards(r.watch.list())[0]), [], 'no buttons while it restarts');
  run(r, 60_000 + 3 * BEAT, member());
  assert.deepEqual([r.watch.episode('kelly').state, r.watch.episode('kelly').stopped], ['failed', true], 'still silent: a restart did not help');
  assert.equal(S.silentCards(r.watch.list())[0].restartTried, true);
  const healed = rig({ mayAutoRestart: false });
  run(healed, 60_000 + 2 * BEAT, member());
  healed.watch.restart(['kelly']);
  healed.watch.noteHook('kelly');
  assert.equal(healed.watch.list().length, 0, 'a check in after the restart closes the card');
  const noWindow = rig({ mayAutoRestart: false, restartOk: false });
  run(noWindow, 60_000 + 2 * BEAT, member());
  noWindow.watch.restart(['kelly']);
  assert.equal(noWindow.watch.episode('kelly').state, 'open', 'the window could not restart it: the card stays as it was');
  assert.equal(noWindow.watch.episode('kelly').restartTried, undefined);
  const kept = rig({ mayAutoRestart: false });
  run(kept, 60_000 + 2 * BEAT, member());
  kept.watch.keep(['kelly']);
  kept.watch.restart(['kelly']);
  assert.deepEqual(kept.log.restarts, [], 'a kept member is not restarted');
  assert.equal(kept.watch.episode('kelly').state, 'kept');
});

test('reopening the app: Checking until the restored member starts, then Done or back as it was (SD8)', () => {
  // Value: protects=no stale alarm and no lost one after a relaunch; fails_when=a restored member is flagged before it starts, a still silent one is forgotten, or one never started keeps a card with no buttons; why_new=SD8, outside voice 6, ship review 2026-10-17; seam=none; no_claim=the KV store (faked)
  const r = rig({ mayAutoRestart: false });
  r.watch.restore([{ agentId: 'kelly', kind: 'never', state: 'failed', engine: 'gemini', engineLabel: 'Gemini CLI', version: '0.63.0', stopped: true, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1 }]);
  assert.equal(r.watch.episode('kelly').state, 'checking');
  run(r, 2 * 60_000, member({ running: false, hasOutput: false, engine: 'gemini', version: '0.63.0', statusTicks: false }), { busy: false });
  assert.equal(r.watch.episode('kelly').state, 'checking', 'not started yet: still Checking');
  run(r, S.RESTART_WAIT_MS, member({ running: false, hasOutput: false, engine: 'gemini', version: '0.63.0', statusTicks: false }), { busy: false });
  assert.equal(r.watch.episode('kelly').state, 'failed', 'never started: back as it was, with its buttons');
  const late = rig({ mayAutoRestart: false });
  late.watch.restore([{ agentId: 'kelly', kind: 'never', state: 'failed', engine: 'gemini', engineLabel: 'Gemini CLI', version: '0.63.0', stopped: true, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1 }]);
  run(late, 60_000 + 2 * BEAT, member({ engine: 'gemini', version: '0.63.0', statusTicks: false }));
  assert.equal(late.watch.episode('kelly').state, 'failed', 'started and still silent: back as it was');
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
  assert.deepEqual(cards.map((c) => c.key), ['michael', 'gemini@0.63.0:never', 'claude@2.1.0:never']);
  assert.deepEqual(cards[1].agentIds, ['kelly', 'dwight']);
  assert.equal(cards[1].state, 'failed');
  assert.deepEqual(S.silentButtons(cards[1]), ['changeEngine', 'keep']);
  assert.deepEqual(S.silentButtons(cards[0]), ['restart']);
});

test('a member that never checked in and one that went quiet get a card each, so each card\'s time line is true for every name (SD3)', () => {
  // Value: protects=SD3's own card per reason; fails_when=the card key drops the reason and a never member shows a last check in; why_new=the grouping test above uses one reason only; seam=none; no_claim=the renderer's lines (SilentEngine.tsx reads kind and lastCheckInAt)
  const ep = (agentId, over = {}) => ({ agentId, kind: 'never', state: 'open', engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0', stopped: false, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1, ...over });
  const cards = S.silentCards([ep('kelly'), ep('dwight', { kind: 'quiet', lastCheckInAt: 500 }), ep('oscar')]);
  assert.deepEqual(cards.map((c) => [c.key, c.agentIds, c.kind, c.lastCheckInAt]), [
    ['claude@2.1.0:never', ['kelly', 'oscar'], 'never', null],
    ['claude@2.1.0:quiet', ['dwight'], 'quiet', 500]
  ]);
  assert.equal(S.silentCardKey(ep('god', { isMichael: true, kind: 'quiet' })), 'michael', 'Michael has one card whatever the reason');
});

test('Michael\'s desktop notice goes once per card: for the name that opens it, never for one joining it (SD10)', () => {
  // Value: protects=one notice per card; fails_when=every name on a card sends a notice, a kept member blocks a new card's notice, or another reason's card blocks it; why_new=no test covered the notice rule (plan N7, E7); seam=none; no_claim=the Notification call and the notifications setting (index.ts silentNotice)
  const ep = (agentId, over = {}) => ({ agentId, kind: 'never', state: 'open', engine: 'gemini', engineLabel: 'Gemini CLI', version: '0.63.0', stopped: false, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1, ...over });
  const kelly = ep('kelly');
  assert.equal(S.noticeForOpened(kelly, [kelly]), true, 'the first name opens the card');
  assert.equal(S.noticeForOpened(ep('dwight'), [kelly, ep('dwight')]), false, 'a second name joins the card shown');
  assert.equal(S.noticeForOpened(ep('dwight'), [ep('kelly', { state: 'kept' })]), true, 'a kept member has no card');
  assert.equal(S.noticeForOpened(ep('dwight', { kind: 'quiet' }), [kelly]), true, 'another reason is another card');
  assert.equal(S.noticeForOpened(ep('dwight', { version: '0.64.0' }), [kelly]), true, 'another version is another card');
  assert.equal(S.noticeForOpened(ep('god', { isMichael: true }), [kelly]), true, "Michael's own card");
  // Only an opened card sends one: Done (resolved) and Keep send none.
  const main = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.match(main, /if \(type === 'opened'\) \{[^]*?if \(noticeForOpened\(episode, silentWatch\?\.list\(\) \?\? \[\]\)\) silentNotice\(episode\);/);
  assert.equal((main.match(/silentNotice\(episode\)/g) ?? []).length, 1, 'no notice on resolved or kept');
  assert.match(main, /function silentNotice\(e: SilentEpisode\): void \{\n\s*if \(!readConfig\(\)\.notifications\) return;/, 'only with notifications on');
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

// ── Ship review 2026-10-17: the watch across relaunches, restarts and engines ──

test('an archived member keeps its card across beats; only leaving the roster ends it (SD8)', () => {
  // Value: protects=the watch half of a relaunch keeping its cards: members passed as not running keep their episodes; fails_when=beat drops episodes of members passed as not running; why_new=red team: the launch archived every member and the first beat erased all cards (the bug was index.ts leaving archived members out, pinned in silent-engine-wiring; this pins the watch side); seam=none; no_claim=index.ts passing archived members
  const r = rig({ mayAutoRestart: false });
  r.watch.restore([
    { agentId: 'kelly', kind: 'never', state: 'failed', engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0', stopped: false, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1 },
    { agentId: 'dwight', kind: 'quiet', state: 'kept', engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0', stopped: false, isMichael: false, since: 1, lastCheckInAt: 1, startedAt: 1 }
  ]);
  for (let i = 0; i < 5; i++) { r.clock.t += BEAT; r.watch.beat([member({ running: false, ptyId: '' }), member({ id: 'dwight', running: false, ptyId: '' })]); }
  assert.equal(r.watch.episode('kelly')?.state, 'checking');
  assert.equal(r.watch.episode('dwight')?.state, 'kept', 'the owner\'s Keep survives');
  r.watch.beat([member({ id: 'dwight', running: false, ptyId: '' })]);
  assert.equal(r.watch.episode('kelly'), undefined, 'deleted from the roster: the card goes');
});

test('a restart from outside the card checks in afresh: the card waits on it, and a stop holds again (R1)', () => {
  // Value: protects=Restart and Continue, a stuck restart or Change engine never keeps the dead process's watch; fails_when=the watch is keyed by terminal id only, or a stopped member that runs again stays marked stopped; why_new=state machine and red team review; seam=none
  const r = rig({ platform: 'win32', mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member({ pid: 100 }));
  assert.deepEqual(r.log.stops, ['kelly'], 'unguarded on Windows: stopped');
  assert.equal(r.watch.episode('kelly').stopped, true);
  r.clock.t += BEAT; r.watch.beat([member({ running: false, pid: undefined })]);
  // The owner starts it again from its panel: same terminal id, a new process.
  r.clock.t += BEAT; r.watch.beat([member({ pid: 200, hasOutput: false })]);
  const ep = r.watch.episode('kelly');
  assert.equal(ep.state, 'restarting');
  assert.equal(ep.stopped, false, 'its terminal runs again');
  run(r, 60_000 + 2 * BEAT, member({ pid: 200 }));
  assert.equal(r.watch.episode('kelly').state, 'failed');
  assert.deepEqual(r.log.stops, ['kelly', 'kelly'], 'still silent and unguarded: stopped again');
});

test('an idle member restarted gets no false card before its new session reports', () => {
  // Value: protects=no quiet card from the old process's last report; fails_when=the old watch is kept after a restart, so start up output reads as three minutes of silence; why_new=red team review; seam=none
  const r = rig();
  r.watch.beat([member({ pid: 1 })]);
  r.watch.noteHook('kelly');
  run(r, 10 * 60_000, member({ pid: 1 }), { busy: false });
  // Restarted after ten idle minutes: busy at once, the new session reports soon.
  run(r, 2 * BEAT, member({ pid: 2 }));
  assert.equal(r.watch.list().length, 0, 'no card on the new process\'s first beats');
  r.watch.noteHook('kelly', 'SessionStart');
  run(r, 2 * 60_000, member({ pid: 2 }));
  assert.equal(r.watch.list().length, 0);
});

test('a member moved to an engine with no reports drops its card, and Michael hears its mail can go to it again', () => {
  // Value: protects=no card stuck for good, no mail held for ever; fails_when=beat skips a non reporting member before looking at its episode; why_new=state machine review; seam=none
  const r = rig({ mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member());
  assert.equal(r.watch.episode('kelly').state, 'open');
  r.clock.t += BEAT; r.watch.beat([member({ reports: false, engine: 'custom' })]);
  assert.equal(r.watch.episode('kelly'), undefined);
  assert.deepEqual(r.log.events.map((e) => e[0]), ['opened', 'dropped']);
});

test('a Restart that never brings the terminal back fails in time, so the card offers its buttons again', () => {
  // Value: protects=no card left spinning with no buttons; fails_when=restarting has no deadline; why_new=testing, state machine and red team reviews; seam=none
  const r = rig({ mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member());
  r.watch.restart(['kelly']);
  assert.equal(r.watch.episode('kelly').state, 'restarting');
  run(r, S.RESTART_WAIT_MS - BEAT, member({ running: false, ptyId: '' }), { busy: false });
  assert.equal(r.watch.episode('kelly').state, 'restarting', 'still in time');
  run(r, 2 * BEAT, member({ running: false, ptyId: '' }), { busy: false });
  const ep = r.watch.episode('kelly');
  assert.equal(ep.state, 'failed');
  assert.notDeepEqual(S.silentButtons(S.silentCards([ep])[0]), [], 'the card has buttons again');
});

test('one long tool call is no silence; past the ceiling it is', () => {
  // Value: protects=a five minute build or test run never raises a false card (or a stop on Windows); fails_when=a PreToolUse with no end yet is ignored by the quiet rule; why_new=red team review; seam=none; no_claim=Claude's real status tick rate during a tool call
  const r = rig({ platform: 'win32' });
  r.watch.beat([member()]);
  r.watch.noteHook('kelly', 'PreToolUse');
  run(r, 10 * 60_000, member());
  assert.equal(r.watch.list().length, 0, 'ten minutes in one tool call: no card');
  assert.deepEqual(r.log.stops, []);
  r.watch.noteHook('kelly', 'PostToolUse');
  run(r, S.QUIET_MS + 3 * BEAT, member());
  assert.equal(r.watch.episode('kelly')?.kind, 'quiet', 'after the tool call ends, silence counts again');
  const long = rig();
  long.watch.beat([member()]);
  long.watch.noteHook('kelly', 'PreToolUse');
  run(long, S.LONG_TOOL_MS + 3 * BEAT, member());
  assert.equal(long.watch.episode('kelly')?.kind, 'quiet', 'longer than any tool call: silence');
});

test('Research not reporting is stopped even on a Mac, has its own card, and is never kept unchecked', () => {
  // Value: protects=a silent Research never works with unguarded file tools and the internet; fails_when=Research is treated as sandbox guarded, shares a card with others, or Keep applies to it; why_new=owner 2026-10-17 (D3.2); seam=none
  const r = rig({ platform: 'darwin', mayAutoRestart: false });
  const pete = member({ id: 'research', isResearch: true });
  run(r, 60_000 + 2 * BEAT, pete);
  assert.deepEqual(r.log.stops, ['research']);
  const ep = r.watch.episode('research');
  assert.equal(ep.isResearch, true);
  r.watch.keep(['research']);
  assert.equal(r.watch.episode('research').state, 'open', 'Keep does nothing for Research');
  const cards = S.silentCards([ep, { ...ep, agentId: 'kelly', isResearch: undefined }]);
  assert.deepEqual(cards.map((c) => c.key).sort(), ['claude@2.1.0:never', 'research']);
  const card = cards.find((c) => c.research);
  assert.deepEqual(S.silentButtons(card), ['restart']);
  assert.deepEqual(S.silentButtons({ ...card, state: 'failed' }), ['restart']);
  assert.equal(S.guardedWithoutReports('claude', 'darwin', true), false);
  assert.equal(S.guardedWithoutReports('claude', 'darwin'), true);
});

test('Keep on a stopped member waits until its terminal can start again', () => {
  // Value: protects=no member marked kept while nothing runs to take its mail; fails_when=keep marks it kept when the restart was not sent; why_new=state machine review; seam=none
  const r = rig({ platform: 'win32', mayAutoRestart: false, restartOk: false });
  run(r, 60_000 + 2 * BEAT, member());
  assert.equal(r.watch.episode('kelly').stopped, true);
  r.watch.keep(['kelly']);
  assert.equal(r.watch.episode('kelly').state, 'open', 'the card stays');
  assert.equal(r.log.events.filter((e) => e[0] === 'kept').length, 0);
});

test('a quiet member: Restart, Keep, a check in and Check again behave as for a never one', () => {
  // Value: protects=the quiet column of the watch's state table; fails_when=any action treats quiet episodes differently; why_new=state machine review, untested cells; seam=none
  const quiet = () => {
    const r = rig({ mayAutoRestart: false });
    r.watch.beat([member()]);
    r.watch.noteHook('kelly');
    run(r, S.QUIET_MS + 3 * BEAT, member());
    assert.equal(r.watch.episode('kelly').kind, 'quiet');
    return r;
  };
  const a = quiet();
  a.watch.restart(['kelly']);
  assert.equal(a.watch.episode('kelly').state, 'restarting');
  run(a, 60_000 + 3 * BEAT, member());
  assert.equal(a.watch.episode('kelly').state, 'failed');
  const b = quiet();
  b.watch.keep(['kelly']);
  assert.equal(b.watch.episode('kelly').state, 'kept');
  assert.equal(S.silentCards(b.watch.list()).length, 0);
  assert.equal(S.mailFor(b.watch.episode('kelly')), 'handoff');
  b.watch.noteHook('kelly');
  assert.equal(b.watch.list().length, 0, 'a report ends the keep');
  const c = quiet();
  c.watch.noteHook('kelly');
  assert.equal(c.watch.list().length, 0);
  assert.deepEqual(c.log.events.map((e) => e[0]), ['opened', 'resolved']);
  const d = quiet();
  d.watch.keep(['kelly']);
  d.watch.checkAgain('kelly');
  assert.equal(d.watch.list().length, 0);
  d.watch.noteHook('kelly');
  run(d, S.QUIET_MS + 3 * BEAT, member());
  assert.equal(d.watch.episode('kelly')?.kind, 'quiet', 'watched afresh');
});

test('a restored kept member stays kept; a restored restart waits, then is back as open', () => {
  // Value: protects=restore() for kept and restarting rows; fails_when=a kept member is put back to Checking or a restarting one never settles; why_new=testing review; seam=none
  const k = rig({ mayAutoRestart: false });
  k.watch.restore([{ agentId: 'kelly', kind: 'never', state: 'kept', engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0', stopped: true, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1 }]);
  run(k, 60_000 + 3 * BEAT, member());
  assert.equal(k.watch.episode('kelly').state, 'kept');
  assert.equal(k.watch.episode('kelly').stopped, false);
  const rs = rig({ mayAutoRestart: false });
  rs.watch.restore([{ agentId: 'kelly', kind: 'never', state: 'restarting', engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0', stopped: false, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1 }]);
  assert.equal(rs.watch.episode('kelly').state, 'checking');
  run(rs, 60_000 + 3 * BEAT, member());
  assert.equal(rs.watch.episode('kelly').state, 'open');
});

test('the new process\'s first report before the beat notices the restart still counts', () => {
  // Value: protects=no false never card after Restart and Continue on an idle member; fails_when=a report the new process sent before the next beat is dropped with the old watch; why_new=pass 2 review of the restart fix; seam=none
  const r = rig();
  r.watch.beat([member({ pid: 1 })]);
  r.watch.noteHook('kelly');
  run(r, 5 * 60_000, member({ pid: 1 }), { busy: false });
  // Restarted between beats: the new session reports at once, then idles.
  r.clock.t += 1000;
  r.watch.noteHook('kelly', 'SessionStart');
  run(r, 3 * 60_000, member({ pid: 2 }), { busy: false });
  assert.equal(r.watch.list().length, 0, 'its SessionStart counted for the new process');
});

test('overlapping tool calls: the long one still counts after the short one ends', () => {
  // Value: protects=a build running beside a quick read is no silence; fails_when=one timestamp tracks every tool call; why_new=pass 2 reviews; seam=none
  const r = rig({ platform: 'win32' });
  r.watch.beat([member()]);
  r.watch.noteHook('kelly', 'PreToolUse');
  r.watch.noteHook('kelly', 'PreToolUse');
  r.watch.noteHook('kelly', 'PostToolUse');
  run(r, 8 * 60_000, member());
  assert.equal(r.watch.list().length, 0, 'the build is still running');
  r.watch.noteHook('kelly', 'Stop');
  run(r, S.QUIET_MS + 3 * BEAT, member());
  assert.equal(r.watch.episode('kelly')?.kind, 'quiet', 'the turn ended: silence counts again');
});

test('a restored member\'s wait counts from when its terminal starts', () => {
  // Value: protects=a member the window restores late is not settled before it can report; fails_when=the restore time starts the wait; why_new=pass 2 review; seam=none
  const r = rig({ platform: 'win32', mayAutoRestart: false });
  r.watch.restore([{ agentId: 'kelly', kind: 'never', state: 'failed', engine: 'claude', engineLabel: 'Claude Code', version: '2.1.0', stopped: true, isMichael: false, since: 1, lastCheckInAt: null, startedAt: 1 }]);
  run(r, S.RESTART_WAIT_MS - 2 * BEAT, member({ running: false, ptyId: '' }), { busy: false });
  run(r, 3 * BEAT, member({ hasOutput: false }), { busy: false });
  assert.equal(r.watch.episode('kelly').state, 'checking', 'just started: still Checking');
  assert.deepEqual(r.log.stops, []);
  r.watch.noteHook('kelly', 'SessionStart');
  assert.equal(r.watch.list().length, 0);
});

test('Research that never checks in is stopped, not restarted on its own', () => {
  // Value: protects=a silent Research never runs a second unreported process; fails_when=the automatic restart covers Research; why_new=pass 2 review (owner D3.2); seam=none
  const r = rig({ platform: 'darwin', mayAutoRestart: true });
  run(r, 60_000 + 2 * BEAT, member({ id: 'research', isResearch: true }));
  assert.deepEqual(r.log.restarts, []);
  assert.deepEqual(r.log.stops, ['research']);
  assert.equal(r.watch.episode('research').state, 'open');
});

test('Change engine: the restarted member\'s card moves to the engine it runs now', () => {
  // Value: protects=the card names the new engine and waits on it; fails_when=restarted() keeps the old engine and version; why_new=pass 2 review; seam=none
  const r = rig({ mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member({ pid: 1, engine: 'gemini', engineLabel: 'Gemini CLI', version: '0.63.0', statusTicks: false }));
  const before = S.silentCardKey(r.watch.episode('kelly'));
  r.clock.t += BEAT; r.watch.beat([member({ pid: 2, engine: 'codex', engineLabel: 'Codex', version: '0.40.0', statusTicks: false, hasOutput: false })]);
  const ep = r.watch.episode('kelly');
  assert.equal(ep.state, 'restarting');
  assert.deepEqual([ep.engine, ep.engineLabel, ep.version], ['codex', 'Codex', '0.40.0']);
  assert.notEqual(S.silentCardKey(ep), before);
});

test('a tool call the app refused never ends, and still never takes a later call\'s grace', () => {
  // Value: protects=a long call after a refused one keeps its grace; fails_when=the grace counts from the first open call; why_new=pass 3 review; seam=none
  const r = rig({ platform: 'win32' });
  r.watch.beat([member()]);
  r.watch.noteHook('kelly', 'PreToolUse'); // refused by the app's gate: no PostToolUse
  for (let i = 0; i < 20; i++) { r.clock.t += 60_000; r.watch.noteHook('kelly', 'PreToolUse'); r.watch.noteHook('kelly', 'PostToolUse'); r.watch.beat([member({ lastOutputAt: r.clock.t - 1000 })]); }
  r.watch.noteHook('kelly', 'PreToolUse'); // a long build
  run(r, 10 * 60_000, member());
  assert.equal(r.watch.list().length, 0, 'the build keeps its grace');
  assert.deepEqual(r.log.stops, []);
});

test('only a SessionStart after the last beat carries over to the new process; the old one\'s last tick does not', () => {
  // Value: protects=a new process that never reports is still flagged; fails_when=any report between the last beat and the restart is credited to the new process; why_new=pass 3 review; seam=none
  const r = rig({ mayAutoRestart: false });
  r.watch.beat([member({ pid: 1, engine: 'codex', statusTicks: false })]);
  r.watch.noteHook('kelly', 'SessionStart');
  run(r, 2 * 60_000, member({ pid: 1, engine: 'codex', statusTicks: false }), { busy: false });
  r.clock.t += 1000;
  r.watch.noteHook('kelly', 'Stop'); // the old process's last report
  run(r, 60_000 + 3 * BEAT, member({ pid: 2, engine: 'codex', statusTicks: false }));
  assert.equal(r.watch.episode('kelly')?.kind, 'never', 'the new process never checked in');
});

test('a card whose member is closed or leaves goes, and Michael hears its mail is his to route', () => {
  // Value: protects=Michael is never left holding mail for someone gone without a word; fails_when=beat drops the episode silently; why_new=pass 3 review; seam=none
  const r = rig({ mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member());
  r.clock.t += BEAT; r.watch.beat([]);
  assert.equal(r.watch.list().length, 0);
  assert.deepEqual(r.log.events.map((e) => e[0]), ['opened', 'removed']);
});

test('a Keep whose restart never brings a terminal gives the card back', () => {
  // Value: protects=no keep left with nothing running and no card; fails_when=keep is final before a terminal runs; why_new=Codex adversarial review 2026-10-17; seam=none
  const r = rig({ platform: 'win32', mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member());
  assert.equal(r.watch.episode('kelly').stopped, true);
  r.watch.keep(['kelly']);
  assert.equal(r.watch.episode('kelly').state, 'kept');
  run(r, S.RESTART_WAIT_MS + BEAT, member({ running: false, ptyId: '' }), { busy: false });
  const ep = r.watch.episode('kelly');
  assert.equal(ep.state, 'open', 'back on Needs you');
  assert.equal(ep.stopped, true);
  assert.equal(S.mailFor(ep), 'hold', 'its mail goes to Michael again');
  const ok = rig({ platform: 'win32', mayAutoRestart: false });
  run(ok, 60_000 + 2 * BEAT, member({ pid: 1 }));
  ok.watch.keep(['kelly']);
  run(ok, S.RESTART_WAIT_MS + BEAT, member({ pid: 2, hasOutput: false }), { busy: false });
  assert.equal(ok.watch.episode('kelly').state, 'kept', 'running again: the keep stands');
});

test('Keep on a member with no terminal starts it again, and a relaunch restarts the wait', () => {
  // Value: protects=no keep with nothing running after a crash or a relaunch, and no false card right after a relaunch; fails_when=keep looks only at the watch's own stop, or restore keeps a stale wait; why_new=round four verification; seam=none
  const r = rig({ mayAutoRestart: false });
  run(r, 60_000 + 2 * BEAT, member());
  // It crashed: the terminal is gone, though the watch never stopped it.
  r.clock.t += BEAT; r.watch.beat([member({ running: false, ptyId: '' })]);
  assert.equal(r.watch.episode('kelly').stopped, false);
  r.watch.keep(['kelly']);
  assert.deepEqual(r.log.restarts.at(-1), ['kelly', false], 'started again for the keep');
  assert.notEqual(r.watch.episode('kelly').waitSince, undefined);
  const saved = r.watch.list();
  const re = rig({ mayAutoRestart: false });
  re.clock.t = r.clock.t + 10 * 60_000;
  re.watch.restore(saved);
  re.clock.t += BEAT; re.watch.beat([member({ running: false, ptyId: '' })]);
  assert.equal(re.watch.episode('kelly').state, 'kept', 'the wait counts from this launch');
});

test('a Mac that sleeps between two redraws never flags an idle member; real work after waking still does', () => {
  // Value: protects=no false "not reporting" card after the lid closes and opens (owner report 2026-10-17: lid closed 22:55, opened 23:07, eight idle members flagged at the wake second, their mail held); fails_when=a stretch of printing or the first report wait carries across a gap in the beats; why_new=the beats stop during sleep, so a redraw before and one after looked like 12 minutes of work; seam=fake clock; no_claim=real terminal output (lastOutputAt faked)
  const idle = rig();
  idle.watch.beat([member()]);
  idle.watch.noteHook('kelly');
  idle.clock.t += 60 * 60_000;
  idle.watch.beat([member()]);
  // The lid closes: every terminal redraws, the beat sees it, then the Mac sleeps.
  idle.clock.t += BEAT;
  idle.watch.beat([member({ lastOutputAt: idle.clock.t - 500 })]);
  idle.clock.t += 12 * 60_000; // asleep: no beats
  // The lid opens: another redraw, and two beats at once (the resume re-arms them).
  const wake = idle.clock.t;
  idle.watch.beat([member({ lastOutputAt: wake - 300 })]);
  idle.clock.t += 50;
  idle.watch.beat([member({ lastOutputAt: wake - 300 })]);
  for (let i = 0; i < 40; i++) { idle.clock.t += BEAT; idle.watch.beat([member({ lastOutputAt: wake - 300 })]); }
  assert.equal(idle.watch.list().length, 0, 'two redraws around a sleep are not work');

  // A member that never reported yet: the sleep does not count toward its first check in.
  const fresh = rig();
  fresh.watch.beat([member({ lastOutputAt: fresh.clock.t })]);
  fresh.clock.t += 10 * 60_000;
  fresh.watch.beat([member({ lastOutputAt: fresh.clock.t - 100 })]);
  fresh.watch.beat([member({ lastOutputAt: fresh.clock.t - 100 })]);
  assert.equal(fresh.watch.list().length, 0, 'not flagged at the wake beat');

  // Real silent work after waking is still flagged once it runs for QUIET_MS.
  const busy = rig();
  busy.watch.beat([member()]);
  busy.watch.noteHook('kelly');
  busy.clock.t += 12 * 60_000;
  busy.watch.beat([member({ lastOutputAt: busy.clock.t - 100 })]);
  run(busy, S.QUIET_MS + 3 * BEAT, member());
  assert.deepEqual(busy.watch.list().map((e) => e.kind), ['quiet'], 'unbroken output after waking');
});
