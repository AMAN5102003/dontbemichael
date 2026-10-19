'use strict';

/**
 * Michael no longer starts temporary helpers on his own (owner, 2026-09-24).
 * Starting an agent is a spend the owner never saw. When a job fits no one on
 * the team and is too big for him, he puts it on the ASK ME board with
 * suggestions, and the owner decides. ALLOW_TEMP_WORKERS brings the old route
 * back; every gate below reads it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { ALLOW_TEMP_WORKERS } = loadTs('src/shared/buildFeatures.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { OFFICE_ROLES } = loadTs('src/shared/officeRoles.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

function promptOf(inj) {
  const i = inj.args.indexOf('--append-system-prompt');
  return inj.args[i + 1];
}

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'no-temp-workers-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, hive: new HiveManager(() => home) };
}

test('this build has no temporary workers', () => {
  assert.equal(ALLOW_TEMP_WORKERS, false);
});

test('Michael is never told he can start one, even with an old config that allowed it', async (t) => {
  const { home, hive } = setup(t);
  hive.setOrchestratorMaySpawn(true);
  assert.equal(hive.orchestratorMaySpawn(), false);
  const p = promptOf(await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true }));
  assert.doesNotMatch(p, /SPAWNING A WORKER/);
  const protocol = fs.readFileSync(path.join(home, 'hive', 'PROTOCOL.md'), 'utf8');
  assert.doesNotMatch(protocol, /Spawning a worker|spawn-requests/);
  assert.match(protocol, /## Private memory/, 'the rest of the protocol is intact');
});

test('instead, a job no one fits goes to the ASK ME board with suggestions', async (t) => {
  const { home, hive } = setup(t);
  const p = promptOf(await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true }));
  // Says outright that it overrides the older spawn wording above it.
  assert.match(p, /WHEN NO ONE FITS \(this overrides anything above about spawning a fresh agent: you cannot start one\):/);
  assert.match(p, /do NOT do it yourself and do NOT start a new agent/);
  assert.match(p, /"status": "blocked" and one humanQA ask/);
  assert.match(p, /give the choices in "options", with "recommended": true on the one you recommend/);
  for (const option of ['add a team member', 'hand it to the closest team member', 'you do it yourself this once', 'or drop it']) {
    assert.ok(p.includes(option), `offers: ${option}`);
  }
  // It can name the right person: every cast member with their fixed job.
  for (const [who, { role }] of Object.entries(OFFICE_ROLES)) {
    assert.ok(p.includes(`${who[0].toUpperCase()}${who.slice(1)} (${role})`), `${who} is suggested as ${role}`);
  }
  assert.match(p, /Small jobs .* are not this/);
});

test('team members do not get Michael\'s rule', async (t) => {
  const { home, hive } = setup(t);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const p = promptOf(await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home }));
  assert.doesNotMatch(p, /WHEN NO ONE FITS/);
});

test('the queue, the Settings switch and the WORKERS tab are all closed', () => {
  assert.match(read('src/main/index.ts'), /const dir = ALLOW_TEMP_WORKERS && readConfig\(\)\.orchestratorMaySpawn \? spawnRequestsDir\(\) : null;/);
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  const gate = settings.indexOf('{ALLOW_TEMP_WORKERS && (<>');
  assert.ok(gate > 0 && settings.lastIndexOf('Who can add agents') > gate, 'the switch is behind the flag');
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(cc, /\(t\.key !== 'workers' \|\| ALLOW_TEMP_WORKERS\)/);
  assert.match(cc, /\{ALLOW_TEMP_WORKERS && tab === 'workers' && <WorkersTab \/>\}/);
});
