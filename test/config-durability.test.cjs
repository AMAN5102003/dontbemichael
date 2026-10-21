'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-config-durability-'));
const configFile = path.join(userData, 'config.json');
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { app: { getPath: () => userData } }
};

// The atomic writer captures renameSync when loaded. Install the failure seam
// before loading it, while all successful operations still use the real fs.
const realRename = fs.renameSync;
let failRename = false;
fs.renameSync = (from, to) => {
  if (failRename && to === configFile) {
    throw Object.assign(new Error('config rename failed'), { code: 'EIO' });
  }
  return realRename(from, to);
};
let config;
try {
  config = loadTs('src/main/config.ts');
} finally {
  fs.renameSync = realRename;
}
const { writeConfig, readConfig, onConfigWritten, setAgentTokenCap, resetConfig } = config;
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));

const saves = [
  ['settings', () => writeConfig({ notifications: false })],
  ['token cap', () => setAgentTokenCap('jim', 100)],
  ['reset', () => resetConfig()]
];

for (const [name, save] of saves) {
  for (const failure of ['partial write', 'rename']) {
    test(`${name}: a failed ${failure} preserves the saved config and does not notify`, () => {
      writeConfig({
        harnessHome: path.join(userData, 'office'),
        onboardingComplete: true,
        missions: [{ id: 'saved-job', label: 'Saved job', intervalMs: 3_600_000, to: 'god', body: '', enabled: true }]
      });
      readConfig(); // Settle the startup migration before injecting a save failure.
      const before = fs.readFileSync(configFile, 'utf8');
      const previous = readConfig();
      const seen = [];
      const off = onConfigWritten((next) => seen.push(next));
      const realWrite = fs.writeFileSync;
      let injected = false;

      if (failure === 'partial write') {
        fs.writeFileSync = (file, data, ...args) => {
          // The old path writes the live filename; atomic saves write a temp fd.
          if (file === configFile || typeof file === 'number') {
            injected = true;
            realWrite(file, String(data).slice(0, 80), ...args);
            throw Object.assign(new Error('disk full during config write'), { code: 'ENOSPC' });
          }
          return realWrite(file, data, ...args);
        };
      } else {
        failRename = true;
      }

      try {
        assert.throws(save, failure === 'partial write' ? /disk full/ : /rename failed/);
      } finally {
        fs.writeFileSync = realWrite;
        failRename = false;
        off();
      }

      if (failure === 'partial write') assert.equal(injected, true, 'the save reached the failing write');
      assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'the last successful config is untouched');
      assert.deepEqual(readConfig(), previous, 'home, schedules and settings remain readable');
      assert.deepEqual(seen, [], 'a failed save is not announced');
      assert.deepEqual(fs.readdirSync(userData), ['config.json'], 'no failed-save temp file remains');
    });
  }
}
