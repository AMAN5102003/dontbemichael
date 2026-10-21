'use strict';

/**
 * A mail tool's name comes from the agent's call, and both mail checks look it
 * up in MAIL_TOOL_OPS. On a plain object "constructor" and "__proto__" are
 * inherited, so each check read them as known tools: the PreToolUse hook sent
 * mcp__md-mail__constructor on to the mailbox rule like any other call, and the
 * broker ran POST /mail/constructor down to its send step. A Can send member's
 * email went out; for Draft only and Send on approval only the last check
 * before the mail server stopped it. Both checks now refuse such a name as an
 * unknown tool.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { MAIL_TOOL_OPS } = loadTs('src/shared/mailboxes.ts');
const { handleMailRequest } = loadTs('src/main/mail.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

/** Names a plain object inherits. The broker's route takes [a-z_] only, so
 *  the first two are the ones that can reach it. */
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

const server = { host: 'h', port: 993, secure: true };
/** Kelly sends from support@ without asking. */
const office = () => ({
  mailboxes: [{ id: 'support', address: 'support@x.com', provider: 'gmail', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 }],
  agentCapabilities: { kelly: { email: { enabled: true, mailboxes: ['support'], send: true, sending: 'send' } } }
});
const email = { mailbox: 'support', to: 'a@b.com', subject: 's', body: 'b' };

test('the tool map holds its nine tools and nothing a plain object inherits', () => {
  // Value: protects=the one map both mail checks read; fails_when=MAIL_TOOL_OPS is a plain object literal again; why_new=no test looked up a name outside the nine; seam=none
  for (const name of INHERITED) assert.equal(MAIL_TOOL_OPS[name], undefined, name);
  assert.deepEqual(Object.keys(MAIL_TOOL_OPS).sort(), ['archive', 'draft', 'list_mailboxes', 'mark_junk', 'mark_read', 'propose', 'read', 'search', 'send']);
  assert.equal(MAIL_TOOL_OPS.send, 'send');
});

test('the broker refuses an inherited name as an unknown tool and never touches the mailbox', async () => {
  // Value: protects=POST /mail/<tool> answers 404 for anything but the nine tools; fails_when=the broker reads an inherited property as a tool and runs the call; why_new=a Can send member's POST /mail/constructor sent an email; seam=none
  const untouched = new Proxy({}, { get: (_t, key) => { throw new Error(`the mail service was used (${String(key)})`); } });
  for (const tool of ['constructor', '__proto__']) {
    const out = await handleMailRequest(untouched, { getConfig: office }, 'kelly', tool, email);
    assert.equal(out.status, 404, `${tool}: ${JSON.stringify(out.body)}`);
    assert.equal(out.body.error, `Unknown mail tool "${tool}".`);
  }
});

test('the hook refuses an inherited name before the mailbox rule, and still lets a real tool through', async (t) => {
  // Value: protects=the PreToolUse check refuses unknown md-mail tools; fails_when=the hook reads an inherited property as a tool; why_new=mcp__md-mail__constructor reached mailAccess as an allowed call; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-names-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'kelly', name: 'kelly', provider: 'claude', cwd: home });
  const hook = new HookServer(hive, () => null, () => ({ harnessHome: home, ...office() }));
  const call = (tool) => hook.handle({ agent_id: 'kelly', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: `mcp__md-mail__${tool}`, tool_input: email, cwd: home });
  for (const tool of ['constructor', '__proto__']) {
    const r = await call(tool);
    assert.equal(r?.hookSpecificOutput?.permissionDecision, 'deny', tool);
    assert.equal(r.hookSpecificOutput.permissionDecisionReason, 'Unknown mail tool.');
  }
  assert.notEqual((await call('send'))?.hookSpecificOutput?.permissionDecision, 'deny', 'a Can send member still sends');
});
