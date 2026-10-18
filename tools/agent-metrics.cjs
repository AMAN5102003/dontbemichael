#!/usr/bin/env node
'use strict';

/**
 * Measure compaction, clearing and memory from an office's own files (owner,
 * 2026-09-25). Read only: nothing in the office is changed.
 *
 *   node tools/agent-metrics.cjs [--home ~/HarnessAgents] [--db <harness.db>] [--days 7] [--json]
 *
 * Reads <home>/hive/log.jsonl (compact, clear*, memory-tidy*, memory-read) and
 * the cost ledger (tokens and dollars per agent per day): the app's harness.db
 * once it has copied the office's old hive/cost-ledger.jsonl in (D17), else
 * that file. Ledger rows are running totals per (agent, session) that restart
 * at zero when the app restarts, so a drop is read as a restart and the new
 * value counts whole, the same rule as src/main/costLifetime.ts.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DAY = 24 * 60 * 60 * 1000;
const FIELDS = ['input', 'output', 'cache_read', 'cache_creation', 'usd'];

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/** Where the app keeps harness.db (index.ts pins its data folder to this name). */
function defaultDb() {
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(base, 'dontbemichael', 'harness.db');
}

/** The office's ledger rows from harness.db, oldest first, or null when it
 *  cannot be opened here or has not copied this office's file in yet. Node 22
 *  has node:sqlite; under Electron's Node, better-sqlite3 opens it. */
function readLedgerTable(dbFile, office) {
  let db = null;
  try {
    try { db = new (require('node:sqlite').DatabaseSync)(dbFile, { readOnly: true }); } catch { db = new (require('better-sqlite3'))(dbFile, { readonly: true, fileMustExist: true }); }
    const mark = db.prepare('SELECT value FROM kv WHERE key = ?').get(`cost-ledger:import:${office}`);
    if (!mark || JSON.parse(mark.value).done !== true) return null;
    return db.prepare('SELECT agent_id, session_id, ts, input, output, cache_read, cache_creation, model, usd FROM cost_ledger WHERE office = ? ORDER BY id').all(office);
  } catch { return null; } finally { try { db?.close(); } catch { /* read only */ } }
}

