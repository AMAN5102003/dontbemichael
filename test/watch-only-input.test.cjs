'use strict';

// A watch-only terminal drops the owner's mouse and focus reports (TODOS:
// "Block mouse and focus reports in a watch-only terminal").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { watchOnlyData } = loadTs('src/renderer/src/components/watchOnlyInput.ts');

const ESC = '\x1b';

test('clicks, drags and the wheel never reach a program that tracks the mouse', () => {
  for (const report of ['[<0;12;5M', '[<0;12;5m', '[<32;13;5M', '[<64;1;1M', '[<65;220;50M', '[<35;100;20M']) {
    assert.equal(watchOnlyData(ESC + report), '', report);
  }
  assert.equal(watchOnlyData(`${ESC}[<0;1;1M${ESC}[<0;1;1m`), '', 'a press and release in one chunk');
});

test('focus in and out never reach a program that asked for focus events', () => {
  assert.equal(watchOnlyData(`${ESC}[I`), '');
  assert.equal(watchOnlyData(`${ESC}[O`), '');
});

test('the arrows the wheel becomes on a full-screen program are dropped', () => {
  assert.equal(watchOnlyData(`${ESC}[A${ESC}[A${ESC}[A`), '');
  assert.equal(watchOnlyData(`${ESC}OB${ESC}OB`), '', 'application cursor mode');
});

test("the terminal's replies to the program's own queries still go through", () => {
  for (const reply of [
    `${ESC}[12;40R`,             // cursor position
    `${ESC}[?1;2c`,              // device attributes
    `${ESC}[>0;276;0c`,          // secondary device attributes
    `${ESC}[?2031;2$y`,          // mode report
    `${ESC}]11;rgb:1e1e/1e1e/1e1e${ESC}\\`, // background colour
    `${ESC}[8;50;220t`           // window size
  ]) assert.equal(watchOnlyData(reply), reply, JSON.stringify(reply));
  assert.equal(watchOnlyData(`${ESC}[<0;3;4M${ESC}[12;40R`), `${ESC}[12;40R`, 'only the report is cut from a mixed chunk');
});

test('the pool filters only while the terminal is locked', () => {
  // Value: protects=a locked terminal's onData goes through the filter and an unlocked one is untouched; fails_when=onData writes the raw chunk or filters in 1:1; why_new=terminalPool can't be loaded in a test; seam=source pin
  const pool = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/terminalPool.ts'), 'utf8');
  assert.match(pool, /term\.onData\(\(raw\) => \{\s*if \(entry\.exited\) return;\s*\/\/[^\n]*\s*const data = entry\.inputLocked \? watchOnlyData\(raw\) : raw;\s*if \(!data\) return;\s*window\.cth\.writePty\(ptyId, data\);/);
});
