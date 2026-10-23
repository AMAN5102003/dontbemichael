'use strict';

/**
 * Surfaces this build hides from business owners (src/shared/buildFeatures.ts).
 *
 * Git is hidden from the owner in this build (owner, 2026-09-23): no GIT tab on
 * any agent, and no CHANGES / HISTORY / COMPARE rail in the IDE, which was the
 * only git view Michael had. The code stays; SHOW_GIT brings it all back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('this build hides git', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_GIT, false);
});

test('the agent sidebar drops the GIT and TRACES tabs; saved ones open elsewhere', () => {
  assert.match(read('src/renderer/src/components/SidebarTabs.tsx'), /ALL_TABS\.filter\(\(tab\) => \(tab\.key !== 'git' \|\| SHOW_GIT\) && \(tab\.key !== 'traces' \|\| SHOW_TRACES\)\)/);
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_TRACES, false);
  assert.match(read('src/renderer/src/components/AgentDetailPanel.tsx'), /SHOW_TRACES && sidebarTab === 'traces'/);
  assert.match(read('src/renderer/src/store/store.ts'), /if \(v === 'traces'\) return SHOW_TRACES \? v : 'profile';/);
  assert.match(read('src/renderer/src/components/AgentDetailPanel.tsx'), /SHOW_GIT && sidebarTab === 'git'/);
  assert.match(read('src/renderer/src/store/store.ts'), /if \(v === 'git'\) return SHOW_GIT \? v : 'terminal';/);
});

test('the IDE hides its git rail and stops polling git status', () => {
  const ide = read('src/renderer/src/ide/IdePanel.tsx');
  const open = ide.indexOf('{SHOW_GIT && (<>');
  const close = ide.indexOf('</>)}', open);
  assert.ok(open > 0 && close > open, 'git rail wrapped in SHOW_GIT');
  const rail = ide.slice(open, close);
  for (const piece of ['toggleGitRail', "'changes', 'history', 'compare'", '<HistoryPane', '<ComparePane']) {
    assert.ok(rail.includes(piece), `${piece} is inside the hidden block`);
  }
  assert.match(ide, /const refreshStatus = useCallback\(async \(\) => \{[\s\S]{0,120}if \(!SHOW_GIT\) return;/);
});

/**
 * The IDE is hidden too (owner, 2026-09-23): no IDE button on any agent, and no
 * other path can open it. SHOW_IDE brings it back.
 */
test('this build hides the IDE', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_IDE, false);
});

