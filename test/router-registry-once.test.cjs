'use strict';

// The router reads the registry once per tick for the Research check, not once
// per outbox file (TODOS: "Read the registry once per router tick").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');

test('a busy tick reads the registry once for the Research check, and every message still arrives', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-router-once-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'jim', name: 'Jim', provider: 'claude', cwd: home });
  const outbox = path.join(hive.root(), 'agents', 'pam', 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(outbox, `m${i}.json`), JSON.stringify({ to: 'jim', act: 'inform', subject: `Note ${i}`, body: 'Delivery moved to Friday.' }));
  }
  let reads = 0;
  const registry = hive.registry.bind(hive);
  hive.registry = () => { reads++; return registry(); };
  assert.equal(hive.routeOnce(), 10);
  // One read per delivery, plus the tick's own; it was two per message.
  assert.ok(reads <= 12, `${reads} registry reads for 10 messages`);
  const inbox = path.join(hive.root(), 'agents', 'jim', 'inbox');
  assert.equal(fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).length, 10);
});
