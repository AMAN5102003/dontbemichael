'use strict';

/**
 * A business office's agents get the rewritten instructions (agent
 * instructions audit, 2026-09-25): Michael's standing instructions with his
 * business briefing, and shared instructions for team members, each followed
 * by the house rules, folders, memory and company knowledge. Calm wording, no
 * dashes, nothing about spawning, git, COMMANDS.md or the build.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager, HOUSE_RULES } = loadTs('src/main/hive.ts');
const promptOf = (inj) => inj.args[inj.args.indexOf('--append-system-prompt') + 1];

const business = {
  name: 'Pho Saigon Kitchen', city: 'Austin, TX', typeName: 'Restaurant & Food',
  briefing: '{Business} in {City} earns from dine in, takeout and catering. Finance handles money.'
};

async function office(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bizprompt-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const biz = path.join(home, 'Documents', 'Pho');
  fs.mkdirSync(path.join(biz, 'Finance'), { recursive: true });
  const hive = new HiveManager(() => home);
  const opts = { businessFolder: biz, business, docTextCliPath: '/App/docText.js' };
  const god = promptOf(await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: biz, isGod: true }, opts));
  const oscar = promptOf(await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: path.join(biz, 'Finance'), role: 'Finance: Oscar keeps the books.' }, opts));
  return { god, oscar };
}

test('Michael is told who he is, about the business, and how to route, ask and keep the board', async (t) => {
  const { god } = await office(t);
  assert.match(god, /^## Who you are\nYou are Michael, the office manager for Pho Saigon Kitchen, a restaurant & food business in Austin, TX\./);
  assert.match(god, /## The business\nPho Saigon Kitchen in Austin, TX earns from dine in, takeout and catering\./);
  for (const h of ['## Routing work', '## Doing it yourself', '## When no one fits', '## The Ask me board', '## Keeping the task board accurate', '## Scheduled runs', '## Staying cheap', '## Files']) {
    assert.ok(god.includes(h), h);
  }
  assert.match(god, /"raisedBy": "<id or god>"/);
  assert.ok(god.includes(HOUSE_RULES));
});

test('a team member gets the shared instructions: Michael is the link, approvals go through him, "michael" is his address', async (t) => {
  const { oscar } = await office(t);
  assert.match(oscar, /^You are Oscar, the Finance on the team at Pho Saigon Kitchen in Austin, TX\. Michael is the office manager/);
  assert.match(oscar, /Anything hard to undo, public, or costing money is the owner's call, so send it to Michael for approval first/);
  assert.match(oscar, /"to": "michael"/);
  assert.match(oscar, /A message sent by the scheduler names a job from your Work style/);
  assert.ok(oscar.includes('"/App/docText.js" "<file>"'), 'the document reader');
  assert.ok(oscar.includes(HOUSE_RULES));
});

test('both are plain: no dashes, no spawning, git, build or COMMANDS.md, no LIVE CONTEXT', async (t) => {
  const { god, oscar } = await office(t);
  for (const p of [god, oscar]) {
    assert.doesNotMatch(p, /[–—]/);
    assert.doesNotMatch(p, /SPAWNING|spawn-requests|COMMANDS\.md|RUNNING BUILD|LIVE CONTEXT|git |worktree|SLACK REPLIES|Env vars available/);
    assert.doesNotMatch(p, /\b(NEVER|ALWAYS|MUST)\b/);
  }
});

test('an install without a business folder keeps its older instructions', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-oldprompt-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const p = promptOf(await hive.ensureAgent({ id: 'jim', name: 'Jim', provider: 'claude', cwd: home }));
  assert.match(p, /HIVE PROTOCOL/);
});

test('Michael\'s prompt never teaches a numbered list of choices; asks use options and parts', async (t) => {
  // Value: protects=new Ask me cards show choices as rows to pick; fails_when=any section of the prompt Michael runs with offers choices as a numbered or bulleted list; why_new=owner 2026-10-15, an old copy of the nothing-fits rule kept asks as text lists; seam=ensureAgent prompt
  const { god } = await office(t);
  const own = god.replace(HOUSE_RULES, '');
  const fit = own.slice(own.indexOf('## When no one fits'), own.indexOf('## The Ask me board'));
  assert.match(fit, /put these choices in the ask's "options", with "recommended": true on the one you recommend: add a team member for it/);
  assert.match(fit, /; or drop it\./);
  assert.doesNotMatch(own, /^[ \t]*(?:\d+[.)]|[-*•])[ \t]+(?:Add a team member|Hand it to|You do it yourself|Drop it)/m);
  assert.doesNotMatch(own, /numbered (?:list|options)|"1\." number|bullet or/);
});
