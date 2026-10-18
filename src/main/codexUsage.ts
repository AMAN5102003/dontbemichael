import { closeSync, fstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { estimateCostUsd, normalizeModel } from './pricing';
import type { AgentUsage } from './transcript';

/**
 * Token usage for a Codex agent, read from its rollout transcripts — the Codex
 * counterpart of readAgentUsage, which only knows the default engine's
 * transcript layout.
 *
 * A hive Codex worker runs under its own CODEX_HOME (<agent>/.codex, see
 * installCodexHooks), and Codex writes each session to
 * `<CODEX_HOME>/sessions/<Y>/<M>/<D>/rollout-<time>-<sessionId>.jsonl`. Every
 * model turn appends an event like
 *
 *   {"type":"event_msg","payload":{"type":"token_count","info":{
 *     "total_token_usage":{"input_tokens":29879,"cached_input_tokens":19200,
 *       "output_tokens":642,"reasoning_output_tokens":108,"total_tokens":30521},
 *     "last_token_usage":{...}}}}
 *
 * `total_token_usage` is already the session's running total, so only the LAST
 * one counts. Its input_tokens INCLUDES the cached ones, and output_tokens
 * includes reasoning (total = input + output), so the split we report is
 * fresh input = input − cached, cache read = cached, no cache writes. The model
 * comes from the latest `turn_context` record.
 */

interface RolloutEntry {
  size: number;
  mtimeMs: number;
  /** Bytes parsed so far; always ends on a newline (a torn line is re-read). */
  offset: number;
  input: number;
  cached: number;
  output: number;
  model?: string;
}

const rolloutCache = new Map<string, RolloutEntry>();
/** home|sessionId → the rollout file that holds it, so a beat doesn't walk the tree. */
const rolloutPaths = new Map<string, string>();
const CACHE_MAX = 512;

/** Codex session ids are UUIDs; anything else never reaches a path. */
const VALID_SESSION_ID = /^[A-Za-z0-9-]+$/;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function zero(): AgentUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0 };
}

/** Find `rollout-*-<sessionId>.jsonl` under `<codexHome>/sessions`. */
export function findRollout(codexHome: string, sessionId: string): string | null {
  if (!sessionId || !VALID_SESSION_ID.test(sessionId)) return null;
  // Keyed by home too: a resumed session can be pointed at another agent's home.
  const key = `${codexHome}|${sessionId}`;
  const known = rolloutPaths.get(key);
  if (known) {
    try { statSync(known); return known; } catch { rolloutPaths.delete(key); }
  }
  const root = path.join(codexHome, 'sessions');
  const suffix = `-${sessionId}.jsonl`;
  let names: string[];
  try {
    names = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return null;
  }
  const hit = names.find((n) => path.basename(n).startsWith('rollout-') && n.endsWith(suffix));
  if (!hit) return null;
  const full = path.join(root, hit);
  rolloutPaths.set(key, full);
  if (rolloutPaths.size > CACHE_MAX) rolloutPaths.clear();
  return full;
}

function parseRolloutLines(text: string, entry: RolloutEntry): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: {
      type?: unknown;
      payload?: { type?: unknown; model?: unknown; info?: { total_token_usage?: Record<string, unknown> } | null };
    };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const p = rec.payload;
    if (!p) continue;
    if (rec.type === 'turn_context' && typeof p.model === 'string') {
      entry.model = normalizeModel(p.model);
    } else if (rec.type === 'event_msg' && p.type === 'token_count') {
      const t = p.info?.total_token_usage;
      if (!t) continue; // a rate-limit-only update carries info: null
      entry.input = num(t.input_tokens);
      entry.cached = num(t.cached_input_tokens);
      entry.output = num(t.output_tokens);
    }
  }
}

/** Latest totals for one rollout, parsing only what was appended since the last
 *  call (rollouts are append-only, like the other transcripts). */