test('every IDE button is behind SHOW_IDE', () => {
  for (const f of ['CommandCenterPanel.tsx', 'AgentDetailPanel.tsx', 'FullscreenTerminal.tsx']) {
    const src = read(`src/renderer/src/components/${f}`);
    const calls = [...src.matchAll(/setIdeOpen\(true/g)].map((m) => m.index);
    assert.ok(calls.length > 0, `${f} still has its IDE button code`);
    for (const at of calls) {
      const before = src.slice(Math.max(0, at - 400), at);
      assert.ok(before.includes('{SHOW_IDE && ('), `${f}: IDE button at ${at} is not behind SHOW_IDE`);
    }
  }
});

test('nothing else can open the IDE, and terminal file links go to Finder', () => {
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /setIdeOpen: \(open, agentId\) => set\(\{ ideOpen: open && SHOW_IDE,/);
  assert.match(store, /openFileInIde: \(absPath\) => \{\n\s+if \(!SHOW_IDE\) return;/);
  assert.match(read('src/renderer/src/App.tsx'), /\{SHOW_IDE && ideOpen && <IdePanel \/>\}/);
  assert.match(read('src/renderer/src/components/terminalPool.ts'), /if \(action === 'reveal' \|\| !hit\.isFile \|\| !SHOW_IDE\) \{\n\s+void window\.cth\.revealPath/);
});

/**
 * ORGANISATION is hidden (owner, 2026-09-24): configuration only, nothing reads
 * the key yet. WEBHOOKS moved out of Michael's Triggers tab into Settings →
 * Connections: one server and one tunnel serve the whole office, and whatever
 * arrives goes to Michael to route, so they were never his alone.
 */
test('this build hides the organisation trigger', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_ORG_TRIGGER, false);
  const triggers = read('src/renderer/src/components/triggers/TriggersTab.tsx');
  assert.match(triggers, /\{SHOW_ORG_TRIGGER && \(\s*<TriggerCard\s+title=\{t\('triggersTab\.organisation'\)\}/);
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  const gate = settings.indexOf('{SHOW_ORG_TRIGGER && (<>');
  assert.ok(gate > 0 && settings.indexOf("t('settings.connections.organisation')") > gate, 'Settings block is behind the flag');
  // A leftover org key must not bring back the History tab on its own.
  assert.match(read('src/renderer/src/store/store.ts'), /\(SHOW_ORG_TRIGGER && s\.orgTrigger\.apiKey\.trim\(\) !== ''\)/);
});

test('webhooks live in Settings, with nothing lost from the Triggers card', () => {
  const triggers = read('src/renderer/src/components/triggers/TriggersTab.tsx');
  assert.doesNotMatch(triggers, /<WebhooksSection/);
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  // Settings already had name, on/off, URL, secret, mode and delete; the body
  // format editor was the one piece only Triggers had.
  assert.match(settings, /<WebhookSchemaEditor schema=\{w\.schema\} onSave=\{\(schema\) => \{ void patchWebhook\(w\.id, \{ schema \}\); \}\} \/>/);
  for (const piece of ['patchWebhook(w.id, { enabled: !w.enabled })', 'rotateWebhookSecret(w.id)', 'patchWebhook(w.id, { mode:', 'addWebhook']) {
    assert.ok(settings.includes(piece), `Settings still has: ${piece}`);
  }
});

/**
 * Context upkeep has no setting any more (owner, 2026-09-25): compaction is
 * Claude Code's own, and a conversation is cleared only after a finished,
 * handed-off task (safeClearer.ts), never on a clock.
 */
test('no clock-driven context upkeep is left in Settings or the Triggers tab', () => {
  assert.doesNotMatch(read('src/renderer/src/components/triggers/TriggersTab.tsx'), /ContextSection/);
  assert.doesNotMatch(read('src/renderer/src/components/SettingsModal.tsx'), /ContextSection/);
  assert.doesNotMatch(read('src/renderer/src/hooks/useHive.ts'), /onContextTrigger/);
});

/**
 * Anonymous usage stats are hidden until the owner decides whether to collect
 * anything (owner, 2026-09-24): no onboarding row, no Settings switch, and no
 * sending even from a build that carries a PostHog key. COLLECT_USAGE_STATS
 * brings all three back together.
 */
test('this build collects no usage stats', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').COLLECT_USAGE_STATS, false);
});

test('the usage stats choice is hidden in onboarding and Settings', () => {
  const wizard = read('src/renderer/src/components/OnboardingWizard.tsx');
  const row = wizard.indexOf("label={t('onboarding.permissions.shareStats')}");
  assert.ok(row > 0 && wizard.slice(row - 200, row).includes('{COLLECT_USAGE_STATS && ('), 'onboarding row is behind the switch');
  assert.match(wizard, /\.\.\.\(COLLECT_USAGE_STATS \? \{ telemetryEnabled: shareStats \} : \{\}\)/);

  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  const sw = settings.indexOf("{t('settings.general.telemetry')}");
  assert.ok(sw > 0 && settings.slice(sw - 700, sw).includes('{COLLECT_USAGE_STATS && (<>'), 'Settings switch is behind the switch');
});

test('nothing is sent while usage stats are hidden, whatever the saved setting', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /enabled: COLLECT_USAGE_STATS && readConfig\(\)\.telemetryEnabled !== false/);
  assert.match(main, /analytics\.setEnabled\(COLLECT_USAGE_STATS && patch\.telemetryEnabled\)/);
});

/**
 * The header's "auto mode on / off" text is hidden (owner, 2026-09-24). The
 * setting itself still works and stays in Settings → Agents.
 */
test('the header hides the auto mode text', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_AUTO_MODE_LABEL, false);
  // Design v2's top bar (shell/TopBar.tsx) has no auto mode text at all.
  for (const f of ['src/renderer/src/App.tsx', 'src/renderer/src/shell/TopBar.tsx']) {
    assert.doesNotMatch(read(f), /auto mode on/, f);
  }
});

/**
 * The close button on a team member is hidden (owner, 2026-09-24): it stopped
 * the agent mid-task and archived it with no way back in the app. Hidden in
 * both places it lived, the agent panel and the full screen view.
 */
