'use strict';

/**
 * Settings → Reset memory (docs/designs/reset-agent-memory.md): every member,
 * Michael and Research included, starts as on its first day while the office
 * stays. Notes, handled messages, recorded conversations and Claude Code's
 * auto memory go; the team, cards, waiting messages and settings stay. No
 * member can steer what is deleted (R5).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const {
  memoryResetTargets, eraseMemoryTargets, idsFromCostRows, idsFromRecord, foldersFromRoster,
  autoMemoryFolders, memberIdsIn, MEMBER_SESSIONS_FILE
} = loadTs('src/main/memoryReset.ts');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function write(p, text = 'x') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

/** A temp office: two members and Michael, Research, the owner's folder, a
 *  Claude Code projects folder with each member's conversation and the
 *  owner's own in the same project folder. */
function office(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hive = path.join(root, 'office', 'hive');
  const projects = path.join(root, 'claude', 'projects');
  const work = path.join(root, 'work', 'sales');
  const desk = path.join(root, 'office', 'research-desk');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(desk, { recursive: true });
  const key = (folder) => path.join(projects, folder.replace(/[^a-zA-Z0-9]/g, '-'));
  for (const id of ['god', 'pam', 'research']) {
    const dir = path.join(hive, 'agents', id);
    write(path.join(dir, 'memory.md'), `# ${id} notes`);
    write(path.join(dir, 'memory', 'inbox.md'), '- a note');
    write(path.join(dir, 'memory', 'procedures', 'invoice.md'), 'steps');
    write(path.join(dir, 'memory', 'cleared.json'), '{}');
    write(path.join(dir, 'identity.md'), 'who');
    write(path.join(dir, 'inbox', 'waiting.json'), '{}');
    write(path.join(dir, 'inbox', '.done', 'old.json'), '{}');
    write(path.join(dir, 'outbox', '.sent', 'old.json'), '{}');
    write(path.join(dir, 'outbox', 'queued.json'), '{}');
  }
  write(path.join(hive, 'agents', 'human', 'owner-sent', 'mine.json'), '{}');
  write(path.join(hive, 'tasks.json'), '{"tasks":[]}');
  write(path.join(hive, 'backups', '20261021T000000Z', 'pam', 'memory.md'), 'old copy');
  // Conversations: Pam's and Michael's in the shared work folder, next to the
  // owner's own Claude Code conversation there; Research's on its desk.
  write(path.join(key(work), 'sess-pam-1.jsonl'));
  fs.mkdirSync(path.join(key(work), 'sess-pam-1', 'subagents'), { recursive: true });
  write(path.join(key(work), 'sess-god-1.jsonl'));
  write(path.join(key(work), 'owner-own.jsonl'));
  write(path.join(key(work), 'memory', 'MEMORY.md'), 'auto memory');
  write(path.join(key(desk), 'sess-research-1.jsonl'));
  return { root, hive, projects, work, desk, key, projectDirsOf: (f) => [key(f)] };
}

test('ids come only from Pulse\'s cost rows and the private record, by member, checked', () => {
  // Value: protects=only unforgeable ids drive deletes; fails_when=a bad id, another member's or a path like ../x is accepted; why_new=R5; seam=none; no_claim=the SQL itself (pinned below)
  const ids = idsFromCostRows([
    { agent_id: 'pam', s: 'sess-pam-1' },
    { agent_id: 'pam', s: 'transcript:sess-pam-2' },
    { agent_id: 'pam', s: '../../etc' },
    { agent_id: '../x', s: 'sess-x' },
    { agent_id: 'god', s: null }
  ]);
  idsFromRecord('{"agentId":"god","sessionId":"sess-god-1"}\nnot json\n{"agentId":"pam","sessionId":"a/b"}\n', ids);
  assert.deepEqual([...ids.get('pam')].sort(), ['sess-pam-1'], 'a transcript: id came from the member writable registry');
  assert.deepEqual([...ids.get('god')], ['sess-god-1']);
  assert.equal(ids.has('../x'), false);
});

test('working folders come from the roster, current, restorable and archived, worktrees included', () => {
  // Value: protects=folders the owner's roster names, never the member writable registry; fails_when=archived or restorable members or worktrees are dropped; why_new=R5, spec review 3; restorable from the Codex adversarial pass (every member waits there from launch until it respawns); seam=none; no_claim=none beyond protects
  const folders = foldersFromRoster({
    agents: [{ id: 'pam', cwd: '/w/sales', worktreePath: '/w/sales-wt' }, { id: 'bad id', cwd: '/x' }],
    archived: [{ id: 'old', cwd: '/w/old' }],
    restorable: [{ id: 'kelly', cwd: '/w/support', worktreePath: '/w/support-wt' }]
  });
  assert.deepEqual(folders.get('pam'), ['/w/sales', '/w/sales-wt']);
  assert.deepEqual(folders.get('old'), ['/w/old']);
  assert.deepEqual(folders.get('kelly'), ['/w/support', '/w/support-wt']);
  assert.equal(folders.has('bad id'), false);
  assert.deepEqual(foldersFromRoster(null).size, 0);
});

