'use strict';

/**
 * Pulse proposal 3 (owner, 2026-10-15; mockup pulse-v3.html): Kept safe,
 * Learning and Team at work, and the backfill's readers. Pure parts only;
 * the store, processor and an end to end backfill are in pulse-telemetry.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { trustKeys, keptSafe } = loadTs('src/shared/pulseSafety.ts');
const { learning, MIN_TURNS_FOR_RATE } = loadTs('src/shared/teamLearning.ts');
const { teamAtWork } = loadTs('src/shared/teamPerformance.ts');
const { readTranscript, gateOfTool, logPoints, ledgerDays } = loadTs('src/main/pulseBackfill.ts');
const { readTeamMemory } = loadTs('src/main/teamMemory.ts');

test('a trust layer deny is a stop only when the check judged it; a check that could not run is held', () => {
  // Value: protects=Kept safe's honesty (held is not protection); fails_when=no-answer, unreadable or too long counts as stopped, or a flag is lost; why_new=owner proposal 3; seam=none; no_claim=none beyond protects
  assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by: 'model' }), ['in-stop']);
  assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by: 'pattern' }), ['in-stop']);
  assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by: 'recheck' }), ['in-stop']);
  for (const by of ['no-answer', 'unreadable', 'length']) assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by }), ['in-held'], by);
  assert.deepEqual(trustKeys({ way: 'out', decision: 'deny', by: 'no-answer' }), ['out-held']);
  assert.deepEqual(trustKeys({ way: 'out', decision: 'pass', flagged: true }), ['out-pass', 'out-flagged']);
  assert.deepEqual(trustKeys({ way: 'sideways', decision: 'pass' }), []);
  assert.equal(keptSafe([]).any, false);
});

test('Learning: notes by week and source, the running total, and questions per 100 requests once a week has enough', () => {
  // Value: protects=the Learning row; fails_when=a note lands in the wrong week, the total ignores earlier notes, a thin week shows a rate, or knows leaves out procedures; why_new=owner proposal 3; seam=none; no_claim=what a note says
  const now = new Date(2026, 9, 15, 12).getTime(); // a Thursday
  const notes = [
    { agentId: 'pam', source: 'owner', date: '2026-09-10' },   // before the four weeks: only in the total
    { agentId: 'pam', source: 'owner', date: '2026-09-22' },
    { agentId: 'pam', source: 'task', date: '2026-10-13' },
    { agentId: 'god', source: 'michael', date: '2026-10-14' },
    { agentId: 'god', source: 'tool', date: '2026-10-15' }
  ];
  const asks = [{ raisedBy: 'pam', askedAt: new Date(2026, 9, 13, 9).getTime() }, { raisedBy: 'god', askedAt: new Date(2026, 9, 14, 9).getTime() }];
  const turns = [{ day: '2026-10-13', turns: 30 }, { day: '2026-10-14', turns: 10 }, { day: '2026-10-06', turns: MIN_TURNS_FOR_RATE - 1 }];
  const l = learning({ now, notes, procedures: { pam: 2 }, asks, turns });
  assert.deepEqual(l.weeks.map((w) => w.from), ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  assert.deepEqual(l.weeks.map((w) => w.total), [2, 2, 2, 5]);
  assert.deepEqual(l.weeks[3].added, { you: 0, job: 2, michael: 1 });
  assert.equal(l.weeks[3].per100, 5, '2 questions in 40 requests');
  assert.equal(l.weeks[2].per100, null, 'too few requests');
  assert.deepEqual([l.notes, l.procedures, l.knows.pam, l.knows.god], [5, 2, 5, 2]);
});

test('Team at work: busiest, several times the average, quiet, and costly for its work only against enough peers', () => {
  // Value: protects=the callouts and headline; fails_when=a quiet member is called busy, a member with little time is judged on cost, or costly is called with too few to compare; why_new=owner proposal 3; seam=none; no_claim=none beyond protects
  const h = 3_600_000;
  const w = teamAtWork([
    { agentId: 'god', busyMs: 3.8 * h, usd: 36 },
    { agentId: 'pam', busyMs: 3.6 * h, usd: 43 },
    { agentId: 'dwight', busyMs: 2.1 * h, usd: 40 },
    { agentId: 'kelly', busyMs: 0.7 * h, usd: 25 },
    { agentId: 'creed', busyMs: 0.32 * h, usd: 31 },
    { agentId: 'sadiq', busyMs: 0.05 * h, usd: 8 }
  ]);
  assert.equal(w.chips.god.kind, 'busiest');
  assert.equal(w.chips.pam.kind, 'times');
  assert.equal(w.chips.creed.kind, 'costly');
  assert.equal(w.chips.sadiq.kind, 'quiet', 'under ten minutes: not judged on cost');
  assert.deepEqual(w.topTwo.ids, ['god', 'pam']);
  assert.equal(w.costliest.agentId, 'creed');
  assert.deepEqual(teamAtWork([{ agentId: 'a', busyMs: 0, usd: 3 }]).chips, {});
  const two = teamAtWork([{ agentId: 'a', busyMs: h, usd: 100 }, { agentId: 'b', busyMs: h, usd: 1 }]);
  assert.equal(two.costliest, null, 'too few to compare');
});

test('a transcript gives working time per request and the steps a setting refused, once each', () => {
  // Value: protects=the backfill's hours and rules; fails_when=a tool result starts a request, a request runs past an hour, a refusal counts twice, or AskUserQuestion counts; why_new=owner proposal 3 backfill; seam=none; no_claim=every Claude Code line shape
  const iso = (ms) => new Date(ms).toISOString();
  const t0 = Date.UTC(2026, 9, 12, 15);
  const lines = [
    { type: 'user', timestamp: iso(t0), message: { content: 'hello' } },
    { type: 'assistant', timestamp: iso(t0 + 60_000), message: { content: [] } },
    { type: 'user', timestamp: iso(t0 + 70_000), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'PreToolUse:WebFetch hook error: Only Research uses the internet.' }] } },
    { type: 'user', timestamp: iso(t0 + 70_000), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'PreToolUse:WebFetch hook error: Only Research uses the internet.' }] } },
    { type: 'user', timestamp: iso(t0 + 80_000), message: { content: [{ type: 'tool_result', tool_use_id: 'y', content: 'PreToolUse:AskUserQuestion hook error: ask Michael' }] } },
    { type: 'assistant', timestamp: iso(t0 + 120_000), message: { content: [] } },
    { type: 'user', timestamp: iso(t0 + 200_000), message: { content: [{ type: 'text', text: 'next' }] } },
    { type: 'assistant', timestamp: iso(t0 + 200_000 + 3 * 3_600_000), message: { content: [] } },
    'not json'
  ].map((l) => (typeof l === 'string' ? l : JSON.stringify(l)));
  const r = readTranscript(lines, t0 - 1, t0 + 10 * 3_600_000);
  assert.deepEqual(r.turns, [{ ts: t0, ms: 120_000 }, { ts: t0 + 200_000, ms: 3_600_000 }]);
  assert.deepEqual(r.refused, [{ ts: t0 + 70_000, gate: 'internet' }]);
  assert.equal(gateOfTool('mcp__md-mail__send', ''), 'mail');
  assert.equal(gateOfTool('mcp__claude_ai_Gmail__search', ''), 'connector');
  assert.equal(gateOfTool('Edit', 'The harness folder is plumbing only'), 'office-files');
  assert.equal(gateOfTool('Read', 'That folder is private'), 'folder');
});

test('office log points carry the past mark, and only a member\'s message is work', () => {
  // Value: protects=backfill isolation and attribution; fails_when=a backfilled point lacks bf, a message from the scheduler counts as a member's work, or an entry outside the window is read; why_new=owner proposal 3 backfill; seam=none; no_claim=none beyond protects
  const pts = logPoints([
    { ts: 10, kind: 'mail-organize', agentId: 'pam', ids: [1, 2] },
    { ts: 10, kind: 'message', from: 'scheduler', to: 'pam' },
    { ts: 10, kind: 'message', from: 'god', act: 'request' },
    { ts: 99, kind: 'mail-sent', agentId: 'dwight' }
  ], 0, 50, new Set(['pam', 'god']));
  assert.deepEqual(pts.map((p) => [p.kind, p.agentId, p.value ?? null, p.attrs.bf]), [['email', 'pam', 2, 1], ['message', 'god', null, 1]]);
});

test('the cost ledger folds with the restart rule and counts only growth inside the window', () => {
  // Value: protects=backfilled value; fails_when=a restart drop loses the new spend, growth before the window counts, or a later line counts; why_new=owner proposal 3 backfill; seam=none; no_claim=none beyond protects
  const day = new Date(2026, 9, 12, 12).getTime();
  const m = ledgerDays([
    { agent_id: 'pam', session_id: 's', ts: day - 30 * 86_400_000, usd: 5 },
    { agent_id: 'pam', session_id: 's', ts: day, usd: 7 },
    { agent_id: 'pam', session_id: 's', ts: day + 1, usd: 1 },
    { agent_id: 'pam', session_id: 's', ts: day + 2 * 86_400_000, usd: 50 }
  ], day - 86_400_000, day + 86_400_000);
  assert.deepEqual([...m], [['pam\t2026-10-12', 3]]);
});

test('team memory reads dates and sources only, for the members asked about', (t) => {
  // Value: protects=Learning's inputs; fails_when=a removed member's memory counts, a procedure is missed, or a free form line counts as a note; why_new=owner proposal 3; seam=temp hive; no_claim=none beyond protects
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-mem-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'agents', 'pam');
  fs.mkdirSync(path.join(dir, 'memory', 'procedures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory.md'), '# Memory\n<!-- memory index v1 -->\n- [m1] fact | Invoices go to the shared box | owner | 2026-10-01\n- just a line\n- [m2] procedure | Check: steps in x.md | task | 2026-10-02\n');
  fs.writeFileSync(path.join(dir, 'memory', 'procedures', 'check.md'), 'steps');
  fs.mkdirSync(path.join(root, 'agents', 'gone'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'gone', 'memory.md'), '- [m1] fact | x | owner | 2026-10-01\n');
  const m = readTeamMemory(root, ['pam', 'nobody']);
  assert.deepEqual(m.notes, [{ agentId: 'pam', source: 'owner', date: '2026-10-01' }, { agentId: 'pam', source: 'task', date: '2026-10-02' }]);
  assert.deepEqual(m.procedures, { pam: 1 });
});

// ─── the plan's real cost, split by share of the work (owner, 2026-10-15) ──

const { planFromAccount, planPrice, planCostFor, scaleSnapshot, DAYS_PER_MONTH } = loadTs('src/shared/claudePlan.ts');
const { readClaudePlan, forgetClaudePlan } = loadTs('src/main/claudeAccount.ts');

test('the plan comes from Claude Code\'s account record, and the owner\'s price wins over the list price', () => {
  // Value: protects=a realistic cost on a plan; fails_when=Max 20x reads as 5x, a team plan gets a made up price, or the owner's price is ignored; why_new=owner 2026-10-15; seam=none; no_claim=current list prices (the owner's figure covers drift)
  assert.equal(planFromAccount({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' }), 'max-20x');
  assert.equal(planFromAccount({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x' }), 'max-5x');
  assert.equal(planFromAccount({ organizationType: 'claude_pro' }), 'pro');
  assert.equal(planFromAccount({ organizationType: 'claude_team' }), 'team');
  assert.equal(planFromAccount({}), null);
  assert.deepEqual(planPrice('max-20x', undefined), { plan: 'max-20x', label: 'Claude Max 20x', monthly: 200, source: 'detected' });
  assert.deepEqual(planPrice('max-20x', 180), { plan: 'max-20x', label: 'Claude Max 20x', monthly: 180, source: 'owner' });
  assert.equal(planPrice('team', undefined), null, 'a seat priced plan needs the owner\'s figure');
  assert.equal(planPrice('team', 150).monthly, 150);
  assert.equal(planPrice(null, 0), null);
});

test('the period\'s plan cost counts only the days that have passed, and the split keeps each member\'s share', () => {
  // Value: protects=the numbers on a plan; fails_when=a whole week is charged on Monday, a member's share changes, or per piece costs stay at pay per use prices; why_new=owner 2026-10-15; seam=none; no_claim=none beyond protects
  const from = new Date(2026, 9, 12).getTime();
  const to = from + 7 * 86_400_000 - 1;
  assert.ok(Math.abs(planCostFor(200, from, to, from + 3.5 * 86_400_000) - (200 * 3.5) / DAYS_PER_MONTH) < 1e-9);
  assert.ok(Math.abs(planCostFor(200, from, to, to + 86_400_000 * 9) - (200 * 7) / DAYS_PER_MONTH) < 1e-6, 'a past week counts whole');
  const snap = { totalUsd: 100, members: [
    { agentId: 'a', usd: 75, share: 0.75, perPiece: { email: 2 }, costForWork: { kind: 'email', perPiece: 2, usual: 1, verdict: 'pricier', position: 0.9 } },
    { agentId: 'b', usd: 25, share: 0.25, perPiece: {}, costForWork: { kind: null, perPiece: null, usual: null, verdict: 'too-few', position: 0.5 } }
  ] };
  const s = scaleSnapshot(snap, 0.2);
  assert.deepEqual([s.totalUsd, s.members[0].usd, s.members[1].usd, s.members[0].share], [20, 15, 5, 0.75]);
  assert.deepEqual([s.members[0].perPiece.email, s.members[0].costForWork.perPiece, s.members[0].costForWork.usual, s.members[1].costForWork.perPiece], [0.4, 0.4, 0.2, null]);
});

test('the plan is read from plan fields only, and a missing or broken record is no plan', (t) => {
  // Value: protects=detection without touching secrets; fails_when=a token field is read, or a broken file throws; why_new=owner 2026-10-15; seam=temp file; no_claim=Claude Code's future record shape
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-plan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ oauthAccount: { organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x', emailAddress: 'owner@example.com' } }));
  forgetClaudePlan();
  assert.equal(readClaudePlan(1, file), 'max-20x');
  fs.writeFileSync(file, '{ not json');
  forgetClaudePlan();
  assert.equal(readClaudePlan(2, file), null);
  forgetClaudePlan();
  assert.equal(readClaudePlan(3, path.join(dir, 'missing.json')), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/claudeAccount.ts'), 'utf8');
  assert.doesNotMatch(src, /accessToken|refreshToken|credentials/, 'never near a secret');
});

test('Pulse shows the plan\'s cost with the pay per use figure behind the (i), and Settings takes an override', () => {
  // Value: protects=the owner's ask; fails_when=the money line shows pay per use dollars on a known plan, the (i) loses the pay per use figure, or the Settings price is not saved; why_new=owner 2026-10-15; seam=source pins; no_claim=pixel layout
  const view = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/pulse/PulseView.tsx'), 'utf8');
  assert.match(view, /<InfoTip text=\{view\.plan \? t\('pulse\.plan\.tip', \{ monthly: dollars\(view\.plan\.monthly\), payPerUse: money\(view\.plan\.payPerUse\) \}\)/);
  assert.match(view, /t\('pulse\.plan\.ofPlan', \{ plan: view\.plan\.label \?\? t\('pulse\.plan\.yourPlan'\), monthly: dollars\(view\.plan\.monthly\) \}\)/);
  assert.equal((view.match(/<WhoBar /g) || []).length, 2, 'the money card is one total; who spent what is Team at work (owner, 2026-10-15)');
  const svc = fs.readFileSync(path.join(__dirname, '..', 'src/main/pulse.ts'), 'utf8');
  assert.match(svc, /const price = billing === 'account' \? this\.planPrice\(\) : null;/, 'an API key shows what was spent');
  assert.match(svc, /scaleSnapshot\(raw, periodCost \/ raw\.totalUsd\)/);
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/SettingsModal.tsx'), 'utf8');
  assert.match(settings, /\.\.\.planPricePatch\(\),/);
  assert.match(settings, /\{cfgX\.claudeAuth !== 'apiKey' && \(/);
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/i18n/locales/en.json'), 'utf8'));
  assert.match(en.pulse.plan.tip, /\{\{payPerUse\}\} at pay per use prices/);
});

// ─── coverage audit, 2026-10-16: the backfill's rejected frames and floor controls ──

test('the backfill counts only a frame naming the wrong member as an impostor, and keeps reopened cards and trust decisions', () => {
  // Value: protects=Kept safe's sender count from the past, and reopen evidence; fails_when=a no secret or old secret frame logged before 2026-10-15 counts as an impostor, a wrong sender frame is dropped, or a reopen or trust decision is lost; why_new=logPoints' rejected frame rule had no test; seam=none; no_claim=none beyond protects
  const pts = logPoints([
    { ts: 10, kind: 'hook-frame-rejected', reason: 'wrong-sender', agentId: 'god' },
    { ts: 10, kind: 'hook-frame-rejected', reason: 'no-secret', agentId: 'god' },
    { ts: 10, kind: 'hook-frame-rejected', reason: 'old-secret', agentId: 'pam' },
    { ts: 10, kind: 'card-reopen', agentId: 'pam', id: 'c1' },
    { ts: 10, kind: 'trust-layer', way: 'in', decision: 'deny', by: 'model' }
  ], 0, 50, new Set(['pam', 'god']));
  assert.deepEqual(pts.map((p) => [p.kind, p.agentId, p.attrs.gate ?? p.attrs.id ?? p.attrs.decision ?? null, p.attrs.bf]), [
    ['refused', 'god', 'impostor', 1], ['card-reopen', 'pam', 'c1', 1], ['trust', null, 'deny', 1]
  ]);
  assert.deepEqual(trustKeys(pts[2].attrs), ['in-stop'], 'a past decision folds like a live one');
});

test('a step stopped from the floor counts as paused in the backfill, as hooks.ts counts it live', () => {
  // Value: protects=Your rules held reads the same for the weeks before Pulse as after; fails_when=a refusal from the floor's pause or tool gate is filed under the tool's own rule (sandbox, folder, connector) instead of paused, where hooks.ts files every control refusal live; why_new=gateOfTool matched only the pause wording; seam=none (ControlRegistry's own reasons); no_claim=reasons a future control adds
  const { ControlRegistry } = loadTs('src/main/control.ts');
  const c = new ControlRegistry();
  c.pause('dwight', true);
  c.gateTool('pam', 'Bash', true);
  const paused = c.toolDecision('dwight', 'Write');
  const gated = c.toolDecision('pam', 'Bash');
  assert.equal(paused.deny && gated.deny, true);
  assert.equal(gateOfTool('Write', paused.reason), 'paused');
  assert.equal(gateOfTool('Bash', gated.reason), 'paused', 'a gated tool is a floor control, not the sandbox rule');
});
