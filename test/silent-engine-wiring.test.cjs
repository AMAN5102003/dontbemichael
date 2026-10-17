'use strict';

/**
 * Issue #326 wiring and words: what the watch is fed, how a member is stopped,
 * Research's held questions, and the card's strings in every language. The
 * renderer has no DOM harness, so its placement is pinned in source; the look
 * is a live check against silent-engine-v2.html.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('the main process feeds the watch every hook event, the fleet beat and the owner\'s keystrokes, and restores it after the store opens', () => {
  // Value: protects=the watch hears check ins, sees members and leaves typing alone; fails_when=one feed is dropped or the restore runs before the store opens; why_new=new wiring; seam=source pin; no_claim=runtime timing (e2e covers the socket path)
  const main = read('src/main/index.ts');
  assert.match(main, /workerWake\.noteHook\(agentId, event, message\);\n\s*\/\/ Any event, a Claude status tick included, is a check in \(issue #326\)\.\n\s*silentWatch\?\.noteHook\(agentId\);/);
  assert.match(main, /writeFleetSnapshot\(\);\n\s*try \{ silentBeat\(\); \}/);
  assert.match(main, /ptyInputAt\.set\(id, Date\.now\(\)\);\n\s*return ptyManager\.write\(id, data\);/);
  const open = main.indexOf('try { persist.open(); }');
  const restore = main.indexOf('silentWatch?.restore(persist.getKv<SilentEpisode[]>(SILENT_KV_KEY)');
  assert.ok(open > 0 && restore > open, 'restored after the store opens (SD8)');
  assert.match(main, /hive\.memberMail = \(agentId\) => mailFor\(silentWatch\?\.episode\(agentId\)\);/);
});

test('a stopped member keeps its place: only the process ends, never the teardown that archives it (R1)', () => {
  // Value: protects=a stopped member stays on its card and can resume; fails_when=the stop archives it (teardownPty) or leaves the process running; why_new=R1; seam=source pin; no_claim=the process actually dying (pty.ts kill is tested elsewhere)
  const main = read('src/main/index.ts');
  const stop = main.slice(main.indexOf('  stop: (m) =>'), main.indexOf('\n', main.indexOf('  stop: (m) =>')));
  assert.match(stop, /ptyManager\.kill\(m\.ptyId\)/);
  assert.doesNotMatch(stop, /teardownPty/);
});

test('the automatic restart shares the stuck path\'s once per 30 minutes limit, and is logged for Michael\'s activity (R4, SD11)', () => {
  // Value: protects=never two automatic restarts within 30 minutes; fails_when=the watch keeps its own limit or skips the stamp; why_new=R4; seam=source pin; no_claim=none beyond protects
  const hooks = read('src/main/hooks.ts');
  assert.match(hooks, /mayAutoRestart\(agentId: string\): boolean \{\n\s*const last = this\.stuckRestartAt\.get\(agentId\);\n\s*return last === undefined \|\| this\.now\(\) - last >= STUCK_AGAIN_MS;/);
  assert.match(hooks, /noteAutoRestart\(agentId: string\): void \{ this\.stuckRestartAt\.set\(agentId, this\.now\(\)\); \}/);
  const main = read('src/main/index.ts');
  assert.match(main, /mayAutoRestart: \(agentId\) => hookServer\.mayAutoRestart\(agentId\),/);
  assert.match(main, /if \(auto\) \{\n\s*hookServer\.noteAutoRestart\(agentId\);/);
  assert.match(main, /kind: 'silent-auto-restart'/);
});

test('questions for a Research member that isn\'t reporting wait with Michael (SD16)', async (t) => {
  // Value: protects=Research is held like anyone; fails_when=the trust layer path skips the hold; why_new=SD16; seam=fake trust layer; no_claim=the trust layer itself
  const electron = require.resolve('electron');
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
  const { HiveManager } = loadTs('src/main/hive.ts');
  HiveManager.TRUST_WAIT_MS = 0;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-silent-research-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'research', name: 'Pete', provider: 'claude', cwd: path.join(home, 'desk'), isResearch: true });
  hive.setResearchEnabled(() => true);
  hive.setTrustLayer({ inbound: async (m) => ({ decision: 'pass', subject: m.subject, body: m.body }), outbound: async (m) => ({ decision: 'pass', subject: m.subject, body: m.body }) });
  hive.memberMail = (id) => (id === 'research' ? 'hold' : null);
  fs.writeFileSync(path.join(hive.root(), 'agents', 'pam', 'outbox', 'q.json'), JSON.stringify({ to: 'research', act: 'query', subject: 'Flour prices', body: 'What does flour cost?' }));
  const dir = (id) => path.join(hive.root(), 'agents', id, 'inbox');
  const msgs = (id) => (fs.existsSync(dir(id)) ? fs.readdirSync(dir(id)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir(id), f), 'utf8'))) : []);
  const held = () => msgs('god').some((m) => /^\[held: "Pete" isn't reporting to the app/.test(m.subject));
  // Wait for the outcome, never a fixed time: the trust layer path is async.
  for (const end = Date.now() + 10_000; !held(); await new Promise((r) => setTimeout(r, 10))) {
    if (Date.now() > end) assert.fail('the question was never held for Michael');
    hive.routeOnce();
  }
  assert.equal(msgs('research').length, 0);
});

test('the card, the tag and the panel line are placed where the design says (SD1, SD14)', () => {
  // Value: protects=placement on the board, the pods, the panel header and above the tabs; fails_when=a piece is dropped or All clear shows beside a card; why_new=new UI; seam=source pin; no_claim=the look (live check against silent-engine-v2.html)
  const ask = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(ask, /<OfficeBreakCard \/>\s*<SilentEngineCards \/>/);
  assert.match(ask, /!engineCard && !onBreak && !researchNotice && !silentShown &&/);
  assert.match(read('src/renderer/src/shell/PanelChrome.tsx'), /\{silent \? <NotReportingTag/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.equal((stage.match(/<NotReportingTag/g) ?? []).length, 2, 'member pods and Michael\'s');
  for (const f of ['src/renderer/src/components/AgentDetailPanel.tsx', 'src/renderer/src/components/CommandCenterPanel.tsx']) {
    assert.match(read(f), /<SilentPanelLine agentId=\{agent\.id\} name=\{agent\.name\} \/>/, f);
  }
  assert.match(read('src/renderer/src/shell/useNeedsYou.ts'), /const silent = silentCards\(merged\.silent\)\.length;\n\s*if \(silent\) feed = \{ \.\.\.feed, count: feed\.count \+ silent \};/);
});

test('the card\'s words exist in every language, with no dashes, names only (SD2, SD15)', () => {
  // Value: protects=plain words in three languages and no he or she; fails_when=a key is missing, a dash or a pronoun appears; why_new=new strings; seam=none; no_claim=translation quality
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json')).silent;
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const s = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).silent;
    assert.deepEqual(Object.keys(s).sort(), Object.keys(en).sort(), loc);
    for (const [k, v] of Object.entries(s)) assert.doesNotMatch(v, /[—–]| - /, `${loc} silent.${k}`);
  }
  for (const [k, v] of Object.entries(en)) assert.doesNotMatch(v, /\b(he|she|her|his|him)\b/i, `en silent.${k}`);
  assert.equal(en.title, "{{name}} isn't reporting to the app");
  assert.equal(en.stillWorking, "{{name}} is still working. The app can't check {{name}}'s folder and tool limits.");
  assert.equal(en.keep, 'Keep working unchecked');
  assert.match(en.info, /^While \{\{name\}\} works, \{\{name\}\}'s AI engine sends the app small reports\./);
});
