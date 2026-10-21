'use strict';

// The app ships for macOS and Windows 11, and these strings render on both
// with no platform check at the call site: Settings > General, the memory
// "could not read" reason, the resume step and the engine step of setup. They
// said "this Mac", so a Windows owner was told the office runs on a Mac.
//
// This pins only the strings every owner sees. Copy that is truly about macOS
// (onboarding.permissions.stayAwakeDescMac, the Battery settings link) is
// chosen per platform in the wizard and is meant to name it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const locale = (l) => JSON.parse(read(`src/renderer/src/i18n/locales/${l}.json`));
const LOCALES = ['en', 'zh-CN', 'ar'];

const SHOWN_ON_EVERY_PLATFORM = [
  'settings.general.otherOffices',
  'settings.general.keepAwake',
  'settings.memory.errNoPermission',
  'onboarding.resume.desc',
  'onboarding.orchestrator.cliAgent'
];

const lookup = (obj, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), obj);

test('strings shown on every platform do not name a Mac', () => {
  for (const l of LOCALES) {
    const strings = locale(l);
    for (const key of SHOWN_ON_EVERY_PLATFORM) {
      const value = lookup(strings, key);
      assert.equal(typeof value, 'string', `${key} vanished from ${l}.json`);
      assert.doesNotMatch(value, /\bMac\b|macOS/, `${l}.json ${key} names a Mac, and Windows owners see it too`);
    }
  }
});

test('the setup fallback text and the mailbox error stay platform neutral too', () => {
  // The <Trans> children are what renders if the key is ever missing.
  const wizard = read('src/renderer/src/components/OnboardingWizard.tsx');
  const fallback = wizard.slice(wizard.indexOf('i18nKey="onboarding.orchestrator.cliAgent"'));
  assert.doesNotMatch(fallback.slice(0, fallback.indexOf('</Trans>')), /\bMac\b/);
  assert.doesNotMatch(read('src/main/mail.ts'), /securely on this Mac/);
});
