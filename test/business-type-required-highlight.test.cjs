'use strict';

/**
 * Setup step 1: business type was already required (it blocks Next and is
 * named in the error list), but it was the one required field with no red
 * highlight and no "*". Every required field now looks required, and every
 * gap is highlighted once the owner has tried to continue.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/OnboardingWizard.tsx'), 'utf8');
const step1 = src.slice(src.indexOf("{step === 'business' && ("), src.indexOf("{step === 'details' && ("));

test('every business tile is highlighted when no type is picked', () => {
  const tiles = step1.match(/<PackTile[\s\S]*?\/>/g) ?? [];
  assert.equal(tiles.length, 2, 'the pack tiles and the "something else" tile');
  for (const tile of tiles) assert.match(tile, /missing=\{gapShown\('type'\)\}/);
  assert.match(src, /function PackTile\(\{[^}]*missing/);
  assert.match(src, /missing && !selected[\s\S]{0,80}var\(--cth-coral-base\)/);
});

test('business name and business type are marked required', () => {
  // The app's required mark, a quiet word beside the label (app-style-rollout.md AS4).
  assert.match(step1, /t\('onboarding\.business\.nameLabel'\)\}\{' '\}\s*<span style=\{requiredMark\}>\{t\('companyProfile\.required'\)\}<\/span>/);
  assert.match(step1, /t\('onboarding\.business\.ask'\)\}\{' '\}\s*<span style=\{requiredMark\}>\{t\('companyProfile\.required'\)\}<\/span>/);
});
