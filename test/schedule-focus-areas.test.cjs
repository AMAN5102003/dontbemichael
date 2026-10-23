'use strict';

/**
 * Scheduled jobs carry a focus area, kept in the agent's Work style
 * (docs/designs/schedule-focus-areas.md, owner 2026-10-02, FA1 to FA4). The
 * focus is defined with the job, listed with the Work style, and sent only in
 * that job's run message, so the agent stays true to its Work style everywhere
 * else.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const M = loadTs('src/shared/missions.ts');
const W = loadTs('src/shared/workStyleText.ts');
const { MICHAEL_WORK_STYLE, effectiveWorkStyle } = loadTs('src/shared/michaelWorkStyle.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const job = (extra) => ({ id: 'm1', label: 'Check emails', intervalMs: 3_600_000, to: 'pam', body: '', enabled: true, createdBy: 'owner', ...extra });

test('the session Work style lists each job by name and time, never its focus', () => {
  // Value: protects=FA2, a focus never reaches the agent outside its run; fails_when=the focus text leaks into the session goal, a paused or heartbeat job is listed, or Michael's 'god' jobs are missed; why_new=new goal block; seam=none
  const missions = [
    job({ focus: 'SECRET FOCUS' }),
    job({ id: 'm2', label: 'Weekly report', weekly: { days: [5], minute: 540 }, intervalMs: 86_400_000 }),
    job({ id: 'm3', label: 'Paused one', enabled: false }),
    job({ id: 'hb', label: 'Heartbeat', kind: 'heartbeat' }),
    job({ id: 's', label: 'Hourly ops standup', to: 'god' })
  ];
  const block = M.scheduledJobsBlock(missions, 'pam', 'god-1');
  assert.match(block, /^### Scheduled jobs\n- Check emails: every 1h\n- Weekly report: Fri at 09:00\n/);
  assert.match(block, /Each job's focus comes with its run message and applies to that run only\./);
  assert.doesNotMatch(block, /SECRET FOCUS|Paused one|Heartbeat/);
  assert.match(M.scheduledJobsBlock(missions, 'god-1', 'god-1'), /- Hourly ops standup: every 1h/);
  assert.equal(M.scheduledJobsBlock(missions, 'oscar', 'god-1'), null, 'no jobs, nothing added');
});

test('the hook goal is the Work style, Michael\'s default when he has none, plus the jobs', () => {
  // Value: protects=F3 and F6 reach the agent; fails_when=the hook goes back to the roster goal alone or Michael runs with no Work style; why_new=new wiring; seam=source pin, main has no harness for the hook provider
  const main = read('src/main/index.ts');
  assert.match(main, /const own = standingGoalFromRoster\(agentId\) \?\? \(agentId === godId \? MICHAEL_WORK_STYLE : null\);/);
  assert.match(main, /scheduledJobsBlock\(readConfig\(\)\.missions \?\? \[\], agentId, godId\)/);
  assert.match(main, /\n  standingGoalFor,\n/);
  assert.equal(effectiveWorkStyle({ isGod: true }), MICHAEL_WORK_STYLE);
  assert.equal(effectiveWorkStyle({ isGod: true, goal: ' Mine. ' }), 'Mine.', 'the owner\'s edit wins');
  assert.equal(effectiveWorkStyle({ goal: '' }), '', 'a team member has no default');
  assert.match(MICHAEL_WORK_STYLE, /^The owner set this work style/);
  assert.match(MICHAEL_WORK_STYLE, /### The job\n[\s\S]*### How to work\n/);
  assert.doesNotMatch(MICHAEL_WORK_STYLE, /[–—]| - /, 'no dashes');
});

test('the standup has a focus area for every install, and an older office gets it once', () => {
  // Value: protects=F6, Michael's standup how lives in its focus (close owner requests, then the floor); fails_when=new installs ship it empty, the migration overwrites an owner's text, or it repeats; why_new=new default; seam=source pin
  const cfg = read('src/main/config.ts');
  assert.match(cfg, /export const OPS_STANDUP_FOCUS =\n  'First close your open requests from the owner/);
  assert.match(cfg, /focus: OPS_STANDUP_FOCUS,/);
  const main = read('src/main/index.ts');
  assert.match(main, /const seed = !cfg6\.standupFocusSeeded;/);
  assert.match(main, /if \(seed && !m\.focus && !\(m\.body \?\? ''\)\.trim\(\)\) return \{ \.\.\.m, focus: OPS_STANDUP_FOCUS \};/);
  assert.match(main, /writeConfig\(\{ missions: after, \.\.\.\(seed \? \{ standupFocusSeeded: true \} : \{\}\) \}\);/);
  assert.doesNotMatch(read('src/main/hive.ts'), /At the hourly ops standup, review every team member/, 'the standup how moved into its focus');
});

test('an agent can set or change a job\'s focus by request, and Michael reads it on the card', () => {
  // Value: protects=FA1 for agent requests; fails_when=an update with only a focus is refused, a focus is lost on approval, or the summary hides it; why_new=new request field; seam=none
  const missions = [job()];
  const r = M.buildScheduleRequest('pam', { op: 'update', id: 'm1', focus: 'Customer mail first' }, missions, 'god', 1, 'r1', 'why');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(M.requestSummary(r.request, missions), 'set the focus of "Check emails" to "Customer mail first"');
  const applied = M.applyScheduleRequest(r.request, missions, 'x').missions[0];
  assert.deepEqual([applied.focus, applied.intervalMs, applied.label], ['Customer mail first', 3_600_000, 'Check emails']);
  const kept = M.buildScheduleRequest('pam', { op: 'update', id: 'm1', when: { every: '2h' } }, [applied], 'god', 2, 'r2', 'why').request;
  assert.equal(M.applyScheduleRequest(kept, [applied], 'x').missions[0].focus, 'Customer mail first', 'a timing change keeps the focus');
  assert.equal(M.missionFingerprint(job()), M.missionFingerprint(job({ focus: undefined })), 'no focus, the old fingerprint: pending requests stay valid');
  assert.notEqual(M.missionFingerprint(job()), M.missionFingerprint(job({ focus: 'x' })));
  assert.match(read('src/main/hive.ts'), /- \\`focus\\`: what to concentrate on when this job runs, within your Work style/);
});

test('a focus area is checked against the Work style and the other jobs; an unreadable answer never blocks', () => {
  // Value: protects=FA3, a focus may narrow the work, never widen duties or contradict another job; fails_when=the prompt drops the work style or the other focus areas, a conflict loses its sentence, or garbage reads as a conflict; why_new=new check; seam=none
  const p = W.focusCheckPrompt({ name: 'Pam', job: 'Check emails', focus: 'Send replies yourself', workStyle: 'Draft replies only; the owner sends them.', others: [{ job: 'Inbox sweep', focus: 'Archive newsletters' }] });
  assert.match(p, /It conflicts when it asks for something the work style rules out or keeps for the owner.s approval, when it adds duties or permissions/);
  assert.match(p, /Draft replies only; the owner sends them\./);
  assert.match(p, /Inbox sweep: Archive newsletters/);
  assert.match(p, /--- NEW FOCUS AREA, for the job "Check emails" ---\nSend replies yourself$/);
  assert.deepEqual(W.parseFocusCheck('OK'), { ok: true });
  assert.deepEqual(W.parseFocusCheck('CONFLICT:  It sends replies, but the work style keeps sending for the owner. '), { ok: false, conflict: 'It sends replies, but the work style keeps sending for the owner.' });
  assert.equal(W.parseFocusCheck('Sure! Here is my analysis'), null);
  const ui = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(ui, /if \(conflict !== null\) \{ setConflict\(null\); return true; \} \/\/ "Save anyway"/, 'a named conflict can be saved anyway');
  assert.match(ui, /catch \{\n\s*return true;/, 'a check that fails lets the save go ahead');
  assert.match(read('src/main/workStyleConvert.ts'), /return \{ checked: false \};/);
});

test('Profile and Edit agent show each job with its focus, read only', () => {
  // Value: protects=FA1, the focus is visible with the Work style but edited on its job; fails_when=the section disappears or becomes editable there; why_new=new UI; seam=source pin
  const list = read('src/renderer/src/components/ScheduledJobs.tsx');
  // Each job's focus under its name, read only (edit-agent-scheduled-jobs.md, SJ5).
  assert.match(list, /\{job\.focus\?\.trim\(\) \? \(\s*<span style=\{\{ \.\.\.focusStyle, color: off \? 'var\(--cth-ink-3\)' : 'var\(--cth-ink-2\)' \}\}>\{job\.focus\}<\/span>/);
  assert.doesNotMatch(list, /<textarea|<input/);
  assert.match(list, /color: 'var\(--cth-ink-3\)' \}\}>\{t\('scheduledJobs\.noFocus'\)\}<\/span>/, 'a quiet note, not a call to act on a read only list');
  assert.match(read('src/renderer/src/components/WorkStyleUpdateCards.tsx'), /<InfoTip text=\{t\('askMe\.workStyleReplaces', \{ name \}\)\}/, 'the detail sits behind an info icon');
  assert.match(read('src/renderer/src/components/ProfileTab.tsx'), /<ScheduledJobsSection agentId=\{agent\.id\} name=\{name\} god=\{god\} \/>/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    assert.ok(d.scheduledJobs.title && d.scheduledJobs.focus.includes('{{focus}}') && d.scheduledJobs.noFocus, loc);
  }
});
