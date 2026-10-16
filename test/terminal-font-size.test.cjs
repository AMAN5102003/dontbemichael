'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('non-finite terminal zoom values leave the current size unchanged', () => {
  const writes = [];
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem: (...args) => writes.push(args)
    }
  };

  const {
    getTerminalFontSize,
    setTerminalFontSize,
    DEFAULT_TERMINAL_FONT_SIZE
  } = require('./load-ts.cjs')('src/renderer/src/components/terminalFontSize.ts');

  assert.equal(getTerminalFontSize(), DEFAULT_TERMINAL_FONT_SIZE);
  assert.equal(setTerminalFontSize(Number.NaN), DEFAULT_TERMINAL_FONT_SIZE);
  assert.equal(setTerminalFontSize(Number.POSITIVE_INFINITY), DEFAULT_TERMINAL_FONT_SIZE);
  assert.equal(setTerminalFontSize(Number.NEGATIVE_INFINITY), DEFAULT_TERMINAL_FONT_SIZE);
  assert.equal(getTerminalFontSize(), DEFAULT_TERMINAL_FONT_SIZE);
  assert.deepEqual(writes, [], 'invalid values are not persisted');
});