function readRollout(file: string): RolloutEntry | null {
  let st: { size: number; mtimeMs: number };
  try { st = statSync(file); } catch { rolloutCache.delete(file); return null; }
  const cached = rolloutCache.get(file);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached;
  const entry: RolloutEntry = !cached || st.size < cached.offset
    ? { size: st.size, mtimeMs: st.mtimeMs, offset: 0, input: 0, cached: 0, output: 0 }
    : { ...cached, size: st.size, mtimeMs: st.mtimeMs };
  try {
    const fd = openSync(file, 'r');
    try {
      const len = st.size - entry.offset;
      if (len > 0) {
        const buf = Buffer.alloc(len);
        const read = readSync(fd, buf, 0, len, entry.offset);
        const text = buf.subarray(0, read).toString('utf8');
        const lastNl = text.lastIndexOf('\n');
        if (lastNl !== -1) {
          const complete = text.slice(0, lastNl + 1);
          parseRolloutLines(complete, entry);
          entry.offset += Buffer.byteLength(complete, 'utf8');
        }
      }
    } finally { closeSync(fd); }
  } catch {
    // Unreadable right now; keep what we have and retry on the next beat.
  }
  rolloutCache.set(file, entry);
  if (rolloutCache.size > CACHE_MAX) {
    let drop = rolloutCache.size - CACHE_MAX / 2;
    for (const k of rolloutCache.keys()) { if (drop-- <= 0) break; rolloutCache.delete(k); }
  }
  return entry;
}

/** Cumulative usage of one Codex session, priced by its model. Zeros when the
 *  rollout isn't there (yet) or can't be read. */
export function readCodexUsage(codexHome: string, sessionId: string): AgentUsage {
  try {
    const file = findRollout(codexHome, sessionId);
    if (!file) return zero();
    const e = readRollout(file);
    if (!e) return zero();
    const fresh = Math.max(0, e.input - e.cached);
    const usage: AgentUsage = {
      inputTokens: fresh,
      outputTokens: e.output,
      cacheReadTokens: e.cached,
      cacheWriteTokens: 0,
      estimatedCostUsd: estimateCostUsd(e.model, {
        inputTokens: fresh,
        outputTokens: e.output,
        cacheReadTokens: e.cached,
        cacheWriteTokens: 0
      })
    };
    if (e.model) usage.model = e.model;
    return usage;
  } catch {
    return zero();
  }
}

/** How much of the file's end a context read looks at: the last token_count
 *  sits near the end, and rollouts grow to many MB (as readContextTokens). */
const CONTEXT_TAIL_BYTES = 256 * 1024;

/** A Codex session's context fill: tokens in the window, and the window's size
 *  when the rollout names it (`model_context_window`). */
export interface CodexContext {
  tokens: number;
  limit?: number;
}

/** The context in the tail of a rollout: the LAST token_count's
 *  `last_token_usage`, counted the way Codex counts its own "context left"
 *  (`tokens_in_context_window` in codex-rs/protocol: the turn's total_tokens,
 *  reasoning included), with input plus output when total_tokens is missing.
 *  Null when no turn has been counted yet. The first line of a tail may be cut
 *  mid-record; it fails to parse and is skipped. */
export function contextFromRolloutTail(text: string): CodexContext | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let rec: {
      type?: unknown;
      payload?: { type?: unknown; info?: { last_token_usage?: Record<string, unknown>; model_context_window?: unknown } | null };
    };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (rec.type !== 'event_msg' || rec.payload?.type !== 'token_count') continue;
    const info = rec.payload.info;
    const last = info?.last_token_usage;
    if (!last) continue; // a rate-limit-only update carries info: null
    const total = num(last.total_tokens);
    const ctx: CodexContext = { tokens: total > 0 ? total : num(last.input_tokens) + num(last.output_tokens) };
    const window = num(info?.model_context_window);
    if (window > 0) ctx.limit = window;
    return ctx;
  }
  return null;
}

/** Current context of a Codex session, for the context gauge: the Codex
 *  counterpart of readContextTokens. Null when the rollout isn't there (yet)
 *  or can't be read; 0 tokens when it holds no counted turn, so a fresh
 *  session zeroes the gauge instead of leaving the last one's value up. */
export function readCodexContext(codexHome: string, sessionId: string): CodexContext | null {
  try {
    const file = findRollout(codexHome, sessionId);
    if (!file) return null;
    const fd = openSync(file, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, CONTEXT_TAIL_BYTES);
      if (len === 0) return { tokens: 0 };
      const buf = Buffer.alloc(len);
      const read = readSync(fd, buf, 0, len, size - len);
      return contextFromRolloutTail(buf.subarray(0, read).toString('utf8')) ?? { tokens: 0 };
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}
