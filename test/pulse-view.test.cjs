'use strict';

/**
 * The Pulse view keeps the approved design (docs/designs/team-performance.md,
 * design review D5 to D16; mockup pulse-final.html): a Pulse tab between Tasks
 * and Who talks to whom, ways to save first in amber soft cards with Apply, Not
 * now and Undo, line icons, a cost for the work bar, Michael's own tile, the
 * office row last, a layout by stage width, words for every picture, and never
 * coral.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const view = read('src/renderer/src/components/pulse/PulseView.tsx');
const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json'));

test('Pulse is a fixed view tab between Tasks and Who talks to whom, and takes the whole window', () => {
  // Value: protects=D5 location and name, the owner's 2026-10-15 ask (no Needs you column or bottom bar on Pulse); fails_when=the tab moves, is renamed, or the column or bottom bar shows on Pulse; why_new=design D5; seam=none; no_claim=pixel layout (visual QA after build)
  const top = read('src/renderer/src/shell/TopBar.tsx');
  assert.match(top, /tab\('tasks', t\('floorView\.tasks'\)\)\}\s*\{tab\('pulse', t\('floorView\.pulse'\)\)\}\s*\{tab\('graph'/);
  assert.equal(en.floorView.pulse, 'Pulse');
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /const columnView = floorView === 'office' \|\| floorView === 'file';\s*const columnShown = columnOpen && columnView;/);
  assert.match(app, /display: closingOpen \|\| floorView === 'pulse' \? 'none' : 'contents'/, 'the bottom bar hides on Pulse but stays mounted');
  assert.match(app, /paddingBottom: floorView === 'pulse' \? 0 : 96/);
  assert.match(read('src/renderer/src/store/store.ts'), /if \(view === 'office' \|\| view === 'file'\) return \{\};/);
});

test('sections run recommendations, what got done, kept safe, learning, the office row, then team at work', () => {
  // Value: protects=D2 and D3 order as the owner set it on 2026-10-15 (proposal 3: Kept safe and Learning in the top area, Team at work in place of the Team tiles, "Recommendations" title), the saved card only once something was applied, and the start date with its reason; fails_when=a section moves, a table returns, the saved card shows with nothing in it, or the start date loses its reason; why_new=owner ask 2026-10-15; seam=none; no_claim=none beyond protects
  assert.equal(en.pulse.recommendations, 'Recommendations');
  assert.match(view, /const savedShown = view\.saved\.state !== 'none';/);
  assert.match(view, /\{savedShown && <div/);
  assert.match(en.pulse.adviceStarts, /\{\{day\}\}[\s\S]*two full weeks[\s\S]*\{\{since\}\}/);
  assert.doesNotMatch(en.pulse.adviceStarts, /record/i, 'business words, not records (owner, 2026-10-15)');
  assert.match(view, /t\('pulse\.adviceStarts', \{ day: fmtDay\(view\.adviceFrom\), since: /);
  const order = ['pulse.recommendations', 'pulse.whatGotDone', 'pulse.safe.title', 'pulse.learning.title', 'pulse.whereMoneyWent', 'pulse.work.title'].map((k) => view.indexOf(`t('${k}')`));
  assert.ok(order.every((i) => i > 0), 'every section is there');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(view, /<table/);
});

test('suggestions are amber soft cards, applied ones green with Undo; no coral and no left stripe anywhere', () => {
  // Value: protects=D10, D12 and calm by default; fails_when=a suggestion gets coral or a stripe, or Apply loses its Undo; why_new=design D12; seam=none; no_claim=none beyond protects
  assert.match(view, /background: 'var\(--cth-amber-soft\)'/);
  assert.match(view, /background: 'var\(--cth-green-soft\)'[\s\S]{0,400}t\('pulse\.undo'\)/);
  assert.doesNotMatch(view, /--cth-coral/, 'no coral color on Pulse');
  assert.doesNotMatch(view, /borderLeft|borderInlineStart/);
  assert.match(view, /window\.cth\.pulseApply\(a\.id, a\.change\)/, 'apply sends what the card showed');
  assert.match(view, /t\('pulse\.notNow'\)/);
});

test('line icons, never emoji; Team at work lists everyone on the team busiest first, Michael included, and opens their week', () => {
  // Value: protects=D11 icons and proposal 3 Team at work; fails_when=emoji return, a removed member shows, Michael is left out, a short worker is judged on cost, or a row stops opening the detail; why_new=owner proposal 3; seam=none; no_claim=pixel layout (visual QA)
  assert.match(view, /KIND_ICON: Record<WorkKind, IconName> = \{ email: 'mail', sent: 'send', task: 'check', check: 'clock' \}/);
  assert.doesNotMatch(view, /\p{Extended_Pictographic}/u);
  assert.match(view, /const rows = s\.members\.filter\(\(m\) => byId\.has\(m\.agentId\)\)\n\s+\.map\(\(m\) => \(\{ \.\.\.m, busyMs: m\.busyMs \?\? 0, turns: m\.turns \?\? 0, dayBusy: m\.dayBusy \?\? \[\] \}\)\)\n\s+\.sort\(\(a, b\) => b\.busyMs - a\.busyMs\);/);
  assert.match(view, /const work = teamAtWork\(rows\);/);
  assert.match(view, /m\.agentId === godId \? t\('pulse\.officeManager'\)/);
  assert.doesNotMatch(view, /pulse\.learning\.headline|pulse\.learning\.trend/, 'no Learning header or headline (owner, 2026-10-15)');
  assert.doesNotMatch(view, /pulse\.work\.perHour|stripOf\(|pulse\.work\.knows/, 'no day strip, per hour or Knows column (owner, 2026-10-15)');
  assert.match(view, /onClick=\{\(\) => setDetail\(m\.agentId\)\}/);
  for (const i of ['shield', 'search', 'pause', 'lock', 'book', 'help']) assert.match(view, new RegExp(`icon="${i}"`), i);
});

test('Kept safe counts what was stopped apart from what could not be checked, and held work is the only amber tile', () => {
  // Value: protects=Kept safe honesty; fails_when=held messages read as protection, or held turns calm while messages wait; why_new=owner proposal 3; seam=none; no_claim=none beyond protects
  const held = view.slice(view.indexOf('<StatTile icon="pause"'), view.indexOf('<StatTile icon="lock"'));
  assert.match(held, /text=\{t\(safe\.held > 0 \? 'pulse\.safe\.held' : 'pulse\.safe\.heldNone'\)\} amber=\{safe\.held > 0\}/);
  assert.equal(en.pulse.safe.held, 'messages held back because the safety check could not run. Nothing went out unchecked.');
  assert.doesNotMatch(view, /<Section title=\{t\('pulse\.safe\.title'\)\}/, 'no Kept safe header; each tile says what it guards (owner, 2026-10-15)');
  assert.match(view, /since: fmtDay\(view\.liveSince \?\? Date\.now\(\)\)/, 'recommendations count from live recording, not the backfill');
});

test('the layout follows the stage width, and every picture has words', () => {
  // Value: protects=D14 reflow and D15 accessibility; fails_when=thresholds drift or a chart loses its label; why_new=design D14, D15; seam=none; no_claim=screen reader behavior (manual check)
  assert.match(view, /return w >= 1100 \? 'wide' : w >= 760 \? 'mid' : 'narrow';/);
  assert.match(view, /role="region" aria-label=\{t\('floorView\.pulse'\)\}/);
  assert.match(view, /role="img" aria-label=\{aria\}/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /aria-label=\{t\('pulse\.planAria'/);
  assert.ok((view.match(/<button[^>]*type="button"/g) || []).length >= 6, 'rows and actions are buttons');
  assert.match(view, /role="listitem"/, 'Team at work rows are a list');
});

test('every pulse string is in all three locales, and the plan ring shows only on a plan', () => {
  // Value: protects=locale parity and E6 on an API key; fails_when=a key is missing in ar or zh-CN, or the ring shows for an API key; why_new=new strings; seam=none; no_claim=translation quality
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const want = keys(en.pulse).sort();
  for (const loc of ['ar', 'zh-CN']) assert.deepEqual(keys(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).pulse).sort(), want, loc);
  assert.match(read('src/main/pulse.ts'), /headroom: billing === 'account' \? planHeadroom\(this\.reading\) : null/);
});

test('Learning follows the period: the period\'s new notes and question rate, against the same span before', () => {
  // Value: protects=the owner\'s 2026-10-15 ask (a tile under This week shows this week); fails_when=a Learning tile shows all time or a fixed four weeks under a period, or Last 4 weeks compares with one week; why_new=owner ask; seam=source pins; no_claim=pixel layout
  assert.match(view, /const span = s\.period === '4-weeks' \? 4 : 1;/);
  assert.match(view, /const off = s\.period === 'last-week' \? 1 : 0;/);
  assert.match(view, /t\(`pulse\.learning\.sub\.\$\{s\.period\}`\)/);
  assert.doesNotMatch(view, /function RateLine|remembersSub/, 'no all time chart');
  assert.equal(en.pulse.learning.sub['this-week'], 'new notes this week');
  assert.match(read('src/main/pulse.ts'), /count: 8 \}\);/, 'eight weeks, so four can be compared with four');
});

test('on Last 4 weeks every top tile shows its week by week trend', () => {
  // Value: protects=the owner\'s 2026-10-15 ask (trends on multi week periods); fails_when=a tile drops its weekly chart; why_new=owner ask; seam=source pins; no_claim=pixel layout
  assert.equal((view.match(/<WeekBars /g) || []).length, 8, 'got done, four Kept safe, learned, spent, your time');
  assert.equal((view.match(/<WeekLine /g) || []).length, 2, 'questions per 100 and while you were away');
  assert.match(view, /const wks = view\.weeks \?\? null;/);
});

test('Spent and Your time fill their tiles: title at the top, plan use or what it means at the foot', () => {
  // Value: protects=the owner\'s 2026-10-15 notes (title at the top, no empty foot); fails_when=the Spent tile centers its title, plan use leaves the foot, or Your time loses its comparison; why_new=owner notes; seam=source pins; no_claim=pixel layout
  const spent = view.slice(view.indexOf("{t('pulse.whereMoneyWent')}") - 400, view.indexOf("{/* Your time and while you were away"));
  assert.match(spent, /\.\.\.tight, justifyContent: 'space-between'/);
  assert.match(spent, /width: `\$\{Math\.min\(100, view\.headroom\.usedPct\)\}%`/, 'plan use is a bar at the foot');
  assert.match(view, /t\('pulse\.asksBefore', \{ n: prev\.asks, before: t\(`pulse\.learning\.before\.\$\{s\.period\}`\) \}\)/);
});
