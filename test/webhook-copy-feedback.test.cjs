'use strict';

/**
 * Settings, Connections, Webhooks: the URL and secret Copy buttons show a check
 * mark for a moment once the text is on the clipboard, as the setup screen's
 * Copy does (SetupPanel.tsx). Before, nothing on screen changed, so the owner
 * could not tell whether it had copied.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('a webhook Copy button shows a check mark only after the text is copied', () => {
  const src = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(src, /copyToClipboard\(text\)\.then\(\(r\) => \{\s*if \(!r\.ok\) return;\s*setCopiedField\(field\);/, 'no check mark when the copy fails');
  assert.match(src, /setTimeout\(\(\) => setCopiedField\(\(f\) => \(f === field \? null : f\)\), 1200\)/, 'the check mark goes after a moment');
  assert.match(src, /onClick=\{\(\) => copyWebhookField\(`\$\{w\.id\}:url`, endpoint\)\}/);
  assert.match(src, /onClick=\{\(\) => copyWebhookField\(`\$\{w\.id\}:secret`, w\.secret\)\}/);
  assert.match(src, /copiedField === `\$\{w\.id\}:url` \? `\$\{t\('common\.copy'\)\} ✓` : t\('common\.copy'\)/);
  assert.match(src, /copiedField === `\$\{w\.id\}:secret` \? `\$\{t\('common\.copy'\)\} ✓` : t\('common\.copy'\)/);
});
