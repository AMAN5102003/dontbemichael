'use strict';

/**
 * Scheduled jobs read as scheduled jobs (docs/designs/edit-agent-scheduled-jobs.md):
 * a labelled group in Edit agent and on the Profile tab, each job with when it
 * runs, its focus and a Paused pill, its own states, and "Change on Access" to
 * where schedules are set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { orderedJobs } = loadTs('src/shared/missions.ts');
const { whenParts } = loadTs('src/shared/scheduleTimes.ts');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const HOUR = 3600_000;
const job = (id, o = {}) => ({ id, label: id, to: 'pam', body: '', intervalMs: HOUR, enabled: true, kind: 'dispatch', ...o });

test('jobs run soonest first, then running jobs with no next time, then paused ones', () => {
  // Value: protects=SJ5 order in Edit agent, Profile and Access; fails_when=paused jobs mix in or a soon job sinks; why_new=orderedJobs is new and shared; seam=none; no_claim=none beyond protects
  const now = 10 * HOUR;
  const jobs = [
    job('paused', { enabled: false, lastFiredAt: now - HOUR / 2 }),
    job('never-fired'),
    job('later', { lastFiredAt: now - HOUR / 4 }),
    job('soon', { lastFiredAt: now - HOUR + 60_000 }),
    job('paused-2', { enabled: false })
  ];
  assert.deepEqual(orderedJobs(jobs, now).map((m) => m.id), ['soon', 'later', 'never-fired', 'paused', 'paused-2']);
  assert.deepEqual(orderedJobs([], now), []);
  assert.equal(orderedJobs(jobs, now).length, jobs.length, 'nothing dropped');
  assert.match(read('src/renderer/src/components/triggers/ScheduleList.tsx'), /const ordered = orderedJobs\(mine, Date\.now\(\)\);/, 'the Access list orders the same way');
});

test('a when line breaks only between its parts, in every locale, and joins back to itself', () => {
  // Value: protects=R1, a time like 8:30 or "every 2h" never splits and nothing overflows; fails_when=parts cut inside a time or lose text; why_new=whenParts is new; seam=none; no_claim=no layout engine; wrapping itself is checked live
  const en = 'Weekdays at 8:30, 12:00 and 17:00, every 2h';
  assert.deepEqual(whenParts(en, ', ', ' and '), ['Weekdays at 8:30, ', '12:00', ' and 17:00, ', 'every 2h']);
  assert.equal(whenParts(en, ', ', ' and ').join(''), en);
  assert.deepEqual(whenParts('Every hour', ', ', ' and '), ['Every hour']);
  const zh = '工作日 8:30、12:00和17:00';
  assert.equal(whenParts(zh, '、', '和').join(''), zh);
  assert.deepEqual(whenParts(zh, '、', '和'), ['工作日 8:30、', '12:00', '和17:00']);
  const ar = 'أيام العمل الساعة 8:30، 12:00 و17:00';
  assert.equal(whenParts(ar, '، ', ' و').join(''), ar);
  const src = read('src/renderer/src/components/ScheduledJobs.tsx');
  assert.match(src, /\{parts\.map\(\(p, i\) => <span key=\{i\} style=\{\{ whiteSpace: 'nowrap' \}\}>\{p\}<\/span>\)\}/, 'each part stays whole');
});

test('the group: a heading with the count and an info icon, rows with when, focus and Paused, and its states', () => {
  // Value: protects=SJ1, SJ4 to SJ6 in the shared group; fails_when=the heading, count, pill, None yet or the failed read line goes, or Research shows a group; why_new=the group is new; seam=none; no_claim=source pins, not rendered
  const src = read('src/renderer/src/components/ScheduledJobs.tsx');
  assert.match(src, /role="group" aria-label=\{jobs\.length \? `\$\{title\}, \$\{jobs\.length\}` : title\}/);
  assert.match(src, /\{jobs\.length > 0 && <span style=\{\{ fontSize: 12, color: 'var\(--cth-ink-3\)' \}\}>\{jobs\.length\}<\/span>\}/);
  assert.match(src, /<InfoTip text=\{t\(office \? 'scheduledJobs\.infoOffice' : 'scheduledJobs\.info', \{ name \}\)\} label=\{title\} \/>/);
  assert.match(src, /const jobs = orderedJobs\(all, Date\.now\(\)\);/);
  assert.match(src, /fontFamily: 'var\(--cth-font-mono\)'/, 'the when line in mono (DESIGN.md)');
  assert.match(src, /\{off && <span style=\{pausedPill\}>\{t\('scheduledJobs\.paused'\)\}<\/span>\}/);
  assert.match(src, /WebkitLineClamp: 2/, 'focus cut at two lines');
  assert.match(src, /status === 'error' \? \(\s*<div role="alert"[^>]*>\s*\{t\('scheduledJobs\.loadError'\)\}\{' '\}\s*<button type="button" onClick=\{retry\}/);
  assert.match(src, /status === 'ready' && jobs\.length === 0 \? \(\s*<span style=\{\{ fontSize: 12\.5, color: 'var\(--cth-ink-3\)' \}\}>\{t\('scheduledJobs\.none'\)\}<\/span>/);
  assert.match(src, /status === 'ready' && jobs\.length === 0 \? t\('scheduledJobs\.addOnAccess'\) : t\('scheduledJobs\.changeOnAccess'\)/);
  assert.match(src, /if \(agentId === RESEARCH_ID\) return null;/, 'Research holds no schedules');
  assert.match(src, /flexWrap: 'wrap'/, 'the when line drops under a long name (SJ7)');
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const sj = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).scheduledJobs;
    for (const k of ['title', 'info', 'infoOffice', 'changeOnAccess', 'addOnAccess', 'changeOnOffice', 'none', 'loadError', 'tryAgain', 'paused', 'noFocus']) {
      assert.ok(sj[k], `${loc} ${k}`);
      assert.doesNotMatch(sj[k], /[—–]| - /, `${loc} ${k} has no dashes`);
    }
  }
});

test('Change on Access closes Edit agent through its question, then opens On a schedule once', () => {
  // Value: protects=SJ3 lands on the schedules, a typed change is never lost, Keep editing goes nowhere, and the unfold happens once; fails_when=the link skips the leave guard, the request isn't keyed or cleared, or the scroll runs before the group exists; why_new=the one-shot request is new; seam=none; no_claim=source pins on store, Edit agent and Access, not a rendered click
  const edit = read('src/renderer/src/components/EditAgentModal.tsx');
  const go = edit.slice(edit.indexOf('const goToSchedules ='), edit.indexOf('const keepEditing ='));
  assert.match(go, /if \(dirtyRef\.current\) \{ afterClose\.current = go; setAsking\('close'\); return; \}/);
  assert.match(go, /onClose\(\);\s*go\(\);/);
  assert.match(go, /if \(!docked\) useStore\.getState\(\)\.setFullscreen\(null\);/);
  assert.match(edit, /const keepEditing = \(\): void => \{ afterClose\.current = null;/, 'Keep editing drops it');
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /openSchedules: \(agentId\) => \{\s*get\(\)\.setSidebarTab\('capabilities'\);\s*set\(\(s\) => \(\{ schedulesRequest: \{ agentId, seq: \(s\.schedulesRequest\?\.seq \?\? 0\) \+ 1 \} \}\)\);/);
  const caps = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(caps, /if \(!schedulesRequest \|\| schedulesRequest\.agentId !== agent\.id\) return;\s*clearSchedulesRequest\(\);\s*setCollapsed\(\(c\) => \(\{ \.\.\.c, schedules: false \}\)\);/);
  assert.match(caps, /if \(!scrollToSchedules \|\| !schedulesRef\.current\) return;/, 'waits for the group to exist');
  assert.ok(caps.indexOf('if (!scrollToSchedules') < caps.indexOf('if (!config) return null;'), 'the scroll hook runs before the early return');
  assert.match(caps, /<div ref=\{schedulesRef\} data-schedules-group/);
});

test('the Profile tab uses the same group; Michael\'s goes to his Office schedule', () => {
  // Value: protects=one design on both tabs and a working link for Michael; fails_when=Profile keeps its old list or Michael's link points at Access; why_new=T3; seam=none; no_claim=source pins
  const profile = read('src/renderer/src/components/ProfileTab.tsx');
  assert.match(profile, /<ScheduledJobsList agentId=\{agentId\} name=\{name\} heading="section" office=\{god\} onChange=\{god \? \(\) => requestTab\('triggers'\) : undefined\} \/>/);
  assert.match(read('src/renderer/src/components/CommandCenterPanel.tsx'), /\{ key: 'triggers', labelKey: 'commandCenter\.tabs\.officeSchedule'/, 'triggers is the Office schedule tab');
});
