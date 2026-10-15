'use strict';

/**
 * Launch goes straight into the office. The "which folder?" screen shows only
 * when the office folder went missing (moved, renamed or deleted), and then the
 * app does NOT rebuild an empty office at the old path behind the owner's back.
 * Switching folders on purpose lives in Settings → General (owner, 2026-09-24).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { copyOfficeData, homeFolderStatus, homeReadyAtLaunch } = loadTs('src/main/homeFolder.ts');
const { agentMcpDir, privateOwnerSentDir, privateOwnerStatePath } = loadTs('src/shared/agentPrivatePaths.ts');
const read =(rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'office-launch-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('a folder with an office in it is ready', (t) => {
  const home = tmp(t);
  fs.mkdirSync(path.join(home, 'hive'));
  fs.writeFileSync(path.join(home, 'hive', 'registry.json'), '{"godId":null,"agents":{}}');
  assert.deepEqual(homeFolderStatus(home), { path: home, exists: true, hasOffice: true });
  assert.equal(homeReadyAtLaunch({ onboardingComplete: true, harnessHome: home }), true);
});

test('a moved or deleted folder is not, and neither is an emptied one', (t) => {
  const base = tmp(t);
  const gone = path.join(base, 'HarnessAgents');
  assert.deepEqual(homeFolderStatus(gone), { path: gone, exists: false, hasOffice: false });
  assert.equal(homeReadyAtLaunch({ onboardingComplete: true, harnessHome: gone }), false);
  fs.mkdirSync(gone);
  assert.deepEqual(homeFolderStatus(gone), { path: gone, exists: true, hasOffice: false });
  assert.equal(homeReadyAtLaunch({ onboardingComplete: true, harnessHome: gone }), false);
  const file = path.join(base, 'not-a-folder');
  fs.writeFileSync(file, 'x');
  assert.equal(homeFolderStatus(file).exists, false);
});

test('before onboarding there is nothing to lose, so launch proceeds', () => {
  assert.equal(homeReadyAtLaunch({ onboardingComplete: false }), true);
  assert.equal(homeReadyAtLaunch({ onboardingComplete: true, harnessHome: '' }), false);
});

test('a missing office is never rebuilt empty at launch, and nothing that feeds it starts', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /const homeReady = homeReadyAtLaunch\(readConfig\(\)\);\s*if \(homeReady\) \{?\s*bootstrapHiveServices\(\);/);
  assert.match(main, /if \(homeReady && slackCfg\.slackEnabled && slackCfg\.slackSigningSecret\)/);
  assert.match(main, /if \(homeReady && enabledWebhookEndpoints\(\)\.length > 0\)/);
});

test('a normal launch shows no picker; only a missing office shows the new screen', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.doesNotMatch(app, /HivePicker/);
  assert.ok(!fs.existsSync(path.resolve(__dirname, '../src/renderer/src/components/HivePicker.tsx')));
  assert.match(app, /setHomeState\(st\.hasOffice \? 'ok' : 'missing'\)/);
  assert.match(app, /if \(homeState === 'missing'\) \{\s*return <OfficeFolderMissing config=\{config\} \/>;/);
  // Onboarding lands straight in the office it just made (after reloading, when
  // that office is not the one the roster was loaded for: roster-source.test.cjs).
  assert.match(app, /onComplete=\{\(next\) => \{[\s\S]{0,200}?setConfig\(next\); setHomeState\('ok'\);\s*\}\}/);
});

test('the missing screen only opens a folder that really holds an office', () => {
  const screen = read('src/renderer/src/components/OfficeFolderMissing.tsx');
  assert.match(screen, /if \(!status\?\.hasOffice\) \{\s*setError\(t\('officeMissing\.notAnOffice'\)\);/);
  // Starting over is a confirmed, deliberate choice.
  assert.match(screen, /setConfirmStartOver\(true\)/);
  assert.match(screen, /window\.cth\.startOverHere\(\)/);
});

test('a recent office is named by its own folder, on Windows too', () => {
  // A Windows path holds no '/', so a '/'-only split named the row with the
  // whole path. Run the helper as written in the screen.
  const screen = read('src/renderer/src/components/OfficeFolderMissing.tsx');
  const body = screen.match(/function folderName\(path: string\): string \{\s*(return [^\n]+)\s*\}/);
  assert.ok(body, 'the folderName helper');
  const folderName = new Function('path', body[1]);
  assert.equal(folderName('C:\\Users\\Ana\\Documents\\My Office'), 'My Office');
  assert.equal(folderName('D:\\Offices\\Acme\\'), 'Acme');
  assert.equal(folderName('\\\\server\\share\\Office'), 'Office');
  assert.equal(folderName('/Users/ana/Documents/My Office'), 'My Office');
  assert.equal(folderName('/Users/ana/My Office/'), 'My Office');
});

test('Settings never offers to move an office on top of another one', () => {
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(settings, /\(changeTargetHasOffice\s*\? \[\['fresh', t\('settings\.changeHome\.openTitle'\)/);
  assert.match(settings, /setChangeMode\(hasOffice \? 'fresh' : 'move'\)/);
  assert.match(settings, /otherOffices\.map\(\(h\) =>/);
});

test('main refuses mode move onto a folder that already holds an office', () => {
  const main = read('src/main/index.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('config:changeHome'"));
  assert.match(handler.slice(0, 2500), /mode === 'move' && homeFolderStatus\(newHome\)\.hasOffice/);
});

test('"start over here" leaves a real office behind, so the next launch goes in', async (t) => {
  // The relaunch trusts only a folder holding hive/registry.json; a bare folder
  // would loop the owner back to the missing screen.
  const main = read('src/main/index.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('config:startOverHere'"));
  assert.match(handler.slice(0, 1200), /ensureHarnessHome\(home\)[\s\S]*hive\.ensureHive\(\)[\s\S]*restartApp\(app\)/);
  // And ensureHive really writes what the launch check reads.
  const home = tmp(t);
  const { HiveManager } = loadTs('src/main/hive.ts');
  new HiveManager(() => home).ensureHive();
  assert.equal(homeFolderStatus(home).hasOffice, true);
});

test('moving the office takes the owner\'s questions to Michael along', async (t) => {
  // Value: protects=the conversation with Michael is still there after "Move my office here"; fails_when=the move copies the hive but not private/owner, where the owner's questions and their state have lived since #63; why_new=the move list predates #63; seam=none
  const { HiveManager } = loadTs('src/main/hive.ts');
  const oldHome = tmp(t);
  // A space in the new path, as an office under "My Documents" has.
  const newHome = path.join(tmp(t), 'New office');
  const hive = new HiveManager(() => oldHome);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: oldHome, isGod: true });
  const q = hive.ownerAsk({ text: 'Did Northwind pay the June invoice?' });
  const token = path.join(agentMcpDir(oldHome, 'kelly'), 'md-mail.mcp.json');
  fs.mkdirSync(path.dirname(token), { recursive: true });
  fs.writeFileSync(token, '{}');
  fs.writeFileSync(path.join(oldHome, 'private', 'card-guard.json'), '{"done":["c1"]}');

  fs.mkdirSync(newHome, { recursive: true });
  copyOfficeData(oldHome, newHome);

  const moved = new HiveManager(() => newHome).ownerConversationView();
  assert.ok(moved.items.some((i) => i.kind === 'owner' && i.id === q.id), 'the question shows in the moved office');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(privateOwnerStatePath(newHome), 'utf8')),
    JSON.parse(fs.readFileSync(privateOwnerStatePath(oldHome), 'utf8')),
    'with the state it had'
  );
  assert.equal(fs.readFileSync(path.join(newHome, 'private', 'card-guard.json'), 'utf8'), '{"done":["c1"]}', 'the board guard still rides along');
  assert.equal(fs.existsSync(agentMcpDir(newHome, 'kelly')), false, 'mail tokens are written again at start, never copied');
  assert.ok(fs.existsSync(path.join(privateOwnerSentDir(oldHome), `${q.id}.json`)), 'the old folder stays as a backup');
});

test('a move copies only what is there', (t) => {
  // Value: protects=an office with no questions asked yet (no private/owner) still moves; fails_when=a missing folder makes the copy throw and the move is refused; why_new=private/owner joined the move list; seam=none
  const oldHome = tmp(t);
  const newHome = tmp(t);
  fs.mkdirSync(path.join(oldHome, 'hive'));
  fs.writeFileSync(path.join(oldHome, 'hive', 'registry.json'), '{"godId":null,"agents":{}}');
  copyOfficeData(oldHome, newHome);
  assert.equal(homeFolderStatus(newHome).hasOffice, true);
  assert.equal(fs.existsSync(path.join(newHome, 'private')), false);
});

test('a move carries Research\'s stamp key, threads and raw originals', (t) => {
  // Value: protects=asks waiting for Research are not swept as forged after a move, answers find their threads, and raw originals stay private; fails_when=copyOfficeData leaves them behind; why_new=api review pass 3; seam=none
  const oldHome = tmp(t);
  const newHome = path.join(tmp(t), 'moved');
  const priv = path.join(oldHome, 'private');
  fs.mkdirSync(path.join(priv, 'research-outbox', 'sent'), { recursive: true });
  fs.writeFileSync(path.join(priv, 'research-stamp.key'), 'ab'.repeat(32));
  fs.writeFileSync(path.join(priv, 'research-threads.json'), '[]');
  fs.writeFileSync(path.join(priv, 'research-outbox', 'sent', 'r1.json'), '{}');
  fs.mkdirSync(newHome, { recursive: true });
  copyOfficeData(oldHome, newHome);
  for (const f of ['research-stamp.key', 'research-threads.json', path.join('research-outbox', 'sent', 'r1.json')]) {
    assert.ok(fs.existsSync(path.join(newHome, 'private', f)), f);
  }
});
