'use strict';

/**
 * tokenizeCommand splits a typed command line the way a shell reads quotes, so
 * a value with spaces stays one argument whether the quote opens the token
 * (`--model "Gemini 3.1 Pro"`, what the app builds) or sits inside it
 * (`--model="Gemini 3.1 Pro"`, what an owner may type in the command field).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { tokenizeCommand } = loadTs('src/shared/commandLine.ts');

test('plain words split on any whitespace', () => {
  assert.deepEqual(tokenizeCommand('claude  --model\topus'), ['claude', '--model', 'opus']);
  assert.deepEqual(tokenizeCommand('   '), []);
  assert.deepEqual(tokenizeCommand(''), []);
});

test('a quoted value that opens the token stays one argument, quotes stripped', () => {
  assert.deepEqual(tokenizeCommand('agy --model "Gemini 3.1 Pro (High)"'), ['agy', '--model', 'Gemini 3.1 Pro (High)']);
  assert.deepEqual(tokenizeCommand(`a "b c" 'd e' f`), ['a', 'b c', 'd e', 'f']);
});

test('a quote inside a token keeps its spaces: --flag="a b" is one argument', () => {
  assert.deepEqual(tokenizeCommand('agy --model="Gemini 3.1 Pro (High)" --yolo'), ['agy', '--model=Gemini 3.1 Pro (High)', '--yolo']);
  assert.deepEqual(tokenizeCommand(`tool --name='a b' --x`), ['tool', '--name=a b', '--x']);
});

test('quoted text may be followed by more of the same word, as in a shell', () => {
  assert.deepEqual(tokenizeCommand('tool "a b"c d'), ['tool', 'a bc', 'd']);
});

test('the other kind of quote inside a quoted span is plain text', () => {
  assert.deepEqual(tokenizeCommand(`tool "it's fine" 'say "hi"'`), ['tool', "it's fine", 'say "hi"']);
});

test('an empty pair is an empty argument', () => {
  assert.deepEqual(tokenizeCommand('tool "" x'), ['tool', '', 'x']);
});

test('a quote with no partner stays a literal character', () => {
  assert.deepEqual(tokenizeCommand('tool "unfinished arg'), ['tool', '"unfinished', 'arg']);
  assert.deepEqual(tokenizeCommand(`tool it's here`), ['tool', "it's", 'here']);
});

test('a Windows path with spaces in quotes is one argument, backslashes untouched', () => {
  assert.deepEqual(
    tokenizeCommand('"C:\\Program Files\\nodejs\\claude.cmd" --model opus'),
    ['C:\\Program Files\\nodejs\\claude.cmd', '--model', 'opus']
  );
});
