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
  assert.deepEqual([...ids.get('pam')].sort(), ['sess-pam-1', 'sess-pam-2']);
  assert.deepEqual([...ids.get('god')], ['sess-god-1']);
  assert.equal(ids.has('../x'), false);
});

test('working folders come from the roster, current and archived, worktrees included', () => {
  // Value: protects=folders the owner's roster names, never the member writable registry; fails_when=archived members or worktrees are dropped; why_new=R5, spec review 3; seam=none; no_claim=none beyond protects
  const folders = foldersFromRoster({
    agents: [{ id: 'pam', cwd: '/w/sales', worktreePath: '/w/sales-wt' }, { id: 'bad id', cwd: '/x' }],
    archived: [{ id: 'old', cwd: '/w/old' }]
  });
  assert.deepEqual(folders.get('pam'), ['/w/sales', '/w/sales-wt']);
  assert.deepEqual(folders.get('old'), ['/w/old']);
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
  const real = fs.realpathSync(repo);
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
  const order = ['memoryTidy.halt()', 'pulseTelemetry.flush()', "stopForReset('memory reset', { keepPersist: true })", 'ptyManager.list()', 'hive.privateSessionsText()', "kind = 'cost'", 'persist.close()', 'memoryResetTargets(', 'eraseMemoryTargets(', 'hive.forgetSessions(', 'restartApp(app)'];
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
