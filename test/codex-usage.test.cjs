'use strict';

/**
 * readCodexUsage: a Codex agent's token usage from its rollout transcripts.
 * Records below are trimmed from a real Codex CLI rollout (token_count events
 * carry the session's running total; input includes cached tokens).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { readCodexUsage, findRollout, readCodexContext, contextFromRolloutTail } = loadTs('src/main/codexUsage.ts');

const SID = '019f389f-690d-7e41-9fc2-dbf46e83b18a';

function tokenCount(input, cached, output, reasoning) {
  const t = { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output };
  return JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: t, last_token_usage: t } } });
}
const turnContext = (model) => JSON.stringify({ type: 'turn_context', payload: { model, cwd: '/tmp/x' } });
const meta = JSON.stringify({ type: 'session_meta', payload: { id: SID } });

function makeHome(lines, sid = SID) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  const day = path.join(home, 'sessions', '2026', '07', '06');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-07-06T14-10-02-${sid}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
  return { home, file };
}

test('the last running total wins, with cached input split out', () => {
  const { home } = makeHome([
    meta,
    turnContext('gpt-5'),
    tokenCount(12811, 9600, 231, 0),
    tokenCount(29879, 19200, 642, 108)
  ]);
  const u = readCodexUsage(home, SID);
  assert.equal(u.inputTokens, 29879 - 19200);
  assert.equal(u.cacheReadTokens, 19200);
  assert.equal(u.outputTokens, 642);
  assert.equal(u.cacheWriteTokens, 0);
  assert.equal(u.model, 'gpt-5');
  const expected = (10679 * 1.25 + 642 * 10 + 19200 * 0.125) / 1_000_000;
  assert.ok(Math.abs(u.estimatedCostUsd - expected) < 1e-12);
});

test('appended turns are picked up on the next read', () => {
  const { home, file } = makeHome([turnContext('gpt-5'), tokenCount(100, 0, 10, 0)]);
  assert.equal(readCodexUsage(home, SID).outputTokens, 10);
  fs.appendFileSync(file, `${tokenCount(300, 100, 40, 0)}\n`);
  const u = readCodexUsage(home, SID);
  assert.equal(u.outputTokens, 40);
  assert.equal(u.cacheReadTokens, 100);
});

test('a torn last line is not counted until it is complete', () => {
  const { home, file } = makeHome([turnContext('gpt-5'), tokenCount(100, 0, 10, 0)]);
  const next = tokenCount(500, 0, 99, 0);
  fs.appendFileSync(file, next.slice(0, 30));
  assert.equal(readCodexUsage(home, SID).outputTokens, 10);
  fs.appendFileSync(file, `${next.slice(30)}\n`);
  assert.equal(readCodexUsage(home, SID).outputTokens, 99);
});

test('rate-limit-only updates (info: null) leave the totals alone', () => {
  const { home } = makeHome([
    turnContext('gpt-5'),
    tokenCount(100, 0, 10, 0),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } })
  ]);
  assert.equal(readCodexUsage(home, SID).outputTokens, 10);
});

test('another session in the same home is not counted', () => {
  const { home } = makeHome([turnContext('gpt-5'), tokenCount(100, 0, 10, 0)]);
  const u = readCodexUsage(home, '019f0000-0000-7000-8000-000000000000');
  assert.equal(u.outputTokens, 0);
  assert.equal(u.estimatedCostUsd, 0);
});

test('a missing home or a path-like session id reads as zero', () => {
  assert.equal(readCodexUsage(path.join(os.tmpdir(), 'no-such-codex-home'), SID).inputTokens, 0);
  const { home } = makeHome([tokenCount(100, 0, 10, 0)]);
  assert.equal(findRollout(home, '../../etc'), null);
});

// Context gauge (TODOS.md, second engine gap 2): the gauge read only Claude
// transcripts, so a Codex member's stayed empty.

function lastTurn(input, output, reasoning = 0, window) {
  const total = { input_tokens: 999999, cached_input_tokens: 0, output_tokens: 999999, reasoning_output_tokens: 0, total_tokens: 1999998 };
  const last = { input_tokens: input, cached_input_tokens: Math.floor(input / 2), output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output };
  const info = { total_token_usage: total, last_token_usage: last };
  if (window !== undefined) info.model_context_window = window;
  return JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info } });
}
const rateLimitsOnly = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: {} } });

test('the context is the last turn, not the running total, reasoning included as Codex counts it', () => {
  // Value: protects=a Codex member's gauge shows its current context the way Codex does; fails_when=the gauge reads the session total, an older turn, or drops reasoning; why_new=the gauge read Claude transcripts only; seam=none; no_claim=the renderer's drawing
  const { home } = makeHome([meta, turnContext('gpt-5'), lastTurn(12000, 300), lastTurn(103790, 5225, 4332), rateLimitsOnly]);
  assert.equal(readCodexContext(home, SID).tokens, 103790 + 5225);
});

test('the window the rollout names comes back as the limit, and none without it', () => {
  // Value: protects=the gauge is sized by the model's real window; fails_when=a Codex member is sized as 200k or 1M; why_new=review asked for model_context_window; seam=none; no_claim=other engines
  const withWindow = makeHome([meta, lastTurn(103790, 5225, 4332, 258400)]);
  assert.deepEqual(readCodexContext(withWindow.home, SID), { tokens: 109015, limit: 258400 });
  const without = makeHome([meta, lastTurn(8000, 80)]);
  assert.deepEqual(readCodexContext(without.home, SID), { tokens: 8080 });
  assert.deepEqual(contextFromRolloutTail(lastTurn(8000, 80, 0, null)), { tokens: 8080 });
});

test('a fresh session reads 0, and no rollout reads null', () => {
  // Value: protects=a restarted member's gauge resets and an unknown one stays blank; fails_when=a fresh session keeps the old value or a missing file reads 0; why_new=new reader; seam=none; no_claim=when the renderer polls
  const { home } = makeHome([meta, turnContext('gpt-5'), rateLimitsOnly]);
  assert.deepEqual(readCodexContext(home, SID), { tokens: 0 });
  assert.equal(readCodexContext(home, '019f389f-0000-0000-0000-000000000000'), null);
  assert.equal(readCodexContext(home, '../escape'), null);
});

test('a tail cut mid record still finds the last counted turn', () => {
  // Value: protects=the tail read survives a torn first line and trailing junk; fails_when=a partial line or a later non count record hides the value; why_new=new reader; seam=none; no_claim=files over the tail size
  const text = lastTurn(5000, 50).slice(20) + '\n' + lastTurn(8000, 80) + '\n' + turnContext('gpt-5') + '\n{"type":"event_msg","payl';
  assert.deepEqual(contextFromRolloutTail(text), { tokens: 8080 });
  assert.equal(contextFromRolloutTail(''), null);
});

test('the gauge reads a Codex member from its rollout, sized and polled by its window', () => {
  // Value: protects=the handler takes the Codex path and the poll uses and keeps following its window; fails_when=hive:agentContext is unhooked, the limit is dropped, or a Codex member stops being polled; why_new=new branch and review; seam=source pin like the neighbouring tests, no IPC harness; no_claim=runtime display
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  assert.match(read('src/main/index.ts'), /ipcMain\.handle\('hive:agentContext'[\s\S]{0,400}hive\.codexHome\(agentId\)[\s\S]{0,200}readCodexContext\(codexHome, sessionId\)/);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /a\.contextLimit !== undefined && !sizedByPoll\.has\(a\.id\)/);
  assert.match(hive, /contextLimit: ctx\.limit/);
});