const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const countBy = (xs, key) => xs.reduce((acc, x) => { const k = String(x[key] ?? 'unknown'); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

/** Tokens and dollars spent per agent per day, from the running totals. */
function usageByDay(ledger, since) {
  const last = new Map();
  const out = {};
  for (const r of ledger) {
    if (!r || typeof r.ts !== 'number' || !r.agent_id) continue;
    const key = `${r.agent_id}\u0000${r.session_id ?? ''}`;
    const prev = last.get(key);
    last.set(key, r);
    if (r.ts < since) continue;
    const bucket = ((out[r.agent_id] ??= {})[day(r.ts)] ??= { input: 0, output: 0, cache_read: 0, cache_creation: 0, usd: 0 });
    for (const f of FIELDS) {
      const now = Number(r[f]) || 0;
      const before = prev ? Number(prev[f]) || 0 : 0;
      bucket[f] += now >= before ? now - before : now;
    }
  }
  for (const days of Object.values(out)) {
    for (const b of Object.values(days)) {
      b.tokens = b.input + b.output + b.cache_read + b.cache_creation;
      b.usd = Math.round(b.usd * 100) / 100;
    }
  }
  return out;
}

function buildReport({ log, ledger, now = Date.now(), days = 7 }) {
  const since = now - days * DAY;
  const recent = log.filter((e) => e && typeof e.ts === 'number' && e.ts >= since);
  const of = (kind) => recent.filter((e) => e.kind === kind);

  const compacts = of('compact');
  const asked = of('clear-handoff-asked');
  const clears = of('clear');
  const cancelled = of('clear-cancelled');
  const tidies = of('memory-tidy');
  const aborts = of('memory-tidy-abort');
  const reads = of('memory-read');
  const sum = (xs, k) => xs.reduce((n, x) => n + (Number(x[k]) || 0), 0);

  return {
    days,
    since: new Date(since).toISOString(),
    compaction: {
      total: compacts.length,
      byTrigger: countBy(compacts, 'trigger'),
      byAgent: countBy(compacts, 'agentId')
    },
    clearing: {
      handoffsAsked: asked.length,
      cleared: clears.length,
      cancelled: cancelled.length,
      cancelledBy: countBy(cancelled, 'reason'),
      tokensBeforeClear: { median: median(clears.map((c) => Number(c.tokensBefore) || 0)), max: Math.max(0, ...clears.map((c) => Number(c.tokensBefore) || 0)) },
      byAgent: countBy(clears, 'agentId')
    },
    memory: {
      tidied: tidies.length,
      notesTaken: sum(tidies, 'notes'),
      added: sum(tidies, 'added'),
      updated: sum(tidies, 'updated'),
      deleted: sum(tidies, 'deleted'),
      repeatedOwnerCorrections: sum(tidies, 'repeats'),
      proceduresSaved: sum(tidies, 'procedures'),
      indexOverBudget: tidies.filter((t) => t.overBudget).length,
      aborted: aborts.length,
      abortedBy: countBy(aborts, 'reason'),
      lastAbortDetail: aborts.length ? String(aborts[aborts.length - 1].detail ?? '') : '',
      notesRead: reads.length,
      proceduresRead: reads.filter((r) => /procedures?\//.test(String(r.file ?? ''))).length
    },
    usage: usageByDay(ledger, since)
  };
}

function render(r) {
  const lines = [];
  lines.push(`Office measures, last ${r.days} days (since ${r.since.slice(0, 10)})`, '');
  lines.push('Compaction');
  lines.push(`  ${r.compaction.total} compactions ${JSON.stringify(r.compaction.byTrigger)}`);
  for (const [a, n] of Object.entries(r.compaction.byAgent)) lines.push(`    ${a}: ${n}`);
  lines.push('', 'Clearing');
  lines.push(`  handoffs asked ${r.clearing.handoffsAsked}, cleared ${r.clearing.cleared}, cancelled ${r.clearing.cancelled} ${JSON.stringify(r.clearing.cancelledBy)}`);
  lines.push(`  size before clear: median ${r.clearing.tokensBeforeClear.median} tokens, max ${r.clearing.tokensBeforeClear.max}`);
  lines.push('', 'Memory');
  const m = r.memory;
  lines.push(`  tidy ups ${m.tidied} (notes ${m.notesTaken}: added ${m.added}, updated ${m.updated}, deleted ${m.deleted}), over budget ${m.indexOverBudget}`);
  lines.push(`  repeated owner corrections ${m.repeatedOwnerCorrections}, procedures saved ${m.proceduresSaved}, notes read ${m.notesRead}, procedures read ${m.proceduresRead}`);
  lines.push(`  tidy ups aborted ${m.aborted} ${JSON.stringify(m.abortedBy)}`);
  if (m.lastAbortDetail) lines.push(`    last: ${m.lastAbortDetail.slice(0, 200)}`);
  lines.push('', 'Tokens and dollars per agent per day');
  for (const [agent, days] of Object.entries(r.usage).sort()) {
    for (const [d, b] of Object.entries(days).sort()) {
      if (b.tokens === 0 && b.usd === 0) continue;
      lines.push(`  ${d}  ${agent.padEnd(12)} ${String(b.tokens).padStart(12)} tokens  $${b.usd.toFixed(2)}`);
    }
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const home = (arg('--home') ?? path.join(os.homedir(), 'HarnessAgents')).replace(/^~(?=$|\/)/, os.homedir());
  const days = Number(arg('--days') ?? 7) || 7;
  const hive = path.join(home, 'hive');
  const ledger = readLedgerTable(arg('--db') ?? defaultDb(), path.resolve(home)) ?? readJsonl(path.join(hive, 'cost-ledger.jsonl'));
  const report = buildReport({ log: readJsonl(path.join(hive, 'log.jsonl')), ledger, days });
  process.stdout.write((argv.includes('--json') ? JSON.stringify(report, null, 2) : render(report)) + '\n');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { buildReport, usageByDay, render, readLedgerTable };
