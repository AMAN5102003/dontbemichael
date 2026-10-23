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

test('one ramp for labels and read text, used everywhere a field shows', () => {
  // Value: protects=H3 and R1, labels outrank their text in Edit agent, the hire wizard, the change box and the jobs list; fails_when=a copy of the old 12 px grey label comes back or a screen stops using the ramp; why_new=fieldText is new; seam=none; no_claim=source pins, not rendered
  const ramp = read('src/renderer/src/components/fieldText.tsx');
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

test('the jobs list heading is a field label in Edit agent, beside its count', () => {
  // Value: protects=H3 for Scheduled jobs on its panel; fails_when=the heading drops back to the old grey label under its own job names; why_new=2B keeps field labels; seam=none; no_claim=source pin
  const src = read('src/renderer/src/components/ScheduledJobs.tsx');
  assert.match(src, /\{heading === 'section'\s*\? <h3 style=\{\{ \.\.\.sectionStyle, margin: 0 \}\}>\{title\}<\/h3>\s*: <span style=\{fieldLabel\}>\{title\}<\/span>\}/, 'a real heading on the Profile tab, a field label in Edit agent');
});

test('one Panel and one Field for every form screen, Edit agent and the hire wizard first', () => {
  // Value: protects=AS1 to AS4, the shared group name, hint, panel and field; fails_when=a screen keeps its own label or panel copy, or the ramp steps change; why_new=T1 of app-style-rollout.md; seam=none; no_claim=source pins, not rendered
  const ramp = read('src/renderer/src/components/fieldText.tsx');
  assert.match(ramp, /export const groupName: CSSProperties = \{\s*margin: 0, fontFamily: 'var\(--cth-font-ui\)', fontSize: 15, lineHeight: '20px', fontWeight: 600,/);
  assert.match(ramp, /export const hint: CSSProperties = \{ fontSize: 12, lineHeight: '17px', fontWeight: 400, color: 'var\(--cth-ink-3\)' \};/);
  assert.match(ramp, /padding: '14px 16px', borderRadius: 'var\(--cth-r-xl\)', background: 'var\(--cth-bg\)'/);
  assert.match(ramp, /<h3 style=\{groupName\}>\{title\}<\/h3>/);
  assert.match(ramp, /if \(read\) return <div role="group" aria-label=\{typeof label === 'string' \? label : undefined\} style=\{box\}>/, 'read only text is a named group, not a label');
  assert.match(ramp, /if \(!info\) return <label style=\{box\}>\{head\}\{children\}\{tail\}<\/label>;/);
  assert.match(ramp, /<label style=\{\{ display: 'contents' \}\}><span style=\{srOnly\}>\{label\}<\/span>\{children\}<\/label>/, 'with an info icon the label names the field, not the icon');
  for (const f of ['EditAgentModal', 'AddAgentModal']) {
    const src = read(`src/renderer/src/components/${f}.tsx`);
    assert.match(src, /return <Field label=\{p\.label\} info=\{p\.info\}>\{p\.children\}<\/Field>;/, `${f} Row is the shared Field`);
    assert.match(src, /return <Field read label=\{p\.label\} info=\{p\.info\}>\{p\.children\}<\/Field>;/, `${f} ReadRow is the shared Field`);
    assert.doesNotMatch(src, /background: 'var\(--cth-bg\)'/, `${f} has no panel copy of its own`);
  }
});

test('Access, Command Center and Office schedule groups are soft panels, on white tab bodies', () => {
  // Value: protects=AS2 to AS4 on TriggerCard's three screens (F1) and R1, a panel never sits on a tinted body; fails_when=the ring or white fill comes back, the fold goes, or a Command Center body turns tinted again; why_new=T2 of app-style-rollout.md; seam=none; no_claim=source pins, not rendered
  const ui = read('src/renderer/src/components/triggers/ui.tsx');
  const card = ui.slice(ui.indexOf('export function TriggerCard('), ui.indexOf('export function SubCard('));
  assert.match(card, /background: panelStyle\.background, borderRadius: panelStyle\.borderRadius/);
  assert.doesNotMatch(card, /boxShadow|borderTop|var\(--cth-card\)/, 'no ring, no rule, no white fill');
  assert.match(card, /<span style=\{\{ \.\.\.groupName, display: 'block' \}\}>\{title\}<\/span>/);
  assert.match(card, /<span style=\{\{ \.\.\.hint, display: 'block', marginTop: 2 \}\}>\{blurb\}<\/span>/);
  assert.match(card, /aria-expanded=\{open\}\s*aria-controls=\{bodyId\}/, 'the fold is kept');
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(cc, /function Scroll[\s\S]*?padding: 10, background: 'var\(--cth-card\)' \}\}>\{children\}<\/div>;/);
  assert.match(cc, /function Centered[\s\S]*?fontSize: 13, background: 'var\(--cth-card\)' \}\}>/);
  assert.doesNotMatch(cc, /overflowX: 'hidden', padding: 10,\s*background: 'var\(--cth-paper-200\)'/, 'no tab body is tinted');
});

