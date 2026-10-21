'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/CompanyProfileFields.tsx'), 'utf8');

test('onboarding suggests recognized regional currencies without overwriting user choice', () => {
  const map = source.match(/const BY_REGION: Record<string, string> = \{([\s\S]*?)\n  \};/);
  assert.ok(map, 'the region mapping should be present');
  const pairs = Object.fromEntries(
    [...map[1].matchAll(/\b([A-Z]{2}): '([A-Z]{3})'/g)].map(([, region, currency]) => [region, currency])
  );
  for (const [region, currency] of Object.entries({
    US: 'USD', IN: 'INR', AZ: 'AZN', IR: 'IRR', PK: 'PKR',
    BD: 'BDT', UA: 'UAH', MY: 'MYR', TH: 'THB', VN: 'VND'
  })) {
    assert.equal(pairs[region], currency, region);
  }
  assert.match(source, /return EURO\.includes\(region\) \? 'EUR' : BY_REGION\[region\]/);
  assert.match(source, /onChange=\{\(e\) => set\(\{ currency: e\.target\.value \|\| undefined \}\)\}/);
});
