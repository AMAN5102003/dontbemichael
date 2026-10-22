'use strict';

/**
 * Each team member's memory is its own (owner, 2026-10-16): "agents should not
 * be able to search each other's memory. instead they should ask the agent
 * what they need ... only company wide knowledge store is seachable by every
 * one." And, after the research pass, "the rule applies to Michael as well".
 *
 *   member ─ query ─► teammate          (asks, never reads)
 *   member ─ search ─► company knowledge (the one shared store)
 *   member ─✗─ agents/<other>/, the hive's git history
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
const { HookServer } = loadTs('src/main/hooks.ts');
const F = loadTs('src/shared/folderAccess.ts');
const { MemoryManager, otherWings } = loadTs('src/main/memory.ts');

const posix = { skip: process.platform === 'win32' ? 'posix paths' : false };
const promptOf = (inj) => inj.args[inj.args.indexOf('--append-system-prompt') + 1];

test('a member\'s shell reads its own hive folder and no one else\'s, nor the hive\'s git history', posix, () => {
  // Value: protects=a teammate's notes can't be read by cat or grep in a shell; fails_when=the sandbox leaves agents/ or .git open, or closes the member's own folder; why_new=memory privacy; seam=none
  const base = { sandbox: { denyWrite: [], denyRead: ['/a'], allowRead: [] }, deny: ['Read(/b)'], sandboxOnly: true };
  const w = F.withMemberWall(base, '/h/hive', 'pam', ['god', 'pam', 'jim']);
  assert.deepEqual(w.sandbox.denyRead, ['/a', '/h/hive/agents', '/h/hive/.git']);
  assert.deepEqual(w.sandbox.allowRead, ['/h/hive/agents/pam']);
  for (const d of ['/h/hive/.git', '/h/hive/agents/god', '/h/hive/agents/jim']) assert.ok(w.deny.some((r) => r.includes(d)), d);
  assert.ok(!w.deny.some((r) => r.includes('/h/hive/agents/pam')), 'its own folder stays open to its file tools');
  const god = F.withMemberWall(base, '/h/hive', 'god', ['god', 'pam']);
  assert.deepEqual(god.sandbox.allowRead, ['/h/hive/agents/god'], 'Michael too: only his own');
  assert.ok(god.deny.some((r) => r.includes('/h/hive/agents/pam')));
  assert.equal(F.withMemberWall(base, '', 'pam', ['god']), base, 'no hive, nothing to wall');
});

test('a file tool into another member\'s folder is refused for everyone, Michael included, and says to ask', posix, () => {
  // Value: protects=the owner's rule holds for members hired after a session started and for Michael; fails_when=the hook lets a read through or the refusal doesn't point to a query; why_new=memory privacy; seam=none
  const nameOf = (id) => ({ god: 'Michael', pam: 'Pam', jim: 'Jim' })[id] ?? id;
  const d = (agent, tool, target) => F.memberWallDecision('/h/hive', agent, tool, target, true, nameOf);
  const pam = d('pam', 'Read', '/h/hive/agents/jim/memory.md');
  assert.equal(pam.deny, true);
  assert.match(pam.reason, /Jim's own folder.*send them a "query" message/);
  assert.equal(d('god', 'Read', '/h/hive/agents/pam/memory/inbox.md').deny, true, 'Michael asks too');
  assert.equal(d('god', 'Grep', '/h/hive/agents/pam').deny, true);
  assert.equal(d('pam', 'Read', '/h/hive/.git/objects/ab').deny, true, 'the history keeps every member\'s notes');
  assert.equal(d('pam', 'Read', '/h/hive/agents/PAM/memory.md').deny, false, 'its own folder, as the disk spells it');
  assert.equal(d('pam', 'Write', '/h/hive/agents/pam/outbox/a.json').deny, false);
  assert.equal(d('pam', 'Read', '/h/hive/tasks.json').deny, false, 'the board stays open');
  assert.equal(d('pam', 'Bash', '/h/hive/agents/jim').deny, false, 'shell commands are the sandbox\'s');
});

test('the app\'s hook refuses Michael a teammate\'s notes and lets a member read its own', async (t) => {
  // Value: protects=the wall is wired into the hook every agent's tools pass through; fails_when=folderCheck skips memberWallDecision; why_new=memory privacy; seam=HookServer.handle
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-private-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  const read = (agent_id, file_path) => server.handle({ agent_id, hook_event_name: 'PreToolUse', cwd: home, tool_name: 'Read', tool_input: { file_path } }).hookSpecificOutput;
  const pamNotes = path.join(hive.root(), 'agents', 'pam', 'memory.md');
  const god = read('god', pamNotes);
  assert.equal(god?.permissionDecision, 'deny');
  assert.match(god.permissionDecisionReason, /Pam's own folder/);
  assert.notEqual(read('pam', pamNotes)?.permissionDecision, 'deny');
});

test('a search over every member\'s folder is refused while someone hired since its start is not covered', posix, () => {
  // Value: protects=a running agent's Grep or Glob over the hive can't reach a new hire's notes, which its start time Read rules don't hide; fails_when=the check ignores the roster, misses an ancestor folder, or refuses narrower searches; why_new=memory privacy follow up (live check: Read rules hide denied folders from Grep and Glob, are read once at start, and support no negated patterns); seam=none
  const nameOf = (id) => ({ god: 'Michael', pam: 'Pam', jim: 'Jim', erin: 'Erin' })[id] ?? id;
  const members = ['god', 'pam', 'jim'];
  const d = (tool, target, walled, roster = members, agent = 'pam') => F.memberWallDecision('/h/hive', agent, tool, target, true, nameOf, { members: roster, walled });
  assert.equal(F.withMemberWall({ sandbox: { denyWrite: [], denyRead: [], allowRead: [] }, deny: [], sandboxOnly: true }, '/h/hive', 'pam', ['god', 'pam', 'pam']).walledMembers.join(), 'god,pam');
  for (const target of ['/h/hive', '/h/hive/agents', '/h', '/']) assert.equal(d('Grep', target, members).deny, false, `all covered: ${target}`);
  const late = d('Grep', '/h/hive', ['god', 'pam']);
  assert.equal(late.deny, true);
  assert.match(late.reason, /^Jim joined after this session started.*ask them with a "query" message\. Your next session covers them\.$/);
  assert.doesNotMatch(late.reason, /[–—]/);
  assert.equal(d('Glob', '/h', ['god', 'pam']).deny, true, 'a listing from further up too');
  assert.match(d('Grep', '/h/hive', ['god'], ['god', 'pam', 'jim', 'erin']).reason, /^Jim, Erin joined.*ask each of them/);
  assert.equal(d('Grep', '/h/hive', null).deny, true, 'no record of its start: refused');
  assert.equal(d('Grep', '/h/hive', ['god', 'PAM', 'JIM']).deny, false, 'ids as the disk spells them');
  for (const target of ['/h/hive/triage', '/h/hive/agents/pam', '/h/other']) assert.equal(d('Grep', target, ['god', 'pam']).deny, false, `narrower: ${target}`);
  assert.equal(d('Read', '/h/hive/tasks.json', ['god', 'pam']).deny, false, 'a single shared file');
  assert.equal(d('Grep', '/h/hive', ['god'], ['god', 'pam'], 'god').deny, true, 'Michael too');
});

test('the hook judges a search against who the agent\'s rules covered when it started', async (t) => {
  // Value: protects=the start time record reaches the hook, and a restart clears the refusal; fails_when=ensureAgent drops walledMembers or folderCheck passes no roster; why_new=memory privacy follow up; seam=HookServer.handle
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-private-late-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const policy = (ids) => F.withMemberWall({ sandbox: { denyWrite: [], denyRead: [], allowRead: [] }, deny: [], sandboxOnly: true }, hive.root(), 'pam', ids);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home }, { folderPolicy: policy(['god', 'pam']) });
  assert.deepEqual(hive.walledMembersOf('pam'), ['god', 'pam']);
  await hive.ensureAgent({ id: 'jim', name: 'Jim', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  const grep = () => server.handle({ agent_id: 'pam', hook_event_name: 'PreToolUse', cwd: home, tool_name: 'Grep', tool_input: { pattern: 'x', path: hive.root() } }).hookSpecificOutput;
  const refused = grep();
  assert.equal(refused?.permissionDecision, 'deny');
  assert.match(refused.permissionDecisionReason, /^Jim joined after this session started/);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home }, { folderPolicy: policy(['god', 'pam', 'jim']) });
  assert.notEqual(grep()?.permissionDecision, 'deny', 'its next session covers Jim');
});

test('both prompts say memory is private and to ask, and nothing says to search across the team', async (t) => {
  // Value: protects=agents are told the rule, not only stopped by it; fails_when=a prompt brings back the shared memory search; why_new=memory privacy; seam=prompt text
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-private-p-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const god = promptOf(await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true }));
  const pam = promptOf(await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home }));
  assert.match(god, /PRIVATE MEMORY: each team member's notes, memory and inbox are its own\. Never open a team member's hive folder \(agents\/<id>\/\)/);
  assert.match(god, /send it a "query", and read its card on the board and the work it publishes/);
  assert.match(pam, /PRIVATE MEMORY: your notes and memory are yours alone/);
  assert.match(pam, /ask them with a "query" message; files a teammate hands off are fine to read\. The one store everyone searches is company knowledge\./);
  for (const p of [god, pam]) assert.doesNotMatch(p, /across the team|team's shared memory|other agents' memor/i);
  const protocol = fs.readFileSync(path.join(hive.root(), 'PROTOCOL.md'), 'utf8');
  assert.match(protocol, /## Private memory/);
  assert.doesNotMatch(protocol, /## Semantic memory/);
});

test('the palace keeps company knowledge only: any other section clears it once', async (t) => {
  // Value: protects=members' notes mined by an older build don't stay searchable; fails_when=status parsing misses a wing or a company only palace is cleared; why_new=memory privacy; seam=stubbed CLI
  assert.deepEqual(otherWings('WING: company\n  rooms: 3\nWING: pam\nWING: god\nWING: pam\n', 'company'), ['pam', 'god']);
  assert.deepEqual(otherWings('WING: company\n', 'company'), []);
  assert.deepEqual(otherWings('', 'company'), []);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-palace-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const palace = path.join(home, 'palace');
  const mined = path.join(home, 'private', 'research-mined');
  fs.mkdirSync(palace, { recursive: true });
  fs.mkdirSync(mined, { recursive: true });
  const memory = new MemoryManager(() => home, () => ({ enabled: true, model: 'minilm' }));
  memory.palacePath = () => palace;
  let status = 'WING: company\n';
  memory.runCli = async () => ({ ok: true, output: status });
  await memory.keepCompanyOnly();
  assert.ok(fs.existsSync(palace), 'a company only palace stays');
  assert.ok(!fs.existsSync(mined), 'the old copy of Research\'s notes is gone');
  status = 'WING: company\nWING: pam\n';
  await memory.keepCompanyOnly();
  assert.ok(!fs.existsSync(palace), 'cleared, and company knowledge is indexed again next');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/memory.ts'), 'utf8');
  assert.match(src, /await this\.keepCompanyOnly\(\);\n\s+await this\.indexCompanyKnowledge\(\);/);
  assert.doesNotMatch(src, /mineAgent|setNotesFilter/, 'no agent folder is mined');
});

test('an office under a linked folder: a link in a member\'s own folder to a teammate\'s is refused (ship review)', posix, async (t) => {
  // Value: protects=the wall holds when the app's home path has a linked part; fails_when=memberWallDecision judges the real target only against the hive root as named; why_new=security review 2026-10-17; seam=HookServer.handle
  const real = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-private-real-')));
  const link = path.join(fs.realpathSync.native(os.tmpdir()), `md-private-link-${process.pid}-${Date.now()}`);
  fs.symlinkSync(real, link);
  t.after(() => { fs.rmSync(link, { force: true }); fs.rmSync(real, { recursive: true, force: true }); });
  const hive = new HiveManager(() => link);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: link, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: link });
  await hive.ensureAgent({ id: 'kelly', name: 'Kelly', provider: 'claude', cwd: link });
  // Kelly links a folder of her own to Pam's.
  fs.symlinkSync(path.join(hive.root(), 'agents', 'pam'), path.join(hive.root(), 'agents', 'kelly', 'peek'));
  const server = new HookServer(hive, () => null, () => ({ harnessHome: link }));
  const out = server.handle({ agent_id: 'kelly', hook_event_name: 'PreToolUse', cwd: link, tool_name: 'Read', tool_input: { file_path: path.join(hive.root(), 'agents', 'kelly', 'peek', 'memory.md') } }).hookSpecificOutput;
  assert.equal(out?.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /Pam's own folder/);
});
