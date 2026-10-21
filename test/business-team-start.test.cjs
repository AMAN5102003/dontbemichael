'use strict';

/**
 * Starting the team picked during onboarding (Decisions 44, 47): the step that
 * turns the finish screen's saved `businessTeam` into agents on the floor. It
 * lives inside the useHive hook, which does not load under node, so this pins
 * the rules in its source. The whole flow (finish → relaunch → Michael up →
 * each member spawned in its folder) needs an end-to-end run to prove.
 *
 * The rules, each of which fails quietly if lost:
 *  - it runs once: `businessTeamStarted` stops a second run, and a member the
 *    registry already has is skipped, so a crash midway never doubles a card;
 *  - one member failing to start does not stop the rest; it is saved, and each
 *    later launch tries the saved members and nobody else, so a member the
 *    owner removed never comes back;
 *  - the cards appear without taking the focus off Michael;
 *  - Michael works in the Office folder on a business install, and in the
 *    harness folder on an older one, exactly as before.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hive = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/hooks/useHive.ts'), 'utf8');

test('the onboarding team starts once, each member in its folder, and Michael keeps the focus', () => {
  const at = hive.indexOf('async function startBusinessTeam(config: HarnessConfig)');
  assert.ok(at > 0, 'startBusinessTeam exists');
  const fn = hive.slice(at, hive.indexOf('\nexport function useHive', at));

  // The whole team starts once; later launches try only the members that failed.
  assert.match(fn, /const retry = config\.businessTeamStarted \? new Set\(config\.businessTeamRetry \?\? \[\]\) : undefined;(?:\s*\/\/[^\n]*)*\s*if \(team\.length === 0 \|\| retry\?\.size === 0\) \{\s*if \(!retry\) await startPickedResearch\(config\);\s*return;\s*\}/, 'runs once, then only for the members that failed (a picked Research starts with the first run)');
  assert.match(fn, /for \(const \[index, member\] of team\.entries\(\)\) \{\s*if \(retry && !retry\.has\(member\.agentId\)\) continue;/, 'a retry skips everyone who started, even one the owner has since removed');
  // A member the floor already holds is not started twice; one the registry
  // knows but the floor lost comes back (office-record.test.cjs).
  assert.match(fn, /const decision = teamMemberStart\(id, member\.folder, floorIds,[^\n]*\);\s*if \(!decision\.start\) continue;/, 'a member already on the floor is not started twice');
  assert.match(fn, /if \(!res\.ok\) \{[\s\S]{0,120}failed\.push\(id\);\s*continue;\s*\}/, 'a failed start skips that member only, and saves it for a retry');
  assert.match(fn, /cwd: workFolder,[\s\S]{0,200}hive: \{ id, name, provider, cwd: workFolder, role \}/, 'spawned inside its own folder');
  assert.match(fn, /goal: teamMemberGoal\(def, \{ name: config\.businessName, city: config\.businessCity \}\)/);
  assert.match(fn, /\}, \{ select: false \}\);/, 'the card appears without taking the focus');
  assert.match(fn, /\.find\(\(p\) => p\.businessType === config\.businessType\) \?\? byTeam \?\? core;/, '"Something else" starts from the core pack');
  assert.match(fn, /\(coverage\(p\) > coverage\(best\) \? p : best\), core\);/, 'core wins ties, so a team picked from core stays on core');
  // Every run saves who failed, so the next launch retries exactly them (TODOS,
  // Onboarding); a retried member never ran, so it gets its first task.
  assert.match(fn, /await window\.cth\.updateConfig\(\{ businessTeamStarted: true, businessTeamRetry: failed \}\)/, 'the members that failed are saved for the next launch');
  assert.match(fn, /if \(retry \|\| !reg\?\.agents\?\.\[id\]\) await window\.cth\.hiveFirstTask/, 'a retried member gets its first task');

  // Michael: asked for in the business folder when there is one, the harness
  // folder otherwise; the floor records wherever main actually started him.
  assert.match(hive, /const requestedCwd = config\.businessFolder \|\| config\.harnessHome!;/);
  assert.match(hive, /hive: \{ id: GOD_ID, name: godName, provider: godProvider, cwd: requestedCwd, isGod: true/);
  assert.match(hive, /const godCwd = res\.cwd \|\| requestedCwd;/);
  // The team starts only after Michael is up.
  // (The other 'ready' is the already-running path, which starts nothing.)
  const start = hive.indexOf('void rewriteTeamInstructions(config).catch(() => undefined).then(() => removeLegacyFirstTasks(config)).catch(() => undefined).then(() => startBusinessTeam(config));');
  const ready = hive.lastIndexOf("useStore.getState().setGodStatus('ready');", start);
  assert.ok(ready > 0 && start > ready && start - ready < 400, 'started right after Michael is ready');
});

test('members that did not start are named to Michael, who tells the owner', () => {
  const at = hive.indexOf('async function startBusinessTeam(config: HarnessConfig)');
  const fn = hive.slice(at, hive.indexOf('\nexport function useHive', at));
  assert.match(fn, /if \(failed\.length\) \{\s*const note = didNotStartNote\(failed\.map\(\(id\) => teamMemberName\(defs\.get\(id\)!\)\), !!retry\);\s*await window\.cth\.hiveSend\(\{ to: GOD_ID, act: 'inform', \.\.\.note \}, 'system'\)/);
  assert.ok(fn.indexOf('didNotStartNote(') > fn.indexOf('businessTeamRetry: failed'), 'after the retry list is saved');
});
