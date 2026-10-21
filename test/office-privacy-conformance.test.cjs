'use strict';

/**
 * Office privacy conformance: the bar an engine has to pass before it is added
 * to BUILD_ENGINES (TODOS.md, "Make a second engine ready for an office").
 *
 * One office, built the way the app builds it: Michael in the business folder,
 * two team members inside it, one outside it (a Dropbox folder, as an owner may
 * choose), a business folder name with a space, and a harness folder apart from
 * all of them. Each agent is spawned through HiveManager.ensureAgent with the
 * same folder policy and connector plan index.ts passes, and the test checks
 * what the app WRITES for it. No agent runs, so this needs no signed in account
 * and runs in CI.
 *
 * The three rules, for every team member:
 *   1. It cannot read another team member's folder, or Michael's.
 *   2. A shell command cannot write outside its own folder.
 *   3. A connector it was not given is refused, at spawn and on every call.
 *
 * What this does and does not prove: it pins what the app asks the engine to
 * enforce (the settings file and the PreToolUse decision). It does not prove
 * the engine obeys, and where an engine has no sandbox (Windows today) the
 * settings are written but nothing enforces the shell rules. The other tests
 * pin the parts: folder-access (the pure rules), harness-guard and
 * hooks-harness-guard (the hook), claude-connectors (the connector gate).
 *
 * Adding an engine: write a `view` for its config next to `claudeView` that
 * answers the same questions, and run the same three checks against it. An
 * engine that cannot answer a question yes-or-no must be downgraded (mail
 * Draft only, no connectors) and say why on the Access tab.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { onWindows, posixOnly } = require('./platform.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { folderPolicy } = loadTs('src/shared/folderAccess.ts');
const { folderLayoutFor } = loadTs('src/main/officeFile.ts');
const C = loadTs('src/shared/claudeConnectors.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

// The same rule the app uses for file name case (index.ts, hooks.ts).
const CASE_INSENSITIVE = process.platform !== 'linux';
const norm = (p) => {
  const s = path.resolve(p).replace(/\\/g, '/');
  return CASE_INSENSITIVE ? s.toLowerCase() : s;
};
const under = (dir, p) => {
  const d = norm(dir);
  const x = norm(p);
  return x === d || x.startsWith(d.endsWith('/') ? d : `${d}/`);
};
const anyUnder = (dirs, p) => dirs.some((d) => under(d, p));

// Claude Code has no shell sandbox on Windows, so the app does not ask for
// sandbox only there (hive.ts) and nothing fences a shell command. The file
// tool rules, the hook and the connector gate still hold, and are checked.
const SHELL_FENCED = !onWindows;

/** The folder in a Claude permission rule: `Read(//Users/a/Biz/Admin/**)` → `/Users/a/Biz/Admin`. */
function ruleDir(rule, tool) {
  const m = new RegExp(`^${tool}\\((.*)/\\*\\*\\)$`).exec(rule);
  if (!m) return null;
  let p = m[1].replace(/^\/\//, '/');
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // a Windows drive letter
  return p;
}

/**
 * What the settings the app writes for one Claude agent let it do. Claude
 * semantics, as hive.ts documents them: the sandbox writes the cwd and the
 * allowWrite folders only, allowRead wins over denyRead, a permission rule
 * `Edit(...)` covers every file writing tool, and a team member's shell runs
 * sandboxed only when allowUnsandboxedCommands is false.
 */
function claudeView(settings, cwd) {
  const fsx = (settings.sandbox && settings.sandbox.filesystem) || {};
  const deny = (settings.permissions && settings.permissions.deny) || [];
  const dirsOf = (tool) => deny.map((r) => ruleDir(r, tool)).filter(Boolean);
  const sandboxed = !!settings.sandbox && settings.sandbox.enabled === true;
  const sandboxOnly = sandboxed && settings.sandbox.allowUnsandboxedCommands === false;
  return {
    sandboxOnly,
    toolsMayRead: (p) => !anyUnder(dirsOf('Read'), p),
    toolsMayWrite: (p) => !anyUnder(dirsOf('Edit'), p),
    toolsMayWriteAllowList: (p) => anyUnder((settings.permissions && settings.permissions.additionalDirectories) || [], p),
    shellMayRead: (p) => !sandboxOnly || anyUnder(fsx.allowRead || [], p) || !anyUnder(fsx.denyRead || [], p),
    shellMayWrite: (p) => !sandboxOnly || (anyUnder([cwd, ...(fsx.allowWrite || [])], p) && !anyUnder(fsx.denyWrite || [], p)),
    sandboxDeniesWrite: (p) => sandboxed && anyUnder(fsx.denyWrite || [], p)
  };
}

// `claude mcp list` lines, as claude-connectors.test.cjs has them.
const MCP_LIST = [
  'claude.ai HubSpot: https://mcp.hubspot.com/anthropic - ✔ Connected',
  'claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected',
  'claude.ai Intuit QuickBooks: https://ai-inc.quickbooks.intuit.com/v1/mcp - ✔ Connected',
  'claude.ai Windsor.ai: https://mcp.windsor.ai - ! Needs authentication',
  'serena: uvx --from git+https://github.com/oraios/serena serena start-mcp-server - ✔ Connected'
].join('\n');

// Tool name prefix, and a read only tool that name would offer, per connector.
const CONNECTORS = {
  HubSpot: { prefix: 'mcp__claude_ai_HubSpot', tool: 'mcp__claude_ai_HubSpot__search_crm_objects' },
  'Google Drive': { prefix: 'mcp__claude_ai_Google_Drive', tool: 'mcp__claude_ai_Google_Drive__search_files' },
  'Intuit QuickBooks': { prefix: 'mcp__claude_ai_Intuit_QuickBooks', tool: 'mcp__claude_ai_Intuit_QuickBooks__company_info' },
  'Windsor.ai': { prefix: 'mcp__claude_ai_Windsor_ai', tool: 'mcp__claude_ai_Windsor_ai__list_sources' },
  serena: { prefix: 'mcp__serena', tool: 'mcp__serena__find_symbol' }
};
// Who was given what. Google Drive is on for the team and given to nobody.
// QuickBooks comes to Oscar by the Finance role default, HubSpot to Pam by grant.
const GRANTS = { oscar: ['Intuit QuickBooks'], pam: ['HubSpot'], kelly: [] };
const readsBooks = (id) => id === 'oscar';

async function buildOffice(t) {
  // Real paths: folderLayoutFor resolves links (macOS /var is /private/var).
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-privacy-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'HarnessAgents');
  const business = path.join(base, 'Documents', 'Pho Bakery');
  const agents = {
    god: { name: 'Michael', cwd: business, isGod: true },
    oscar: { name: 'Oscar', cwd: path.join(business, 'Finance') },
    pam: { name: 'Pam', cwd: path.join(business, 'Admin') },
    kelly: { name: 'Kelly', cwd: path.join(base, 'Dropbox', 'Sales') }
  };
  for (const d of [home, business, ...Object.values(agents).map((a) => a.cwd)]) fs.mkdirSync(d, { recursive: true });

  const parsed = C.parseMcpList(MCP_LIST);
  const cfg = {
    harnessHome: home,
    businessFolder: business,
    businessTeam: [],
    claudeConnectors: { list: parsed.connectors, servers: parsed.servers, readAt: 1 },
    connectorsOn: { HubSpot: true, 'Google Drive': true },
    quickbooksClaude: true,
    agentCapabilities: { pam: { connectors: GRANTS.pam } }
  };

  const hive = new HiveManager(() => home);
  const layout = folderLayoutFor(business, Object.values(agents).filter((a) => !a.isGod).map((a) => a.cwd), home);
  const spawned = {};
  for (const [id, a] of Object.entries(agents)) {
    // What index.ts passes to ensureAgent: the folder policy and the connector plan.
    const inj = await hive.ensureAgent(
      { id, name: a.name, provider: 'claude', cwd: a.cwd, isGod: !!a.isGod },
      {
        businessFolder: business,
        folderPolicy: folderPolicy({ isGod: !!a.isGod, cwd: a.cwd }, layout, CASE_INSENSITIVE),
        connectors: C.spawnConnectorPlan(cfg, id, readsBooks(id))
      }
    );
    const settings = JSON.parse(fs.readFileSync(inj.args[inj.args.indexOf('--settings') + 1], 'utf8'));
    spawned[id] = { inj, settings, view: claudeView(settings, a.cwd) };
  }

  const server = new HookServer(
    hive, () => ({ send() {} }), () => cfg,
    undefined, undefined, undefined, undefined, undefined, undefined, readsBooks
  );
  const hook = (agent_id, tool_name, tool_input) =>
    server.handle({ agent_id, session_id: 's1', hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: agents[agent_id].cwd });
  return { base, business, agents, spawned, hook };
}

