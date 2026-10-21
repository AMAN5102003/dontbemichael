'use strict';

/**
 * Pete's first day welcome (owner, 2026-10-13: D5, D7, D9): after the owner
 * turns Research on, the first conversation that can be one of Pete's is,
 * once per turn on, kept per office. Turning Research on again welcomes him
 * again; a restart or a restore does not.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const W = loadTs('src/renderer/src/scene/office/peteWelcome.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('the welcome plays once per turn on, in each office on its own', () => {
  // Value: protects=armed until played, then not until Research is turned on again, per office home; fails_when=the key loses the office, mark or forget stops working; why_new=E3, D7, D9; seam=storage argument (the studio passes localStorage); no_claim=real browser storage (a Map stands in)
  const s = memoryStorage();
  assert.equal(W.welcomeArmed(s, '/offices/a'), true, 'a new office welcomes Pete');
  W.markWelcomed(s, '/offices/a');
  assert.equal(W.welcomeArmed(s, '/offices/a'), false, 'not twice');
  assert.equal(W.welcomeArmed(s, '/offices/b'), true, 'another office keeps its own welcome');
  assert.equal(s.m.get('pete-welcomed:/offices/a'), '1');
  W.forgetWelcome(s, '/offices/a');
  assert.equal(W.welcomeArmed(s, '/offices/a'), true, 'turned on again: welcomed again');
  assert.equal(W.welcomeKey(null), 'pete-welcomed', 'an unknown office uses the plain key');
});

test('a blocked storage never throws and never replays the welcome in one session', () => {
  // Value: protects=storage errors stay quiet and the window remembers the welcome; fails_when=a storage throw escapes or the welcome replays on every tick; why_new=E3 error map; seam=storage argument; no_claim=a later start may replay it (accepted, CEO Error and Rescue map)
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(W.welcomeArmed(blocked, '/offices/c'), true);
  assert.doesNotThrow(() => W.markWelcomed(blocked, '/offices/c'));
  assert.equal(W.welcomeArmed(blocked, '/offices/c'), false, 'remembered in this window');
  assert.doesNotThrow(() => W.forgetWelcome(blocked, '/offices/c'));
  assert.equal(W.welcomeArmed(blocked, '/offices/c'), true);
  assert.equal(W.welcomeArmed(undefined, '/offices/d'), true, 'no storage at all');
});

test('only a real turn on re-arms the welcome, and only the timer plays it', () => {
  // Value: protects=forgetWelcome runs after the spawn succeeds (not on the already on floor return), the tick asks for the welcome and demo banter does not; fails_when=the clear moves before the early return or demo banter uses up the welcome; why_new=D7 repair, spec pass 3; seam=none; no_claim=runtime order (source pins)
  const research = read('src/renderer/src/shell/research.ts');
  const start = research.slice(research.indexOf('export async function startResearch'), research.indexOf('export async function stopResearch'));
  const clear = start.indexOf('forgetWelcome(browserStorage(), ROSTER_BOOT_HOME)');
  assert.ok(clear > start.indexOf('if (!res.ok)'), 'after a failed spawn has returned');
  assert.ok(clear < start.indexOf('store.addAgent('), 'before Pete reaches the floor');
  assert.ok(start.indexOf('if (researchOnFloor()) return { ok: true };') < start.indexOf('const prep'), 'already on the floor returns before any clear');
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(stage, /if \(Date\.now\(\) < busyUntil\) return;\n\s*if \(welcomeChat\(\)\) return;/, 'the timer asks for the welcome first');
  assert.match(stage, /const banterNow = \(\) => \{ if \(!chat\(\)\) say\(\); \};/, 'demo banter never takes the welcome');
  assert.match(stage, /welcomeArmed\(browserStorage\(\), ROSTER_BOOT_HOME\)/, 'read each tick, per office');
  assert.match(stage, /podOfId\(b\.id\) !== podOfId\(pete\.id\)/, 'partners from other pods, as all banter');
});

test('the welcome is marked played only once its first beat is in the air, on both paths', () => {
  // Value: protects=the welcome plays once instead of on every tick; fails_when=the first beat callback or a markWelcomed call is dropped; why_new=ship testing review; seam=none; no_claim=runtime timing (source pins)
  const stage = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'renderer', 'src', 'scene', 'studio', 'StudioStage.tsx'), 'utf8');
  assert.match(stage, /if \(i === 0\) thrown\?\.\(\);/, 'marked once a beat is thrown');
  assert.equal((stage.match(/\(\) => markWelcomed\(browserStorage\(\), ROSTER_BOOT_HOME\)/g) || []).length, 2, 'both welcome paths mark it');
});
