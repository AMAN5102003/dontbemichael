'use strict';

// Before Michael's card is on the floor, several views name him with a
// fallback. It was "the orchestrator" in English for every owner.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the fallback name for Michael is translated', () => {
  for (const f of [
    'src/renderer/src/components/CommandCenterPanel.tsx',
    'src/renderer/src/components/SettingsModal.tsx',
    'src/renderer/src/components/WorkersTab.tsx',
    'src/renderer/src/components/triggers/TriggerHistoryTab.tsx',
    'src/renderer/src/realtime/DevicePicker.tsx'
  ]) {
    const src = read(f);
    assert.doesNotMatch(src, /'the orchestrator'/, f);
    assert.match(src, /\?\? t\('common\.orchestrator'\)/, f);
  }
  for (const locale of ['en', 'zh-CN', 'ar']) {
    assert.ok(JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`)).common.orchestrator, locale);
  }
});
