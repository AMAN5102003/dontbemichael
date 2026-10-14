'use strict';

/**
 * ⌘-clicking a path an agent printed (the fs:revealPath handler): shown in
 * its folder, never opened (owner, D12). A path an agent controls can name
 * an app, a link to one, or a folder swapped for one between a check and an
 * open (ship review, red team and specialist pass 2); opening any of them
 * would launch it outside every sandbox.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a path an agent printed is shown in its folder and never opened', () => {
  // Value: protects=one click on agent text never launches a program; fails_when=the handler calls shell.openPath again, for a folder or anything else; why_new=owner D12 after a check then open race (both pass 2 reviewers); seam=source pin, the handler needs Electron
  const main = read('src/main/index.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('fs:revealPath'"), main.indexOf('\n});', main.indexOf("ipcMain.handle('fs:revealPath'")));
  assert.match(handler, /const st = await statAbs\(p\);\s*if \(!st\.exists\) return \{ ok: false, error: 'not found' \};\s*shell\.showItemInFolder\(st\.path\);\s*return \{ ok: true \};/);
  assert.doesNotMatch(handler, /openPath/);
  assert.doesNotMatch(read('src/main/fs.ts'), /export (async )?function (opensAsFolder|revealTarget)/, 'no folder guessing left to get wrong');
});

test('the Profile tab\'s Open folder shows, never opens, a folder that is an app by name or insides', (t) => {
  // Value: protects=the owner's own Open folder button can't launch an app planted as a team folder; fails_when=fs:openAgentFolder opens any directory; why_new=specialist pass 3; seam=none
  const os = require('node:os');
  const { isPackageDir } = require('./load-ts.cjs')('src/main/fs.ts');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pkg-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const plain = path.join(base, 'Sales');
  fs.mkdirSync(plain);
  assert.equal(isPackageDir(plain), false);
  assert.equal(isPackageDir(path.join(base, 'Tool.app')), true);
  assert.equal(isPackageDir(path.join(base, 'Q3.2026')), false, 'dots in a name are fine');
  fs.mkdirSync(path.join(base, 'Finance', 'Contents', 'MacOS'), { recursive: true });
  assert.equal(isPackageDir(path.join(base, 'Finance')), true, 'an app by its insides, whatever its name');
  assert.match(read('src/main/index.ts'), /if \(!recorded \|\| !dir \|\| isPackageDir\(shown\)\) \{ shell\.showItemInFolder\(shown\); return \{ ok: true \}; \}/);
});
