'use strict';

/**
 * A schedule says when and which job (owner, 2026-09-25): its label names the
 * job and the agent does it the way its Work style says. Since 2026-10-02 a job
 * also has a focus area (docs/designs/schedule-focus-areas.md): what to
 * concentrate on in that run, sent only in its run message (FA2). An older
 * schedule's prompt rides along until the owner writes a focus (FA4), and is
 * never silently dropped.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { scheduledRunBody } = loadTs('src/shared/scheduleMessage.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('every run sends the job name and points at the Work style, with a way to stay quiet', () => {
  const body = scheduledRunBody('  Weekly money summary ');
  assert.equal(body, 'Scheduled run: Weekly money summary.\nDo it the way your Work style and your saved procedures say. If there is nothing to do, stop without messaging anyone.');
  assert.doesNotMatch(body, /[\u2013\u2014]/);
});

test('an older schedule\'s prompt is still sent, labelled, until the owner clears it', () => {
  const body = scheduledRunBody('Email triage', 'Check Gmail and flag anything urgent.');
  assert.match(body, /Older instructions the owner gave this schedule:\nCheck Gmail and flag anything urgent\.$/);
  assert.doesNotMatch(body, /move into your Work style/, 'that action no longer exists');
});

test('a job\'s focus area comes with its run, for that run only, and never silences the owner\'s older prompt', () => {
  // Value: protects=FA2 and FA4, the focus is in front of the agent exactly when its job runs, and a focus a team member asked for cannot drop what the owner wrote; fails_when=the focus is dropped, loses its "this run only" scope, or the older prompt stops going out once a focus exists; why_new=focus areas, red team 2026-10-03; seam=none
  const body = scheduledRunBody('Check emails', 'old words', ' Unread mail from customers first. ');
  assert.equal(body, [
    'Scheduled run: Check emails.',
    'Focus for this run, within your Work style: Unread mail from customers first.',
    'It applies to this run only.',
    'Do it the way your Work style and your saved procedures say. If there is nothing to do, stop without messaging anyone.',
    '',
    'Older instructions the owner gave this schedule:',
    'old words'
  ].join('\n'));
});

test('the scheduler sends that message, and the Schedules card has no prompt for new schedules', () => {
  const main = read('src/main/index.ts');
  assert.equal((main.match(/body: scheduledRunBody\(m\.label, m\.body, m\.focus\)/g) ?? []).length, 1, 'the launch standup');
  assert.match(main, /const payload = firePayload\(m\);/, 'the timer sends what firePayload builds');
  assert.match(read('src/shared/missions.ts'), /body: m\.relay \? relayRunBody\(m\.label, m\.body, m\.focus\) : scheduledRunBody\(m\.label, m\.body, m\.focus\)/);
  const ui = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(ui, /if \(!cleanLabel \|\| !whenIsUsable \|\| !cleanedFocus\) return;/, 'a new job needs its name, its times and its focus area (FA1)');
  assert.doesNotMatch(ui, /goesTo/, 'a schedule belongs to its agent, so there is no "goes to"');
  assert.match(ui, /mission\.focus \?\? \(mission\.kind === 'heartbeat' \? '' : mission\.body\.trim\(\)\)/, 'an older prompt is the starting focus text (FA4)');
  assert.match(ui, /data-add-focus/, 'a job without a focus area says so on its row (FA4)');
  assert.match(ui, /\{heartbeat && \(\s*<Field label=\{t\('schedulesSection\.prompt'\)\}>/, 'the heartbeat keeps its box for now');
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json'));
  assert.match(en.jobChange.howWorksInfo, /scheduled jobs included/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of ['labelHint', 'focus', 'focusPlaceholder', 'focusConflict', 'focusFromOlder', 'addFocus', 'checking', 'saveAnyway']) assert.ok(d.schedulesSection[k], `${loc} ${k}`);
  }
});

test('voice-created schedules take a job name and its focus area, not a prompt', () => {
  const actions = read('src/renderer/src/realtime/actions.ts');
  assert.match(actions, /required: \['label', 'focus'\],/);
  const main = read('src/main/realtimeActions.ts');
  assert.match(main, /to: targetId,\n\s*body: '',\n\s*focus,/);
  assert.match(main, /What should the "\$\{label\}" run focus on each time\?/, 'asks when the focus is missing');
});
