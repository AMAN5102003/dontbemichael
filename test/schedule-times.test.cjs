'use strict';

/**
 * One job, several "when" lines (owner, 2026-09-27: "every 2 hours on weekdays
 * and 2 pm on weekends"). src/shared/scheduleTimes.ts plus how missions.ts,
 * main's timer and the editor use it. Times are local: the dates below are
 * built with the local Date constructor, like the scheduler does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const T = loadTs('src/shared/scheduleTimes.ts');
const M = loadTs('src/shared/missions.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime(); // Sep 2026: 26 Sat, 27 Sun, 28 Mon
const H = 3_600_000;
const owners = [
  { kind: 'every', everyMs: 2 * H, days: [1, 2, 3, 4, 5], from: 8 * 60, to: 18 * 60 },
  { kind: 'at', days: [0, 6], minute: 14 * 60 }
];

test('lines are made canonical; a bad line spoils the set', () => {
  assert.deepEqual(T.normalizeTimes(owners), owners);
  assert.deepEqual(T.normalizeLine({ kind: 'every', everyMs: H, days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 1439 }), { kind: 'every', everyMs: H }, 'all days, all day is plain');
  assert.equal(T.normalizeTimes([...owners, { kind: 'every', everyMs: 2 * 86_400_000 }]), null, 'every is at most a day in a line');
  assert.equal(T.normalizeTimes([{ kind: 'every', everyMs: H, from: 600, to: 500 }]), null, 'window ends before it starts');
  assert.equal(T.normalizeTimes([{ kind: 'at', days: [], minute: 60 }]), null);
  assert.equal(T.normalizeTimes([]), null);
});

test('every 2h on weekdays 08:00 to 18:00 plus weekends at 14:00', () => {
  // Sunday morning: next is Sunday 14:00, then Monday 08:00, 10:00 ...
  assert.equal(T.nextTimesFireMs(owners, at(27, 9)), at(27, 14));
  assert.equal(T.nextTimesFireMs(owners, at(27, 14)), at(28, 8));
  assert.equal(T.nextTimesFireMs(owners, at(28, 8)), at(28, 10));
  assert.equal(T.nextTimesFireMs(owners, at(28, 17, 59)), at(28, 18));
  assert.equal(T.nextTimesFireMs(owners, at(28, 18)), at(29, 8), 'nothing after 18:00');
  assert.equal(T.previousTimesFireMs(owners, at(28, 11)), at(28, 10));
});

test('a missed slot runs once when the app opens, never as a backlog', () => {
  // Closed at 21:00 Friday, opened 07:15 Monday: nothing to catch up, wait for 08:00.
  assert.equal(T.timesDelayMs(owners, at(28, 7, 15), at(25, 18)), at(28, 8) - at(28, 7, 15));
  // Opened 09:30 Monday, the 08:00 slot never ran: one run now.
  assert.equal(T.timesDelayMs(owners, at(28, 9, 30), at(27, 14)), 0);
  // ...and after it ran, the next wait is to 10:00.
  assert.equal(T.timesDelayMs(owners, at(28, 9, 31), at(28, 9, 30)), at(28, 10) - at(28, 9, 31));
});

test('the lines read as words', () => {
  assert.equal(T.formatTimes(owners), 'every 2h weekdays 08:00 to 18:00, weekends at 14:00');
  assert.equal(T.formatLine({ kind: 'every', everyMs: 30 * 60_000, days: [1, 3] }), 'every 30m Mon, Wed');
});

test('the schedule list reads the lines in the owner\'s language; Michael still reads English', () => {
  const zh = {
    day: (d) => ['日', '一', '二', '三', '四', '五', '六'][d],
    everyDay: '每天', weekdays: '工作日', weekends: '周末',
    list: (items) => items.join('、'),
    and: (items) => (items.length > 1 ? `${items.slice(0, -1).join('、')}和${items[items.length - 1]}` : items[0]),
    at: (days, time) => `${days} ${time}`,
    every: (interval) => `每 ${interval}`,
    span: (from, to) => `${from}至${to}`
  };
  assert.equal(T.formatTimes(owners, zh), '每 2h 工作日 08:00至18:00、周末 14:00');
  assert.equal(T.formatTimes([{ kind: 'at', days: [1, 3], minute: 480 }, { kind: 'at', days: [1, 3], minute: 840 }], zh), '一、三 08:00和14:00');
  assert.equal(T.formatTimes(owners, T.ENGLISH_WHEN), T.formatTimes(owners), 'English is the default');
  assert.equal(M.whenWords({ intervalMs: 0, times: owners }), 'every 2h weekdays 08:00 to 18:00, weekends at 14:00', 'messages to Michael stay English');
  const list = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(list, /const words = whenWords\(t, i18n\.language\);/);
  assert.doesNotMatch(list, /formatWeekly/, 'a weekly job is worded through the same words');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const s = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).schedulesSection;
    for (const k of ['whenWeekends', 'whenAt', 'whenAnd', 'whenSpan', 'whenSep']) assert.ok(s[k], `${loc}: ${k}`);
  }
});

test('agents ask for several times in one request, and the old forms still work', () => {
  const both = M.parseWhen([{ every: '2h', days: ['weekdays'], between: ['08:00', '18:00'] }, { days: ['weekends'], at: '14:00' }]);
  assert.deepEqual(both.times, owners);
  assert.deepEqual(M.parseWhen({ every: '3d' }), { intervalMs: 3 * 86_400_000 }, 'plain every keeps its long range');
  assert.deepEqual(M.parseWhen({ days: ['fri'], at: '09:00' }), { intervalMs: 86_400_000, weekly: { days: [5], minute: 540 } });
  assert.deepEqual(M.parseWhen([{ every: '1h' }]), { intervalMs: H }, 'one plain line is stored the old way');
  assert.equal(M.parseWhen([{ every: '2h', between: ['18:00', '08:00'] }]), null);
  assert.equal(M.parseWhen([{ every: '2h' }, { days: ['xyz'], at: '09:00' }]), null);
});

test('an approved request with times adds or updates one schedule with them', () => {
  const missions = [{ id: 'm1', label: 'Check Emails', intervalMs: 2 * H, to: 'nick', body: '', enabled: true, createdBy: 'owner' }];
  const add = M.buildScheduleRequest('nick', { op: 'add', label: 'Check Emails', when: [{ every: '2h', days: ['weekdays'], between: ['08:00', '18:00'] }, { days: ['weekends'], at: '14:00' }], focus: 'Customer mail' }, missions, 'god', 1, 'r1', 'why');
  assert.equal(add.ok, true);
  const added = M.applyScheduleRequest(add.request, missions, 'm2');
  assert.deepEqual(added.missions[1].times, owners);
  const upd = M.buildScheduleRequest('nick', { op: 'update', id: 'm1', when: [{ days: ['weekdays'], at: '08:00' }, { days: ['weekdays'], at: '14:00' }] }, missions, 'god', 1, 'r2', 'why');
  const updated = M.applyScheduleRequest(upd.request, missions, 'x').missions[0];
  assert.equal(updated.times.length, 2);
  // Back to one plain line clears the extra lines.
  const back = M.buildScheduleRequest('nick', { op: 'update', id: 'm1', when: { every: '4h' } }, [updated], 'god', 1, 'r3', 'why');
  const plain = M.applyScheduleRequest(back.request, [updated], 'x').missions[0];
  assert.equal(plain.times, undefined);
  assert.equal(plain.intervalMs, 4 * H);
});

test('the timer plan, next run and fingerprint know about times', () => {
  const m = { id: 'm', label: 'Check Emails', intervalMs: 2 * H, times: owners, to: 'nick', body: '', enabled: true };
  const plan = M.armPlan(m, at(27, 9), { standupId: 's', standupFiredThisLaunch: true });
  assert.equal(plan.type, 'times');
  assert.equal(plan.firstDelayMs, at(27, 14) - at(27, 9));
  assert.equal(M.nextRunAt(m, at(27, 9)), at(27, 14));
  const old = { id: 'o', label: 'Check Emails', intervalMs: 2 * H, to: 'nick', body: '', enabled: true };
  assert.equal(M.missionFingerprint(old), JSON.stringify(['Check Emails', 2 * H, '', true]), 'rows without times keep their fingerprint');
  assert.notEqual(M.missionFingerprint(m), M.missionFingerprint(old));
  // An upsert without times drops them.
  const list = M.upsertMission([m], { ...m, times: undefined });
  assert.equal('times' in list[0], false);
});

test('main arms times like weekly, refuses bad lines, and agents are told how to ask', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /if \(plan\.type === 'weekly' \|\| plan\.type === 'times'\) \{/);
  assert.match(main, /plan\.type === 'times' \? timesDelayMs\(plan\.times, now, floor\) : weeklyDelayMs\(plan\.weekly, now, floor\)/);
  assert.match(main, /if \(!times\) return \{ ok: false, error: 'invalid schedule times' \};/);
  assert.match(read('src/main/hive.ts'), /One job can have several: \\`"when": \[/);
  const list = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(list, /<WhenLines lines=\{lines\} onChange=\{setLines\} \/>/);
  assert.match(list, /if \(times\) return formatTimes\(times, words\);/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const u = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).triggersUi;
    for (const k of ['addTime', 'removeTime', 'onlyBetween', 'and', 'windowHint', 'timeN']) assert.ok(u[k], `${loc}: ${k}`);
  }
});

test('a day an every line runs on belongs to it alone (owner, 2026-09-27)', () => {
  const clash = [{ kind: 'every', everyMs: 2 * H, days: [1, 2, 3, 4, 5, 6] }, { kind: 'at', days: [0, 6], minute: 840 }];
  assert.deepEqual(T.clashingDays(clash), [6]);
  assert.equal(T.normalizeTimes(clash), null, 'refused on save and in agent requests');
  assert.equal(M.parseWhen([{ every: '2h', days: ['mon', 'sat'] }, { days: ['weekends'], at: '14:00' }]), null);
  // Several "on days" lines may share a day.
  assert.deepEqual(T.clashingDays([{ kind: 'at', days: [1, 2, 3, 4, 5], minute: 480 }, { kind: 'at', days: [1, 2, 3, 4, 5], minute: 840 }]), []);
  // What each line's picker greys out.
  assert.deepEqual(T.daysTakenFor(owners, 0), [0, 6]);
  assert.deepEqual(T.daysTakenFor(owners, 1), [1, 2, 3, 4, 5]);
  assert.deepEqual(T.daysTakenFor([{ kind: 'at', days: [1], minute: 1 }, { kind: 'at', days: [1], minute: 2 }], 0), []);
  const ui = read('src/renderer/src/components/triggers/WhenLines.tsx');
  assert.match(ui, /const taken = \(i: number\) => daysTakenFor\(lines, i\);/);
  assert.match(ui, /disabled=\{blocked\}/);
  assert.match(ui, /t\('triggersUi\.daysClash'/);
  assert.match(read('src/renderer/src/components/triggers/ui.tsx'), /taken\?: number\[\];/);
});

test('a request carries its reason, and one without is not sent (owner, 2026-09-27)', () => {
  const none = M.buildScheduleRequest('nick', { op: 'add', label: 'Check Emails', when: { every: '2h' }, focus: 'Customer mail' }, [], 'god', 1, 'r');
  assert.equal(none.ok, false);
  assert.match(none.reason, /Say why in the message "body"/);
  const ok = M.buildScheduleRequest('nick', { op: 'add', label: 'Check Emails', when: { every: '2h' }, focus: 'Customer mail' }, [], 'god', 1, 'r', '  Quiet   mailbox. ');
  assert.equal(ok.request.reason, 'Quiet mailbox.');
  const card = read('src/renderer/src/components/ScheduleRequestCards.tsx');
  assert.match(card, /t\('askMe\.scheduleWhy', \{ reason: req\.reason \}\)/);
  assert.match(read('src/main/hive.ts'), /this\.scheduleRequestHandler\(id, schedule, typeof msg\.body === 'string' \? msg\.body : ''\)/);
});

test('two requests from one agent about one job become one card (owner, 2026-09-27)', () => {
  const missions = [{ id: 'm1', label: 'Check Emails', intervalMs: 2 * H, to: 'nick', body: '', enabled: true, createdBy: 'owner' }];
  const why = 'Twice daily, agreed with Michael.';
  const upd = M.buildScheduleRequest('nick', { op: 'update', id: 'm1', when: { days: ['weekdays'], at: '08:00' } }, missions, 'god', 1, 'r1', why).request;
  const add = M.buildScheduleRequest('nick', { op: 'add', label: 'Check Emails', when: { days: ['weekdays'], at: '14:00' }, focus: 'Customer mail' }, missions, 'god', 2, 'r2', why).request;
  const filed = M.fileScheduleRequest([upd], add, missions);
  assert.equal(filed.length, 1);
  assert.equal(filed[0].op, 'update');
  assert.equal(filed[0].missionId, 'm1');
  assert.deepEqual(filed[0].draft.times, [{ kind: 'at', days: [1, 2, 3, 4, 5], minute: 480 }, { kind: 'at', days: [1, 2, 3, 4, 5], minute: 840 }]);
  assert.equal(filed[0].reason, why, 'the same reason once');
  assert.equal(T.formatTimes(filed[0].draft.times), 'weekdays at 08:00 and 14:00');
  // Approving it gives one schedule at both times.
  const applied = M.applyScheduleRequest(filed[0], missions, 'x').missions;
  assert.equal(applied.length, 1);
  assert.equal(applied[0].times.length, 2);
  // Another agent, or another job, stays its own card.
  const other = M.buildScheduleRequest('pam', { op: 'add', label: 'Check Emails', when: { every: '1h' }, focus: 'f' }, missions, 'god', 3, 'r3', 'x').request;
  assert.equal(M.fileScheduleRequest(filed, other, missions).length, 2);
  // Folding requests filed before merging existed.
  assert.equal(M.foldScheduleRequests([upd, add], missions).length, 1);
  // A pause after a change about the same job replaces it: the latest intent.
  const pause = M.buildScheduleRequest('nick', { op: 'pause', id: 'm1' }, missions, 'god', 4, 'r4', 'Mailbox moved.').request;
  const replaced = M.fileScheduleRequest(filed, pause, missions);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].op, 'pause');
  const main = read('src/main/index.ts');
  assert.match(read('src/main/scheduleRequests.ts'), /const filed = fileScheduleRequest\(before, built\.request, cfg\.missions \?\? \[\]\);/);
  assert.match(main, /const folded = foldScheduleRequests\(pending, cfg\.missions \?\? \[\]\);/);
});

test('Michael decides team members\' schedule requests; the owner sees only what he passes on (owner, 2026-09-27)', () => {
  const main = read('src/main/index.ts');
  const requests = read('src/main/scheduleRequests.ts');
  const intake = requests.slice(requests.indexOf('function receiveScheduleRequest('), requests.indexOf('function tellMichaelAboutRequest('));
  assert.match(intake, /if \(actor === godId && \(op === 'approve' \|\| op === 'decline' \|\| op === 'ask-owner' \|\| op === 'pending'\)\)/);
  assert.match(intake, /tellMichaelAboutRequest\(request, cfg\.missions \?\? \[\]\);/);
  assert.doesNotMatch(intake, /ownerToast/, 'a new request no longer pings the owner');
  assert.match(intake, /if \(actor === godId\) \{[\s\S]{0,200}applyScheduleRequest\(built\.request/, "Michael's own changes apply at once");
  const decide = requests.slice(requests.indexOf('function michaelDecides('), requests.indexOf('function decideScheduleRequest('));
  assert.match(decide, /if \(!note\) return 'Add a "note" saying what you can\\'t settle/);
  assert.match(decide, /escalated: true, escalation: note/);
  assert.match(main, /try \{ sweepScheduleRequests\(\); \}/, 'waiting requests reach Michael, then the owner');
  const cards = read('src/renderer/src/components/ScheduleRequestCards.tsx');
  // The shared Needs you feed is the one reader of schedule requests.
  assert.match(read('src/renderer/src/shell/useNeedsYou.ts'), /publish\(\{ requests: all\.filter\(\(r\) => r\.escalated\) \}\)/);
  assert.match(cards, /t\('askMe\.scheduleMichael', \{ name: godName, note: req\.escalation \}\)/);
  const missions = [{ id: 'm1', label: 'Check Emails', intervalMs: 2 * H, to: 'nick', body: '', enabled: true }];
  const req = M.buildScheduleRequest('nick', { op: 'update', id: 'm1', when: [{ days: ['weekdays'], at: '08:00' }, { days: ['weekdays'], at: '14:00' }] }, missions, 'god', 1, 'r', 'why').request;
  assert.equal(M.requestSummary(req, missions), 'change "Check Emails" from every 2h to weekdays at 08:00 and 14:00');
});

test('merges keep a rename and a correction as asked; a joined request goes back to Michael (pre-landing review)', () => {
  const missions = [{ id: 'm1', label: 'Standup', intervalMs: 86_400_000, weekly: { days: [1, 2, 3, 4, 5], minute: 540 }, to: 'pam', body: '', enabled: true }];
  const b = (p, id) => M.buildScheduleRequest('pam', p, missions, 'god', 1, id, 'why').request;
  const time = b({ op: 'update', id: 'm1', when: { days: ['weekdays'], at: '08:00' } }, 'a');
  const rename = b({ op: 'update', id: 'm1', label: 'Morning standup' }, 'b');
  const renamed = M.fileScheduleRequest([time], rename, missions)[0];
  assert.equal(renamed.draft.label, 'Morning standup');
  assert.deepEqual(renamed.draft.weekly, { days: [1, 2, 3, 4, 5], minute: 480 }, 'the new time stays, the old one is not added');
  const fix = b({ op: 'update', id: 'm1', when: { days: ['weekdays'], at: '10:00' } }, 'c');
  const corrected = M.fileScheduleRequest([time], fix, missions)[0];
  assert.deepEqual(corrected.draft.weekly, { days: [1, 2, 3, 4, 5], minute: 600 }, 'a correction replaces, it does not add');
  const escalated = { ...time, escalated: true, escalation: 'x', sentToMichael: true };
  const joined = M.fileScheduleRequest([escalated], fix, missions)[0];
  assert.equal(joined.escalated, undefined);
  assert.equal(joined.sentToMichael, undefined);
  const main = read('src/main/index.ts');
  const requests = read('src/main/scheduleRequests.ts');
  assert.match(requests, /if \(req\.escalated\) return 'That request is with the owner in ASK ME now/);
  assert.match(requests, /const overdue = pending\.filter\(\(r\) => !r\.escalated && r\.sentToMichael && at - \(r\.sentToMichaelAt \?\? r\.createdAt\) > MICHAEL_DECIDES_WITHIN_MS\);/);
  assert.match(main, /scheduleSweepTimer = setInterval\(/);
});

test('a schedule row is three quiet lines: name and next run, when, then who and when it fired (owner, 2026-10-01)', () => {
  const list = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  // A bold when chip beside the name cut it to "Check ...", and under the name
  // it broke the status mid phrase.
  assert.doesNotMatch(list, /WhenChip/);
  assert.match(list, /\}\}>\{mission\.label\}<\/span>\s*\{next && <span style=\{\{ flexShrink: 0[^}]*\}\}>\{next\}<\/span>\}/, 'the next run sits beside the name');
  assert.match(list, /<span style=\{\{ display: 'block'[^}]*fontSize: 14[^}]*\}\}>\{whenText\(mission, t\)\}<\/span>\s*\{sub && <span style=\{\{ display: 'block'[^}]*\}\}>\{sub\}<\/span>\}/, 'when on its own line, then the status');
  assert.doesNotMatch(/const sub = \[[^]*?\]\.filter/.exec(list)[0], /schedulesSection\.next/, 'the next run is not repeated in the status');
  // "added by you" was on every row and said nothing; only a team member's
  // request names who asked.
  assert.match(list, /const creator = !mission\.createdBy \|\| mission\.createdBy === OWNER \? ''/);
  assert.doesNotMatch(list, /addedByYou/);
  assert.match(list, /padding: readOnly \? '8px 0' : '8px 4px'/, 'read only rows line up with the name above');
  assert.match(list, /return \/\^\\d\/\.test\(every\) \? t\('schedulesSection\.everyInterval', \{ interval: every \}\) : every;/, 'an interval reads "every 4h", not a bare "4h", in every language');
});
