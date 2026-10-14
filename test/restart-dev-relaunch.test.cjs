'use strict';

/**
 * Regression for the blank window after Reset & Restart under `npm run dev`.
 * electron-vite stops its dev server when the first Electron exits, so a
 * relaunched copy loads ELECTRON_RENDERER_URL from a dead server and shows
 * nothing. In dev the app exits without relaunching; built apps still relaunch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { restartApp, canRelaunch } = loadTs('src/main/restart.ts');

function fakeApp() {
  const calls = [];
  return { calls, relaunch: () => calls.push('relaunch'), exit: (c) => calls.push(`exit:${c}`) };
}

test('dev mode exits without relaunching into a dead dev server', () => {
  const app = fakeApp();
  const lines = [];
  const out = restartApp(app, { ELECTRON_RENDERER_URL: 'http://localhost:5173' }, (l) => lines.push(l));
  assert.equal(out, 'exited-dev');
  assert.deepEqual(app.calls, ['exit:0']);
  assert.match(lines.join('\n'), /npm run dev/);
});

test('a built app relaunches, then exits', () => {
  const app = fakeApp();
  const out = restartApp(app, {}, () => {});
  assert.equal(out, 'relaunched');
  assert.deepEqual(app.calls, ['relaunch', 'exit:0']);
});

test('only a built app can relaunch', () => {
  // Value: protects=restartApp and closing time agree on when the app reopens; fails_when=the dev check drifts between them; why_new=closing time had its own inline check; seam=none
  assert.equal(canRelaunch({ ELECTRON_RENDERER_URL: 'http://localhost:5173' }), false);
  assert.equal(canRelaunch({}), true);
});

test('closing time asks for a reopen only when the app can relaunch, so a dev build never says "Reopening"', () => {
  // Value: protects=the closing dialog only promises a reopen that happens; fails_when=app:startClosingTime passes relaunch through without canRelaunch; why_new=TODOS "Say closing in dev builds when reopen is skipped"; seam=none
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  assert.match(main, /closingTime\.start\(\{ relaunch: opts\?\.relaunch === true && canRelaunch\(\) \}\)/);
});
