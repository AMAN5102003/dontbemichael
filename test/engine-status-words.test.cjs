'use strict';

// The engine status on the Manager setup step is translated (issue #425). In
// English it must still say exactly what engineAvailabilityBadge and
// engineAvailabilityMessage say.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { engineBadgeWords, engineMissingWords } = loadTs('src/renderer/src/components/engineStatusWords.ts');
const { engineAvailabilityBadge, engineAvailabilityMessage } = loadTs('src/shared/engineAvailability.ts');

const locale = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', `src/renderer/src/i18n/locales/${name}.json`), 'utf8'));
// Enough of i18next for these strings: a key lookup, {{name}} values, and
// godName filled in as i18n/index.ts does by default.
const tFor = (dict) => (key, vars = {}) => {
  const s = key.split('.').reduce((o, k) => o?.[k], dict);
  if (typeof s !== 'string') throw new Error(`missing ${key}`);
  const all = { godName: 'Michael', ...vars };
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(all[k]));
};
const en = tFor(locale('en'));

const STATES = ['installed', 'installs-on-first-run', 'not-installable', 'unknown']
  .map((state) => ({ state, path: null, installCommand: '' }));

test('in English the engine status says exactly what the shared helpers say', () => {
  for (const a of STATES) {
    assert.equal(engineBadgeWords(a, en), engineAvailabilityBadge(a), a.state);
    assert.equal(engineMissingWords(a, 'Grok', en), engineAvailabilityMessage(a, 'Grok'), a.state);
  }
});

test('in Chinese and Arabic every engine status is translated', () => {
  for (const name of ['zh-CN', 'ar']) {
    const t = tFor(locale(name));
    for (const a of STATES.filter((s) => s.state !== 'unknown')) {
      const badge = engineBadgeWords(a, t);
      assert.ok(badge, `${name} ${a.state}`);
      assert.notEqual(badge, engineAvailabilityBadge(a), `${name} ${a.state}`);
    }
    const missing = STATES.find((s) => s.state === 'not-installable');
    const msg = engineMissingWords(missing, 'Grok', t);
    assert.match(msg, /Grok/);
    assert.doesNotMatch(msg, /\{\{|undefined|is not installed/);
  }
});

test('an unknown engine shows no badge and no message in any language', () => {
  const unknown = STATES.find((s) => s.state === 'unknown');
  for (const name of ['en', 'zh-CN', 'ar']) {
    const t = tFor(locale(name));
    assert.equal(engineBadgeWords(unknown, t), null, name);
    assert.equal(engineMissingWords(unknown, 'Grok', t), null, name);
  }
});

test('the Manager step reads its engine status from the locale', () => {
  // Value: protects=no English is left hard-coded in the engine status; fails_when=a string goes back into the wizard; why_new=the wizard needs React to render; seam=source pin
  const wizard = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/OnboardingWizard.tsx'), 'utf8');
  assert.doesNotMatch(wizard, /'checking\.\.\.'|'check again'|>\s*install instructions\s*</);
  assert.match(wizard, /engineBadgeWords\(a, t\)/);
  assert.match(wizard, /engineMissingWords\(selectedEngine, providerPreset\(godProvider\)\.label, t\)/);
});
