'use strict';

/**
 * Pasted screenshots (src/main/pastes.ts; TODOS, "Keep pasted screenshots
 * somewhere durable"). Only the file's path goes into a message, and a queued
 * message can wait for a busy team member across a restart, so the file must
 * be in the app's own folder and must not be removed while a message may still
 * point at it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { pastesDir, savePaste, sweepOldPastes, PASTE_KEEP_MS } = loadTs('src/main/pastes.ts');

const DAY = 24 * 60 * 60 * 1000;

function scratch(t) {
  // A space in the name: several shipped bugs came from one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md pastes '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a pasted screenshot is saved in the app folder, not the OS temp folder', (t) => {
  // Value: protects=a queued message's attachment path still exists after a restart; fails_when=the paste goes back to the temp folder; why_new=TODOS "Keep pasted screenshots somewhere durable"; seam=userData argument
  const userData = scratch(t);
  const file = savePaste(pastesDir(userData), Buffer.from('png bytes'), 1234);
  assert.equal(file.name, 'paste-1234.png');
  assert.equal(file.path, path.join(userData, 'pastes', 'paste-1234.png'));
  assert.equal(fs.readFileSync(file.path, 'utf8'), 'png bytes');
  // The main process saves into userData, never app.getPath('temp').
  const main = fs.readFileSync(path.resolve(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.match(main, /savePaste\(pastesDir\(app\.getPath\('userData'\)\), img\.toPNG\(\)\)/);
  assert.doesNotMatch(main, /cth-pastes/);
  assert.match(main, /sweepOldPastes\(pastesDir\(app\.getPath\('userData'\)\), PASTE_KEEP_MS, Date\.now\(\), JSON\.stringify\(roster\.read\(\)\?\.queues \?\? \{\}\)\);/, 'old pastes are cleared at startup, but not one a queued message names');
});

test('startup removes only old pasted screenshots', (t) => {
  // Value: protects=a screenshot a waiting message points at survives, and pastes don't pile up forever; fails_when=the age or name check is dropped; why_new=TODOS "Keep pasted screenshots somewhere durable"; seam=now
  const dir = pastesDir(scratch(t));
  const now = Date.now();
  const make = (name, ageMs) => {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x');
    const at = new Date(now - ageMs);
    fs.utimesSync(p, at, at);
    return p;
  };
  const old = make('paste-1.png', PASTE_KEEP_MS + DAY);
  const recent = make('paste-2.png', 3 * DAY);
  const notOurs = make('notes.txt', PASTE_KEEP_MS + DAY);
  sweepOldPastes(dir, PASTE_KEEP_MS, now);
  assert.equal(fs.existsSync(old), false);
  assert.ok(fs.existsSync(recent), 'a recent paste may still be waiting in a queue');
  assert.ok(fs.existsSync(notOurs), 'only paste files are touched');
  // No folder yet (nothing pasted): nothing to do, and no error.
  sweepOldPastes(path.join(dir, 'missing'));
});

test('an old screenshot a queued message still names is kept', (t) => {
  const dir = pastesDir(scratch(t));
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const old = new Date(now - PASTE_KEEP_MS - DAY);
  const waiting = path.join(dir, 'paste-111.png');
  const done = path.join(dir, 'paste-222.png');
  for (const p of [waiting, done]) { fs.writeFileSync(p, 'x'); fs.utimesSync(p, old, old); }
  // The saved queues, as main reads them from the roster.
  const queues = { pam: [{ id: 'q1', text: `Check this\n\nAttached files:\n- ${waiting} (paste-111.png)`, ts: now - PASTE_KEEP_MS - DAY }] };
  sweepOldPastes(dir, PASTE_KEEP_MS, now, JSON.stringify(queues));
  assert.ok(fs.existsSync(waiting), 'Pam has not had it yet');
  assert.equal(fs.existsSync(done), false);
});
