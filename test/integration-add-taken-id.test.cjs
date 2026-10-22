'use strict';

/**
 * Adding an integration never replaces one already registered under its id
 * (src/main/integrations.ts upsertRecord). Saving under an id in use replaces
 * that record, and its secret lives under `int:<id>`, so an add that lands on
 * a taken id would drop one integration and hand its key to another. The form
 * picks a free id (#476), but two windows adding the same label, or an add
 * made before the list loaded, can still land on one; main refuses those.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

// integrations.ts and config.ts reach Electron for app.getPath and safeStorage;
// stand in a throwaway userData root and a reversible "encryption" (same seam as
// secret-store.test.cjs).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-int-add-'));
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: {
    app: { getPath: () => userData },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
      decryptString: (b) => b.toString('utf8').replace(/^enc:/, '')
    }
  }
};
const I = loadTs('src/main/integrations.ts');
const { INTEGRATION_ID_TAKEN } = loadTs('src/shared/integrations.ts');
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const stripe = (label, baseUrl) => ({
  id: 'stripe', label, kind: 'custom-rest', baseUrl, authType: 'bearer',
  secretRef: 'int:stripe', enabled: true, createdAt: 1, updatedAt: 1
});

test('a new integration on a taken id is refused, and the one there keeps its record and key', () => {
  // Value: protects=adding an integration never deletes another one or its saved key; fails_when=upsertRecord replaces by id for a new record; why_new=the form alone can race (two windows, a list not loaded yet); seam=electron stub
  assert.equal(I.upsertRecord(stripe('Stripe', 'https://api.stripe.com'), { isNew: true }).ok, true);
  I.setSecret('int:stripe', 'sk-first');

  const again = I.upsertRecord(stripe('Stripe test', 'https://test.stripe.example'), { isNew: true });
  assert.deepEqual(again, { ok: false, error: INTEGRATION_ID_TAKEN });
  const kept = I.getRecord('stripe');
  assert.equal(kept.label, 'Stripe', 'the first integration is still there');
  assert.equal(kept.baseUrl, 'https://api.stripe.com');
  assert.equal(I.getSecret('int:stripe'), 'sk-first', 'and so is its key');
  assert.equal(I.listRecords().length, 1);
  assert.doesNotMatch(INTEGRATION_ID_TAKEN, /[–—]/);
});

test('editing an integration still saves over its own id', () => {
  // Value: protects=an owner can still change a saved integration; fails_when=the taken id check also blocks edits; why_new=one IPC serves add and edit; seam=electron stub
  const edited = I.upsertRecord(stripe('Stripe live', 'https://api.stripe.com'));
  assert.equal(edited.ok, true);
  assert.equal(I.getRecord('stripe').label, 'Stripe live');
  assert.equal(I.upsertRecord(stripe('Stripe live 2', 'https://api.stripe.com'), { isNew: false }).ok, true);
  assert.equal(I.getSecret('int:stripe'), 'sk-first', 'an edit with no new key leaves the key alone');
});

test('the form sends whether an integration is new, and shows its own words when the id is taken', () => {
  // Value: protects=the add flag reaches main from the Connections form, and the refusal reads in the owner's language; fails_when=a hop drops the flag (form, client, preload, IPC) or the raw English sentence shows; why_new=the IPC took no flag; seam=source pins, the form needs React
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('integrations:upsert', \(_evt, record: unknown, opts: unknown\) =>\s*integrations\.upsertRecord\(record, \{ isNew: \(opts as \{ isNew\?: unknown \} \| null \| undefined\)\?\.isNew === true \}\)\);/);
  assert.match(read('src/preload/index.ts'), /ipcRenderer\.invoke\('integrations:upsert', record, opts\)/);
  const client = read('src/renderer/src/integrations/registryClient.ts');
  assert.match(client, /b\.integrationsUpsert\(record, \{ isNew: opts\?\.isNew === true \}\)/);
  assert.match(client, /if \(opts\?\.isNew && prev\) return Promise\.resolve\(\{ ok: false, error: INTEGRATION_ID_TAKEN \}\);/, 'the dev mock refuses the same way');
  const form = read('src/renderer/src/components/IntegrationsRegistry.tsx');
  assert.match(form, /integrationsClient\.save\(recordFromDraft\(draft, Date\.now\(\)\), secret, \{ isNew: draft\.isNew \}\)/);
  assert.match(form, /if \(res\.error === INTEGRATION_ID_TAKEN\) \{ await refresh\(\); setErr\(tr\('integrations\.errIdTaken'\)\); return; \}/);
  for (const locale of ['en', 'ar', 'zh-CN']) {
    const s = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`)).integrations.errIdTaken;
    assert.ok(typeof s === 'string' && s.length > 10, locale);
    assert.doesNotMatch(s, /[–—]/, locale);
  }
});
