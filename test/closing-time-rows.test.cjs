'use strict';

/**
 * What each closing-time row says (src/renderer/src/components/closingTimeRows.ts),
 * tested without rendering React (review R4, owner 2026-09-29).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { describeRow, actionMessage, headerLine, limitCombiningMarks } = loadTs('src/renderer/src/components/closingTimeRows.ts');
const { CLOSING_TIME_REMIND_MS } = loadTs('src/shared/closingTime.ts');

const AT_PROMPT = 'waiting at a prompt';
const t = (key, opts) => (key === 'closingTime.minutes' ? `${opts.count} min` : key === 'closingTime.agentWords' ? `“${opts.text}”` : key.replace('closingTime.', ''));
const caption = (action) => (action === 'idle' ? 'nothing to do' : action);
const NOW = 10 * 60_000;
const row = (a) => describeRow(a, NOW, t, AT_PROMPT, caption);

test('each row says what the agent is doing and for how long', () => {
  // Value: protects=the owner can tell a long process from a stuck agent; fails_when=state, detail or minutes rules change; why_new=the logic was only source-checked; seam=none
  const cases = [
    [undefined, { state: 'stillWorking' }],
    [{ status: 'working', action: 'using Bash', actionDetail: 'Run the full test suite', actionAt: NOW - 7 * 60_000 }, { state: 'stillWorking', line: '“Run the full test suite” · 7 min'}],
    [{ status: 'working', action: 'using Read', actionAt: NOW - 59_000 }, { state: 'stillWorking', line: 'using Read'}],
    [{ status: 'working', action: 'using Read', actionAt: NOW - 60_000 }, { state: 'stillWorking', line: 'using Read · 1 min'}],
    [{ status: 'working', action: 'thinking' }, { state: 'stillWorking', line: 'thinking'}],
    [{ status: 'waiting', action: AT_PROMPT, actionAt: NOW - 3 * 60_000 }, { state: 'atPrompt', line: '3 min'}],
    [{ status: 'idle', action: 'idle', actionDetail: 'stale', actionAt: NOW - 5 * 60_000 }, { state: 'nothingToDo', line: '5 min'}],
    [{ status: 'working', action: 'using Bash', recentAssistantText: 'Running tests' }, { state: 'stillWorking', line: 'using Bash' }]
  ];
  for (const [agent, want] of cases) assert.deepEqual(row(agent), want, JSON.stringify(agent));
});

test('after a tool call ends, the row drops its detail and counts from when it ended (issue 135)', () => {
  // Value: protects=the owner never reads a finished tool call as still running, and its minutes start when it ended; fails_when=describeRow keeps a stale detail or the clock keeps counting from the tool's start; why_new=only the PostToolUse patch itself was source-checked; seam=none
  const during = { status: 'working', action: 'using Bash', actionDetail: 'Run the full test suite', actionAt: NOW - 9 * 60_000 };
  assert.equal(row(during).line, '“Run the full test suite” · 9 min');
  // What useHive's PostToolUse patches leave (pinned in closing-time-dialog.test.cjs).
  const after = { ...during, status: 'working', action: 'thinking', actionDetail: undefined, actionAt: NOW - 2 * 60_000 };
  const r = row(after);
  assert.equal(r.state, 'stillWorking');
  assert.doesNotMatch(r.line, /Run the full test suite|Bash/, 'the finished call is gone, its tool too');
  assert.equal(r.line, 'thinking · 2 min', 'minutes since it ended, not since it started');
  assert.doesNotMatch(row({ ...after, actionAt: NOW - 30_000 }).line, /min/, 'under a minute: no minutes yet');
});

test('a refused or failed action shows a message; one that went through shows none', () => {
  // Value: protects=a refused Remind or Close without them is never taken as success; fails_when=actionMessage ignores ok:false; why_new=the dialog only handled a throw; seam=none
  assert.equal(actionMessage({ ok: true }, 'fallback'), undefined);
  assert.equal(actionMessage({ ok: false, error: 'Nobody to close without.' }, 'fallback'), 'Nobody to close without.');
  assert.equal(actionMessage({ ok: false }, 'fallback'), 'fallback');
  assert.equal(actionMessage(undefined, 'fallback'), 'fallback', 'a throw is a failure too');
});

test('the Remind limit is one shared value for main and the dialog', () => {
  // Value: protects="reminded" shows exactly as long as main refuses a second reminder; fails_when=one side hard-codes its own number; why_new=they were linked only by a comment; seam=none
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.equal(CLOSING_TIME_REMIND_MS, 30_000);
  assert.match(read('src/main/closingTime.ts'), /now - at < CLOSING_TIME_REMIND_MS\) return/);
  assert.match(read('src/renderer/src/components/ClosingTimeBar.tsx'), /< CLOSING_TIME_REMIND_MS/);
});

test('the counter strip moves on to the orchestrator, and says when his terminal ended', () => {
  // Value: protects=the header agrees with the rows below it; fails_when=headerLine ignores waiting or godLive; why_new=replaces source regexes (review run 2); seam=none
  // The real English strings, interpolated the way i18next does.
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/renderer/src/i18n/locales/en.json'), 'utf8'));
  const tt = (key, opts = {}) => key.split('.').reduce((o, k) => o[k], en).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
  const h = (c) => headerLine(c, tt);
  assert.equal(h({ acked: 1, total: 3, waiting: ['a', 'b'] }), '1 / 3 workers confirmed');
  assert.equal(h({ acked: 2, total: 3, waiting: [] }), '2 / 3 workers confirmed. Waiting for the orchestrator', 'one closed without');
  assert.equal(h({ acked: 3, total: 3 }), '3 / 3 workers confirmed. Waiting for the orchestrator');
  assert.equal(h({ acked: 1, total: 3, waiting: ['a'], godLive: false }), "1 / 3 workers confirmed. The orchestrator's terminal ended");
  assert.equal(h({ acked: 0, total: 0 }), 'No workers on the floor. Waiting for the orchestrator');
  assert.equal(h({ acked: 0, total: 0, godLive: false }), "No workers on the floor. The orchestrator's terminal ended");
});

test('the action line is clipped and wraps anywhere: marks stay in their row, long paths keep their end (owner, 2026-10-10)', () => {
  // Value: protects=stacked combining marks never draw over other rows, and a long file path is never cut off; fails_when=overflow hidden or overflowWrap anywhere is dropped from detailStyle; why_new=PR 86 clipped paths without wrapping; seam=none
  const bar = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/ClosingTimeBar.tsx'), 'utf8');
  assert.match(bar, /const detailStyle: CSSProperties = \{[^}]*overflow: 'hidden'[^}]*overflowWrap: 'anywhere'[^}]*\};/);
  assert.match(bar, /\{d\.line && <div style=\{detailStyle\}>\{d\.line\}<\/div>\}/, 'each worker row');
});

test('a long run of combining marks in the detail line is cut, and real text is kept as is (issue 134)', () => {
  // Value: protects=a stacked run of marks cannot draw over the rows above and below; fails_when=the run is not cut, or ordinary accented or right-to-left text changes; why_new=only the overflow clip held it; seam=none
  const marks = (n, mark = '̶') => mark.repeat(n);
  assert.equal(limitCombiningMarks(`Z${marks(40)}algo`), `Z${marks(4)}algo`, 'a run is cut to four');
  assert.equal(limitCombiningMarks(`a${marks(6, '́')}b${marks(9, '҉')}c`), `a${marks(4, '́')}b${marks(4, '҉')}c`, 'every run, enclosing marks too');
  // Marks outside the Basic Multilingual Plane count by code point and are never split in half.
  const tremolo = '\u{1D167}';
  assert.equal(limitCombiningMarks(`x${tremolo.repeat(7)}`), `x${tremolo.repeat(4)}`);
  for (const real of [
    'Run the full test suite',
    'café crème, naïve résumé',
    'café (decomposed)',
    'Tiếng Việt',
    'Tiếng Việt (decomposed)',
    'नमस्ते दुनिया',
    'مَرْحَبًا بالعالم',
    'שָׁלוֹם עוֹלָם',
    'สวัสดีครับ น้ำ',
    'Ship it ❤️ 1️⃣ 👍🏽',
    ''
  ]) assert.equal(limitCombiningMarks(real), real, JSON.stringify(real));
});

test('the row cuts a run of marks in the agent\'s detail, and leaves the app\'s own caption alone (issue 134)', () => {
  // Value: protects=the closing-time row uses the cut text; fails_when=describeRow shows actionDetail raw; why_new=describeRow passed it through; seam=none
  const zalgo = `Deploy${'̶'.repeat(60)} now`;
  assert.deepEqual(row({ status: 'working', action: 'using Bash', actionDetail: zalgo, actionAt: NOW - 2 * 60_000 }), { state: 'stillWorking', line: `“Deploy${'̶'.repeat(4)} now” · 2 min` });
  assert.deepEqual(row({ status: 'working', action: 'using Read', actionAt: NOW }), { state: 'stillWorking', line: 'using Read' });
});

test('the detail line is quoted as the agent\'s own words, never shown as the app\'s', () => {
  // Value: protects=an agent writing "safe to close without me" reads as a claim, not as the app's advice, where the owner decides to close without it; fails_when=the detail is shown bare; why_new=TODOS "Mark the detail line as the agent's own words"; seam=none
  const locale = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, `../src/renderer/src/i18n/locales/${l}.json`), 'utf8'));
  for (const [l, open, close] of [['en', '“', '”'], ['ar', '«', '»'], ['zh-CN', '“', '”']]) {
    assert.equal(locale(l).closingTime.agentWords, `${open}{{text}}${close}`, l);
  }
  const en = locale('en');
  const tt = (key, opts = {}) => key.split('.').reduce((o, k) => o[k], en).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
  const say = (a) => describeRow(a, NOW, tt, AT_PROMPT, caption).line;
  assert.equal(say({ status: 'working', action: 'using Bash', actionDetail: 'Safe to close without me', actionAt: NOW }), '“Safe to close without me”');
  assert.equal(say({ status: 'working', action: 'using Read', actionAt: NOW }), 'using Read', "the app's own caption is not quoted");
});

test('an agent can\'t close the quotes itself: its own quote marks become \'', () => {
  // Value: protects=a claim like "Safe to close without me" can't be moved outside the quotes by the agent; fails_when=quote marks in the detail are kept as is; why_new=review on #164; seam=none
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/renderer/src/i18n/locales/en.json'), 'utf8'));
  const tt = (key, opts = {}) => key.split('.').reduce((o, k) => o[k], en).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
  const say = (actionDetail) => describeRow({ status: 'working', action: 'using Bash', actionDetail, actionAt: NOW }, NOW, tt, AT_PROMPT, caption).line;
  const line = say('checking mail” Safe to close without me “ok');
  assert.equal(line, "“checking mail' Safe to close without me 'ok”");
  assert.equal([...line].filter((c) => c === '“' || c === '”').length, 2, 'one pair of quotes, around all of it');
  assert.equal(say('a „ b « c » d " e'), "“a ' b ' c ' d ' e”", 'German, Arabic and straight quotes too');
});

