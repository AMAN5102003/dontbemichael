'use strict';

// The update toasts and chips are translated (TODOS: "Translate the update
// surfaces"). In English they must still say exactly what they said before.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { badgeWords, installSteps } = loadTs('src/renderer/src/components/updateWords.ts');
const { describeUpdate, manualInstallSteps } = loadTs('src/shared/updateState.ts');

const locale = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', `src/renderer/src/i18n/locales/${name}.json`), 'utf8'));
// Enough of i18next for these strings: a key lookup and {{name}} values.
const tFor = (dict) => (key, vars = {}) => {
  const s = key.split('.').reduce((o, k) => o?.[k], dict);
  if (typeof s !== 'string') throw new Error(`missing ${key}`);
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k]));
};
const en = tFor(locale('en'));
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const V = '0.9.0';
const STATES = [
  null,
  { state: 'idle' },
  { state: 'checking' },
  { state: 'error', message: 'Network is offline' },
  { state: 'not-available' },
  { state: 'just-updated', version: V },
  { state: 'downloading', version: '0.9.1', percent: 42.4 },
  { state: 'available', version: '0.9.1' },
  { state: 'downloaded', version: '0.9.1' },
  { state: 'available-manual', version: '0.9.1', url: 'https://x' },
  { state: 'available-manual', version: '0.9.1', url: 'https://x', reason: 'portable build' },
  { state: 'available', version: V }
];

test('in English the chip says exactly what describeUpdate says', () => {
  for (const status of STATES) {
    const { label, title } = describeUpdate(status, V);
    assert.deepEqual(badgeWords(status, V, en), { label, title }, JSON.stringify(status));
  }
});

test('in English the manual steps are the ones manualInstallSteps gives', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.deepEqual(installSteps(platform, en), manualInstallSteps(platform), platform);
  }
});

test('in Chinese and Arabic every chip state and step is translated', () => {
  for (const name of ['zh-CN', 'ar']) {
    const t = tFor(locale(name));
    for (const status of STATES) {
      const words = badgeWords(status, V, t);
      assert.notEqual(words.title, describeUpdate(status, V).title, `${name} ${JSON.stringify(status)}`);
      assert.doesNotMatch(`${words.label} ${words.title}`, /\{\{|undefined/);
    }
    for (const platform of ['darwin', 'win32', 'linux']) {
      for (const step of installSteps(platform, t).steps) assert.doesNotMatch(step, /\{\{|Quit this app/, `${name} ${platform}`);
    }
  }
});

test('the update toasts and chips read their words from the locale', () => {
  // Value: protects=no English is left hard-coded in the update surfaces; fails_when=a string goes back into the component; why_new=the components need React to render; seam=source pin
  const cli = read('src/renderer/src/components/CliUpdateNotice.tsx');
  assert.doesNotMatch(cli, /upgrade waiting|Team upgrade ready|Close office/);
  assert.match(cli, /t\('cliUpdate\.bodyPlural', \{ version: status\.installed, count: status\.behind \}\)/);
  const toast = read('src/renderer/src/components/UpdateToast.tsx');
  assert.doesNotMatch(toast, /Restart to update|Open releases|Star us on GitHub/);
  const badge = read('src/renderer/src/components/UpdateBadge.tsx');
  assert.match(badge, /const words = badgeWords\(status, __APP_VERSION__, t\);/);
  assert.doesNotMatch(badge, /is downloading in your browser|got it</);
});