test('the close agent button is hidden everywhere', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_CLOSE_AGENT, false);
  assert.match(read('src/renderer/src/components/AgentDetailPanel.tsx'),
    /\{isReal && SHOW_CLOSE_AGENT && \(\s*<PixelButton variant="destructive" size="md" onClick=\{onKill\}>/);
  assert.match(read('src/renderer/src/components/FullscreenTerminal.tsx'),
    /\{!agent\.isGod && SHOW_CLOSE_AGENT && \(\s*<PixelButton variant="destructive" size="sm" onClick=\{onKill\}>/);
});

/**
 * "Open a Terminal window here" is hidden everywhere (owner, 2026-09-24): the
 * open button next to edit, the same button in full screen, and the terminal
 * icon beside each folder in Michael's Command Center.
 */
test('the open terminal buttons are hidden everywhere', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_OPEN_TERMINAL, false);
  const cases = [
    ['AgentDetailPanel.tsx', "onClick={openTerminal} disabled={openTerminalState === 'opening'}"],
    ['FullscreenTerminal.tsx', "onClick={openTerminal} disabled={openState === 'opening'}"],
    ['CommandCenterPanel.tsx', 'onClick={() => window.cth.openTerminalAt(r)}']
  ];
  for (const [file, marker] of cases) {
    const src = read(`src/renderer/src/components/${file}`);
    const at = src.indexOf(marker);
    assert.ok(at > 0, `${file} still has the button`);
    assert.ok(src.slice(Math.max(0, at - 160), at).includes('{SHOW_OPEN_TERMINAL && ('), `${file}: behind SHOW_OPEN_TERMINAL`);
  }
});

/**
 * The floor-wide Auto / Pause delivery switch is hidden (owner, 2026-09-24).
 * A pause is saved per agent in the config and restored at launch, so while the
 * switch is hidden a saved pause is cleared instead: no one is left with held
 * messages and no switch to release them.
 */
test('the delivery switch is hidden, and a saved pause cannot strand messages', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_DELIVERY_SWITCH, false);
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  const at = cc.indexOf("variant={floorDeliveryPaused ? 'primary' : 'secondary'}");
  assert.ok(at > 0 && cc.slice(at - 120, at).includes('{SHOW_DELIVERY_SWITCH && ('), 'switch behind SHOW_DELIVERY_SWITCH');
  const main = read('src/main/index.ts');
  assert.match(main, /if \(SHOW_DELIVERY_SWITCH\) \{\s*control\.replaceAutoDeliveryPauses\(readConfig\(\)\.autoDeliveryPausedAgents \?\? \[\]\);\s*\} else if \(\(readConfig\(\)\.autoDeliveryPausedAgents \?\? \[\]\)\.length > 0\) \{\s*writeConfig\(\{ autoDeliveryPausedAgents: \[\] \}\);/);
});

/**
 * Hiring by voice is off (owner, 2026-09-24): voice Michael is not given the
 * spawn_agent tool, his instructions say he can't hire, and main refuses a
 * spawn request that arrives anyway.
 */
