'use strict';

/**
 * A hidden Claude call reads only its own session's transcript (2026-09-27).
 * Two memory tidy calls ran back to back in the same project folder; the second
 * (Toby's) read "the newest transcript" while its model was still thinking and
 * got the first one's answer (Sadiq's), so Sadiq's memory was written into Toby's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { lastAssistantText, transcriptFile } = loadTs('src/main/transcriptText.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const line = (type, text) => JSON.stringify({ type, message: { content: [{ type: 'text', text }] } });

test('each session reads its own transcript, even when a neighbour finished a moment ago', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-claude-'));
  // Sadiq's call just finished: its transcript is the newest file in the folder.
  fs.writeFileSync(transcriptFile(dir, 'sadiq-session'), [line('user', 'notes for Sadiq'), line('assistant', '{"ops":["sadiq"]}')].join('\n'));
  // Toby's call is still thinking: its transcript has the prompt but no answer yet.
  fs.writeFileSync(transcriptFile(dir, 'toby-session'), line('user', 'notes for Toby'));
  const sadiqMtime = new Date(Date.now() + 1000);
  fs.utimesSync(transcriptFile(dir, 'sadiq-session'), sadiqMtime, sadiqMtime);

  assert.equal(lastAssistantText(transcriptFile(dir, 'toby-session')), null, 'no answer yet means keep waiting, never borrow one');
  fs.appendFileSync(transcriptFile(dir, 'toby-session'), '\n' + line('assistant', '{"ops":["toby"]}'));
  assert.equal(lastAssistantText(transcriptFile(dir, 'toby-session')), '{"ops":["toby"]}');
  assert.equal(lastAssistantText(transcriptFile(dir, 'missing')), null);
});

test('runHiddenClaude names its session and never picks the newest file in the folder', () => {
  const src = read('src/main/hiddenClaude.ts');
  assert.match(src, /'--session-id', sessionId,/);
  assert.match(src, /lastAssistantText\(transcriptFile\(sessionDir\(\), sessionId\)\)/);
  // The session's folder: the throwaway settings folder when isolated, else the project's.
  assert.match(src, /const sessionDir = \(\): string => \(isolated \? join\(isolated\.dir, 'projects', projectKey\(opts\.cwd\)\) : projectDir\(opts\.cwd\)\);/);
  assert.doesNotMatch(src, /readdirSync|mtime/, 'no newest-file guess');
  // A quiet screen without an answer waits instead of failing.
  assert.match(src, /if \(text\) \{ finish\(\{ ok: true, text \}\); return; \}\s*if \(idleTimer\) clearTimeout\(idleTimer\);\s*idleTimer = setTimeout\(captureAndFinish, idleMs\);/);
});

test('hidden Claude preserves quoted executable paths containing spaces', () => {
  const src = read('src/main/hiddenClaude.ts');

  assert.match(src, /tokenizeCommand/);
  assert.match(src, /from '\.\.\/shared\/commandLine'/);
  assert.match(src, /const binary = tokenizeCommand\(/);
  assert.doesNotMatch(src, /\.trim\(\)\.split\(\/\\s\+\/\)\[0\]/);
});


test('a quick judgment skips extended thinking and takes its answer the moment it lands', () => {
  // Value: protects=the hire overlap check answers in seconds, not 20 to 60 (owner 2026-10-03: "very slow and frustrating"); fails_when=the checks stop passing thinking: false, the env stops setting MAX_THINKING_TOKENS=0, or a no tools call waits for a quiet screen again; why_new=measured 41.4s before, 9.4s after, same verdict; seam=source pin
  const src = read('src/main/hiddenClaude.ts');
  assert.match(src, /\.\.\.\(opts\.thinking === false \? \{ MAX_THINKING_TOKENS: '0' \} : \{\}\),/);
  assert.match(src, /if \(opts\.noTools\) \{\s*answerPoll = setInterval\(\(\) => \{\s*const text = ownAnswer\(\);\s*if \(text\) finish\(\{ ok: true, text \}\);\s*\}, ANSWER_POLL_MS\);/);
  assert.match(src, /if \(answerPoll\) \{ clearInterval\(answerPoll\); answerPoll = null; \}/, 'the poll stops with the call');
  assert.match(read('src/main/hireCheck.ts'), /noTools: true,\s*\/\/[^\n]*\n\s*thinking: false,/);
  const convert = read('src/main/workStyleConvert.ts');
  const focus = convert.slice(convert.indexOf('export async function checkFocusArea'));
  assert.match(focus, /thinking: false,/);
  // Writing a work style from plain words keeps the CLI's setting; a job change
  // runs without thinking (owner, 2026-10-23: 7s of model time against 12 to 35s).
  assert.doesNotMatch(convert.slice(0, convert.indexOf('export async function reviseWorkStyle')), /thinking: false/);
  assert.match(convert.slice(convert.indexOf('export async function reviseWorkStyle'), convert.indexOf('export async function checkFocusArea')), /thinking: false,/);
});

test('an answer is only taken once its text block is complete', () => {
  // Value: protects=polling never takes a thinking block or a half written line as the answer; fails_when=lastAssistantText returns thinking or partial JSON; why_new=the transcript is now read while the model is still writing; seam=none
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-claude-'));
  const f = transcriptFile(dir, 's');
  fs.writeFileSync(f, line('user', 'check') + '\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } }));
  assert.equal(lastAssistantText(f), null, 'thinking alone is no answer');
  fs.appendFileSync(f, '\n{"type":"assistant","message":{"content":[{"type":"text","text":"{\\"distin');
  assert.equal(lastAssistantText(f), null, 'a half written line is skipped');
});
