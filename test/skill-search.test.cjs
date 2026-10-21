'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { skillMatchesQuery, filterCatalog } = loadTs('src/renderer/src/components/skillSearch.ts');

test('a typo within one edit still finds the skill', () => {
  assert.equal(skillMatchesQuery('search', 'finds things', 'serach'), true);
});

test('an exact substring still matches', () => {
  assert.equal(skillMatchesQuery('pdf-filler', 'fills pdf forms', 'pdf'), true);
});

test('a short query word does not fuzzy-match: "ai" does not match "api"', () => {
  assert.equal(skillMatchesQuery('api-tool', 'calls an api', 'ai'), false);
});

test('owner and category filters stay exact, even with a typo-tolerant query', () => {
  const items = [
    { name: 'search-skill', description: 'does a search', owner: 'acme', category: 'AI & Agents' },
    { name: 'search-twin', description: 'also does a search', owner: 'other', category: 'AI & Agents' },
    { name: 'search-cousin', description: 'also does a search', owner: 'acme', category: 'Other Stuff' }
  ];
  const { shown, total } = filterCatalog(items, 'serach', 'acme', 'AI & Agents');
  assert.equal(total, 1);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].name, 'search-skill');
});

test('an empty query matches everything, owner/category filters still apply', () => {
  const items = [
    { name: 'a', description: '', owner: 'acme', category: 'cat1' },
    { name: 'b', description: '', owner: 'other', category: 'cat1' }
  ];
  const { shown, total } = filterCatalog(items, '', 'acme', 'all');
  assert.equal(total, 1);
  assert.equal(shown[0].name, 'a');
});

test('the 300 row cap bounds what is shown, but total states the real count', () => {
  const items = Array.from({ length: 400 }, (_, i) => ({
    name: `skill-${i}`, description: '', owner: 'acme', category: 'cat1'
  }));
  const { shown, total } = filterCatalog(items, '', 'all', 'all');
  assert.equal(shown.length, 300);
  assert.equal(total, 400);
});