const denied = (r) => !!(r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny');

// Value: protects=for one real office (Michael, a team folder inside the business folder, one outside it) the settings the app writes and its PreToolUse decisions hold all three privacy rules together: no reading another folder, no shell write outside the agent's own folder, no connector that was not given; fails_when=folderPolicy, hookSettings or spawnConnectorPlan stops carrying one of the three, or a writable folder is widened to cover the office; why_new=folder, sandbox and connector rules were each tested alone, never as one office with a person outside the business folder; seam=none
test('office privacy conformance: folders, shell writes and connectors hold for every team member', async (t) => {
  const o = await buildOffice(t);
  const rel = (p) => path.relative(o.base, p);
  const team = ['oscar', 'pam', 'kelly'];
  const ownOf = (id) => o.agents[id].cwd;
  const peersOf = (id) => team.filter((x) => x !== id);
  const file = (dir, name = 'notes.md') => path.join(dir, name);
  const michaelsFile = file(o.business, 'plan.md');
  // A folder inside the business folder that no team member owns is Michael's.
  const unownedFile = file(path.join(o.business, 'Marketing'), 'brief.md');
  const strayFile = file(path.dirname(o.business), 'stray.txt'); // beside the business folder

  await t.test('1. no team member reads another team member\'s folder or Michael\'s', async () => {
    for (const id of team) {
      const { view } = o.spawned[id];
      const who = `${id}: `;
      for (const peer of peersOf(id)) {
        const f = file(ownOf(peer));
        assert.ok(!view.toolsMayRead(f), `${who}file tools must not read ${rel(f)}`);
        if (SHELL_FENCED) assert.ok(!view.shellMayRead(f), `${who}the shell must not read ${rel(f)}`);
        assert.ok(!view.toolsMayWrite(f), `${who}file tools must not change ${rel(f)}`);
      }
      // Michael's own files cannot be a static file tool rule (it would hide the
      // folders inside his), so the shell sandbox holds them here and the hook below.
      if (SHELL_FENCED) for (const f of [michaelsFile, unownedFile]) assert.ok(!view.shellMayRead(f), `${who}the shell must not read ${rel(f)}`);
      const own = file(ownOf(id));
      assert.ok(view.toolsMayRead(own) && view.toolsMayWrite(own) && view.shellMayRead(own), `${who}its own folder stays open`);

      // And on every call: the PreToolUse decision, for each way of reaching a folder.
      for (const peer of peersOf(id)) {
        const dir = ownOf(peer);
        for (const [tool, input] of [
          ['Read', { file_path: file(dir) }],
          ['Grep', { pattern: 'x', path: dir }],
          ['Glob', { pattern: path.join(dir, '**', '*.md') }],
          ['Write', { file_path: file(dir), content: 'x' }]
        ]) assert.ok(denied(await o.hook(id, tool, input)), `${who}hook must refuse ${tool} in ${rel(dir)}`);
      }
      for (const f of [michaelsFile, unownedFile]) {
        assert.ok(denied(await o.hook(id, 'Read', { file_path: f })), `${who}hook must refuse a read of ${rel(f)}`);
      }
      assert.ok(!denied(await o.hook(id, 'Read', { file_path: own })), `${who}hook lets it read its own folder`);
      assert.ok(!denied(await o.hook(id, 'Write', { file_path: own, content: 'x' })), `${who}hook lets it write its own folder`);
    }

    // Michael reads every team folder and changes none.
    const god = o.spawned.god;
    for (const id of team) {
      const f = file(ownOf(id));
      assert.ok(god.view.toolsMayRead(f), `michael: file tools read ${rel(f)}`);
      assert.ok(!god.view.toolsMayWrite(f), `michael: file tools must not change ${rel(f)}`);
      assert.ok(!denied(await o.hook('god', 'Read', { file_path: f })), `michael: hook lets him read ${rel(f)}`);
      assert.ok(denied(await o.hook('god', 'Write', { file_path: f, content: 'x' })), `michael: hook must refuse a write to ${rel(f)}`);
    }
    assert.ok(!denied(await o.hook('god', 'Write', { file_path: michaelsFile, content: 'x' })), 'michael: his own folder stays his');
  });

  await t.test('2. a shell command cannot write outside the agent\'s own folder', posixOnly('Claude Code has no shell sandbox on Windows'), () => {
    for (const id of team) {
      const { view } = o.spawned[id];
      const who = `${id}: `;
      assert.ok(view.sandboxOnly, `${who}the sandbox is on and a command cannot rerun outside it`);
      for (const f of [...peersOf(id).map((p) => file(ownOf(p))), michaelsFile, unownedFile, strayFile]) {
        assert.ok(!view.shellMayWrite(f), `${who}the shell must not write ${rel(f)}`);
        assert.ok(!view.toolsMayWriteAllowList(f), `${who}the file tool write list must not cover ${rel(f)}`);
      }
      assert.ok(view.shellMayWrite(file(ownOf(id))), `${who}the shell writes its own folder`);
    }
    // Michael works in the business folder, which holds every team folder, so the
    // sandbox names each one. His shell is not sandbox only today (see the note
    // in folderAccess.ts), so this pins what the app writes for him, not more.
    for (const id of team) {
      const f = file(ownOf(id));
      assert.ok(o.spawned.god.view.sandboxDeniesWrite(f), `michael: the sandbox denies writes to ${rel(f)}`);
    }
  });

  await t.test('3. a connector that was not given is refused at spawn and on every call', async () => {
    for (const id of team) {
      const { inj, settings } = o.spawned[id];
      const given = GRANTS[id];
      const stripped = inj.env.ENABLE_CLAUDEAI_MCP_SERVERS === 'false' && inj.args.includes('--strict-mcp-config');
      const denyList = (settings.permissions && settings.permissions.deny) || [];
      assert.equal(stripped, given.length === 0, `${id}: starts with no connector at all only when it was given none`);
      for (const [key, c] of Object.entries(CONNECTORS)) {
        const allowedByRule = !stripped && !denyList.includes(c.prefix);
        assert.equal(allowedByRule, given.includes(key), `${id}: spawn settings for ${key}`);
        const allowedByHook = !denied(await o.hook(id, c.tool, {}));
        assert.equal(allowedByHook, given.includes(key), `${id}: hook decision for ${key}`);
      }
    }
  });
});