test('a reset erases notes, handled messages, recorded conversations and auto memory, and keeps the office', (t) => {
  // Value: protects=a true first day with the office intact; fails_when=a note, handled message or recorded conversation survives, or a card, waiting message, identity or the owner's folder goes; why_new=new feature; seam=none; no_claim=Claude Code reading its folders (live check T7)
  const o = office(t);
  const sessions = idsFromCostRows([{ agent_id: 'pam', s: 'sess-pam-1' }, { agent_id: 'god', s: 'sess-god-1' }, { agent_id: 'research', s: 'sess-research-1' }]);
  const members = memberIdsIn(o.hive);
  assert.deepEqual(members.sort(), ['god', 'pam', 'research'], 'the owner\'s folder is never a member');
  const targets = memoryResetTargets({
    hiveRoot: o.hive,
    memberIds: members,
    folders: new Map([['pam', [o.work]], ['god', [o.work]]]),
    sessions,
    projectDirsOf: o.projectDirsOf,
    gitTop: () => null,
    research: { id: 'research', desk: o.desk }
  });
  const result = eraseMemoryTargets(targets, [o.hive, o.projects]);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.refused, []);
  for (const id of ['god', 'pam', 'research']) {
    const dir = path.join(o.hive, 'agents', id);
    for (const gone of ['memory.md', 'memory', path.join('inbox', '.done'), path.join('outbox', '.sent')]) {
      assert.equal(fs.existsSync(path.join(dir, gone)), false, `${id}: ${gone} goes`);
    }
    for (const kept of ['identity.md', path.join('inbox', 'waiting.json'), path.join('outbox', 'queued.json')]) {
      assert.equal(fs.existsSync(path.join(dir, kept)), true, `${id}: ${kept} stays`);
    }
  }
  assert.equal(fs.existsSync(path.join(o.hive, 'backups')), false, 'the tidy up\'s copies go');
  assert.equal(fs.existsSync(path.join(o.hive, 'tasks.json')), true, 'cards stay');
  assert.equal(fs.existsSync(path.join(o.hive, 'agents', 'human', 'owner-sent', 'mine.json')), true, 'the owner\'s folder stays');
  const key = o.key(o.work);
  assert.equal(fs.existsSync(path.join(key, 'sess-pam-1.jsonl')), false);
  assert.equal(fs.existsSync(path.join(key, 'sess-pam-1')), false, 'its side folder too');
  assert.equal(fs.existsSync(path.join(key, 'sess-god-1.jsonl')), false);
  assert.equal(fs.existsSync(path.join(key, 'owner-own.jsonl')), true, 'the owner\'s own conversation in the same folder stays');
  assert.equal(fs.existsSync(path.join(key, 'memory')), false, 'Claude Code\'s auto memory for the folder goes (R2)');
  assert.equal(fs.existsSync(o.key(o.desk)), false, 'Research\'s desk conversations go whole, as in the full reset');
});

test('nothing outside the recorded ids and the roster\'s folders is touched, whatever the log or registry say', (t) => {
  // Value: protects=members cannot steer the reset onto the owner's files; fails_when=a forged id or another folder reaches a delete; why_new=spec review 2, R5; seam=none; no_claim=none beyond protects
  const o = office(t);
  const other = path.join(o.root, 'owner-repo');
  fs.mkdirSync(other, { recursive: true });
  write(path.join(o.key(other), 'owner-own.jsonl'));
  write(path.join(o.key(other), 'memory', 'MEMORY.md'));
  // A planted log row and registry cwd would name these; the reset never reads them.
  write(path.join(o.hive, 'log.jsonl'), JSON.stringify({ kind: 'session', agentId: 'pam', sessionId: 'owner-own' }) + '\n');
  write(path.join(o.hive, 'registry.json'), JSON.stringify({ agents: { pam: { cwd: other, sessionId: 'owner-own' } } }));
  const targets = memoryResetTargets({
    hiveRoot: o.hive, memberIds: ['pam'], folders: new Map([['pam', [o.work]]]),
    sessions: idsFromCostRows([{ agent_id: 'pam', s: 'sess-pam-1' }]),
    projectDirsOf: o.projectDirsOf, gitTop: () => null
  });
  eraseMemoryTargets(targets, [o.hive, o.projects]);
  assert.equal(fs.existsSync(path.join(o.key(other), 'owner-own.jsonl')), true);
  assert.equal(fs.existsSync(path.join(o.key(other), 'memory', 'MEMORY.md')), true);
  assert.equal(fs.existsSync(path.join(o.key(o.work), 'owner-own.jsonl')), true);
});