test('the schedule editor, company profile and Add a mailbox use the shared fields on panels', () => {
  // Value: protects=AS1, AS2 and AS4 on T4's screens; fails_when=a 10 px capital, 14 px grey or 12 px label comes back, or a group loses its panel; why_new=T4 of app-style-rollout.md; seam=none; no_claim=source pins, not rendered
  const ui = read('src/renderer/src/components/triggers/ui.tsx');
  assert.match(ui, /<div style=\{\{ \.\.\.fieldLabel, marginBottom: 5 \}\}>\{label\}<\/div>/, 'the schedule editor label');
  const sched = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(sched, /const editorBox: CSSProperties = \{ borderRadius: 'var\(--cth-r-lg\)', padding: '4px 10px 12px', background: 'var\(--cth-card\)' \};/);
  assert.doesNotMatch(sched, /cream-200/, 'no ringed cream editor');
  const prof = read('src/renderer/src/components/CompanyProfileFields.tsx');
  for (const k of ['addressHead', 'contactHead', 'operateHead', 'moneyHead']) assert.match(prof, new RegExp(`<Panel title=\\{t\\('companyProfile\\.${k}'\\)\\}>`), k);
  assert.match(prof, /<SharedField\s+label=\{required \? <>\{label\}\{' '\}<span style=\{requiredMark\}>\{t\('companyProfile\.required'\)\}<\/span><\/> : label\}\s+note=\{hint\}/);
  const mail = read('src/renderer/src/components/AddMailboxDialog.tsx');
  assert.match(mail, /import \{ Field, Panel, hint \} from '\.\/fieldText';/);
  assert.doesNotMatch(mail, /function Field\(/, 'no copy of its own');
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const w = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).companyProfile.required;
    assert.ok(w && !/[—–]| - /.test(w), `${loc} required`);
  }
});

test('every named section uses the group name: Profile, Command Center, Git, Pulse, Workers and the jobs list', () => {
  // Value: protects=AS3 on T5's screens; fails_when=a section name goes back to 10 to 13 px grey or small caps; why_new=T5 of app-style-rollout.md; seam=none; no_claim=source pins, not rendered
  const c = (f) => read(`src/renderer/src/components/${f}.tsx`);
  assert.match(c('ProfileTab'), /<h3 style=\{\{ \.\.\.groupName, margin: '0 0 8px' \}\}>/);
  assert.match(c('CommandCenterPanel'), /<h3 style=\{\{ \.\.\.groupName, marginBottom: 6 \}\}>\{title\}<\/h3>/);
  assert.match(c('GitTab'), /<h3 style=\{\{ \.\.\.groupName, padding: '10px 10px 4px' \}\}>\{title\}<\/h3>/);
  assert.match(c('pulse/PulseView'), /<h2 style=\{\{ \.\.\.groupName, display: 'flex', gap: 6, alignItems: 'center' \}\}>/);
  assert.match(c('WorkersTab'), /const sectionHead: React\.CSSProperties = groupName;/);
  assert.match(c('ScheduledJobs'), /const sectionStyle: CSSProperties = groupName;/);
});
