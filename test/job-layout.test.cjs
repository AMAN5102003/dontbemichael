'use strict';

/**
 * Edit agent reads by its headings (docs/designs/edit-agent-hierarchy.md): one
 * type ramp shared by Edit agent, the hire wizard and the job change preview,
 * and How X works in its parts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { plainParts } = loadTs('src/shared/workStyleText.ts');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the plain words split into their parts, and nothing else splits', () => {
  // Value: protects=H4 parts for every plain words shape the app writes; fails_when=a time, a link or a sentence with a colon becomes a part, or text is lost; why_new=plainParts is new; seam=none; no_claim=none beyond protects
  const plain = 'The job:\nAnswers customers.\n\nHow the work is done:\nUses the owner\'s documents.\nThe support lead tells Michael: when stuck.\n\nAsks the owner first: refunds after 9:00, see https://example.com';
  assert.deepEqual(plainParts(plain), [
    { label: 'The job', text: 'Answers customers.' },
    { label: 'How the work is done', text: 'Uses the owner\'s documents.\nThe support lead tells Michael: when stuck.' },
    { label: 'Asks the owner first', text: 'refunds after 9:00, see https://example.com' }
  ]);
  assert.deepEqual(plainParts('Just words.\nMore words.'), [{ label: '', text: 'Just words.\nMore words.' }], 'no labels, one part');
  assert.deepEqual(plainParts('Intro.\nRefunds:\nAlways ask.'), [{ label: '', text: 'Intro.' }, { label: 'Refunds', text: 'Always ask.' }], 'words before the first label keep their place');
  assert.deepEqual(plainParts('The job：\n回答客户。'), [{ label: 'The job', text: '回答客户。' }], 'a full width colon');
  assert.deepEqual(plainParts('9:00:\nnot a label'), [{ label: '', text: '9:00:\nnot a label' }]);
  assert.deepEqual(plainParts(''), []);
  assert.deepEqual(plainParts('the job: lower case label'), [{ label: 'The job', text: 'lower case label' }]);
});

test('one ramp for headings, labels and read text, used everywhere a field shows', () => {
  // Value: protects=H3 and R1, labels outrank their text in Edit agent, the hire wizard, the change box and the jobs list; fails_when=a copy of the old 12 px grey label comes back or a screen stops using the ramp; why_new=fieldText is new; seam=none; no_claim=source pins, not rendered
  const ramp = read('src/renderer/src/components/fieldText.tsx');
  assert.match(ramp, /export const sectionHeading: CSSProperties = \{\s*margin: 0, fontFamily: 'var\(--cth-font-ui\)', fontSize: 15, lineHeight: '20px', fontWeight: 600,\s*letterSpacing: '-0\.02em', color: 'var\(--cth-ink\)'/);
  assert.match(ramp, /export const fieldLabel: CSSProperties = \{ fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var\(--cth-ink\)' \};/);
  assert.match(ramp, /\? \{ fontSize: 14, lineHeight: '22px', fontWeight: 400, color: 'var\(--cth-ink-2\)' \}\s*: \{ fontSize: 13, lineHeight: '20px', fontWeight: 400, color: 'var\(--cth-ink-2\)' \};/);
  for (const f of ['EditAgentModal', 'AddAgentModal', 'JobChangeReview', 'ScheduledJobs']) {
    const src = read(`src/renderer/src/components/${f}.tsx`);
    assert.match(src, /from '\.\/fieldText'/, `${f} uses the shared ramp`);
    assert.doesNotMatch(src, /<span style=\{\{ fontSize: 12, fontWeight: 600, color: 'var\(--cth-ink-2\)' \}\}>\{(label|p\.box\.label|title)\}<\/span>/, `${f} has no old field label`);
  }
  assert.match(read('src/renderer/src/components/JobChangeReview.tsx'), /<span style=\{fieldLabel\}>\{p\.box\.label\}<\/span>/);
});

test('How X works shows its parts, folded to the first, in Edit agent, the hire wizard and the preview', () => {
  // Value: protects=H4, H5 and R2 at every place the plain words show; fails_when=a screen goes back to one block or the preview folds; why_new=JobParts is new; seam=none; no_claim=source pins, not rendered
  const ramp = read('src/renderer/src/components/fieldText.tsx');
  assert.match(ramp, /const shown = folded \? parts\.slice\(0, 1\) : parts;/);
  assert.match(ramp, /if \(parts\.length > 1\) return true;/, 'Show all whenever more parts wait');
  assert.match(read('src/renderer/src/components/EditAgentModal.tsx'), /<JobParts plain=\{plain\} wide=\{wide\} folded=\{!showAll\} \/>/);
  assert.match(read('src/renderer/src/components/AddAgentModal.tsx'), /<JobParts plain=\{plain\} folded=\{!plainAll\} \/>/);
  assert.match(read('src/renderer/src/components/JobChangeReview.tsx'), /<JobParts plain=\{ok\.plain\} \/>/, 'the preview shows them all, no fold');
});

test('the jobs list heading is a section heading in Edit agent', () => {
  // Value: protects=H1 and H3 for Scheduled jobs; fails_when=the heading drops back to a label under its own job names; why_new=heading panel variant; seam=none; no_claim=source pin
  const src = read('src/renderer/src/components/ScheduledJobs.tsx');
  assert.match(src, /\? <h3 style=\{\{ \.\.\.sectionHeading, display: 'inline' \}\}>\{title\}<\/h3>/);
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const v = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).jobChange.jobOf;
    assert.match(v, /\{\{name\}\}/, loc);
  }
});