test('a member folder swapped for a link is refused, never followed', (t) => {
  // Value: protects=a link in a member's folder can't aim the reset elsewhere; fails_when=rm follows the link out of the hive; why_new=Research red team rule; seam=none; no_claim=Windows junctions (POSIX link here)
  if (process.platform === 'win32') return t.skip('POSIX symlinks');
  const o = office(t);
  const outside = path.join(o.root, 'outside');
  write(path.join(outside, 'memory.md'), 'not the office\'s');
  const agentDir = path.join(o.hive, 'agents', 'pam');
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.symlinkSync(outside, agentDir);
  const r = eraseMemoryTargets([path.join(agentDir, 'memory.md')], [o.hive, o.projects]);
  assert.equal(fs.existsSync(path.join(outside, 'memory.md')), true);
  assert.equal(r.refused.length, 1);
});

test('auto memory goes at the repository root for a subfolder or worktree, and the confirm names it once', (t) => {
  // Value: protects=Claude Code's auto memory keyed by repository is found from a subfolder; fails_when=only the subfolder key is used; why_new=spec review 2, R2; seam=none; no_claim=Claude Code's keying beyond its documented repository rule (live check T7)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const sub = path.join(repo, 'sales');
  fs.mkdirSync(sub, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const gitTop = (f) => {
    try { return path.resolve(execFileSync('git', ['-C', f, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()); } catch { return null; }
  };
  // .native: Windows gives the temp folder as an 8.3 short name (RUNNER~1); git gives the long one.
  const real = fs.realpathSync.native(repo);
  const seen = [];
  const targets = memoryResetTargets({
    hiveRoot: path.join(root, 'hive'), memberIds: ['pam'], folders: new Map([['pam', [sub]]]),
    sessions: new Map(), projectDirsOf: (f) => { seen.push(f); return [path.join(root, 'p', f.replace(/[^a-zA-Z0-9]/g, '-'))]; }, gitTop
  });
  assert.ok(seen.includes(real), 'the repository root is keyed');
  assert.ok(targets.includes(path.join(root, 'p', real.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')));
  assert.deepEqual(autoMemoryFolders(new Map([['pam', [sub]], ['god', [repo]]]), gitTop), [real]);
});

test('the private session record: appended from hook frames, its own last id per member, emptied by a reset', async (t) => {
  // Value: protects=the record members can't write, and a reset dropping every saved conversation; fails_when=the record follows the registry, misses a new id, or the reset leaves a sessionId; why_new=R5, eng review finding 3; seam=none; no_claim=hook authentication (hooks.ts tests)
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-hive-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  hive.recordSession('pam', 'sess-1');
  hive.recordSession('pam', 'sess-1');
  // A member's shell rewrites the registry; the record still notes the next id.
  const regPath = path.join(home, 'hive', 'registry.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  reg.agents.pam.sessionId = 'sess-2';
  fs.writeFileSync(regPath, JSON.stringify(reg));
  hive.recordSession('pam', 'sess-2');
  hive.recordSession('pam', '../evil');
  const record = path.join(home, 'private', MEMBER_SESSIONS_FILE);
  const ids = idsFromRecord(fs.readFileSync(record, 'utf8'));
  assert.deepEqual([...ids.get('pam')], ['sess-1', 'sess-2']);
  assert.equal(fs.readFileSync(record, 'utf8').trim().split('\n').length, 2, 'one line per new id');
  assert.equal(hive.privateSessionsText(), fs.readFileSync(record, 'utf8'));

  assert.equal(hive.forgetSessions({ members: ['pam'], removed: 3 }), true);
  assert.equal(hive.lastSession('pam'), undefined, 'a new conversation at the next start');
  assert.equal(fs.existsSync(record), false, 'the record of old ids goes with them');
  const log = fs.readFileSync(path.join(home, 'hive', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const row = log.find((r) => r.kind === 'memory-reset');
  assert.deepEqual([row.members, row.removed, row.registryCleared], [['pam'], 3, true]);
});

test('members\' notes and the tidy up\'s copies leave the hive\'s history; the files stay', async (t) => {
  // Value: protects=no member reads another's notes through git (R3); fails_when=memory.md, memory/ or backups/ stay tracked or are deleted from disk; why_new=R3; seam=none; no_claim=past commits (kept by the owner's choice)
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-git-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'hive');
  // An older hive that committed notes before the ignore lines existed.
  fs.mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  write(path.join(root, 'agents', 'pam', 'memory.md'), 'notes');
  write(path.join(root, 'agents', 'pam', 'memory', 'inbox.md'), '- note');
  write(path.join(root, 'agents', 'pam', 'identity.md'), 'who');
  write(path.join(root, 'backups', 's', 'pam', 'memory.md'), 'copy');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'old'], { cwd: root });
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  hive.commit('next');
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(tracked, /agents\/pam\/memory/);
  assert.doesNotMatch(tracked, /^backups\//m);
  assert.match(tracked, /agents\/pam\/identity\.md/, 'everything else is still versioned');
  assert.equal(fs.existsSync(path.join(root, 'agents', 'pam', 'memory.md')), true, 'the notes stay on disk');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const line of ['agents/*/memory.md', 'agents/*/memory/', '/backups/']) assert.ok(ignore.split('\n').includes(line), line);
});

test('a tidy pass that returns after a halt writes nothing back', async (t) => {
  // Value: protects=no old note lands after the erase; fails_when=a late tidy pass writes memory.md or hands its notes back; why_new=eng review finding 2; seam=askModel stub; no_claim=the real model call
  const { MemoryTidy } = loadTs('src/main/memoryTidy.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-tidy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'hive', 'agents', 'pam');
  write(path.join(dir, 'memory', 'inbox.md'), Array.from({ length: 12 }, (_, i) => `- note ${i}`).join('\n'));
  const tidy = new MemoryTidy(() => home, () => 'claude', () => ({}), () => true, () => 'Pam', () => {});
  let release;
  tidy.askModel = () => new Promise((r) => { release = r; });
  const pass = tidy.tidyNow('pam');
  await new Promise((r) => setImmediate(r));
  assert.equal(typeof release, 'function', 'the pass is waiting on its model');
  // The reset halts the tidy up and erases the notes while the model runs.
  tidy.halt();
  fs.rmSync(path.join(dir, 'memory'), { recursive: true, force: true });
  release({ ops: [{ op: 'add', text: 'old fact', source: 'note' }] });
  await pass;
  assert.equal(fs.existsSync(path.join(dir, 'memory.md')), false, 'no index written');
  assert.equal(fs.existsSync(path.join(dir, 'memory')), false, 'no notes handed back');
  assert.deepEqual(await tidy.tidyNow('pam'), [], 'and no new pass starts');
});

test('wiring: ids before the store closes, both resets share their stops, and Settings asks once', () => {
  // Value: protects=the order that makes the reset complete and safe; fails_when=persist closes before the ids are read, the flush or halt is dropped, or the IPC skips the relaunch; why_new=new wiring; seam=source pins; no_claim=the IPC round trip (live check T7)
  const src = read('src/main/index.ts');
  const at = src.indexOf("ipcMain.handle('app:resetMemory'");
  const body = src.slice(at, src.indexOf('\n});', at));
  const order = ['memoryTidy.halt()', 'pulseTelemetry.flush()', 'ptyManager.list()', "stopForReset('memory reset', { keepPersist: true })", 'snapshotRemains(', 'hardKillTree(', 'hive.privateSessionsText()', "kind = 'cost'", 'persist.close()', 'memoryResetTargets(', "kind: 'memory-reset-start'", 'eraseMemoryTargets(', 'hive.forgetSessions(', 'restartApp(app)'];
  let last = -1;
  for (const step of order) {
    const i = body.indexOf(step);
    assert.ok(i > last, `${step} in order`);
    last = i;
  }
  assert.match(body, /WHERE office = \? AND kind = 'cost'/, 'this office\'s rows only');
  assert.match(body, /folders: memoryResetFolders\(\)/);
  assert.match(src, /function memoryResetFolders\(\): Map<string, string\[\]> \{\n  return foldersFromRoster\(roster\.read\(\)\);/, 'the roster, never the registry');
  assert.doesNotMatch(body, /registry\(\)|log\.jsonl/, 'no member writable source');
  assert.match(read('src/preload/index.ts'), /resetMemory: \(\): Promise<\{ ok: boolean \}> => ipcRenderer\.invoke\('app:resetMemory'\)/);
  // Not offered to voice or agent tools.
  for (const f of ['src/main/realtimeActions.ts', 'src/renderer/src/realtime/tools.ts', 'src/renderer/src/realtime/actions.ts']) {
    assert.doesNotMatch(read(f), /resetMemory|app:resetMemory/, f);
  }
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(settings, /onClick=\{\(\) => void askResetMemory\(\)\}/);
  assert.match(settings, /onClick=\{resetMemory\} disabled=\{busy\}/, 'one confirm, then busy');
  // The private record is erased by a full reset and moves with the office.
  assert.match(read('src/main/factoryReset.ts'), /'member-sessions\.jsonl'/);
  assert.match(read('src/main/homeFolder.ts'), /'member-sessions\.jsonl'/);
});

test('a tidy pass whose model fails after a halt hands no old notes back', async (t) => {
  // Value: protects=no old note lands after the erase when the tidy up's model call fails rather than replies; fails_when=the failed pass restores the notes it held into memory/inbox.md after the reset; why_new=the halt test above covers only a reply, and the failure path has its own restore; seam=askModel stub; no_claim=the real model call
  const { MemoryTidy } = loadTs('src/main/memoryTidy.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-tidyfail-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'hive', 'agents', 'pam');
  const inbox = path.join(dir, 'memory', 'inbox.md');
  write(inbox, Array.from({ length: 12 }, (_, i) => `- old note ${i}`).join('\n'));
  const logged = [];
  const tidy = new MemoryTidy(() => home, () => 'claude', () => ({}), () => true, () => 'Pam', (e) => logged.push(e));
  let fail;
  tidy.askModel = () => new Promise((_, reject) => { fail = reject; });
  const pass = tidy.tidyNow('pam');
  await new Promise((r) => setImmediate(r));
  assert.equal(typeof fail, 'function', 'the pass is waiting on its model');
  tidy.halt();
  // The reset erases the notes; a member still stopping writes a first day note.
  fs.rmSync(path.join(dir, 'memory'), { recursive: true, force: true });
  write(inbox, '- new note');
  fail(new Error('model gone'));
  assert.deepEqual(await pass, []);
  assert.equal(fs.readFileSync(inbox, 'utf8'), '- new note', 'no old note is handed back');
  assert.deepEqual(logged, [], 'and no tidy failure is logged for a pass the reset stopped');
});

test('a target that cannot be removed is reported, and the rest still go', (t) => {
  // Value: protects=one stuck file never stops a reset halfway (the app then relaunches with the rest erased); fails_when=a failed remove throws out of the erase or is counted as removed; why_new=only refusal was tested, not a failed remove; seam=none; no_claim=Windows file locks (a read only folder stands in)
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX permissions, not as root');
  const o = office(t);
  const locked = path.join(o.hive, 'agents', 'pam', 'memory');
  const stuck = path.join(locked, 'inbox.md');
  const free = path.join(o.hive, 'agents', 'god', 'memory.md');
  fs.chmodSync(locked, 0o555);
  let r;
  // Write access back before the temp folder's own cleanup runs.
  try { r = eraseMemoryTargets([stuck, free], [o.hive, o.projects]); } finally { fs.chmodSync(locked, 0o755); }
  assert.deepEqual(r.failed, [stuck]);
  assert.equal(r.removed, 1);
  assert.equal(fs.existsSync(stuck), true);
  assert.equal(fs.existsSync(free), false, 'the next target still went');
});

test('a registry that cannot be written keeps the session record for a second try and says so in the log', async (t) => {
  // Value: protects=the reset reaches its relaunch, the log tells the truth when the registry write fails, and the trusted ids stay for a reset run again; fails_when=forgetSessions throws, drops the private record while the registry keeps its ids, or logs registryCleared true; second Codex pass (ship); why_new=the forget test covers only a registry that writes; seam=none (a folder where registry.json was); no_claim=which error the OS gives
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-reg-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  hive.recordSession('pam', 'sess-1');
  const regPath = path.join(home, 'hive', 'registry.json');
  fs.rmSync(regPath, { force: true });
  write(path.join(regPath, 'blocker'), 'x');
  assert.equal(hive.forgetSessions({ members: ['pam'], removed: 0 }), false);
  assert.match(hive.privateSessionsText(), /"sess-1"/, 'the trusted record of old ids stays while the registry still has them');
  const log = fs.readFileSync(path.join(home, 'hive', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.find((r) => r.kind === 'memory-reset').registryCleared, false);
});

test('with no office the reset stops nothing, and Settings says it failed and frees the button', () => {
  // Value: protects=a reset that cannot run leaves the app working, and the owner is told; fails_when=the no office answer moves below allowQuit or a stop (the app is left stopped with no relaunch), or a failed reset leaves the button busy with no message; why_new=the wiring test pins the order after the guard, not the guard or the failure path; seam=source pins, the modal needs React; no_claim=the IPC round trip
  const src = read('src/main/index.ts');
  const at = src.indexOf("ipcMain.handle('app:resetMemory'");
  const body = src.slice(at, src.indexOf('\n});', at));
  const guard = body.indexOf('if (!home || !hiveRoot) return { ok: false };');
  assert.ok(guard > 0, 'no office answers ok false');
  for (const later of ['allowQuit = true', 'memoryTidy.halt()', 'stopForReset(']) assert.ok(body.indexOf(later) > guard, `${later} after the guard`);
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  const fn = settings.slice(settings.indexOf('const resetMemory = async'), settings.indexOf('// --- Change home folder'));
  assert.match(fn, /if \(r\?\.ok\) return;\s*\} catch \{[^}]*\}\s*setBusy\(false\);\s*setMemoryErr\(t\('settings\.resetMemoryConfirm\.failed'\)\);/);
  assert.match(settings, /\{memoryErr && \(\s*<div role="alert"[^>]*>\{memoryErr\}<\/div>/);
  assert.match(settings, /setMemoryFolders\(await window\.cth\.memoryResetFolders\(\)\.catch\(\(\) => \[\] as string\[\]\)\);/, 'a folder list that cannot be read still opens the confirm');
});

test('after a reset, reply tracking counts zero and the owner\'s dock keeps only the owner\'s own lines (R6, R8)', async (t) => {
  // Value: protects=the after reset behavior the owner chose for handled messages (D10 B, D15 B); fails_when=a reader still finds an old reply or open question, or the reset touches the owner's own sent mail or a waiting message; why_new=plan item listed every reader of inbox/.done and outbox/.sent but no test pinned them; seam=none
  const { HiveManager } = loadTs('src/main/hive.ts');
  const { privateOwnerSentDir } = loadTs('src/shared/agentPrivatePaths.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-readers-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home, () => true);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  hive.commit = () => {};
  const hiveRoot = path.join(home, 'hive');
  const godDir = path.join(hiveRoot, 'agents', 'god');

  // Before: a member waits on a reply, the owner's question is with Michael
  // and his holding reply is in the dock.
  const asked = { id: 'm1', conversation: 'c1', in_reply_to: null, from: 'oscar', to: 'pam', act: 'query', subject: 's', body: 'b', hops: 0, requires_reply: true, needs_human: false, created_at: new Date().toISOString() };
  write(path.join(hiveRoot, 'agents', 'oscar', 'outbox', '.sent', 'm1.json'), JSON.stringify(asked));
  write(path.join(hiveRoot, 'agents', 'oscar', 'inbox', 'waiting.json'), JSON.stringify({ ...asked, id: 'w1', from: 'pam', to: 'oscar' }));
  write(path.join(hiveRoot, 'agents', 'oscar', 'inbox', '.done', 'd1.json'), JSON.stringify({ ...asked, id: 'd1', conversation: 'c2', from: 'pam', to: 'oscar', act: 'inform', requires_reply: false }));
  const q = hive.ownerAsk({ text: 'Chase the Northwind invoice' });
  assert.equal(hive.ownerDelivered(q.id), true);
  write(path.join(godDir, 'outbox', 'r.json'), JSON.stringify({ to: 'human', act: 'inform', in_reply_to: q.id, subject: 'On it', body: 'Kelly is on it.', expect_by: '2099-01-01T00:00:00.000Z', created_at: new Date().toISOString() }));
  hive.routeOnce();
  hive.refreshOwnerRequests();
  assert.equal(hive.awaitingReplies('oscar'), 1);
  assert.deepEqual(hive.ownerQuestions().map((x) => x.id), [q.id]);
  assert.ok(hive.ownerConversationView().items.some((i) => i.kind === 'michael'));
  assert.equal(hive.godSentSince('god', 0), true);
  assert.deepEqual(hive.messageHistory('oscar').map((m) => m.id).sort(), ['d1', 'w1']);

  const targets = memoryResetTargets({
    hiveRoot, memberIds: memberIdsIn(hiveRoot), folders: new Map(), sessions: new Map(),
    projectDirsOf: () => [], gitTop: () => null, research: { id: 'research', desk: path.join(home, 'desk') }
  });
  assert.equal(eraseMemoryTargets(targets, [hiveRoot]).failed.length, 0);

  // After: every reader of handled messages starts over.
  hive.refreshOwnerRequests();
  assert.equal(hive.awaitingReplies('oscar'), 0, 'the safe clearer and closing time see no open questions');
  assert.deepEqual(hive.ownerQuestions(), [], 'Michael no longer tracks the owner\'s open question (R8)');
  const dock = hive.ownerConversationView().items;
  assert.deepEqual(dock.map((i) => [i.kind, i.id]), [['owner', q.id]], 'the dock shows only the owner\'s own line (R8)');
  assert.equal(hive.godSentSince('god', 0), false);
  assert.deepEqual(hive.messageHistory('oscar').map((m) => m.id), ['w1'], 'history keeps only the waiting message');
  assert.deepEqual(hive.ownerAnswersWithoutRequest(), []);
  // Kept: the owner's own sent mail and members' waiting messages.
  assert.ok(fs.existsSync(path.join(privateOwnerSentDir(home), `${q.id}.json`)));
  assert.ok(fs.existsSync(path.join(hiveRoot, 'agents', 'oscar', 'inbox', 'waiting.json')));
});

test('every reader of handled messages has its after reset behavior stated here', () => {
  // Value: protects=a new reader of inbox/.done or outbox/.sent gets its after reset behavior decided, not discovered; fails_when=code reads or writes handled messages somewhere this list does not name; why_new=plan item (R6) asks the readers to be listed in a test; seam=source scan
  /** Where each function that touches '.done' or '.sent' stands after a reset. */
  const AFTER_RESET = {
    'src/main/hive.ts': {
      ensureAgent: 'makes the folders again, empty, when a member starts',
      drainForStop: 'prompt text naming the folder; unchanged',
      injectedPrompt: 'prompt text naming the folders; unchanged',
      makeResearchFolderSafe: 'makes Research\'s inbox/.done again, empty',
      mailFolderKind: 'classifies a path; unchanged',
      quarantine: 'files a refused message into a fresh folder',
      routeOnce: 'files routed messages into a fresh folder',
      memberDeleted: 'the triage folder, not member mail; untouched',
      refreshOwnerRequests: 'no open owner request until the owner asks again (R8, pinned above)',
      ownerState: 'rebuilds from Michael\'s inbox/.done only when the private state file is missing; that file stays',
      ownerDelivered: 'files the next delivered question into a fresh folder',
      ownerDockRaw: 'Michael\'s earlier replies are gone; the owner\'s lines stay (R8, pinned above)',
      godSentSince: 'false until Michael sends again (pinned above)',
      fileOwnerNotes: 'files into a fresh folder',
      ownerAnswersWithoutRequest: 'only waiting messages count (pinned above)',
      awaitingReplies: 'zero (pinned above)',
      voiceMessages: 'the archived part of Messages starts over',
      messageHistory: 'only waiting messages show (pinned above)'
    },
    'src/main/index.ts': {
      isFloorQuiet: 'a missing folder is skipped; inbox, log and terminals still judge',
      lastCoordinationAt: 'a missing folder is skipped; inbox, outbox and notes still count',
      archiveRequest: 'spawn requests, not member mail; untouched',
      workerSignaledDone: 'spawn requests, not member mail; untouched',
      processSpawnRequest: 'spawn requests, not member mail; untouched'
    },
    'src/main/checkedBackfill.ts': { backfillChecked: 'finds nothing to backfill from mail; marks already recorded stay' },
    'src/shared/agentPrivatePaths.ts': { privateOwnerSentDir: 'the owner\'s own mail; kept', legacyOwnerSentDir: 'the owner\'s own mail; kept' },
    'src/main/memoryReset.ts': { memoryResetTargets: 'the reset itself' }
  };
  const found = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) {
        let cur = null;
        for (const line of read(rel).split('\n')) {
          const m = line.match(/^(?:export )?(?:async )?function (\w+)/) ?? line.match(/^  (?:(?:private|public|static|async|readonly) )*(\w+)(?:<.*?>)?\((?:.*\{\s*)?$/);
          if (m && !['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) cur = m[1];
          if (/'\.(done|sent)'/.test(line)) (found[rel] ??= new Set()).add(cur);
        }
      }
    }
  };
  walk('src');
  const listed = Object.fromEntries(Object.entries(AFTER_RESET).map(([f, r]) => [f, Object.keys(r).sort()]));
  const seen = Object.fromEntries(Object.entries(found).map(([f, s]) => [f, [...s].sort()]));
  assert.deepEqual(seen, listed, 'a function reads or writes handled messages: state its behavior after a memory reset in AFTER_RESET');
});

test('the reset waits on each member\'s processes, not on the terminal list a kill empties', { skip: process.platform === 'win32' && 'POSIX process groups' }, async () => {
  // Value: protects=no member process still writing when the erase runs; fails_when=the wait reads a list that empties on the kill, or a tree whose leader died with a child still running counts as stopped; why_new=Codex adversarial pass (ship): killAll forgets terminals before they die; seam=a real process group
  const { snapshotRemains, groupMembers, hardKillTree } = loadTs('src/main/procKill.ts');
  const { spawn } = require('node:child_process');
  const leader = spawn('sh', ['-c', 'sleep 30 & wait'], { detached: true, stdio: 'ignore' });
  const pid = leader.pid;
  let before = null;
  for (let i = 0; i < 50 && !(before && before.size >= 2); i++) { await new Promise((r) => setTimeout(r, 20)); before = groupMembers(pid); }
  assert.ok(before && before.size >= 2, 'the shell and its child share a group');
  assert.equal(snapshotRemains(pid, before), true);
  assert.equal(snapshotRemains(pid, null), null, 'no snapshot: cannot tell, so never forced');
  process.kill(pid, 'SIGKILL');
  for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch { break; } await new Promise((r) => setTimeout(r, 20)); }
  assert.equal(snapshotRemains(pid, before), true, 'the leader is gone but its child still runs');
  assert.equal(snapshotRemains(pid, new Map([[pid, 'another start time']])), false, 'a recycled pid is a stranger, never the member');
  hardKillTree(pid);
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) { await new Promise((r) => setTimeout(r, 20)); alive = snapshotRemains(pid, before); }
  assert.equal(alive, false, 'stopped once the whole group is gone');
  // The handler snapshots before the kill and waits on the trees, then forces any left.
  const src = read('src/main/index.ts');
  const body = src.slice(src.indexOf("ipcMain.handle('app:resetMemory'"));
  assert.match(body, /const trees = ptyManager\.list\(\)\.map\(\(s\) => \(\{ id: s\.id, pid: s\.pid, before:/);
  assert.match(body, /const until = Date\.now\(\) \+ KILL_GRACE_MS \+ 2000;/);
  assert.match(body, /const running = \(t: \(typeof trees\)\[number\]\): boolean => snapshotRemains\(t\.pid, t\.before\) \?\? \(Date\.now\(\) < until \|\| isAlive\(t\.pid\)\);/, 'a tree it cannot verify waits out the grace');
  assert.match(body, /for \(const t of left\) if \(snapshotRemains\(t\.pid, t\.before\) === true\) hardKillTree\(t\.pid\);\n  const stillRunning = left\.map\(\(t\) => t\.id\);/, 'only a verified tree is forced');
});

test('an unreadable registry is left as it is, never written back empty', async (t) => {
  // Value: protects=the team survives a reset that meets a torn registry; fails_when=forgetSessions writes the empty fallback over it; why_new=pre-landing review (ship); seam=none
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-torn-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const regPath = path.join(home, 'hive', 'registry.json');
  const torn = fs.readFileSync(regPath, 'utf8').slice(0, 40);
  fs.writeFileSync(regPath, torn);
  assert.equal(hive.forgetSessions({ members: ['pam'], removed: 0 }), false);
  assert.equal(fs.readFileSync(regPath, 'utf8'), torn, 'left for the owner, not replaced by an empty team');
});

test('a worktree member\'s auto memory is keyed by its main repository', (t) => {
  // Value: protects=the reset and its confirm reach the auto memory Claude Code shares across a repository and its worktrees; fails_when=a linked worktree or subfolder resolves to itself, or a folder outside a repository is given a root; why_new=pre-landing review (ship), and the coverage gap gitTopOf had no seam; seam=a real git repository
  const { gitTopOf } = loadTs('src/main/memoryReset.ts');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-git-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'first');
  const wt = path.join(root, 'wt');
  git('worktree', 'add', '-q', wt);
  assert.equal(gitTopOf(repo), repo);
  assert.equal(gitTopOf(path.join(repo, 'sub')), repo);
  assert.equal(gitTopOf(wt), repo, 'a linked worktree shares the main repository\'s auto memory');
  const outside = path.join(root, 'plain');
  fs.mkdirSync(outside);
  assert.equal(gitTopOf(outside), null);
  assert.equal(gitTopOf(path.join(root, 'missing')), null);
  assert.deepEqual(autoMemoryFolders(new Map([['pam', [wt]], ['oscar', [outside]]]), gitTopOf), [outside, repo].sort());
});

test('members\' notes leave the hive history, and a failed git try runs again next commit', async (t) => {
  // Value: protects=notes already in the hive repo stop being versioned (R3), even after one failed git call; fails_when=the pass marks itself done before git answers, or leaves tracked notes in the index; why_new=second Codex pass (ship), and R3 had no behavior test; seam=a real hive repo; a folder with no repo for the failed try
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-untrack-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const root = path.join(home, 'hive');
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  write(path.join(root, 'agents', 'pam', 'memory.md'), '# notes');
  write(path.join(root, 'agents', 'pam', 'memory', 'inbox.md'), '- a note');
  git('add', '-f', 'agents/pam/memory.md', 'agents/pam/memory/inbox.md');
  git('commit', '-q', '-m', 'old notes');
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memreset-norepo-'));
  t.after(() => fs.rmSync(notRepo, { recursive: true, force: true }));
  hive.untrackedNotes = false; // the hive's first commit already ran the pass on a clean repo
  hive.untrackNotes(notRepo);
  assert.equal(hive.untrackedNotes, false, 'git failed, so the pass is not marked done');
  hive.untrackNotes(root);
  assert.equal(hive.untrackedNotes, true);
  assert.equal(git('ls-files', 'agents/pam/memory.md', 'agents/pam/memory').trim(), '', 'no longer tracked');
  assert.ok(fs.existsSync(path.join(root, 'agents', 'pam', 'memory.md')), 'the notes stay on disk');
});
