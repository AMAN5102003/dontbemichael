'use strict';

/**
 * The list of files kept out of an agent's git index (PR #128: 7.5GB of .git
 * from versioned Codex transcripts). `src/main/hive.ts` writes it when an agent
 * spawns. The memory palace used to write a second copy on every mine cycle;
 * since 2026-10-16 it holds company knowledge only and mines no agent folder,
 * so the list lives in one place. Pin both.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the git ignore list lives in hive.ts alone and keeps Codex homes out', () => {
  // Value: protects=a repo can't bloat again from Codex scratch state; fails_when=the line is dropped or a second drifting copy comes back; why_new=memory privacy (owner 2026-10-16) removed the palace copy; seam=source pin
  const m = src('src/main/hive.ts').match(/const MINE_IGNORE_LINES = (\[[^\]]*\]);/);
  assert.ok(m, 'MINE_IGNORE_LINES not found in src/main/hive.ts');
  assert.ok(JSON.parse(m[1].replace(/'/g, '"')).includes('.codex/'), 'Codex homes must stay out of the index');
  assert.doesNotMatch(src('src/main/memory.ts'), /MINE_IGNORE_LINES|\.gitignore/, 'the palace writes nothing into agent folders');
});
