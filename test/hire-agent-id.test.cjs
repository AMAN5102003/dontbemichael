'use strict';

/**
 * A new team member's id comes from the name the owner types. It is passed to
 * command line tools as an argument (`mempalace mine ... --wing <id>`), so it
 * must never start with a hyphen: an argument that does is read as an option.
 * Names with an accented first letter ("Óscar") or no Latin letters at all
 * (小王, سارة) used to produce exactly that ("-scar-...", "-...").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { hireAgentId } = loadTs('src/shared/hireTemplates.ts');
const NOW = 1_700_000_000_000;
const STAMP = NOW.toString(36);

test('a plain name keeps today\'s shape: name, hyphen, time stamp', () => {
  assert.equal(hireAgentId('Pam', NOW), `pam-${STAMP}`);
  assert.equal(hireAgentId('Kelly Kapoor', NOW), `kelly-kapoor-${STAMP}`);
});

test('accents are dropped instead of cutting the letter off', () => {
  assert.equal(hireAgentId('Óscar', NOW), `oscar-${STAMP}`);
  assert.equal(hireAgentId('Élodie', NOW), `elodie-${STAMP}`);
  assert.equal(hireAgentId('José María', NOW), `jose-maria-${STAMP}`);
});

test('a name with no Latin letters or digits falls back to "agent"', () => {
  assert.equal(hireAgentId('小王', NOW), `agent-${STAMP}`);
  assert.equal(hireAgentId('سارة', NOW), `agent-${STAMP}`);
  assert.equal(hireAgentId('', NOW), `agent-${STAMP}`);
});

test('the id never starts or ends its name part with a hyphen', () => {
  for (const name of [' Pam', 'Pam ', '-Pam-', '(Pam)', 'Óscar', '小王', '...', 'Ångström!']) {
    const id = hireAgentId(name, NOW);
    assert.doesNotMatch(id, /^-/, `${JSON.stringify(name)} gave ${id}`);
    assert.doesNotMatch(id, /--/, `${JSON.stringify(name)} gave ${id}`);
    assert.match(id, /^[a-z0-9][a-z0-9-]*$/, `${JSON.stringify(name)} gave ${id}`);
  }
});
