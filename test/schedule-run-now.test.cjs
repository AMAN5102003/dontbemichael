/**
 * Run now (docs/designs/schedule-run-now.md): the owner runs one job at once.
 * The rules are pure in src/shared/missions.ts (runNowCheck, runNowOutcome);
 * main's handler and the row are pinned by source, because index.ts needs
 * Electron and the row needs a React harness this suite doesn't have.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

process.env.TZ = 'UTC';

const M = loadTs('src/shared/missions.ts');
const { scheduledRunBody, relayRunBody } = loadTs('src/shared/scheduleMessage.ts');

const HOUR = 3_600_000;
const at = (y, m, d, h = 0, min = 0, s = 0) => new Date(Date.UTC(y, m - 1, d, h, min, s)).getTime();
const ctx = { standupId: 'ops-standup', standupFiredThisLaunch: true };
const mk = (over = {}) => ({ id: 'm1', label: 'Check the support inbox', intervalMs: HOUR, to: 'kelly', body: '', enabled: true, ...over });
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
/** main's missions:runNow handler, from its first line to its closing brace. */
function runNowHandler() {
  const idx = src('src/main/index.ts');
  const start = idx.indexOf("ipcMain.handle('missions:runNow'");
  assert.ok(start >= 0, 'main handles missions:runNow');
  return idx.slice(start, idx.indexOf('\n});\n', start) + 4);
}

/* ───────────────────────────── who can run now ───────────────────────────── */

test('run now: a job that is on runs, and the check hands back the stored copy', () => {
  // Value: protects=main sends the job as saved now, not as a screen opened earlier knew it; fails_when=runNowCheck returns something other than the list's own row; seam=pure
  const stored = mk({ focus: 'refund emails first' });
  const res = M.runNowCheck([mk({ id: 'other' }), stored], 'm1', at(2026, 10, 15, 10));
  assert.equal(res.ok, true);
  assert.equal(res.mission, stored);
});

test('run now: a paused job runs too, so the owner can try it before turning it on', () => {
  assert.equal(M.runNowCheck([mk({ enabled: false })], 'm1', at(2026, 10, 15, 10)).ok, true);
});

test('run now: an unknown id is refused as not found', () => {
  assert.deepEqual(M.runNowCheck([mk()], 'gone', at(2026, 10, 15, 10)), { ok: false, error: 'not found' });
  assert.deepEqual(M.runNowCheck([], 'm1', at(2026, 10, 15, 10)), { ok: false, error: 'not found' });
});

test('run now: the heartbeat and a compact row are not jobs', () => {
  // Value: protects=the office pulse keeps its own adaptive timer and a compact row sends nothing; fails_when=run now treats every schedule as a job
  const now = at(2026, 10, 15, 10);
  assert.deepEqual(M.runNowCheck([mk({ kind: 'heartbeat' })], 'm1', now), { ok: false, error: 'not a job' });
  assert.deepEqual(M.runNowCheck([mk({ kind: 'compact' })], 'm1', now), { ok: false, error: 'not a job' });
  assert.equal(M.runNowCheck([mk({ kind: 'dispatch' })], 'm1', now).ok, true, 'an explicit dispatch row is a job');
});

/* ─────────────────────────── never sent twice ─────────────────────────── */

test('run now: within a minute of its last run the job is not sent again', () => {
  // Value: protects=a double click, or a click just after the clock fired, sends the job once; fails_when=the gap is dropped or measured the wrong way
  const last = at(2026, 10, 15, 10);
  const list = [mk({ lastFiredAt: last })];
  assert.deepEqual(M.runNowCheck(list, 'm1', last), { ok: false, error: 'just ran' });
  assert.deepEqual(M.runNowCheck(list, 'm1', last + 30_000), { ok: false, error: 'just ran' });
  assert.deepEqual(M.runNowCheck(list, 'm1', last + M.RUN_NOW_GAP_MS - 1), { ok: false, error: 'just ran' });
  assert.equal(M.runNowCheck(list, 'm1', last + M.RUN_NOW_GAP_MS).ok, true, 'a full minute later it runs');
});

test('run now: a job that never ran has no gap, and a last run in the future never blocks it', () => {
  // A clock set back leaves lastFiredAt ahead of now; the gap must not hold the job for hours.
  const now = at(2026, 10, 15, 10);
  assert.equal(M.runNowCheck([mk()], 'm1', now).ok, true);
  assert.equal(M.runNowCheck([mk({ lastFiredAt: now + 2 * HOUR })], 'm1', now).ok, true);
});

test('run now: the gap is one minute', () => {
  assert.equal(M.RUN_NOW_GAP_MS, 60_000);
});

/* ─────────────────────── the same run the clock sends ─────────────────────── */

test('run now sends what the clock sends: the job, its focus and older instructions', () => {
  // Value: protects=a run now tests the job exactly as it will run on its clock; fails_when=main builds its own message instead of firePayload
  const job = mk({ focus: 'refund emails first', body: 'Sign as Sam.' });
  assert.deepEqual(M.firePayload(job), { to: 'kelly', subject: job.label, body: scheduledRunBody(job.label, 'Sign as Sam.', 'refund emails first') });
  const relay = mk({ to: 'god', relay: true });
  assert.equal(M.runNowCheck([relay], 'm1', at(2026, 10, 15, 10)).ok, true, 'a former everyone job is a job');
  assert.equal(M.firePayload(relay).body, relayRunBody(relay.label, '', undefined));
  assert.match(runNowHandler(), /sendMission\(check\.mission\);/, 'main sends through the clock\'s own sendMission');
});

