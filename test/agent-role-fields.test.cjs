'use strict';

/**
 * Edit Agent shows the stored role as two fields, Role and Role description,
 * and the goal as Work Style (owner, 2026-09-24). The stored value stays one
 * string (`Role: description`, as setup writes it), because that is what the
 * registry, the floor card and Michael's roster read.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { splitAgentRole, joinAgentRole } = loadTs('src/shared/agentRole.ts');
const { teamMemberRole } = loadTs('src/shared/teamPlan.ts');

test('a pack role splits into its title and description, and joins back unchanged', () => {
  const stored = teamMemberRole({ role: 'Finance', summary: 'Keeps track of your overall finances: money in and money out.' });
  const parts = splitAgentRole(stored);
  assert.deepEqual(parts, { role: 'Finance', roleDescription: 'Keeps track of your overall finances: money in and money out.' });
  assert.equal(joinAgentRole(parts.role, parts.roleDescription), stored);
});

test('a short title alone is a role; a long sentence alone is a description', () => {
  assert.deepEqual(splitAgentRole('Bookkeeper'), { role: 'Bookkeeper', roleDescription: '' });
  const sentence = 'Answers every customer email within a day and keeps the inbox tidy';
  assert.deepEqual(splitAgentRole(sentence), { role: '', roleDescription: sentence });
});

test('a status caption is not a role', () => {
  for (const s of ['a fresh harness', 'on standby', 'idle', '', undefined]) {
    assert.deepEqual(splitAgentRole(s), { role: '', roleDescription: '' }, String(s));
  }
});

test('joining uses whichever field is filled, and nothing when both are empty', () => {
  assert.equal(joinAgentRole('Sales', ''), 'Sales');
  assert.equal(joinAgentRole('', 'Finds new clients'), 'Finds new clients');
  assert.equal(joinAgentRole('Sales:', ' Finds new clients '), 'Sales: Finds new clients');
  assert.equal(joinAgentRole('  ', ''), '');
});

test('Edit Agent shows Role, Role description and Work style, with plain notes', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/EditAgentModal.tsx'), 'utf8');
  // The rows are built once (roleRow to workStyleNotes) and laid out in one
  // column or, wide, in two (wide panel WD2).
  const briefing = src.slice(src.indexOf('const roleRow = ('), src.indexOf('const engine = ('));
  const side = src.slice(src.indexOf('<Fields id="briefing" grow>'), src.indexOf('</Fields>', src.indexOf('<Fields id="briefing" grow>')));
  assert.match(side, /\{roleRow\}\s*\{handlesRow\}\s*\{workStyleRow\}\s*\{schedules\}\s*\{workStyleNotes\}/, 'one column: role, what they handle, work style, then the jobs');
  for (const label of ["<Row label={t('editAgent.role')}>", "label={t('editAgent.handles', { name: who })}", "label={t('editAgent.workStyle')}"]) {
    assert.ok(briefing.includes(label), label);
  }
  assert.doesNotMatch(briefing, /label="Description"|label="Goal/, 'the old labels are gone');
  assert.match(briefing, /info=\{t\('editAgent\.handlesInfo', \{ manager: godName, name: who \}\)\}/, 'the office manager by the name the office uses');
  assert.doesNotMatch(briefing, /Role description/, 'the plain label replaced it (owner, 2026-09-27)');
  assert.match(briefing, /info=\{t\('editAgent\.workStyleInfo', \{ name: who \}\)\}/);
  const en = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/i18n/locales/en.json'), 'utf8')).editAgent;
  assert.match(en.handlesInfo, /^\{\{manager\}\} reads this to decide what goes to \{\{name\}\}\./);
  assert.match(en.workStyleInfo, /^How \{\{name\}\} does the job:.*Each scheduled job adds its focus area, set on the job\.$/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.resolve(__dirname, `../src/renderer/src/i18n/locales/${loc}.json`), 'utf8')).editAgent);
    assert.deepEqual(keys, Object.keys(en), `${loc} has every Edit agent string`);
  }
  assert.doesNotMatch(briefing, /Michael doesn't use it\./, 'Michael has a Work style now (schedule-focus-areas.md F6)');
  assert.match(briefing, /<ScheduledJobsList agentId=\{agent\.id\} compact \/>/, 'each job and its focus, read only (FA1)');
});

test('saving joins the fields, keeps the old role when both are empty, and tells the registry', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/EditAgentModal.tsx'), 'utf8');
  assert.match(src, /const trimmedDescription = joinAgentRole\(role, roleDescription\) \|\| agent\.description;/);
  assert.doesNotMatch(src, /a fresh harness/);
  assert.match(src, /if \(trimmedDescription !== agent\.description\) \{\s*void window\.cth\.hivePatchAgentRole\(agent\.id, trimmedDescription\)/);
});
