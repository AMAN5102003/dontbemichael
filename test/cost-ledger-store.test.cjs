'use strict';

/**
 * The cost ledger in harness.db (TODOS.md, D17 in docs/designs/team-performance.md):
 * new rows land in the table, the old hive/cost-ledger.jsonl is copied in once,
 * and lifetime totals from the table match the file's fold. better-sqlite3 is
 * built for Electron, so this file reruns itself under Electron's own Node
 * (ELECTRON_RUN_AS_NODE) and skips where no Electron binary is installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.env.COST_LEDGER_UNDER_ELECTRON) {
  let bin = null;
  try { bin = require('electron'); } catch { bin = null; }
  const ok = typeof bin === 'string' && fs.existsSync(bin);
  test('the cost ledger in harness.db (run under Electron\'s Node)', { skip: ok ? false : 'no Electron binary' }, () => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', COST_LEDGER_UNDER_ELECTRON: '1' };
    // Without this the inner run reports to this one and its failures are hidden.
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(bin, ['--test', __filename], { env, encoding: 'utf8', timeout: 300_000 });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  });
  return;
}

const loadTs = require('./load-ts.cjs');
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { app: { getPath: () => os.tmpdir() }, Notification: class { show() {} static isSupported() { return false; } } }
};
const { PersistStore } = loadTs('src/main/db.ts');
const { CostLedgerStore } = loadTs('src/main/costLedger.ts');
const { CostLedgerTotals, lifetimeUsdFromLedger } = loadTs('src/main/costLifetime.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { runBackfill } = loadTs('src/main/pulseBackfill.ts');
const { readLedgerTable } = require('../tools/agent-metrics.cjs');

const OFFICE = '/office';

/** A temp office folder and harness.db; the database closes before the folder goes. */
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-ledger-'));
  const dbFile = path.join(dir, 'harness.db');
  const persist = new PersistStore(dbFile);
  persist.open();
  t.after(() => { persist.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const hiveRoot = path.join(dir, 'hive');
  fs.mkdirSync(hiveRoot, { recursive: true });
  const file = path.join(hiveRoot, 'cost-ledger.jsonl');
  return { dir, dbFile, persist, hiveRoot, file, store: new CostLedgerStore(() => persist.database()) };
}

/** One ledger row in the exact shape appendCostLedger writes. */
const row = (agent, session, usd, ts = 1) => ({ agent_id: agent, session_id: session, ts, input: 10, output: 5, cache_read: 0, cache_creation: 0, model: 'model-a', usd });
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const tableRows = (persist) => persist.database()
  .prepare('SELECT agent_id, session_id, ts, input, output, cache_read, cache_creation, model, usd FROM cost_ledger ORDER BY id').all();
const fileLines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;

test('new rows go to the table once the old file is copied in, and the file is not written again', async (t) => {
  // Value: protects=one cost store (D17); fails_when=a row still lands in the agent writable file after the import, or the table row differs from the file's; why_new=TODOS.md D17; seam=HiveManager.costLedgerSink; no_claim=index.ts wiring (read by eye)
  const { dir, persist, store, file } = setup(t);
  const hive = new HiveManager(() => dir);
  hive.costLedgerSink = (r) => store.append(OFFICE, r);
  const sample = (usd) => ({ agentId: 'pam', sessionId: 's1', ts: 5, input: 10, output: 5, cacheRead: 0, cacheCreation: 0, model: 'model-a', usd });
  hive.appendCostLedger(sample(1));
  assert.equal(fileLines(file), 1, 'before the import the file is still the ledger');
  assert.equal(tableRows(persist).length, 0);
  assert.equal(await store.importFile(OFFICE, file), 1);
  hive.appendCostLedger(sample(2));
  hive.appendCostLedger(sample(3));
  assert.deepEqual(tableRows(persist).map((r) => r.usd), [1, 2, 3]);
  assert.deepEqual(tableRows(persist)[1], row('pam', 's1', 2, 5));
  assert.equal(fileLines(file), 1, 'the old file is left as it was, not deleted or grown');
});

test('the old file is copied in once, in order, with the rows a beat wrote while it streamed', async (t) => {
  // Value: protects=a one-time idempotent import; fails_when=a second run or a restart copies rows again, a row written during the copy is lost or lands out of order, or a junk line is copied; why_new=TODOS.md D17; seam=temp file and db; no_claim=a file agents rewrote after the import (nothing reads it then)
  const { persist, store, file } = setup(t);
  fs.writeFileSync(file, lines([row('pam', 's1', 1), row('pam', 's1', 4), row('jim', 's2', 2)]) + 'not json\n{"agent_id":null}\n');
  const copying = store.importFile(OFFICE, file);
  assert.equal(store.imported(OFFICE), false, 'the file stays the ledger until the copy is done');
  fs.appendFileSync(file, `${JSON.stringify(row('pam', 's1', 6))}\n`);
  assert.equal(await copying, 4);
  assert.equal(store.imported(OFFICE), true);
  assert.deepEqual(tableRows(persist).map((r) => [r.agent_id, r.usd]), [['pam', 1], ['pam', 4], ['jim', 2], ['pam', 6]]);
  assert.equal(await store.importFile(OFFICE, file), 0, 'a second run adds nothing');
  assert.equal(await new CostLedgerStore(() => persist.database()).importFile(OFFICE, file), 0, 'nor does the next start');
  assert.equal(tableRows(persist).length, 4);
  assert.equal(await store.importFile('/other', path.join(path.dirname(file), 'none.jsonl')), 0, 'an office with no file has nothing to copy');
  assert.equal(store.imported('/other'), true);
});

test('an import cut short resumes where it stopped and copies no row twice', async (t) => {
  // Value: protects=idempotency across a quit mid-import; fails_when=the rows of a finished step are copied again or the rest is never copied; why_new=TODOS.md D17; seam=the store's clock throwing inside the second step; no_claim=a real crash (the step's transaction is what is relied on)
  const { persist, file } = setup(t);
  const all = Array.from({ length: 5_000 }, (_, i) => row(`m${i % 7}`, 's', i, i));
  fs.writeFileSync(file, lines(all)); // over one step's worth of bytes
  let steps = 0;
  const quits = new CostLedgerStore(() => persist.database(), () => { if (++steps === 2) throw new Error('quit'); return 1; });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try { assert.equal(await quits.importFile(OFFICE, file), 0); } finally { console.error = orig; }
  assert.match(errors.join('\n'), /import stopped/);
  const first = tableRows(persist).length;
  assert.ok(first > 0 && first < all.length, `the first step stays (${first} rows)`);
  assert.equal(quits.imported(OFFICE), false);
  assert.equal(await quits.importFile(OFFICE, file), 0, 'not tried again until the next start');
  assert.equal(tableRows(persist).length, first);
  const store = new CostLedgerStore(() => persist.database());
  assert.equal(await store.importFile(OFFICE, file), all.length - first);
  assert.deepEqual(tableRows(persist).map((r) => r.usd), all.map((r) => r.usd));
});

test('lifetime totals from the table equal the file fold for the same rows, restarts included', async (t) => {
  // Value: protects=lifetime spend after the move; fails_when=the table fold drops a restart's peak, keys a session differently, or later rows do not fold onto earlier ones; why_new=TODOS.md D17; seam=none; no_claim=the row cap per pass (same as the file's byte cap)
  const { store, file } = setup(t);
  const old = [
    row('pam', 's1', 8), row('pam', 's1', 20), row('pam', 's1', 0), row('pam', 's1', 3), // a restart: 23
    row('jim', 's2', 0.92), row('jim', 's2', 0), row('jim', 's2', 0.4),                  // a small one: 1.32
    row('pam', 's3', 5),
    { agent_id: 'dwight', usd: 2 }, { agent_id: 'dwight', session_id: null, usd: 'lots' }
  ];
  fs.writeFileSync(file, lines(old));
  await store.importFile(OFFICE, file);
  const totals = new CostLedgerTotals();
  assert.equal(totals.usdFor('pam'), null, 'cold until the first pass');
  await totals.refreshFromStore(store, OFFICE);
  assert.equal(totals.ready, true);
  assert.equal(totals.usdFor('pam'), 28);
  assert.equal(Number(totals.usdFor('jim').toFixed(4)), 1.32);
  assert.deepEqual(totals.all(), lifetimeUsdFromLedger(fs.readFileSync(file, 'utf8')));
  const later = [row('pam', 's1', 0.5), row('pam', 's1', 1), row('jim', 's2', 2)];
  for (const r of later) store.append(OFFICE, r);
  store.append('/other', row('pam', 's1', 99));
  await totals.refreshFromStore(store, OFFICE);
  assert.deepEqual(totals.all(), lifetimeUsdFromLedger(lines([...old, ...later])), 'later rows fold onto the same state; another office stays apart');
});

test('a failed write is dropped and logged once, never thrown, and never sent to the file', async (t) => {
  // Value: protects=the 30 s breaker beat; fails_when=a write error throws into the beat, logs every beat, or falls back to the old file; why_new=TODOS.md D17; seam=a closed database handle; no_claim=disk full (the same throw path)
  const { dir, persist, file } = setup(t);
  const db = persist.database();
  const store = new CostLedgerStore(() => db);
  const hive = new HiveManager(() => dir);
  hive.costLedgerSink = (r) => store.append(OFFICE, r);
  await store.importFile(OFFICE, file);
  assert.equal(store.append(OFFICE, row('pam', 's1', 1)), true);
  db.close();
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const sample = (usd) => ({ agentId: 'pam', sessionId: 's1', ts: 5, input: 10, output: 5, cacheRead: 0, cacheCreation: 0, model: 'model-a', usd });
  try {
    assert.doesNotThrow(() => { hive.appendCostLedger(sample(2)); hive.appendCostLedger(sample(3)); });
  } finally { console.error = orig; }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ledger write failed/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(store.rowsAfter(OFFICE, 0, 10), null, 'a read that fails keeps the last good totals');
});

test("Pulse's backfill reads the copied ledger, not the file agents can write", async (t) => {
  // Value: protects=the agent writable file out of the decision path; fails_when=the backfill reads hive/cost-ledger.jsonl after the import; why_new=TODOS.md D17; seam=temp hive and db; no_claim=the backfill's other sources (pulse-telemetry.test.cjs)
  const { dir, persist, store, file, hiveRoot } = setup(t);
  const live = new Date(2026, 9, 15, 9).getTime();
  const day = 86_400_000;
  const past = live - 2 * day;
  fs.writeFileSync(file, lines([row('pam', 'S1', 1, past - 60 * day), row('pam', 'S1', 3, past), row('pam', 'S1', 0.5, past + 1000)]));
  await store.importFile(OFFICE, file);
  fs.writeFileSync(file, lines([row('pam', 'S1', 500, past)])); // an agent rewrites the old file
  persist.database().prepare("INSERT INTO telemetry_events (office, agent_id, kind, ts) VALUES (?, 'pam', 'prompt', ?)").run(OFFICE, live);
  await runBackfill({ db: persist.database(), office: OFFICE, hiveRoot, projectsRoot: path.join(dir, 'projects'), members: new Set(['pam']), now: live + 5000 });
  const { usd } = persist.database().prepare("SELECT SUM(value) AS usd FROM telemetry_events WHERE office = ? AND kind = 'cost'").get(OFFICE);
  assert.ok(Math.abs(usd - 2.5) < 1e-9, `value ${usd}`);
});

test('the measures tool reads the copied ledger from harness.db, else the file', async (t) => {
  // Value: protects=tools/agent-metrics.cjs after the move; fails_when=the tool reads a stale file once rows go to the table, or reads a table this office was not copied into; why_new=TODOS.md D17; seam=a real harness.db opened read only; no_claim=node:sqlite under plain Node 22 (checked by hand)
  const { dbFile, store, file } = setup(t);
  fs.writeFileSync(file, lines([row('pam', 's1', 1)]));
  assert.equal(readLedgerTable(dbFile, OFFICE), null, 'not copied in yet: the tool reads the file');
  await store.importFile(OFFICE, file);
  store.append(OFFICE, row('pam', 's1', 2));
  assert.deepEqual(readLedgerTable(dbFile, OFFICE), [row('pam', 's1', 1), row('pam', 's1', 2)]);
  assert.equal(readLedgerTable(dbFile, '/other'), null);
  assert.equal(readLedgerTable(path.join(path.dirname(dbFile), 'missing.db'), OFFICE), null);
});
