'use strict';

// The short notes beside Slack, webhooks and the organisation key in Settings
// (saved, listening, stopped, could not save...) and the home folder change
// error were English only, in an app that ships Arabic and Chinese.
// Structural checks: the renderer has no DOM test harness here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Settings sets no note or error from English written in the code', () => {
  const src = read('src/renderer/src/components/SettingsModal.tsx');
  assert.doesNotMatch(src, /set(Slack|Webhook|Org)Note\('[a-z]/, 'a note is a string literal');
  assert.doesNotMatch(src, /set(Slack|Webhook|Org)Note\([^;]*\?\? '/, 'a fallback note is a string literal');
  assert.doesNotMatch(src, /'listening'|'started, but tunnel unavailable'|'Could not change the home folder\.'/);
});

test('the notes are in each language', () => {
  const keys = ['noteSaved', 'noteListening', 'noteNoTunnel', 'noteStartFailed', 'noteStopped', 'noteSaveFailed', 'noteDeleted'];
  for (const locale of ['en', 'zh-CN', 'ar']) {
    const s = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`)).settings;
    for (const k of keys) assert.ok(s.connections[k], `${locale} settings.connections.${k}`);
    assert.ok(s.changeHome.couldNotChange, `${locale} settings.changeHome.couldNotChange`);
  }
});
