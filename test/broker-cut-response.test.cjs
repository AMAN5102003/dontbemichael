'use strict';
// A connected app's answer that stops partway must reach the agent as a failed
// transfer, never as a complete one. The broker strips content-length and
// streams the body after the status line, so closing the reply cleanly after an
// upstream failure handed the agent a 200 with half a body and nothing to say it
// was cut.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const loadTs = require('./load-ts.cjs');

const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** GET through the broker. `complete` is whether the whole reply arrived. */
function get(base, token, route) {
  return new Promise((resolve, reject) => {
    const req = http.get(new URL(route, base), { headers: { authorization: `Bearer ${token}` } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('error', () => { /* reported through complete */ });
      res.on('close', () => resolve({ status: res.statusCode, body, complete: res.complete }));
    });
    req.on('error', reject);
  });
}

async function brokerFor(t, upstreamHandler) {
  const upstream = http.createServer(upstreamHandler);
  const port = await listen(upstream);
  t.after(() => upstream.close());
  const record = {
    id: 'books', label: 'Books', kind: 'custom-rest', baseUrl: `http://127.0.0.1:${port}`,
    authType: 'none', enabled: true, createdAt: 0, updatedAt: 0
  };
  const broker = new IntegrationBroker({ getRecord: (id) => (id === 'books' ? record : undefined), getSecret: () => undefined });
  await broker.start();
  t.after(() => broker.stop());
  return { broker, token: broker.grant('pty-1', ['books'], 'oscar') };
}

test('broker: an upstream answer cut partway reaches the agent as a failed transfer', { timeout: 10_000 }, async (t) => {
  const { broker, token } = await brokerFor(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '64' });
    res.write('{"invoices":[1,2,3,');
    setTimeout(() => res.socket.destroy(), 50);
  });
  const out = await get(broker.url(), token, '/i/books/reports');
  assert.equal(out.status, 200, 'the status line was already sent');
  assert.equal(out.body, '{"invoices":[1,2,3,');
  assert.equal(out.complete, false, 'the agent can tell the reply was cut');
});

test('broker: a whole upstream answer still arrives complete', { timeout: 10_000 }, async (t) => {
  const { broker, token } = await brokerFor(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"invoices":[1,2,3]}');
  });
  const out = await get(broker.url(), token, '/i/books/reports');
  assert.equal(out.status, 200);
  assert.equal(out.body, '{"invoices":[1,2,3]}');
  assert.equal(out.complete, true);
});
