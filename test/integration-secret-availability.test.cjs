'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('Connector Center checks encrypted secret availability before saving metadata', () => {
  // Value: protects=an unavailable keychain stops a secret-bearing integration before a partial record is saved; fails_when=the renderer upserts before checking, or main accepts a direct secret write; why_new=TODOS credential encryption guidance; seam=IPC/client source contract
  const main = read('src/main/index.ts');
  const client = read('src/renderer/src/integrations/registryClient.ts');

  assert.match(main, /ipcMain\.handle\('integrations:canStoreSecrets',[\s\S]*?integrations\.canStoreSecrets\(\)[\s\S]*?cannotStoreReason\(\)/);
  const secretHandler = main.match(/ipcMain\.handle\('integrations:setSecret',[\s\S]*?\n\}\);/);
  assert.ok(secretHandler, 'integration secret handler exists');
  assert.ok(secretHandler[0].indexOf('!integrations.canStoreSecrets()') < secretHandler[0].indexOf('integrations.setSecret('), 'main rejects unavailable encryption before writing');

  const save = client.match(/save: async \(record, secret\) => \{[\s\S]*?\n  \},\n  remove:/);
  assert.ok(save, 'integration client save exists');
  assert.ok(save[0].indexOf('b.integrationsCanStoreSecrets()') < save[0].indexOf('b.integrationsUpsert(record)'), 'secret availability is checked before metadata upsert');
  assert.match(save[0], /if \(secret && secret\.length > 0\)/, 'public and blank-secret saves stay available without encrypted storage');
});