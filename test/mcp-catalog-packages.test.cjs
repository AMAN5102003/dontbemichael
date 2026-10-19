'use strict';

/**
 * The MCP catalog never launches a package npm has deprecated. The reference
 * Brave Search server was retired upstream; Brave's own server replaces it
 * with the same BRAVE_API_KEY, so a saved key keeps working.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { MCP_CATALOG, mcpCatalogEntry } = loadTs('src/shared/mcpCatalog.ts');

const DEPRECATED = ['@modelcontextprotocol/server-brave-search'];

test('no catalog entry launches a deprecated npm package', () => {
  for (const entry of MCP_CATALOG) {
    for (const arg of entry.spec.args) {
      assert.ok(!DEPRECATED.includes(arg), `${entry.id} still launches ${arg}`);
    }
  }
});

test('web search runs Brave\'s own server over stdio with the same key', () => {
  const entry = mcpCatalogEntry('search-with-key');
  assert.ok(entry);
  assert.deepEqual(entry.spec, { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'], env: { BRAVE_API_KEY: '' } });
  assert.equal(entry.tier, 'secret');
  assert.equal(entry.defaultEnabled, false);
});
