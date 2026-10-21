'use strict';

/**
 * Issue #63: three agent trust-boundary leaks.
 *  1) Owner Claude plugins stay off in agent sessions (per-session settings).
 *  2) md-mail.mcp.json (broker token) lives under harnessHome/private, is
 *     deleted on teardown, and orphans are swept at boot.
 *  3) Owner dock mail and state leave hive/agents/human.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('shared helpers pin private paths and plugin disable map', () => {
  // Value: protects=token and owner dock paths stay out of hive/agents, and only enabled plugins are flipped off; fails_when=helpers move back under agents/ or keep true; why_new=#63; seam=none
  const src = read('src/shared/agentPrivatePaths.ts');
  assert.match(src, /join\(harnessHome, 'private'\)/);
  assert.match(src, /join\(privateRoot\(harnessHome\), 'agent-mcp', agentId\)/);
  assert.match(src, /'md-mail\.mcp\.json'/);
  assert.match(src, /join\(hiveRoot, 'agents', agentId, 'md-mail\.mcp\.json'\)/);
  assert.match(src, /join\(privateRoot\(harnessHome\), 'owner'\)/);
  assert.match(src, /join\(hiveRoot, 'agents', 'human', 'outbox', '\.sent'\)/);
  assert.match(src, /join\(hiveRoot, 'agents', 'human', 'state\.json'\)/);
  assert.match(src, /if \(on === true \|\| on === 'true'\) out\[id\] = false;/);
});

test('spawn writes md-mail under private/, teardown deletes it, boot sweeps orphans', () => {
  // Value: protects=token file never stays in hive/agents and does not outlive the PTY; fails_when=legacy path returns, or remove/sweep helpers disappear; why_new=#63 mail token; seam=source pin
  const main = read('src/main/index.ts');
  assert.match(main, /mdMailMcpPath\(home, agentId\)/);
  assert.match(main, /unlinkSync\(legacyMdMailMcpPath\(root, agentId\)\)/);
  assert.match(main, /function removeMdMailMcp\(/);
  assert.match(main, /try \{ removeMdMailMcp\(agentId \?\? id\); \} catch/);
  assert.match(main, /function sweepOrphanAgentMcp\(/);
  assert.match(main, /try \{ sweepOrphanAgentMcp\(\); \} catch/);
  assert.doesNotMatch(main, /join\(root, 'agents', agentId, 'md-mail\.mcp\.json'\)/);
});

test('hive owner dock uses private/owner and migrates agents/human once', () => {
  // Value: protects=owner text is not writable as agents/human; fails_when=ownerSentDir goes back under agentDir\('human'\); why_new=#63 owner paths; seam=source pin
  const hive = read('src/main/hive.ts');
  assert.match(hive, /privateOwnerSentDir\(home\)/);
  assert.match(hive, /privateOwnerStatePath\(home\)/);
  assert.match(hive, /migrateOwnerPrivate\(/);
  assert.match(hive, /this\.migrateOwnerPrivate\(\);/);
  assert.match(hive, /legacyOwnerSentDir\(root\)/);
  assert.doesNotMatch(hive, /ownerSentDir\(\): string \{ return join\(this\.agentDir\('human'\)/);
});

test('agent session settings turn the owner\'s enabled plugins off', () => {
  // Value: protects=plugin skills/hooks do not ride into agent sessions; fails_when=enabledPlugins block leaves hookSettings; why_new=#63 plugins; seam=source pin
  const hive = read('src/main/hive.ts');
  assert.match(hive, /ownerPluginsOffForSession\(/);
  assert.match(hive, /enabledPlugins: disabledPlugins/);
  assert.match(hive, /pluginsDisabledForSession\(raw\.enabledPlugins\)/);
});

test('no agent reads or changes the app private folder, with or without a business folder', () => {
  // Value: protects=a sibling cannot read a running agent's live mail token under private/; fails_when=private/ drops out of the folder policy or the hook decision; why_new=moving the token alone left it readable; seam=none
  const loadTs = require('./load-ts.cjs');
  const { folderPolicy, folderDecision } = loadTs('src/shared/folderAccess.ts');
  const P = (p) => path.resolve(p);
  const priv = P('/w/home/private');
  const token = path.join(priv, 'agent-mcp', 'ada', 'md-mail.mcp.json');
  const withBiz = { business: P('/w/Biz'), teamFolders: [P('/w/Biz/Sales'), P('/w/Biz/Ops')], appPrivate: priv };
  const bare = { teamFolders: [], appPrivate: priv };
  for (const layout of [withBiz, bare]) {
    for (const agent of [{ isGod: false, cwd: P('/w/Biz/Ops') }, { isGod: true, cwd: P('/w/Biz') }]) {
      const pol = folderPolicy(agent, layout, true);
      assert.ok(pol.sandbox.denyRead.includes(priv), 'shell reads');
      assert.ok(pol.sandbox.denyWrite.includes(priv), 'shell writes');
      assert.ok(pol.deny.some((r) => r.startsWith('Read(') && r.includes('/w/home/private')), 'Read tool');
      assert.ok(pol.deny.some((r) => r.startsWith('Edit(') && r.includes('/w/home/private')), 'Edit tool');
      for (const tool of ['Read', 'Grep', 'Write', 'Edit']) {
        assert.equal(folderDecision(agent, layout, tool, token, true).deny, true, `${tool} ${agent.isGod ? 'Michael' : 'team member'}`);
      }
    }
  }
  assert.equal(folderDecision({ isGod: false, cwd: P('/w/Biz/Ops') }, bare, 'Read', P('/w/Biz/Ops/notes.md'), true).deny, false, 'own folder still opens');
  const main = read('src/main/index.ts');
  assert.match(main, /: privateOnlyFolderPolicy\(!!opts\.hive!\.isGod, opts\.cwd\);/, 'an office without a business folder still closes private/');
  assert.match(main, /return \{ \.\.\.folderPolicy\(\{ isGod, cwd \}, layout, process\.platform !== 'linux'\), sandboxOnly: false \};/, 'and keeps its shell rules as before');
  assert.match(read('src/main/officeFile.ts'), /appPrivate: join\(app, 'private'\)/);
});

test('no agent changes the hook program or any agent settings, through the shell or the file tools', () => {
  // Value: protects=an agent cannot rewrite the hook that runs outside its sandbox, or its next start settings, with Write or Edit; fails_when=the locked folders drop out of the policy or the hook decision; why_new=issue 100 locked only the shell (adversarial review); seam=none
  const loadTs = require('./load-ts.cjs');
  const { folderPolicy, folderDecision } = loadTs('src/shared/folderAccess.ts');
  const P = (p) => path.resolve(p);
  const bin = P('/w/home/hive/bin');
  const settings = P('/w/home/agent-settings');
  const locked = [bin, settings];
  const withBiz = { business: P('/w/Biz'), teamFolders: [P('/w/Biz/Ops')], appPrivate: P('/w/home/private'), appLocked: locked };
  const bare = { teamFolders: [], appPrivate: P('/w/home/private'), appLocked: locked };
  for (const layout of [withBiz, bare]) {
    for (const agent of [{ isGod: false, cwd: P('/w/Biz/Ops') }, { isGod: true, cwd: P('/w/Biz') }]) {
      const who = agent.isGod ? 'Michael' : 'team member';
      const pol = folderPolicy(agent, layout, true);
      for (const f of locked) {
        assert.ok(pol.sandbox.denyWrite.includes(f), `shell writes ${f} (${who})`);
        assert.ok(pol.deny.includes(`Edit(/${f.replace(/\\/g, '/').replace(/^(?!\/)/, '/')}/**)`), `Edit tool ${f} (${who})`);
      }
      for (const target of [path.join(bin, 'cth-hook.cjs'), path.join(settings, 'ada.json')]) {
        for (const tool of ['Write', 'Edit', 'MultiEdit']) {
          assert.equal(folderDecision(agent, layout, tool, target, true).deny, true, `${tool} ${target} (${who})`);
        }
        assert.equal(folderDecision(agent, layout, 'Read', target, true).deny, false, `reading stays open (${who})`);
      }
    }
  }
  assert.match(read('src/main/officeFile.ts'), /appLocked: \[join\(app, 'hive', 'bin'\), join\(app, 'agent-settings'\)\]/);
  assert.match(read('src/main/hooks.ts'), /const layout = folderLayoutFor\(cfg\.businessFolder, folders, home\);/);
});
