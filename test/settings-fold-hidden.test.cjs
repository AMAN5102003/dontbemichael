'use strict';

/**
 * The Claude connectors and Mailboxes folds slide open and shut (PR 130). A
 * closed fold must still take its rows out of the Tab order and away from
 * screen readers, as the `hidden` attribute did, so nobody can reach a
 * mailbox's Remove they cannot see.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

for (const file of ['src/renderer/src/components/MailboxesSettings.tsx', 'src/renderer/src/components/ClaudeConnectorsSettings.tsx']) {
  test(`a closed fold hides its rows from the keyboard: ${path.basename(file)}`, () => {
    // Value: protects=invisible buttons are never focusable; fails_when=the fold only collapses its height; why_new=PR 130 replaced hidden with a height animation; seam=source pin
    const src = read(file);
    const grid = src.indexOf("gridTemplateRows: open ? '1fr' : '0fr'");
    assert.ok(grid > 0, 'the fold animates its height');
    const inner = src.slice(grid, src.indexOf('<div id={listId}>', grid));
    assert.match(inner, /visibility: open \? 'visible' : 'hidden'/, 'closed rows are hidden, not only squashed');
    assert.match(inner, /transition: `visibility 0s linear \$\{open \? '0s' : 'var\(--cth-dur-base\)'\}`/, 'and only once the slide has finished');
  });
}