test('voice Michael cannot hire', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').ALLOW_VOICE_HIRE, false);
  const actions = read('src/renderer/src/realtime/actions.ts');
  const at = actions.indexOf("name: 'spawn_agent'");
  assert.ok(at > 0 && actions.slice(at - 120, at).includes('...(ALLOW_VOICE_HIRE ? ['), 'tool offered only when allowed');
  const session = read('src/renderer/src/realtime/session.ts');
  assert.match(session, /\$\{ALLOW_VOICE_HIRE \? 'hire a new agent, ' : ''\}/);
  assert.match(session, /You cannot hire new team members by voice in this version/);
  assert.match(read('src/main/realtimeActions.ts'), /if \(verb === 'spawn'\) \{[\s\S]{0,200}if \(!ALLOW_VOICE_HIRE\) \{\s*return \{ ok: false, spoken:/);
});

/**
 * Voice is off entirely (owner, 2026-09-24): no Talk toggle, no dictation mic
 * or hold Option, no Voice tab, and main refuses to start a voice session or
 * transcribe audio.
 */
test('voice is off everywhere', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_VOICE, false);
  for (const f of ['FullscreenTerminal.tsx']) {
    const src = read(`src/renderer/src/components/${f}`);
    assert.match(src, /\{SHOW_VOICE && <RealtimeMichaelToggle \/>\}/, `${f}: Talk toggle behind SHOW_VOICE`);
    assert.doesNotMatch(src.replace(/\{SHOW_VOICE && <RealtimeMichaelToggle \/>\}/g, ''), /<RealtimeMichaelToggle \/>/, `${f}: no ungated toggle`);
  }
  assert.match(read('src/renderer/src/store/store.ts'), /setFreeflowEnabled: \(on\) => set\(\{ freeflowEnabled: SHOW_VOICE && on \}\)/);
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(settings, /const VISIBLE_SECTIONS: Section\[\] = NAV_SECTIONS\.filter\(\(s\) => s !== 'Voice' \|\| SHOW_VOICE\);/);
  assert.match(settings, /\{VISIBLE_SECTIONS\.map\(\(section\) => \{/);
  assert.match(settings, /activeSection === 'Voice' && SHOW_VOICE && \(/);
  assert.match(read('src/main/realtime.ts'), /if \(!SHOW_VOICE\) return \{ ok: false, error: 'Voice is off in this version\.', code: 'disabled' \};/);
  assert.match(read('src/main/index.ts'), /ipcMain\.handle\('freeflow:transcribe'[\s\S]{0,200}if \(!SHOW_VOICE\) return \{ ok: false/);
});

test('the pixel office themes are gone with the floor', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_OFFICE_THEME, false);
  assert.doesNotMatch(read('src/renderer/src/components/SettingsModal.tsx'), /OfficeThemePicker/);
  assert.doesNotMatch(read('src/renderer/src/App.tsx'), /setOfficeTheme/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../src/renderer/src/scene/office/themeRegistry.ts')), false);
});

test('there is no automatic updates switch: every installed build checks (owner, 2026-10-02)', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_AUTO_UPDATE_SWITCH, undefined, 'the flag is gone with the switch');
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  assert.doesNotMatch(settings, /autoUpdate/);
});

test('this build hides Slack, and a Slack connection saved earlier does not start', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_SLACK, false);
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  const open = settings.indexOf('{SHOW_SLACK && (<>');
  const close = settings.indexOf('</>)}', open);
  assert.ok(open > 0 && close > open, 'Slack block wrapped in SHOW_SLACK');
  const block = settings.slice(open, close);
  for (const piece of ["t('settings.connections.slack')", 'startSlack', 'SLACK_CONNECT_STEPS', "t('settings.connections.slackHint')"]) {
    assert.ok(block.includes(piece), `${piece} is inside the hidden block`);
  }
  assert.match(read('src/main/index.ts'), /async function startSlackServer\(\)[\s\S]{0,200}?\n  if \(!SHOW_SLACK\) return \{ ok: false/);
});

test('this build hides the safe and read only server list; the switches that need a yes stay', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_READONLY_SERVERS, false);
  const src = read('src/renderer/src/components/McpDefaultsSettings.tsx');
  assert.match(src, /const TIER_ORDER: McpTier\[\] = \(\['safe-readonly', 'write', 'secret'\] as McpTier\[\]\)\s*\.filter\(\(tier\) => tier !== 'safe-readonly' \|\| SHOW_READONLY_SERVERS\);/);
});

