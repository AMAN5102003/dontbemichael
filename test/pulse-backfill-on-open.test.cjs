'use strict';

// Opening Pulse starts the backfill, not only the 30 s beat (TODOS: "Backfill
// when Pulse first opens"), so a first look right after an update is not
// missing the office's past weeks. index.ts can't be loaded here, so this pins
// the wiring; the backfill itself is covered in pulse-telemetry.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the snapshot starts the backfill before it folds, and the view refreshes when it lands', () => {
  const main = read('src/main/index.ts');
  const at = main.indexOf("ipcMain.handle('pulse:snapshot'");
  assert.ok(at > 0);
  const handler = main.slice(at, main.indexOf('\n});', at));
  assert.match(handler, /if \(office\) \{ pulseBackfillOnce\(office\); pulseProcessor\.tick\(office\); \}/);
  // Once per office: a second open while it runs, or after it landed, starts nothing.
  assert.match(main, /if \(!db \|\| !root \|\| pulseBackfilling === office \|\| backfilled\(db, office\)\) return;/);
  assert.match(main, /if \(n > 0 && pulseProcessor\.tick\(office\) > 0\) liveWebContents\(\)\?\.send\('pulse:updated'\);/);
  assert.match(read('src/renderer/src/components/pulse/PulseView.tsx'), /window\.cth\.onPulseUpdated\(\(\) => \{ void load\(\); \}\)/);
});