/* ─────────────────── the row and the timer agree afterwards ─────────────────── */

test('after a run now an interval job counts from that run, on the row and on the timer', () => {
  // Value: protects=the row's "next" and the armed timer say the same time after a run now; fails_when=main skips the re-arm, or armPlan stops honoring lastFiredAt
  const ranAt = at(2026, 10, 15, 10, 0);
  const runNow = at(2026, 10, 15, 10, 30);
  const after = mk({ lastFiredAt: runNow });
  assert.equal(M.nextRunAt(mk({ lastFiredAt: ranAt }), runNow), at(2026, 10, 15, 11, 0), 'before: next at 11:00');
  assert.equal(M.nextRunAt(after, runNow), at(2026, 10, 15, 11, 30), 'after: the row says 11:30');
  assert.deepEqual(M.armPlan(after, runNow, ctx), { type: 'interval', firstDelayMs: HOUR, everyMs: HOUR }, 'and a re-armed timer waits the same hour');
  assert.match(runNowHandler(), /sendMission\(check\.mission\);[\s\S]*syncMissions\(\);/, 'main re-arms after the send');
});

test('after a run now a job on the clock keeps its slots, and a missed slot is not run again', () => {
  // Value: protects=a run now is one extra run that neither moves Monday 09:00 nor doubles a slot it already covered; fails_when=run now changes the stored times or the catch up ignores lastFiredAt
  const monday9 = { days: [1], minute: 540 };
  const runNow = at(2026, 9, 21, 9, 30); // Monday 09:30, the 09:00 slot was missed
  assert.equal(M.armPlan(mk({ weekly: monday9 }), runNow, ctx).firstDelayMs, 0, 'before: the missed slot would run now');
  const after = mk({ weekly: monday9, lastFiredAt: runNow });
  assert.equal(M.armPlan(after, runNow, ctx).firstDelayMs, at(2026, 9, 28, 9, 0) - runNow, 'after: it waits for next Monday');
  assert.equal(M.nextRunAt(after, runNow), at(2026, 9, 28, 9, 0));
});

/* ───────────────────────────── what the row says ───────────────────────────── */

test('runNowOutcome: sent, ran a moment ago, or failed', () => {
  assert.equal(M.runNowOutcome({ ok: true }), 'sent');
  assert.equal(M.runNowOutcome({ ok: false, error: 'just ran' }), 'justRan');
  for (const error of ['not found', 'not a job', 'office not open', 'invalid id', 'disk full', undefined]) {
    assert.equal(M.runNowOutcome({ ok: false, error }), 'failed', String(error));
  }
});

/* ───────────────────────────────── wiring ───────────────────────────────── */

test('main refuses a run now without an office and never stamps one it could not send', () => {
  // Value: protects="fired just now" only after a job really went out; fails_when=the office check moves after sendMission or goes away
  const handler = runNowHandler();
  assert.match(handler, /if \(typeof id !== 'string'\) return \{ ok: false, error: 'invalid id' \};/);
  assert.match(handler, /if \(!hive\.enabled\(\)\) return \{ ok: false, error: 'office not open' \};[\s\S]*runNowCheck\(readConfig\(\)\.missions \?\? \[\], id, Date\.now\(\)\)[\s\S]*sendMission/);
});

test('the preload bridge exposes runMissionNow on the missions:runNow channel', () => {
  assert.match(src('src/preload/index.ts'), /runMissionNow: \(id: string\): Promise<\{ ok: boolean; error\?: string \}> =>\s*ipcRenderer\.invoke\('missions:runNow', id\)/);
});

test('the row offers Run now on jobs only, and only once its edits are saved', () => {
  // Value: protects=Run now never sends the old text while the owner's edit sits unsaved, and never shows on the heartbeat; fails_when=the guard or the disabled state is dropped
  const row = src('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(row, /const canRunNow = !heartbeat && \(mission\.kind \?\? 'dispatch'\) === 'dispatch';/);
  assert.match(row, /disabled=\{busy \|\| runState === 'sending' \|\| dirty\}/);
  assert.match(row, /window\.cth\.runMissionNow\(mission\.id\)/);
});

test('an unsaved edit outranks an earlier run\'s answer, and that answer clears', () => {
  // Value: protects=the row says why Run now is off, and never leaves "less than a minute ago" up after the minute; fails_when=the status line puts justRan ahead of dirty, or justRan has no timer; why_new=live test on macOS, 2026-10-15
  const row = src('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(row, /\{dirty \? t\('schedulesSection\.runNowSaveFirst'\)\s*: runState === 'sent'/);
  assert.match(row, /if \(runState !== 'sent' && runState !== 'justRan'\) return;/);
});

test('every Run now string exists in every shipped language, without dashes', () => {
  const keys = ['runNow', 'runNowAria', 'runNowSending', 'runNowSent', 'runNowJustRan', 'runNowFailed', 'runNowSaveFirst'];
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const section = JSON.parse(src(`src/renderer/src/i18n/locales/${lang}.json`)).schedulesSection;
    for (const k of keys) {
      assert.equal(typeof section[k], 'string', `${lang}.${k}`);
      assert.ok(section[k].trim(), `${lang}.${k} is not empty`);
      assert.doesNotMatch(section[k], /[–—]| - /, `${lang}.${k} has no dash`);
    }
    assert.match(section.runNowAria, /\{\{job\}\}/, `${lang} names the job for a screen reader`);
    assert.match(section.runNowSent, /\{\{name\}\}/, `${lang} names who got it`);
  }
});