test('this build hides the whole Default MCP servers section: none of its servers load (owner, 2026-10-01)', () => {
  // Claude Code ignores mcpServers in the --settings file each agent starts
  // with (probe on 2.1.287), so every switch here did nothing.
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_MCP_DEFAULTS, false);
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(settings, /\{SHOW_MCP_DEFAULTS && activeSection === 'Connections' && \(\s*<>\s*<McpDefaultsSettings config=\{config\} \/>/);
  assert.equal((settings.match(/<McpDefaultsSettings /g) || []).length, 1, 'shown nowhere else');
});

test('Add Agent hides import hire and its AI prompt; the button says hire (owner, 2026-09-27)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/components/AddAgentModal.tsx'), 'utf8');
  assert.match(fs.readFileSync(path.resolve(__dirname, '..', 'src/shared/buildFeatures.ts'), 'utf8'), /export const SHOW_IMPORT_HIRE = false;/);
  assert.match(src, /\{SHOW_IMPORT_HIRE && <div style=\{\{/, 'the explainer and generate with AI are gated');
  assert.match(src, /\{SHOW_IMPORT_HIRE && \(\s*<PixelButton[\s\S]*?onClick=\{importHire\}/, 'the import hire button is gated');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', `src/renderer/src/i18n/locales/${loc}.json`), 'utf8'));
    assert.doesNotMatch(d.addAgent.spawn, /spawn|生成|إنشاء/i, `${loc}: the button hires`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/i18n/locales/en.json'), 'utf8')).addAgent.spawn, 'Hire');
});

test('Add Agent groups the characters by their job in the show (owner, 2026-09-27)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/components/AddAgentModal.tsx'), 'utf8');
  assert.match(src, /CAST_GROUPS\.map\(\(g\) =>/);
  assert.match(src, /tr\(`addAgent\.castGroup\.\$\{g\.key\}`\)/);
  const { OFFICE_CAST, CAST_GROUPS } = loadTs('src/renderer/src/scene/office/cast.ts');
  const grouped = CAST_GROUPS.flatMap((g) => g.members);
  // Pete is the Research member's own face and no hire's (owner, third ship D4).
  assert.deepEqual([...grouped].sort(), OFFICE_CAST.map((c) => c.name).filter((n) => n !== 'pete').sort(), 'every hireable character is in exactly one group');
  assert.equal(new Set(grouped).size, grouped.length);
  assert.deepEqual(CAST_GROUPS[0], { key: 'office', members: ['michael', 'pam', 'erin'] });
  assert.deepEqual(CAST_GROUPS[1].members.slice(0, 2), ['dwight', 'jim']);
  assert.ok(CAST_GROUPS.every((g) => g.members.length >= 2), 'no group is a lone tile');
  assert.match(src, /flexWrap: 'wrap', columnGap: 20/, 'groups sit side by side and wrap');
  assert.match(src, /tr\(`addAgent\.castRole\.\$\{c\.name\}`\)/, 'each tile names its job');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', `src/renderer/src/i18n/locales/${loc}.json`), 'utf8'));
    for (const g of CAST_GROUPS) assert.ok(d.addAgent.castGroup?.[g.key], `${loc}: ${g.key} has a heading`);
    for (const n of grouped) assert.ok(d.addAgent.castRole?.[n], `${loc}: ${n} names its own job`);
  }
});

test('the hire wizard has no worktree, resume, projects or engine choices (owner, 2026-09-27)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/components/AddAgentModal.tsx'), 'utf8');
  const flags = fs.readFileSync(path.resolve(__dirname, '..', 'src/shared/buildFeatures.ts'), 'utf8');
  assert.match(src, /isolate: false,/, 'never a worktree');
  assert.doesNotMatch(src, /resumeSessionId|registerProject|gitIsolation/, 'no resume or project list');
  assert.match(flags, /export const SHOW_ENGINE_PICKER = false;/);
  assert.match(src, /\{SHOW_ENGINE_PICKER && <>[\s\S]*?addAgent\.provider[\s\S]*?addAgent\.command[\s\S]*?<\/>\}/, 'engine and command are gated');
  assert.match(src, /const model = customModel \?\? defaultModel;/, 'the model starts on the Settings default');
});

