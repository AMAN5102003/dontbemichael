'use strict';

// Parallel tool calls keep each other's detail on the closing-time row
// (TODOS: "Parallel tool calls clear each other's detail").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { RunningToolCalls } = loadTs('src/renderer/src/hooks/runningToolCalls.ts');

const call = (tool, detail, at) => ({ tool, detail, at });

test('when one of two parallel calls ends, the other is still running', () => {
  const r = new RunningToolCalls();
  r.start('pam', 'a', call('Bash', 'Run the tests', 1));
  r.start('pam', 'b', call('Read', 'plan.md', 2));
  assert.deepEqual(r.end('pam', 'b'), call('Bash', 'Run the tests', 1));
  assert.equal(r.end('pam', 'a'), undefined);
});

test('the latest call still running is the one shown', () => {
  const r = new RunningToolCalls();
  r.start('pam', 'a', call('Read', 'a.md', 1));
  r.start('pam', 'b', call('Read', 'b.md', 2));
  r.start('pam', 'c', call('Read', 'c.md', 3));
  assert.equal(r.end('pam', 'a').detail, 'c.md');
  assert.equal(r.end('pam', 'c').detail, 'b.md');
});

test('a call that never ended (failed or refused) does not come back after the next call', () => {
  const r = new RunningToolCalls();
  r.start('pam', 'failed', call('Bash', 'Deploy', 1));
  r.start('pam', 'b', call('Read', 'plan.md', 2));
  r.end('pam', 'b');
  r.start('pam', 'c', call('Edit', 'plan.md', 3));
  assert.equal(r.end('pam', 'c'), undefined);
});

test('a new turn or a stop clears the calls, and agents never share them', () => {
  const r = new RunningToolCalls();
  r.start('pam', 'a', call('Bash', 'Run the tests', 1));
  r.start('pam', 'b', call('Read', 'plan.md', 2));
  r.start('jim', 'c', call('Read', 'notes.md', 3));
  r.clear('pam');
  assert.equal(r.end('pam', 'b'), undefined);
  r.start('jim', 'd', call('Read', 'more.md', 4));
  assert.equal(r.end('jim', 'd').detail, 'notes.md');
  assert.equal(r.end('jim', undefined), undefined, 'no id: nothing to go back to');
});

test('the panel starts a call on PreToolUse, goes back on PostToolUse, and clears on a prompt or a stop', () => {
  // Value: protects=useHive wires the helper into the hook events; fails_when=a branch stops calling it; why_new=useHive can't be loaded in a test; seam=source pin
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/hooks/useHive.ts'), 'utf8');
  assert.match(src, /if \(e\.toolUseId\) runningCalls\.start\(e\.agentId, e\.toolUseId, \{ tool: e\.tool, detail: e\.detail, at: Date\.now\(\) \}\);/);
  assert.match(src, /const running = e\.event === 'PostToolUse' \? runningCalls\.end\(e\.agentId, e\.toolUseId\) : undefined;\s*if \(running && !breakerArmed\) updateAgent\(e\.agentId, \{ action: `using \$\{running\.tool\}`, actionDetail: running\.detail, actionAt: running\.at \}\);/);
  assert.match(src, /if \(e\.event === 'UserPromptSubmit'\) \{ promptSubmits\.note\(e\.agentId\); runningCalls\.clear\(e\.agentId\); \}/);
  assert.match(src, /breakerLevel\.current\[e\.agentId\] = 'healthy';\s*runningCalls\.clear\(e\.agentId\);/);
});
