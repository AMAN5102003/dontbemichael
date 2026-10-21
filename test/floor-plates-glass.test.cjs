'use strict';

/**
 * The office floor says what each office does, and its monitors are glass
 * (owner, 2026-10-15; docs/designs/office-floor-plates-glass.md). Owners who
 * don't know The Office saw only names; each pod now carries its department on
 * a plate in front of the chairs, and the thick black monitors are frameless
 * glass slabs, clear when idle and tinted with scrolling lines at work.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const art = read('src/renderer/src/scene/studio/StudioArt.tsx');
const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');

test('every pod carries its department on a plate in front of the chairs', () => {
  // Value: protects=the department shows on the floor whatever state the pod is in; fails_when=the stage stops passing the label or the pod stops drawing the plate; why_new=owner 2026-10-15; seam=none
  assert.match(stage, /<Pod[\s\S]*?label=\{t\(`studio\.dept\.\$\{pod\.dept\}`\)\}/);
  assert.match(art, /\{plate && <DeptPlate at=\{P\(gx, gy \+ plateGy, 6\)\} \{\.\.\.plate\} c=\{c\} dark=\{dark\} \/>\}/);
  // Right after the front chair's back, and the pad grows only by what the plate needs.
  assert.match(art, /const plateGy = \(n <= 2 \? CHAIR_END : FRONT_ROW \+ CHAIR_END\) \+ 0\.1;/);
  assert.match(art, /const front = plate \? Math\.max\(0, plateGy \+ 0\.12 - hd\) : 0;/);
  assert.match(art, /const hw = Math\.max\(n === 1 \? 0\.65 : 1\.0, plate \? plate\.w \/ \(2 \* S\) \+ 0\.06 : 0\);/, 'a long word widens a small office just enough');
  // In the floor's plane, small, in the department color; no spacing that would break Arabic.
  assert.match(art, /matrix\(1,0\.5,-1,0\.5,/);
  assert.match(art, /fontSize=\{5\.8\} letterSpacing=\{spaced \? 0\.5 : 0\} fill=\{c\.acc\}/);
});

test('monitors are frameless glass: clear when idle, tinted and scrolling at work, Michael included', () => {
  // Value: protects=no black bezel returns on any desk or in the hub; fails_when=a station or the hub draws T.mon again or idle glass loses its reflection; why_new=owner 2026-10-15; seam=none
  assert.doesNotMatch(art, /top=\{T\.mon\[0\]\}/, 'no dark monitor box anywhere');
  assert.equal((art.match(/top=\{GLASS_TOP\} left=\{GLASS_LEFT\} right=\{GLASS_RIGHT\}/g) || []).length, 2, 'desks and the hub');
  assert.match(art, /const screenFill = st === 'idle' \? GLASS_IDLE/);
  assert.match(art, /\{!on && \(\s*\/\/ a soft reflection across the glass/);
  assert.match(art, /const scrolling = st === 'working' \|\| st === 'looping' \|\| st === 'thinking' \|\| st === 'compacting';/);
  assert.match(art, /fill=\{busy \? 'rgba\(108,92,231,0\.14\)' : GLASS_IDLE\}/, "Michael's screens");
});

test('the HR department is called HR', () => {
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json'));
  assert.equal(en.studio.dept.people, 'HR');
  for (const loc of ['ar', 'zh-CN']) assert.ok(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).studio.dept.people, loc);
});