test('focus mode is hidden: no button opens it and a saved preference cannot reopen it (owner, 2026-10-01)', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_FOCUS_MODE, false);
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /if \(id && !SHOW_FOCUS_MODE\) return;/, 'setFullscreen opens nothing');
  assert.match(store, /fullscreenAgentId: SHOW_FOCUS_MODE \? focusOnLoad\(initialPrefersFocusMode, initialSelectedId\) : null,/, 'never at launch');
  assert.match(store, /if \(!SHOW_FOCUS_MODE\) return s;/, 'restoreFocusMode does nothing');
  assert.match(read('src/renderer/src/shell/TopBar.tsx'), /\{SHOW_FOCUS_MODE && \(\n\s+<IconButton label=\{fullscreenAgentId \? t\('shell\.exitFocus'\)/);
  assert.match(read('src/renderer/src/components/AgentDetailPanel.tsx'), /onToggleFullscreen=\{SHOW_FOCUS_MODE \? /);
  assert.match(read('src/renderer/src/components/CommandCenterPanel.tsx'), /onToggleFullscreen=\{SHOW_FOCUS_MODE \|\| fullscreen \? /);
});

test('Settings, General: one About card carries the version once and the update status (owner, 2026-10-01)', () => {
  // docs/designs/about-updates-card.md: the hero card and the Updates block
  // said the version twice and offered release notes three ways.
  const modal = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(modal, /<SettingsHeroCard \/>/);
  assert.doesNotMatch(modal, /<UpdatesSection \/>/, 'no separate Updates block');
  const card = read('src/renderer/src/components/SettingsHeroCard.tsx');
  assert.equal((card.match(/v\{__APP_VERSION__\}/g) || []).length, 1, 'the version once');
  assert.match(card, /const u = useUpdates\(\);/);
  assert.match(card, /<UpdateStatusLine u=\{u\} \/>[\s\S]*<UpdateButtons u=\{u\} \/>[\s\S]*<UpdateDetails u=\{u\} \/>/);
  assert.doesNotMatch(card, /download v\{pending\}|border: `2px solid/, 'no second download, no v1 ink frame');
  assert.match(card, /<InfoTip label=\{hero\.plan\.label\} text=\{hero\.plan\.blurb\} \/>/, 'the plan blurb sits behind an info icon');
  assert.doesNotMatch(card, /⭐/);
  const upd = read('src/renderer/src/components/UpdatesSection.tsx');
  assert.match(upd, /const quiet = !status \|\| status\.state === 'idle' \|\| status\.state === 'checking' \|\| status\.state === 'not-available' \|\| status\.state === 'just-updated';/, 'quiet states do not repeat the version');
  assert.match(upd, /notes: quiet \? \[\] : notes/, 'notes only for a newer version');
  // In Settings' scrolling flex column a card with overflow hidden shrank to
  // 1px (owner, 2026-10-01: "I no longer see the entire merged section").
  assert.match(card, /<div style=\{\{ flexShrink: 0, background: panelStyle\.background, borderRadius: panelStyle\.borderRadius \}\}>/, 'on the soft panel (app-style-rollout.md AS2)');
  assert.doesNotMatch(card, /overflow: 'hidden'/);
});

test("What's new opens a popover under its link with the notes of this version (owner, 2026-10-02)", () => {
  // It opened GitHub behind the app, then a corner toast that was easy to miss
  // on a mostly white app; the answer to a click sits where you clicked.
  const card = read('src/renderer/src/components/SettingsHeroCard.tsx');
  assert.match(card, /<button type="button" ref=\{whatsNewRef\} style=\{footLink\} onClick=\{toggleNotes\} aria-expanded=\{notesOpen\} aria-haspopup="dialog">/);
  assert.match(card, /\{notesOpen && <WhatsNewPopover notes=\{whatsNew\.notes\} loading=\{whatsNew\.loading\} anchor=\{whatsNewRef\} onClose=\{\(\) => setNotesOpen\(false\)\} \/>\}/);
  assert.match(card, /<div style=\{\{ position: 'relative', display: 'flex'/, 'the footer anchors the popover');
  assert.doesNotMatch(card, /fullChangelog|cth:show-release-notes/);
  const pop = read('src/renderer/src/components/WhatsNewPopover.tsx');
  assert.match(pop, /if \(cur\.state === 'just-updated' && cur\.notes\) \{ setNotes/);
  assert.match(pop, /const r = await window\.cth\.updateReleaseNotes\(\);/);
  assert.match(pop, /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); close\(\); \} \}\}/, 'Esc closes the popover, not Settings');
  assert.match(pop, /document\.addEventListener\('mousedown', onDown\)/, 'a click outside closes it');
  assert.match(pop, /t\('whatsNewPopover\.failed'\)/, 'a failure says so');
  assert.match(pop, /onClick=\{\(\) => void window\.cth\.openExternal\(changelog\)\}>\{t\('whatsNewPopover\.fullChangelog'\)\}<\/button>/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const w = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).whatsNewPopover;
    for (const k of ['title', 'titleVersion', 'loading', 'failed', 'fullChangelog', 'releasePage', 'close']) assert.ok(w[k], `${loc} whatsNewPopover.${k}`);
  }
  // Ink fill like the info tooltips: white on a white card was hard to read.
  assert.match(pop, /background: 'var\(--cth-ink\)', color: ON,/);
  // The corner toast is for updates that arrive on their own again.
  assert.doesNotMatch(read('src/renderer/src/components/UpdateToast.tsx'), /cth:show-release-notes|WhatsNewCard/);
  // Main answers for the running version from its GitHub release, in dev too.
  const upd = read('src/main/updater.ts');
  const reg = upd.indexOf("ipcMain.handle('update:releaseNotes'");
  assert.ok(reg > 0 && reg < upd.indexOf('if (!app.isPackaged) return;'), 'registered before the packaged-only block');
});

test('Settings, General hides Explain things simply and Arabic / RTL text in terminals (owner, 2026-10-02)', () => {
  const flags = loadTs('src/shared/buildFeatures.ts');
  assert.equal(flags.SHOW_SIMPLE_MODE_SWITCH, false);
  assert.equal(flags.SHOW_ARABIC_TERMINAL_SWITCH, false);
  const modal = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(modal, /\{SHOW_SIMPLE_MODE_SWITCH && \(\s*<div[^>]*>\s*<div[^>]*>\s*<span[^>]*>\{t\('settings\.general\.simpleMode'\)\}/);
  assert.match(modal, /\{SHOW_ARABIC_TERMINAL_SWITCH && \(\s*<div[^>]*>\s*<div[^>]*>\s*<span[^>]*>\s*\{t\('settings\.general\.arabicTerminal'\)\}/);
  // The settings still work while hidden: Arabic shaping follows the language.
  assert.match(read('src/renderer/src/terminal/arabicSetting.ts'), /return override \?\? languageDefault\(\);/);
});

test('Settings, General hides the Language section (owner, 2026-10-02)', () => {
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_LANGUAGE_PICKER, false);
  const modal = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(modal, /\{SHOW_LANGUAGE_PICKER && \(<>\s*\{\/\* Language — app UI language \(i18n\) \*\/\}/);
  // The saved choice, else English: never the OS locale.
  assert.match(read('src/renderer/src/i18n/index.ts'), /return 'en';\s*\}/);
});

test('the Danger zone is a loud red card with a filled reset button (owner, 2026-10-02)', () => {
  // It was a 10px label, grey prose and a white button: easy to miss for the
  // one action that wipes the office.
  const modal = read('src/renderer/src/components/SettingsModal.tsx');
  const zone = modal.slice(modal.indexOf('{/* Danger zone: loud on purpose'), modal.indexOf('{/* Footer */}'));
  assert.match(zone, /<div role="group" aria-labelledby="settings-danger-zone" style=\{\{[^}]*background: 'var\(--cth-coral-soft\)'/);
  assert.match(zone, /<svg width="22"[^>]*aria-hidden="true"/, 'a warning mark');
  assert.match(zone, /background: 'var\(--cth-coral-strong\)', color: 'var\(--cth-on-coral\)'/, 'a filled red button, readable in dark mode too');
  assert.match(zone, /onClick=\{\(\) => setConfirming\(true\)\}/, 'reset still asks first');
  assert.match(read('branding/DESIGN.md'), /Reset & start over inside the Danger zone card/);
});

test('the update line only promises automatic checks when they run (owner, 2026-10-02)', () => {
  // updater.ts checks every 6h in every installed build (the old autoUpdate
  // flag is ignored); a dev build never checks.
  const upd = read('src/main/updater.ts');
  assert.match(upd, /const CHECK_INTERVAL_MS = 6 \* 60 \* 60 \* 1000;/, 'the 6 hours the line names');
  assert.match(upd, /const tick = \(\): void => \{ void runCheck\(\); \};/, 'always check (owner, 2026-10-02)');
  assert.doesNotMatch(upd, /autoUpdateEnabled|readConfig\(\)\.autoUpdate/);
  assert.doesNotMatch(read('src/main/realtimeActions.ts'), /^\s*autoUpdate: \{/m, 'voice cannot set a setting that does nothing');
  assert.match(read('src/main/index.ts'), /return \{ version: app\.getVersion\(\), changelog: top, packaged: app\.isPackaged \};/);
  const ui = read('src/renderer/src/components/UpdatesSection.tsx');
  assert.match(ui, /if \(packaged === false\) return \{ headline: t\('updatesSection\.onVersion', \{ v \}\), detail: t\('updatesSection\.devDetail'\), button: null \};/);
  assert.match(ui, /detail: t\('updatesSection\.idleDetail'\),/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const u = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).updatesSection;
    assert.ok(u.devDetail, loc);
  }
});
