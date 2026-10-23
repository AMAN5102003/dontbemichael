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

test('Edit Agent shows Role, what they handle read only, What should change and How they work', () => {
  // Value: protects=the owner reads the job and changes it by saying what should change (work-style-change-request.md, DR4); fails_when=the order changes, a typed job field comes back, or a label loses its info; why_new=the job became read only; seam=source pin
  const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/EditAgentModal.tsx'), 'utf8');
  // The rows are built once (roleRow to schedules) and laid out in one
  // column or, wide, in two (wide panel WD2).
  const briefing = src.slice(src.indexOf('const roleRow = ('), src.indexOf('const engine = ('));
  // Groups on soft panels (owner, 2026-10-23, mockup 2B; edit-agent-hierarchy.md
  // H1, H2): name and role, the whole job with what should change under it,
  // then the scheduled jobs and the engine.
  // One keyed tree for both layouts (revise-progress.test.cjs keeps the run).
  const tree = src.slice(src.indexOf('{/* One tree for both layouts'));
  assert.match(tree, /<div key="side" style=\{column\}>\s*<Panel id="name">\{nameRow\}\{roleRow\}<\/Panel>\s*\{wide && \(\s*<>\s*\{!isResearch && <Panel id="schedules">\{schedules\}<\/Panel>\}\s*\{engine\}/, 'wide left: who, the jobs, the engine');
  assert.match(tree, /<div key="job" style=\{column\}>\s*<Panel id="job">\s*\{handlesRow\}\s*\{workStyleRow\}\s*<\/Panel>\s*\{changeRow\}\s*<\/div>/, 'the whole job, the change box under it (H2)');
  assert.match(tree, /\{!wide && \(\s*<div key="more" style=\{column\}>\s*\{!isResearch && <Panel id="schedules">\{schedules\}<\/Panel>\}\s*\{engine\}\s*\{danger\}/, 'one column: then the jobs, the engine, the danger zone');
  assert.ok(tree.indexOf('key="side"') < tree.indexOf('key="job"') && tree.indexOf('key="job"') < tree.indexOf('key="more"'), 'one column: who, the job, the rest');
  assert.ok(briefing.includes("<Row label={t('editAgent.role')}>"));
  assert.ok(briefing.includes("<ReadRow label={t('editAgent.handles', { name: who })}"));
  assert.ok(briefing.includes("<ReadRow label={t('jobChange.howWorks', { name: who })}"));
  assert.doesNotMatch(briefing, /<textarea/, 'nothing in the job is typed here');
  assert.match(briefing, /info=\{t\('editAgent\.handlesInfo', \{ manager: godName, name: who \}\)\}/, 'the office manager by the name the office uses');
  assert.match(briefing, /const handlesRow = !lead && \(/, 'Michael and his assistant have none (finding 5)');
  const en = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/i18n/locales/en.json'), 'utf8'));
  assert.match(en.editAgent.handlesInfo, /^\{\{manager\}\} reads this to decide what goes to \{\{name\}\}\./);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../src/renderer/src/i18n/locales/${loc}.json`), 'utf8'));
    assert.deepEqual(Object.keys(d.editAgent), Object.keys(en.editAgent), `${loc} has every Edit agent string`);
    assert.deepEqual(Object.keys(d.jobChange), Object.keys(en.jobChange), `${loc} has every job change string`);
  }
  assert.match(src, /<ScheduledJobsList agentId=\{agent\.id\} name=\{who\} onChange=\{goToSchedules\} \/>/, 'each job and its focus, read only (FA1)');
});

test('saving joins the typed title with the saved handles, keeps the old role when empty, and tells the registry', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/EditAgentModal.tsx'), 'utf8');
  assert.match(src, /const trimmedDescription = joinAgentRole\(role, splitAgentRole\(cur\.description\)\.roleDescription\) \|\| cur\.description;/);
  assert.doesNotMatch(src, /a fresh harness/);
  assert.match(src, /if \(trimmedDescription !== cur\.description\) \{\s*void window\.cth\.hivePatchAgentRole\(agent\.id, trimmedDescription\)/);
});
