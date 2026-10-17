'use strict';

// The raiser's memory note is written as soon as the answer is on the card,
// before Michael's request goes. His request says the answer is in their
// notes, and a request that fails to go is sent again later: the note must not
// be skipped with it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the memory note comes before the request to Michael', () => {
  const tab = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/AskMeTab.tsx'), 'utf8');
  const fn = tab.slice(tab.indexOf('const sendAnswer = async'), tab.indexOf('setSending(null);', tab.indexOf('const sendAnswer = async')));
  const patched = fn.indexOf('updateNeedsYouTasks(() => next);');
  const note = fn.indexOf('await window.cth.hiveRememberOwnerAnswer(');
  const request = fn.indexOf('await window.cth.hiveSend(');
  assert.ok(patched > 0 && note > patched, 'after the answer is on the card');
  assert.ok(request > note, 'before the request to Michael');
  assert.equal(fn.split('hiveRememberOwnerAnswer(').length, 2, 'written once');
});
