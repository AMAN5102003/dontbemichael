'use strict';

/**
 * Starter job suggestions in an empty schedule tab (per-agent-schedules.md 5A).
 * The business's pack chooses the job; the owner's click saves it paused.
 *
 * Contributor note: Thank you for the opportunity to contribute to this project.
 * It means a great deal to me and my family.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { starterSuggestionsFor, pausedStarterMission } = loadTs('src/shared/starterJobs.ts');

const hours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], work: { start: '09:00', end: '17:00' } };
const job = (agentId, title, schedule = 'mon 09:00') => ({ agentId, title, schedule, focus: `Check ${title.toLowerCase()}` });
const pack = (businessType, agents, starterMissions = []) => ({
  businessType, agents: agents.map((id) => ({ id })), officeHours: hours, starterMissions
});

test('suggest at most three valid and distinct jobs from the original agent’s office pack', () => {
  const core = pack('core', ['pam'], [job('pam', 'Core inbox')]);
  const own = pack('retail-shop', ['pam', 'kelly'], [
    job('kelly', 'Support inbox'),
    job('pam', 'Inbox zero'),
    job('pam', 'Daily follow ups'),
    job('pam', 'Weekly review'),
    job('pam', 'Fourth job'),
    job('pam', 'Inbox zero'),
    job('pam', 'Bad schedule', 'whenever needed')
  ]);
  const suggestions = starterSuggestionsFor([own, core], 'retail-shop', 'pam');
  assert.deepEqual(suggestions.map((s) => s.job.title), ['Inbox zero', 'Daily follow ups', 'Weekly review']);
  assert.ok(suggestions.every((s) => s.hours === hours), 'each job uses its own pack hours');
});

test('use a hired agent’s source card even when the office has a different business pack', () => {
  const own = pack('saas-consulting', ['pam'], [job('pam', 'SaaS inbox')]);
  const retail = pack('retail-shop', ['pam'], [job('pam', 'Store inbox')]);
  assert.deepEqual(
    starterSuggestionsFor([own, retail], 'saas-consulting', 'hire_42', 'retail-shop/pam').map((s) => s.job.title),
    ['Store inbox']
  );
  assert.deepEqual(starterSuggestionsFor([own, retail], 'saas-consulting', 'hire_42', 'retail-shop/other'), []);
  assert.deepEqual(starterSuggestionsFor([own, retail], 'saas-consulting', 'custom_agent'), []);
});

test('fall back to core only for an original agent absent from its business pack', () => {
  const own = pack('pro-services', ['pam', 'kelly'], [job('kelly', 'Support review')]);
  const core = pack('core', ['pam'], [job('pam', 'Core inbox')]);
  assert.deepEqual(starterSuggestionsFor([own, core], 'pro-services', 'pam').map((s) => s.job.title), ['Core inbox']);
  assert.deepEqual(starterSuggestionsFor([own, core], 'pro-services', 'god'), []);
});

test('adding one suggestion uses the existing schedule parser and saves it paused', () => {
  const suggestion = starterSuggestionsFor([pack('retail-shop', ['pam'], [job('pam', 'Inbox zero')])], 'retail-shop', 'pam')[0];
  const created = pausedStarterMission(suggestion, 'pam', [], 'god', () => 'm_suggested');
  assert.ok(created);
  assert.equal(created.id, 'm_suggested');
  assert.equal(created.label, 'Inbox zero');
  assert.equal(created.focus, 'Check inbox zero');
  assert.equal(created.to, 'pam');
  assert.equal(created.enabled, false, 'the first run must wait for the owner to enable it');
  assert.ok(created.weekly || created.times, 'keep the schedule read from the pack');
  assert.equal(pausedStarterMission(suggestion, 'pam', [created], 'god', () => 'm_duplicate'), null, 'never add the same job twice');
});

test('the empty state offers suggestions with a paused Add action in every supported locale', () => {
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const list = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  const capabilities = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(list, /mine\.length === 0 && suggestions\.length > 0/, 'suggestions stay out of populated tabs');
  assert.match(list, /pausedStarterMission\(/, 'the suggested save must be paused');
  assert.match(list, /upsertMission\(mission\)/, 'the click saves the mission in main');
  assert.match(capabilities, /businessType=\{config\.businessType\} sourceCard=\{agent\.sourceCard\}/, 'agent provenance is passed through');
  for (const locale of ['en', 'ar', 'zh-CN']) {
    const o = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`));
    assert.match(o.schedulesSection.suggestedJob, /\{\{title\}\}/);
    assert.match(o.schedulesSection.suggestedJob, /\{\{schedule\}\}/);
    assert.match(o.schedulesSection.addSuggestedJob, /\{\{title\}\}/);
  }
});
