'use strict';

/**
 * A hidden call can stream its draft as it writes (owner, 2026-10-03: "Suggest
 * me" sat on "Writing..." with no sign of life). The live text is read off the
 * hidden session's screen.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { screenAnswer } = loadTs('src/main/screenAnswer.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('the live draft is the text after the answer marker, in paragraphs, without the status lines', () => {
  // Value: protects=the owner sees a readable draft while it is written; fails_when=the prompt, the spinner or the effort line leaks in, or terminal wraps split sentences; why_new=new preview; seam=none
  const screen = [
    '> Write a first work style for Creed ... Answer with the description only.',
    '',
    '⏺ The job: Creed keeps HubSpot clean, so this matters even though it',
    '  looks like small, quiet work.',
    '',
    '  How the work is done: Creed checks records for duplicates because',
    '  duplicates split history.',
    '',
    '● high · /effort',
    '✻ Writing… (3s · ↓ 120 tokens)',
    '❯ '
  ];
  assert.equal(screenAnswer(screen), 'The job: Creed keeps HubSpot clean, so this matters even though it looks like small, quiet work.\n\nHow the work is done: Creed checks records for duplicates because duplicates split history.');
  assert.equal(screenAnswer(['> prompt', '✻ Thinking…']), '', 'nothing written yet');
  assert.equal(screenAnswer(['⏺ first answer', '', '> next', '⏺ The job: second.']), 'The job: second.', 'the last answer only');
});

test('a hidden session can show its screen as it writes, and be stopped', () => {
  // Value: protects=the live preview and Stop stay available to hidden calls; fails_when=the headless terminal is always made or the abort no longer finishes the run; why_new=owner 2026-10-03, kept when Suggest me was retired (work-style-change-request.md); seam=source pin
  const hidden = read('src/main/hiddenClaude.ts');
  assert.match(hidden, /const screen = opts\.onScreenText \? new Terminal\(/, 'a headless terminal only when a preview is wanted');
  assert.match(hidden, /screen\?\.write\(data\);/);
  assert.match(hidden, /const onAbort = \(\) => finish\(\{ ok: false, error: 'cancelled' \}\);/);
  assert.match(read('package.json'), /"@xterm\/headless": "\^5\.5\.0"/);
});
