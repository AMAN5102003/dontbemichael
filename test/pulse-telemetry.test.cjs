'use strict';

/**
 * Pulse telemetry store and processor (docs/designs/team-performance.md, D15,
 * D16, eng review E1 and E4) against a real harness.db. better-sqlite3 is built
 * for Electron, so this file reruns itself under Electron's own Node
 * (ELECTRON_RUN_AS_NODE) and skips where no Electron binary is installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.env.PULSE_UNDER_ELECTRON) {
  let bin = null;
  try { bin = require('electron'); } catch { bin = null; }
  const ok = typeof bin === 'string' && fs.existsSync(bin);
  test('telemetry store and processor (run under Electron\'s Node)', { skip: ok ? false : 'no Electron binary' }, () => {
    const r = spawnSync(bin, ['--test', __filename], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PULSE_UNDER_ELECTRON: '1' },
      encoding: 'utf8', timeout: 300_000
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  });
  return;
}

const loadTs = require('./load-ts.cjs');
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => os.tmpdir() } } };
const { PersistStore } = loadTs('src/main/db.ts');
const { TelemetryStore } = loadTs('src/main/telemetryStore.ts');
const { TelemetryProcessor, RUN_IDLE_END_MS, RUN_CAP_MS } = loadTs('src/main/telemetryProcessor.ts');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pulse-'));
  const persist = new PersistStore(path.join(dir, 'harness.db'));
  persist.open();
  t.after(() => { persist.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let now = new Date(2026, 9, 15, 9).getTime();
  const clock = { now: () => now, at: (ms) => { now = ms; }, add: (ms) => { now += ms; } };
  const store = new TelemetryStore(() => persist.database(), () => '/office', clock.now);
  const proc = new TelemetryProcessor(() => persist.database(), store, clock.now);
  return { persist, store, proc, clock };
}

test('the migration makes the tables once, and nothing but kind, time, value and small attributes is stored', (t) => {
  // Value: protects=the store shape and no text in telemetry; fails_when=a migration is edited or prompt text lands in a row; why_new=D16; seam=none; no_claim=a database made by an older build (user_version 1 upgrades here)
  const { persist, store } = setup(t);
  const db = persist.database();
  assert.equal(db.pragma('user_version', { simple: true }), 4);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_tr_open', 'idx_te_office_id', 'idx_te_office_kind_ts')").all().map((r) => r.name).sort();
  assert.deepEqual(idx, ['idx_te_office_id', 'idx_te_office_kind_ts', 'idx_tr_open'], 'the hot reads have their indexes');
  store.record({ agentId: 'pam', kind: 'tool', ts: 1, attrs: { tool: 'Write' } });
  store.flush();
  const row = db.prepare('SELECT * FROM telemetry_events').get();
  assert.deepEqual([row.office, row.agent_id, row.kind, row.attrs], ['/office', 'pam', 'tool', '{"tool":"Write"}']);
});

test('a run starts at the first turn after its mail lands and ends after 2 idle minutes; work makes it did-work', (t) => {
  // Value: protects=E1 run windows; fails_when=a run starts at dispatch or waits for a prompt equal to the run text, or ends at the first stop; why_new=eng E1; seam=none; no_claim=agent behavior inside a run (fixture points)
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: 'toby', kind: 'prompt', ts: t0 - 60_000 }); // a turn before the run: ignored
  store.record({ agentId: 'toby', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm1' } });
  store.record({ agentId: 'toby', kind: 'prompt', ts: t0 + 30_000 }); // the wake turn: the run starts
  store.record({ agentId: 'toby', kind: 'cost', ts: t0 + 40_000, value: 0.5, attrs: { s: 's1', tokens: 100 } });
  store.record({ agentId: 'toby', kind: 'tool', ts: t0 + 50_000, attrs: { tool: 'Write' } });
  store.record({ agentId: 'toby', kind: 'stop', ts: t0 + 60_000 });
  clock.at(t0 + 60_000 + RUN_IDLE_END_MS + 1);
  proc.tick('/office');
  const run = persist.database().prepare('SELECT * FROM telemetry_runs').get();
  assert.equal(run.start, t0 + 30_000);
  assert.equal(run.end, t0 + 60_000);
  assert.equal(run.outcome, 'did-work');
  assert.equal(run.work, 1);
  assert.ok(Math.abs(run.usd - 0.5) < 1e-9);
  const day = proc.days('/office', '2026-01-01').find((d) => d.agentId === 'toby');
  assert.equal(day.checks, 1);
  assert.ok(Math.abs(day.runUsd - 0.5) < 1e-9 && Math.abs(day.usd - 0.5) < 1e-9);
});

test('a run with nothing done is nothing to do; one that never stops ends at 60 minutes as unknown; back to back closes the first', (t) => {
  // Value: protects=E1 outcomes and caps; fails_when=an idle run counts as work, a stuck run stays open, or a second dispatch leaks the first; why_new=eng E1; seam=none; no_claim=none beyond protects
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: 'toby', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm1' } });
  store.record({ agentId: 'toby', kind: 'prompt', ts: t0 + 1000 });
  store.record({ agentId: 'toby', kind: 'stop', ts: t0 + 2000 });
  store.record({ agentId: 'pam', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm2' } });
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 1000 });
  clock.at(t0 + 1000 + RUN_CAP_MS + 1); // the cap counts from the run's start
  proc.tick('/office');
  const runs = persist.database().prepare('SELECT agent_id, outcome FROM telemetry_runs ORDER BY agent_id').all();
  assert.deepEqual(runs.map((r) => [r.agent_id, r.outcome]), [['pam', 'unknown'], ['toby', 'nothing']]);
  store.record({ agentId: 'kelly', kind: 'run-dispatch', ts: clock.now(), attrs: { mission: 'm3' } });
  store.record({ agentId: 'kelly', kind: 'run-dispatch', ts: clock.now() + 1, attrs: { mission: 'm3' } });
  proc.tick('/office');
  assert.equal(persist.database().prepare("SELECT COUNT(*) AS n FROM telemetry_runs WHERE agent_id = 'kelly' AND end IS NULL").get().n, 1);
});

test('cost counts a restart whole, repeats are not stored, and a crash mid batch never counts twice', (t) => {
  // Value: protects=exact totals; fails_when=a restart is lost, a repeat is stored, or a replayed batch double counts; why_new=D16 processor; seam=none; no_claim=power loss during fsync
  const { store, proc, persist } = setup(t);
  store.cost('pam', 's1', 1.0, 10, 'claude-opus-5-5', 1000);
  store.cost('pam', 's1', 1.0, 10, 'claude-opus-5-5', 2000); // repeat: dropped
  store.cost('pam', 's1', 1.5, 15, 'claude-opus-5-5', 3000);
  store.cost('pam', 's1', 0.25, 3, 'claude-opus-5-5', 4000); // app restarted
  store.flush();
  assert.equal(persist.database().prepare("SELECT COUNT(*) AS n FROM telemetry_events WHERE kind = 'cost'").get().n, 3);
  const db = persist.database();
  const orig = db.transaction.bind(db);
  let boom = true;
  db.transaction = (fn) => orig((...a) => { const r = fn(...a); if (boom) { boom = false; throw new Error('crash'); } return r; });
  assert.throws(() => proc.tick('/office'));
  db.transaction = orig;
  proc.tick('/office');
  proc.tick('/office');
  const usd = proc.days('/office', '1900-01-01').reduce((s, d) => s + d.usd, 0);
  assert.ok(Math.abs(usd - 1.75) < 1e-9, `got ${usd}`);
});

test('a failed write is counted for its day and the day is reported; records keep the presence and card facts', (t) => {
  // Value: protects=D15 and E2, E3, E4 sources; fails_when=a failed write is silent, or reopen, held time or away share is lost; why_new=D15; seam=none; no_claim=disk full on a real disk (closed handle stands in)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pulse-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let open = false;
  const persist = new PersistStore(path.join(dir, 'harness.db'));
  persist.open();
  t.after(() => persist.close());
  const when = new Date(2026, 9, 14, 10).getTime();
  const store = new TelemetryStore(() => (open ? persist.database() : null), () => '/office', () => when);
  store.record({ agentId: 'pam', kind: 'email', ts: when, value: 3 });
  store.flush();
  assert.deepEqual(store.failureDays('/office'), ['2026-10-14'], 'pending failure is reported');
  open = true;
  store.flush();
  assert.deepEqual(store.failureDays('/office'), ['2026-10-14'], 'saved once the store works');

  const { store: s2, proc } = setup(t);
  const t0 = new Date(2026, 9, 15, 9).getTime();
  s2.presence(1900, false, t0);
  s2.tasks([{ id: 'c1', status: 'doing', assignee: 'nick', createdAt: new Date(t0).toISOString() }], t0);
  s2.tasks([{ id: 'c1', status: 'blocked', assignee: 'nick' }], t0 + 3600_000);
  s2.tasks([{ id: 'c1', status: 'done', assignee: 'nick' }], t0 + 3 * 3600_000);
  s2.record({ agentId: 'nick', kind: 'card-reopen', ts: t0 + 4 * 3600_000, attrs: { id: 'c1' } });
  s2.record({ agentId: 'nick', kind: 'email', ts: t0 + 4 * 3600_000, value: 2 });
  proc.tick('/office');
  const [card] = proc.cards('/office', 0);
  assert.equal(card.heldMs, 2 * 3600_000);
  assert.equal(card.reopened, true);
  assert.equal(card.doneAt, t0 + 3 * 3600_000);
  const day = proc.days('/office', '2026-01-01').find((d) => d.agentId === 'nick');
  assert.deepEqual([day.tasks, day.emails, day.awayPieces], [1, 2, 3], 'the owner was away for all of it');
});

const { PulseService } = loadTs('src/main/pulse.ts');

function service(t, opts = {}) {
  const env = setup(t);
  const t0 = new Date(2026, 9, 1, 9).getTime();
  env.clock.at(t0);
  // 14 runs over two weeks of Toby's check, 12 found nothing.
  for (let i = 0; i < 14; i++) {
    const at = t0 + i * 86_400_000;
    env.store.record({ agentId: 'toby', kind: 'run-dispatch', ts: at, attrs: { mission: 'm1' } });
    env.store.record({ agentId: 'toby', kind: 'prompt', ts: at + 1000 });
    if (i < 2) env.store.record({ agentId: 'toby', kind: 'message', ts: at + 1500 });
    env.store.record({ agentId: 'toby', kind: 'stop', ts: at + 2000 });
    env.clock.at(at + 2000 + 3 * 60_000);
    env.proc.tick('/office');
  }
  env.clock.at(t0 + 15 * 86_400_000);
  let missions = [{ id: 'm1', label: 'Benefits inbox check', to: 'toby', intervalMs: 2 * 3600_000, body: '', enabled: true, kind: 'dispatch' }];
  const models = opts.models ?? [{ agentId: 'toby', provider: 'claude', model: 'claude-opus-5-5' }];
  const svc = new PulseService({
    db: () => env.persist.database(), store: env.store, processor: env.proc, office: () => '/office',
    members: () => [{ id: 'toby', isGod: false }, { id: 'god', isGod: true }], godId: () => 'god', tasks: () => [],
    missions: () => missions, models: () => models, ladder: () => [], priceOf: () => undefined,
    applyMissions: (change) => { const next = change(missions); if (!next) return { ok: false, error: 'not found' }; missions = next; return { ok: true }; },
    billing: () => opts.billing ?? 'account', plan: () => opts.plan ?? null, memory: () => ({ notes: [], procedures: {} }), now: env.clock.now
  });
  return { ...env, svc, missions: () => missions, setMissions: (m) => { missions = m; } };
}

test('Apply changes a schedule only if it still is what the advice saw; Undo restores it; Not now hides it', (t) => {
  // Value: protects=D10 apply and undo, compare and set, D13 dismiss; fails_when=a stale or double click overwrites a schedule, Undo restores the wrong value, or a dismissed card stays; why_new=new apply path; seam=none; no_claim=the Schedules UI refresh (missions:updated is sent by applyMissions)
  const { svc, missions, setMissions } = service(t);
  const view = svc.snapshot('last-week');
  assert.equal(view.available, true);
  const [advice] = view.advice;
  assert.equal(advice.kind, 'run-less');
  assert.deepEqual(svc.apply(advice.id, { kind: 'interval', fromMs: 1, toMs: 2 }), { ok: false, error: 'stale' }, 'not what the owner saw');
  const r = svc.apply(advice.id, advice.change);
  assert.equal(r.ok, true);
  assert.equal(missions()[0].intervalMs, 4 * 3600_000);
  assert.deepEqual(svc.apply(advice.id, advice.change), { ok: false, error: 'stale' }, 'a second click finds it changed');
  assert.equal(svc.snapshot('this-week').advice.length, 0, 'an applied suggestion waits for new evidence');
  assert.equal(svc.snapshot('this-week').saved.state, 'measuring');
  assert.equal(svc.undo(r.appliedId).ok, true);
  assert.equal(missions()[0].intervalMs, 2 * 3600_000);
  assert.deepEqual(svc.undo(r.appliedId), { ok: false, error: 'stale' }, 'undone once');
  setMissions([{ ...missions()[0], intervalMs: 3 * 3600_000 }]);
  assert.equal(svc.apply(advice.id, advice.change).ok, false, 'changed elsewhere: refused');
  setMissions([{ ...missions()[0], intervalMs: 2 * 3600_000 }]);
  assert.equal(svc.dismiss(advice.id), true);
  assert.equal(svc.snapshot('this-week').advice.length, 0);
});

test('a model suggestion is checked here and made by the roster; the owner\'s store is never written from main', (t) => {
  // Value: protects=model changes only through the owner's click and the renderer roster; fails_when=main writes a model or applies a stale one; why_new=eng correction 3; seam=none; no_claim=the renderer side (component test)
  const models = [{ agentId: 'toby', provider: 'claude', model: 'claude-opus-5-5' }];
  const { svc } = service(t, { models });
  const fake = { id: 'cheaper-model:toby', kind: 'cheaper-model', agentId: 'toby', change: { kind: 'model', from: 'claude-opus-5-5', to: 'claude-sonnet-5', toLabel: 'Sonnet 5' }, evidence: {}, savesPerWeek: null, band: 1 };
  svc.allAdvice = () => [fake];
  models[0].model = 'claude-haiku-4-5';
  assert.deepEqual(svc.apply(fake.id, fake.change), { ok: false, error: 'stale' }, 'changed in Edit agent meanwhile: refused');
  models[0].model = 'claude-opus-5-5';
  assert.deepEqual(svc.apply(fake.id, fake.change), { ok: true, kind: 'model', agentId: 'toby', to: 'claude-sonnet-5', from: 'claude-opus-5-5' });
  const id = svc.modelApplied(fake.id, 'toby', 'claude-opus-5-5', 'claude-sonnet-5');
  assert.ok(id > 0);
  models[0].model = 'claude-sonnet-5'; // the roster made the change
  models[0].model = 'claude-haiku-4-5'; // then the owner picked another model in Edit agent
  assert.deepEqual(svc.undo(id), { ok: false, error: 'stale' }, 'Undo never overwrites a model changed since');
  models[0].model = 'claude-sonnet-5';
  assert.deepEqual(svc.undo(id), { ok: true, kind: 'model', agentId: 'toby', to: 'claude-opus-5-5' });
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.equal((src.match(/pulse\.apply\(/g) || []).length, 1, 'only the pulse:apply handler applies advice');
});

// ─── proposal 3: Team at work, Kept safe, backfill ───────────────────────

const { runBackfill, backfilled } = loadTs('src/main/pulseBackfill.ts');

test('working time runs from each request to its stop, capped; a request with no stop ends at the next one', (t) => {
  // Value: protects=Team at work's hours and requests; fails_when=a turn is counted from dispatch, is not capped at an hour, or an unstopped turn is lost or counted twice; why_new=owner proposal 3; seam=none; no_claim=Claude Code's own Stop timing
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 });
  store.record({ agentId: 'pam', kind: 'tool', ts: t0 + 60_000, attrs: { tool: 'Read' } });
  store.record({ agentId: 'pam', kind: 'stop', ts: t0 + 120_000 });                 // 2 minutes
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 200_000 });
  store.record({ agentId: 'pam', kind: 'tool', ts: t0 + 230_000, attrs: { tool: 'Read' } });
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 300_000 });              // no stop before: ends at its last activity (30 s)
  store.record({ agentId: 'pam', kind: 'stop', ts: t0 + 300_000 + 3 * 3600_000 }); // left open: capped at an hour
  proc.tick('/office');
  const d = persist.database().prepare('SELECT busy_ms, turns FROM telemetry_daily WHERE agent_id = ?').get('pam');
  assert.equal(d.turns, 3);
  assert.equal(d.busy_ms, 120_000 + 30_000 + 3600_000);
});

test('points from the past count for their day but never touch open runs or presence, and never start recommendations', (t) => {
  // Value: protects=backfill isolation; fails_when=a backfilled email lands in a live run, counts as work while the owner is away, or moves the live start date; why_new=owner proposal 3 backfill; seam=none; no_claim=none beyond protects
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: null, kind: 'presence', ts: t0 - 10, value: 1 });  // the owner is away now
  store.record({ agentId: 'pam', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm1' } });
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 1000 });
  store.record({ agentId: 'pam', kind: 'email', ts: t0 - 5 * 86_400_000, value: 4, attrs: { bf: 1 } });
  store.record({ agentId: 'pam', kind: 'busy', ts: t0 - 5 * 86_400_000, value: 600_000, attrs: { bf: 1 } });
  proc.tick('/office');
  const db = persist.database();
  const past = db.prepare('SELECT * FROM telemetry_daily WHERE agent_id = ? AND day < ?').get('pam', new Date(t0).toISOString().slice(0, 10));
  assert.equal(past.emails, 4);
  assert.equal(past.away_pieces, 0, 'a past email is not work while the owner is away');
  assert.equal(past.busy_ms, 600_000);
  assert.equal(db.prepare('SELECT work FROM telemetry_runs').get().work, 0, 'nor work in today\'s run');
  assert.notEqual(proc.firstDay('/office'), proc.firstDay('/office', true), 'live start ignores the past');
});

test('trust layer decisions and refusals become Kept safe counters', (t) => {
  // Value: protects=Kept safe tiles; fails_when=a failed check counts as stopped, a flag is lost, or an unknown gate is counted; why_new=owner proposal 3; seam=none; no_claim=the trust layer's own judgement
  const { store, proc, clock } = setup(t);
  const ts = clock.now();
  for (const a of [{ way: 'in', decision: 'pass' }, { way: 'in', decision: 'clean' }, { way: 'in', decision: 'deny', by: 'model' }, { way: 'in', decision: 'deny', by: 'no-answer' },
    { way: 'out', decision: 'clean', flagged: true }, { way: 'out', decision: 'pass', flagged: false }, { way: 'out', decision: 'deny', by: 'unreadable' }]) store.record({ agentId: null, kind: 'trust', ts, attrs: a });
  store.record({ agentId: 'pam', kind: 'refused', ts, attrs: { gate: 'quickbooks' } });
  store.record({ agentId: 'pam', kind: 'refused', ts, attrs: { gate: 'nonsense' } });
  proc.tick('/office');
  const { keptSafe } = loadTs('src/shared/pulseSafety.ts');
  const day = new Date(ts); const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  assert.deepEqual(keptSafe(proc.safetyRows('/office', key, key)), {
    toInternet: { pass: 1, clean: 1, stop: 1 }, webAnswers: { pass: 1, clean: 1, flagged: 1 }, held: 2, rules: { quickbooks: 1 }, any: true
  });
});

test('the backfill reads the office log, sessions and cost ledger once, before the first live point', async (t) => {
  // Value: protects=a fresh Pulse not starting at zero; fails_when=the backfill reads past the live start, counts twice on a second start, misses a session's working time or a refused step, or loses a member's cost across an app restart; why_new=owner proposal 3; seam=temp hive, projects root and db; no_claim=real transcripts' every line shape
  const { persist, store, proc, clock } = setup(t);
  const live = clock.now();
  store.record({ agentId: 'pam', kind: 'prompt', ts: live });
  store.flush();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hive = path.join(root, 'hive'); const projects = path.join(root, 'projects', '-x');
  fs.mkdirSync(hive, { recursive: true }); fs.mkdirSync(projects, { recursive: true });
  const day = 86_400_000; const past = live - 2 * day;
  fs.writeFileSync(path.join(hive, 'log.jsonl'), [
    { ts: past - 50 * day, kind: 'session', agentId: 'pam', sessionId: 'S1' },
    { ts: past, kind: 'mail-organize', agentId: 'pam', ids: ['a', 'b', 'c'] },
    { ts: past, kind: 'mail-sent', agentId: 'dwight' },
    { ts: past, kind: 'trust-layer', way: 'out', decision: 'clean', flagged: false },
    { ts: live + 1000, kind: 'mail-sent', agentId: 'dwight' },          // after the live start: not read
    { ts: past - 90 * day, kind: 'mail-sent', agentId: 'dwight' }       // too old: not read
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const iso = (ms) => new Date(ms).toISOString();
  fs.writeFileSync(path.join(projects, 'S1.jsonl'), [
    { type: 'user', timestamp: iso(past), message: { content: 'sort the inbox' } },
    { type: 'assistant', timestamp: iso(past + 60_000), message: { content: [{ type: 'tool_use' }] } },
    { type: 'user', timestamp: iso(past + 90_000), message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'PreToolUse:mcp__claude_ai_Intuit_QuickBooks__report hook error: The owner has not given you QuickBooks.' }] } },
    { type: 'assistant', timestamp: iso(past + 300_000), message: { content: [{ type: 'text', text: 'done' }] } }
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(hive, 'cost-ledger.jsonl'), [
    { agent_id: 'pam', session_id: 'S1', ts: past - 60 * day, usd: 1 },  // before the window: only a starting point
    { agent_id: 'pam', session_id: 'S1', ts: past, usd: 3 },            // +2 in the window
    { agent_id: 'pam', session_id: 'S1', ts: past + 1000, usd: 0.5 },   // app restart: +0.5
    { agent_id: 'pam', session_id: 'S1', ts: live + 1000, usd: 9 }      // after the live start: not read
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const deps = { db: persist.database(), office: '/office', hiveRoot: hive, projectsRoot: path.join(root, 'projects'), members: new Set(['pam', 'dwight']), now: live + 5000 };
  const n = await runBackfill(deps);
  assert.ok(n > 0);
  assert.equal(backfilled(persist.database(), '/office'), true);
  assert.equal(await runBackfill(deps), 0, 'once per office');
  proc.tick('/office');
  const pastDay = proc.days('/office', '2000-01-01').filter((d) => d.day !== proc.firstDay('/office', true));
  const pam = pastDay.find((d) => d.agentId === 'pam');
  assert.equal(pam.emails, 3);
  assert.equal(pam.busyMs, 300_000);
  assert.equal(pam.turns, 1);
  assert.ok(Math.abs(pam.usd - 2.5) < 1e-9, `value ${pam.usd}`);
  assert.equal(pastDay.find((d) => d.agentId === 'dwight').sent, 1);
  const { keptSafe } = loadTs('src/shared/pulseSafety.ts');
  const ks = keptSafe(proc.safetyRows('/office', '2000-01-01', '2999-01-01'));
  assert.deepEqual([ks.webAnswers.clean, ks.rules.quickbooks], [1, 1]);
});

test("on a plan, each member's cost is their part of the plan's cost so far this period; on an API key nothing is split", (t) => {
  // Value: protects=the owner's realistic cost (2026-10-15); fails_when=members' costs do not add up to the period's plan cost, a share changes, the pay per use figure is lost, or an API key is split; why_new=owner 2026-10-15; seam=none; no_claim=the plan price itself (owner or list)
  const { planCostFor } = loadTs('src/shared/claudePlan.ts');
  const { periodRange } = loadTs('src/shared/teamPerformance.ts');
  const add = (env) => {
    const now = env.clock.now();
    env.store.cost('toby', 'x', 3, 100, null, now - 3600_000);
    env.store.cost('pam', 'y', 1, 100, null, now - 3600_000);
    env.proc.tick('/office');
  };
  const onPlan = service(t, { plan: { plan: 'max-20x', label: 'Claude Max 20x', monthly: 200, source: 'detected' } });
  add(onPlan);
  const v = onPlan.svc.snapshot('this-week');
  const r = periodRange('this-week', onPlan.clock.now());
  const cost = planCostFor(200, r.fromMs, r.toMs, onPlan.clock.now());
  assert.ok(Math.abs(v.snapshot.totalUsd - cost) < 1e-9);
  assert.ok(Math.abs(v.snapshot.members.reduce((s, m) => s + m.usd, 0) - cost) < 1e-9);
  assert.equal(v.plan.payPerUse, 4);
  assert.ok(Math.abs(v.snapshot.members.find((m) => m.agentId === 'toby').share - 0.75) < 1e-9);
  const onKey = service(t, { billing: 'apiKey', plan: { plan: 'max-20x', label: 'Claude Max 20x', monthly: 200, source: 'detected' } });
  add(onKey);
  const k = onKey.svc.snapshot('this-week');
  assert.equal(k.plan, null);
  assert.equal(k.snapshot.totalUsd, 4);
});

test('Last 4 weeks comes with week by week figures that add up to the period; a single week has none', (t) => {
  // Value: protects=the trend charts on a multi week period (owner, 2026-10-15); fails_when=a week is missing, the weeks do not add up to the period, or one week periods carry weeks; why_new=owner ask; seam=none; no_claim=chart drawing (source pins in pulse-view)
  const env = service(t);
  const now = env.clock.now();
  for (const back of [1, 8, 15]) {
    env.store.record({ agentId: 'toby', kind: 'email', ts: now - back * 86_400_000, value: back });
    env.store.record({ agentId: 'toby', kind: 'sent', ts: now - back * 86_400_000 });
  }
  env.proc.tick('/office');
  assert.equal(env.svc.snapshot('this-week').weeks, null);
  const v = env.svc.snapshot('4-weeks');
  assert.equal(v.weeks.from.length, 4);
  const total = (k) => v.snapshot.outcomes.find((o) => o.kind === k).total;
  assert.equal(v.weeks.emails.reduce((a, b) => a + b, 0), total('email'));
  assert.equal(v.weeks.sent.reduce((a, b) => a + b, 0), total('sent'));
  assert.equal(v.weeks.toInternet.length, 4);
});

// ─── coverage audit, 2026-10-16: the board, presence, headroom, the advice gate ──

test('the board and the owner\'s presence feed Tasks done and work while away: owner closes and reports left out, away from when input stopped', (t) => {
  // Value: protects=Tasks done and the away share; fails_when=the first board read counts cards already done, an owner close or a report card counts as done work, away starts at the check instead of when input stopped, a repeat reading adds a point, or work after the owner is back counts as away; why_new=TelemetryStore.tasks exclusions and presence transitions only ran inside one happy path; seam=none; no_claim=powerMonitor's own idle reading
  const { store, proc, clock, persist } = setup(t);
  const db = persist.database();
  const t0 = clock.now();
  store.tasks([{ id: 'old', status: 'done', assignee: 'pam' }, { id: 'a', status: 'doing', assignee: 'pam' }, { id: 'b', status: 'doing', assignee: 'pam' }], t0);
  store.flush();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM telemetry_events WHERE kind = 'card-status'").get().n, 0, 'the first read only remembers');
  store.tasks([
    { id: 'old', status: 'done', assignee: 'pam' },
    { id: 'a', status: 'done', assignee: 'pam' },
    { id: 'b', status: 'done', assignee: 'pam', closedBy: 'owner' },
    { id: 'r', status: 'done', assignee: 'pam', humanQA: [{ kind: 'report' }] }
  ], t0 + 1000);
  store.presence(1900, false, t0 + 2000);   // idle 31 minutes: away since input stopped
  store.presence(2000, false, t0 + 60_000); // still away: no new point
  store.record({ agentId: 'pam', kind: 'email', ts: t0 + 70_000, value: 2 });
  proc.tick('/office');                     // away carries across ticks
  store.presence(5, false, t0 + 80_000);    // back at the desk
  store.record({ agentId: 'pam', kind: 'email', ts: t0 + 90_000, value: 3 });
  store.presence(0, true, t0 + 100_000);    // the computer sleeps: away from now
  store.record({ agentId: 'pam', kind: 'sent', ts: t0 + 110_000 });
  proc.tick('/office');
  const presence = db.prepare("SELECT ts, value FROM telemetry_events WHERE kind = 'presence' ORDER BY id").all().map((r) => [r.ts, r.value]);
  assert.deepEqual(presence, [[t0 + 2000 - 1900 * 1000, 1], [t0 + 80_000, 0], [t0 + 100_000, 1]]);
  const excluded = Object.fromEntries(proc.cards('/office', 0).map((c) => [c.id, c.excluded]));
  assert.deepEqual(excluded, { a: false, b: true, r: true }, 'a card unchanged since the first read is not a change');
  const day = proc.days('/office', '2026-01-01').find((d) => d.agentId === 'pam');
  assert.deepEqual([day.tasks, day.emails, day.sent, day.awayPieces], [1, 5, 1, 3]);
});

test('plan headroom keeps the most constrained live window at its own length, and an API key shows none', (t) => {
  // Value: protects=the plan pace warning; fails_when=an expired or unreadable window is taken, a five hour window is measured as a week (or the reverse), a reading with no window clears the last one, or an API key shows plan headroom; why_new=PulseService.noteRateLimits had no test (OfficeBreak's reader has its own); seam=none; no_claim=Claude Code's status line shape beyond rate_limits
  const H = 3_600_000, D = 86_400_000;
  const { svc, clock } = service(t);
  const now = clock.now();
  svc.noteRateLimits({
    five_hour: { used_percentage: 40, resets_at: (now + H) / 1000 },
    seven_day: { used_percentage: 90, resets_at: (now + 2 * D) / 1000 },
    seven_day_opus: { used_percentage: 99, resets_at: (now - 1000) / 1000 }, // already reset
    broken: { used_percentage: '95', resets_at: (now + H) / 1000 }
  }, now);
  let h = svc.snapshot('this-week').headroom;
  assert.deepEqual([h.usedPct, h.resetsAt], [90, now + 2 * D]);
  // A week long window that began 5 days ago, 90% used: it runs out at 100/90 of the time so far.
  assert.ok(Math.abs(h.runsOutAt - (now - 5 * D + (100 / 90) * 5 * D)) < 1, `runsOutAt ${h.runsOutAt}`);
  svc.noteRateLimits({}, now);
  svc.noteRateLimits(null, now);
  assert.equal(svc.snapshot('this-week').headroom.usedPct, 90, 'a reading with no live window keeps the last one');
  svc.noteRateLimits({ five_hour: { used_percentage: 95, resets_at: (now + H) / 1000 } }, now);
  h = svc.snapshot('this-week').headroom;
  assert.ok(h.runsOutAt !== null && Math.abs(h.runsOutAt - (now - 4 * H + (100 / 95) * 4 * H)) < 1, 'a five hour window is five hours long');
  const onKey = service(t, { billing: 'apiKey' });
  onKey.svc.noteRateLimits({ seven_day: { used_percentage: 90, resets_at: (now + 2 * D) / 1000 } }, onKey.clock.now());
  assert.equal(onKey.svc.snapshot('this-week').headroom, null);
});

test('suggestions wait for 14 days of live records; a backfill never starts them early, and an office with no data shows nothing', (t) => {
  // Value: protects=recommendations only from enough live evidence; fails_when=the wait counts from the backfill's first day, advice shows before 14 live days, adviceFrom names the wrong day, the gate never opens, or a missing office shows data; why_new=the gate was only pinned in the view's source; seam=none; no_claim=none beyond protects
  const env = setup(t);
  const T = new Date(2026, 8, 1, 9).getTime();
  env.clock.at(T);
  env.store.record({ agentId: 'toby', kind: 'email', ts: T - 20 * 86_400_000, value: 1, attrs: { bf: 1 } });
  for (let i = 0; i < 12; i++) { // twelve runs over three days, none found work
    const at = T + i * 6 * 3600_000;
    env.store.record({ agentId: 'toby', kind: 'run-dispatch', ts: at, attrs: { mission: 'm1' } });
    env.store.record({ agentId: 'toby', kind: 'prompt', ts: at + 1000 });
    env.store.record({ agentId: 'toby', kind: 'stop', ts: at + 2000 });
    env.clock.at(at + 2000 + 3 * 60_000);
    env.proc.tick('/office');
  }
  const deps = (office) => ({
    db: () => env.persist.database(), store: env.store, processor: env.proc, office: () => office,
    members: () => [{ id: 'toby', isGod: false }], godId: () => 'god', tasks: () => [],
    missions: () => [{ id: 'm1', label: 'Inbox check', to: 'toby', intervalMs: 6 * 3600_000, body: '', enabled: true, kind: 'dispatch' }],
    models: () => [], ladder: () => [], priceOf: () => undefined, applyMissions: () => ({ ok: false, error: 'not found' }),
    billing: () => 'account', plan: () => null, memory: () => ({ notes: [], procedures: {} }), now: env.clock.now
  });
  const svc = new PulseService(deps('/office'));
  const early = svc.snapshot('this-week');
  assert.deepEqual([early.collectingSince, early.liveSince], ['2026-08-12', '2026-09-01']);
  assert.deepEqual(early.advice, [], 'enough runs, but only three days of live records');
  assert.equal(early.adviceFrom, '2026-09-15');
  env.clock.at(new Date(2026, 8, 15, 0, 0, 1).getTime());
  const ready = svc.snapshot('this-week');
  assert.equal(ready.adviceFrom, null);
  assert.deepEqual(ready.advice.map((a) => [a.kind, a.missionId]), [['run-less', 'm1']]);
  const none = new PulseService(deps(null)).snapshot('this-week');
  assert.deepEqual([none.available, none.advice, none.plan, none.collectingSince], [false, [], null, null]);
});

test('a Claude member\'s transcript total never reaches Pulse cost; an engine with no live numbers keeps its own per session', () => {
  // Value: protects=Spent and each member's cost read the real spend; fails_when=a transcript fallback sample (the whole session's total, no session id) is stored for a Claude member beside its live numbers, or other engines lose their only cost source; why_new=ship review 2026-10-16, the fallback was counted again after each launch; seam=none; no_claim=the sampling loop itself runs in main (source pin)
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.match(src, /if \(sample && \(sample\.sessionId \|\| \(a\.provider \?\? 'claude'\) !== 'claude'\)\) \{\s*pulseTelemetry\.cost\(id, sample\.sessionId \|\| `transcript:\$\{hive\.lastSession\(id\) \?\? ''\}`/);
  assert.doesNotMatch(src, /pulseTelemetry\.cost\(id, sample\.sessionId \|\| 'transcript'/);
});
