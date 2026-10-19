'use strict';

/**
 * Names change only in Edit Agent (owner, 2026-09-25). A click on a name used
 * to start renaming it, mostly by accident, so names are plain text now.
 * Michael can't be renamed. Edit Agent renames through the office registry,
 * which refuses a name another agent already has.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};
const { HiveManager } = loadTs('src/main/hive.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('no name starts editing on a click', () => {
  assert.equal(fs.existsSync(path.resolve(__dirname, '../src/renderer/src/components/AgentNameEditor.tsx')), false);
  for (const f of ['AgentDetailPanel.tsx', 'CommandCenterPanel.tsx', '../shell/PanelChrome.tsx']) {
    const src = read(`src/renderer/src/components/${f}`);
    assert.doesNotMatch(src, /AgentNameEditor|onRename|onDoubleClick=/, f);
  }
});

test('Edit Agent renames through the registry first, and stays open on a refusal', () => {
  const src = read('src/renderer/src/components/EditAgentModal.tsx');
  const save = src.slice(src.indexOf('const save = async () => {'));
  const rename = save.indexOf('await renameAgent(agent.id, trimmedName)');
  const update = save.indexOf('updateAgent(agent.id, {');
  assert.ok(rename > 0 && update > rename, 'rename before the rest is saved');
  assert.match(save, /if \(!renamed\.ok\) \{ setNameError\(renamed\.error \?\? t\('editAgent\.errRename'\)\); return; \}/);
  assert.doesNotMatch(save.slice(update, save.indexOf('});', update)), /name: trimmedName/, 'the name is not saved on screen only');
});

test('the registry refuses a name another agent already has', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rename-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  const r = hive.renameAgent('oscar', ' pam ');
  assert.equal(r.ok, false);
  assert.match(r.error, /^Another team member is already called pam\. Pick a different name\.$/);
  assert.doesNotMatch(r.error, /[–—]/);
  assert.equal(hive.registry().agents.oscar.name, 'Oscar');
  assert.deepEqual(hive.renameAgent('oscar', 'Angela'), { ok: true, name: 'Angela' });
  assert.deepEqual(hive.renameAgent('oscar', 'Angela'), { ok: true, name: 'Angela' }, 'its own name is fine');
});

test('the registry refuses a name that only looks different from a teammate\'s', async (t) => {
  // Value: protects=no agent is renamed to a lookalike of a teammate's name, so messages by name and the roster stay unambiguous; fails_when=renameAgent compares names by lower case alone again; why_new=the existing test only renames to an exact copy (" pam "), which a lower case compare also refuses; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rename-look-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  for (const look of ['Pаm', 'Pam.', 'P a m', 'Pám']) {
    const r = hive.renameAgent('oscar', look);
    assert.equal(r.ok, false, JSON.stringify(look));
    assert.match(r.error, /^Another team member is already called /);
  }
  assert.equal(hive.registry().agents.oscar.name, 'Oscar');
  assert.equal(hive.renameAgent('oscar', 'Pamela').ok, true, 'a different name is still fine');
});
