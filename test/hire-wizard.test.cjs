'use strict';

/**
 * The hire wizard's contract (docs/designs/hire-redesign.md): three steps, the
 * job check before Hire, bindings that hand work back, the source card, and the
 * new hire opening on Capabilities.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const modal = read('src/renderer/src/components/AddAgentModal.tsx');

test('four steps, Who, Job, Role then Setup; a queued hire opens on Role', () => {
  assert.match(modal, /const STEPS: Step\[\] = \['who', 'job', 'role', 'setup'\];/);
  assert.match(modal, /useState<Step>\(pendingHire \? 'role' : 'who'\)/);
  assert.doesNotMatch(modal, /DESCRIPTION_TEMPLATES/, 'the developer templates are gone');
});

test('the job list offers the character\'s own job, the office\'s jobs, a new job and every pack\'s', () => {
  assert.match(modal, /ownJob\(character, officeJobs, cards\)/);
  assert.match(modal, /teamJobs\(team, cards\)/);
  assert.match(modal, /officeJobs\.filter\(\(j\) => j\.key !== theirJob\?\.key && \(listAll \|\| sameFamily\(j, character\)\)\)/, 'office jobs open on the character\'s family');
  assert.match(modal, /useEffect\(\(\) => \{ setShowAll\(false\); \}, \[character\]\);/, 'a new character closes the list again');
  assert.match(modal, /tr\('addAgent\.wizard\.showAll', \{ count: hiddenCount \}\)/);
  assert.match(modal, /\{familyJobs\.map\(\(j\) => \(/);
  assert.match(modal, /cardJobs\(res\.packs\.map\(\(p\) => p\.pack\), res\.core, config\.businessType, business\)/);
  assert.match(modal, /const copy = jobFor\(chosenJob, name\.trim\(\)\);/, 'the name is swapped in');
});

test('Setup opens only for a verified role: distinct, or bound; Hire checks again', () => {
  const gate = modal.slice(modal.indexOf('const roleReady = async'), modal.indexOf('const goTo = async'));
  assert.match(gate, /if \(!v\) v = await runCheck\(\);/);
  assert.match(gate, /if \(overlaps\.length > 0 && !binding\) \{ setError\(tr\('addAgent\.wizard\.errOverlap'\)\); return false; \}/);
  assert.match(modal, /if \(!\(await roleReady\(\)\)\) \{ setStep\('role'\); return; \}/);
  const start = modal.indexOf('const submit = async');
  const flow = modal.slice(start, modal.indexOf('\n  return (', start));
  assert.ok(flow.indexOf('roleReady()') < flow.indexOf('spawnPty'), 'checked before spawning');
  assert.match(modal, /const checkSig = `\$\{profile\.name\}\\n\$\{profile\.routing\}`;/, 'a title edit does not reset the check');
  assert.match(modal, /const overlapNames = \[\.\.\.new Set\(\[\.\.\.\(verdict\?\.overlapsWith \?\? \[\]\), \.\.\.ruleOverlaps\]\)\];/, 'the rules always count, live');
  assert.match(modal, /disabled=\{\(step === 'who' && !!whoError\) \|\| \(step === 'role' && \(checking \|\| \(overlapNames\.length > 0 && !binding\)\)\)\}/);
});

test('Finalize explains the work style, the folder and the model behind info icons', () => {
  const setup = modal.slice(modal.indexOf("{step === 'setup' && ("));
  for (const k of ['workStyleIntro', 'folderPurpose', 'modelPurpose']) assert.match(setup, new RegExp(`info=\\{tr\\('addAgent\\.wizard\\.${k}'`), k);
  assert.match(modal, /\{info && <InfoTip text=\{info\} label=\{label\} \/>\}/);
  assert.match(modal, /info=\{tr\('addAgent\.roleHelp'/, 'the role screen too');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const w = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent.wizard;
    assert.equal(w.step.setup, { en: 'Finalize', 'zh-CN': '完成', ar: 'إنهاء' }[loc]);
  }
  const role = modal.slice(modal.indexOf("{step === 'role' && ("), modal.indexOf("{step === 'setup' && ("));
  assert.match(role, /<DistinctBox/);
  assert.doesNotMatch(role, /addAgent\.workStyle'/, 'work style is not on the role screen');
});

test('a binding updates the overlapping teammates\' lines and a mailbox binding is set before the spawn', () => {
  const start = modal.indexOf('const submit = async');
  const flow = modal.slice(start, modal.indexOf('\n  return (', start));
  assert.ok(flow.indexOf('mailSetCapabilities(id, { email: { enabled: true') < flow.indexOf('spawnPty'));
  assert.match(flow, /void window\.cth\.hivePatchAgentRole\(mate\.id, next\)/);
  assert.match(flow, /appendOnce\(split\.roleDescription, others\)/);
  assert.match(modal, /maxLength=\{TOPIC_MAX\}/);
  assert.match(modal, /const TOPIC_MAX = 120;/);
});

test('the hire saves its source card and opens on Capabilities', () => {
  assert.match(modal, /\n      sourceCard,\n/);
  assert.match(modal, /setSidebarTab\('capabilities'\);/);
  assert.match(read('src/renderer/src/components/ProfileTab.tsx'), /o\.cards\.get\(agent\.id\) \?\? \(agent\.sourceCard \? o\.allCards\.get\(agent\.sourceCard\) : undefined\)/);
});

test('main checks with Haiku and no tools, and falls back to the rules', () => {
  const main = read('src/main/hireCheck.ts');
  assert.match(main, /const CHECK_MODEL = 'claude-haiku-4-5';/);
  assert.match(main, /noTools: true,/);
  const { rulesVerdict, readJobProfile } = loadTs('src/main/hireCheck.ts');
  assert.equal(readJobProfile({ name: '' }), null);
  assert.equal(readJobProfile({ name: 'Erin', title: 5 }).title, '');
  const v = rulesVerdict({ name: 'Erin', title: 'Admin', routing: 'Erin sorts the business inbox and supplier mail.' }, [{ name: 'Pam', title: 'Receptionist', routing: 'Pam sorts the business inbox and supplier mail.' }]);
  assert.deepEqual(v, { distinct: false, overlapsWith: ['Pam'], why: '', source: 'rules' });
  assert.match(main, /overlapsWith = \[\.\.\.new Set\(\[\.\.\.verdict\.overlapsWith, \.\.\.overlapsByRules\(job, team\)\]\)\]/, 'the AI cannot clear what the rules flag');
});

test('every wizard string exists in all three languages, without dashes', () => {
  const keys = [...new Set([...modal.matchAll(/'addAgent\.wizard\.([a-zA-Z.]+)'/g)].map((m) => m[1]))];
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const w = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent.wizard;
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => o?.[p], w);
      assert.equal(typeof v, 'string', `${loc}: wizard.${k}`);
      assert.doesNotMatch(v, /[–—]| - /, `${loc}: wizard.${k} has a dash`);
    }
    for (const s of ['who', 'job', 'role', 'setup']) assert.ok(w.step[s] && w.stepHint[s], `${loc}: step ${s}`);
  }
});

test('the model list starts on the default for agents from Settings, marked default', () => {
  assert.match(modal, /const defaultModel = isClaudeProvider\(provider\) \? config\.defaultModel : config\.providerDefaultModels\?\.\[provider\];/);
  assert.match(modal, /m\.id === defaultModel \? tr\('addAgent\.wizard\.modelDefault', \{ model: m\.label \}\) : m\.label/);
  assert.doesNotMatch(modal, /'best' \| 'fast'/, 'no Best or Fast');
});

test('work style is required, when hiring and when editing (owner, 2026-09-27)', () => {
  assert.match(modal, /if \(!workStyle\.trim\(\)\) \{ setError\(tr\('addAgent\.wizard\.errWorkStyle'\)\); return; \}/);
  const edit = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.match(edit, /if \(!agent\.isGod && !agent\.isAssistant && !goal\.trim\(\)\) \{ setGoalError\(true\); return; \}/);
  assert.doesNotMatch(edit, /Work style \(optional\)/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const a = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent;
    assert.doesNotMatch(a.workStyle, /optional|可选|اختياري/, loc);
  }
});

test('the other businesses\' list leaves out this business\'s own card for the job (owner, 2026-09-27)', () => {
  assert.match(modal, /const ownBusinessCard = \(j: HireJob\) => !!config\.businessType && j\.sourceCard\?\.startsWith\(`\$\{config\.businessType\}\/`\) && inFamily\(j\) && !!family;/);
  assert.match(modal, /cards\.filter\(\(j\) => \(listAll \|\| inFamily\(j\)\) && !ownBusinessCard\(j\)\)/);
});

test('the role screen asks what the new hire handles, not what to send (owner, 2026-09-27)', () => {
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const a = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent;
    assert.doesNotMatch(JSON.stringify(a), /what to send|What to send/, `${loc}: no "what to send" left`);
  }
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json')).addAgent;
  assert.equal(en.wizard.whatToSend, 'What {{name}} handles');
  assert.match(modal, /tr\('addAgent\.roleHelp', \{ godName, name: name\.trim\(\) \}\)/);
});

test('a bound job says the overlap is resolved instead of repeating it (owner, 2026-09-27)', () => {
  assert.match(modal, /p\.binding\s*\? t\('addAgent\.wizard\.resolved', \{ name: p\.name, names: p\.overlapNames\.join\(listJoin\) \}\)\s*: t\('addAgent\.wizard\.overlaps'/);
  assert.match(modal, /\{!p\.binding && <span>\{p\.verdict\?\.why/);
});

test('the job check shows each teammate taking a turn while it runs (owner, 2026-09-27)', () => {
  assert.match(modal, /if \(p\.checking\) return <CheckingTeam team=\{p\.team\} \/>;/);
  const anim = modal.slice(modal.indexOf('function CheckingTeam'), modal.indexOf('interface DistinctBoxProps'));
  assert.match(anim, /setInterval\(\(\) => setTurn\(\(n\) => n \+ 1\), 900\)/);
  assert.match(anim, /prefers-reduced-motion: reduce/, 'still for reduced motion');
  assert.match(anim, /t\('addAgent\.wizard\.comparingWith', \{ name: current\.name \}\)/);
  assert.match(read('src/renderer/src/design/global.css'), /@keyframes cth-hop/);
});

test('going back drops a job check still running, and a title alone is not checked', () => {
  // Value: protects=Review never shows "checking the team" for a job that is not on the form; fails_when=a check started on Creed's default job keeps running after Back and Write new job, or the auto check runs with no role description; why_new=owner 2026-10-03: the animation kept running with nothing filled out; seam=source pin
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(modal, /if \(step === 'role' && profile\.name && profile\.routing && !verdict && !checking\) void runCheck\(\);/, 'only a role description is checked');
  assert.match(modal, /if \(step === 'who' \|\| step === 'job'\) \{\n\s+checkSeq\.current\+\+; stopCheckRun\(\); setChecking\(false\); prefetchSig\.current = '';/, 'leaving Review cancels the check');
  // A cancelled check's late answer is ignored, so it cannot bring "checking" back.
  assert.match(modal, /if \(seq !== checkSeq\.current\) return null;/);
  assert.match(modal, /if \(seq === checkSeq\.current\) setChecking\(false\);/);
});

test('Next asks for what the new hire handles before any check', () => {
  // Value: protects=an empty "what they handle" never starts the job check; fails_when=a title alone (a new job keeps the character's role) passes the gate and checks nothing; why_new=owner 2026-10-03; seam=source pin
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  const gate = modal.slice(modal.indexOf('const roleReady = async'), modal.indexOf('const goTo = async'));
  assert.match(gate, /if \(!routing\.trim\(\)\) \{ setError\(tr\('addAgent\.wizard\.errJob', \{ name: name\.trim\(\), godName \}\)\); return false; \}/);
  assert.ok(gate.indexOf('!routing.trim()') < gate.indexOf('runCheck()'), 'asked before the check');
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const msg = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent.wizard.errJob;
    assert.match(msg, /\{\{name\}\}/, loc);
    assert.match(msg, /\{\{godName\}\}/, loc);
  }
});

test('the job check starts on the job step, and Review reuses it', () => {
  // Value: protects=the owner does not wait for the check on Review when the picked job's check could already run; fails_when=the job step stops starting it, it checks different text than Review shows, Review starts a second one while it runs, or a return to the job step leaves it dropped; why_new=owner 2026-10-03; seam=source pin
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  const pre = modal.slice(modal.indexOf('const prefetchSig = useRef'), modal.indexOf('The instant rules always count'));
  assert.match(pre, /if \(step !== 'job' \|\| !chosenJob \|\| !name\.trim\(\)\) return;/);
  assert.match(pre, /const copy = jobFor\(chosenJob, name\.trim\(\)\);/, 'the same text Review applies');
  assert.match(pre, /const sig = `\$\{job\.name\}\\n\$\{job\.routing\}`;/);
  assert.match(modal, /const checkSig = `\$\{profile\.name\}\\n\$\{profile\.routing\}`;/, 'Review keys its verdict the same way');
  assert.match(pre, /if \(check\?\.sig === sig \|\| prefetchSig\.current === sig\) return;/, 'one check per job');
  assert.match(pre, /window\.setTimeout\(\(\) => \{ prefetchSig\.current = sig; void runCheck\(job, sig\); \}, 400\)/);
  assert.match(pre, /if \(step === 'who' \|\| step === 'job'\) \{\n\s+checkSeq\.current\+\+; stopCheckRun\(\); setChecking\(false\); prefetchSig\.current = '';/, 'a dropped check starts again');
  // Review does not start its own while the early one runs.
  assert.match(modal, /if \(step === 'role' && profile\.name && profile\.routing && !verdict && !checking\) void runCheck\(\);/);
  assert.match(modal, /const runCheck = async \(job: JobProfile = profile, sig = checkSig\)/);
});

test('a hire can be bound to one connection, and starts with only that connector', () => {
  // Value: protects=binding Creed to HubSpot makes him the CRM data analyst: Michael routes HubSpot data work to him and he holds HubSpot and nothing else; fails_when=the option is missing, the grant comes after the spawn, a failed grant still hires, or a failed spawn keeps the grant; why_new=owner 2026-10-03; seam=source pin
  const H = loadTs('src/shared/hireTemplates.ts');
  assert.deepEqual(H.bindingLines('the data in HubSpot', 'Creed'), { own: 'Only the data in HubSpot.', others: 'Not for the data in HubSpot; that goes to Creed.' });
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(modal, /const bindConnectors = \(config\.claudeConnectors\?\.list \?\? \[\]\)\s*\.map\(\(c\) => \(\{ key: c\.key, on: connectorOn\(config, c\.key\), signIn: c\.status === 'needs-sign-in' \}\)\)/, 'every connector on the account is listed');
  assert.match(modal, /setConnectionScope\(key \? tr\('addAgent\.wizard\.connectionScope', \{ name: key \}\) : ''\);/, 'the scope starts as "the data in <connector>", editable');
  assert.match(modal, /onBindConnection=\{\(\) => \{ if \(bindConnector && bindConnectors\.some\(\(c\) => c\.key === bindConnector && c\.on\)\) applyBinding\(connectionScope, undefined, bindConnector\); \}\}/);
  const submit = modal.slice(modal.indexOf('const id = hireAgentId(name);'), modal.indexOf('const spawnRes = await window.cth.spawnPty'));
  assert.match(submit, /if \(binding\?\.connectorKey\) \{\s*const res = await \(isQuickBooksKey\(binding\.connectorKey\)[\s\S]*?: window\.cth\.connectorsSetGrant\(id, binding\.connectorKey, true\)\)/, 'granted before the spawn');
  assert.match(submit, /if \(!res\?\.ok\) \{[\s\S]*?setError\(tr\('capabilities\.saveFailed'\)\); return;/, 'a failed grant stops the hire');
  assert.match(submit, /: window\.cth\.connectorsSetGrant\(id, binding\.connectorKey, false\)\)\.catch/, 'a failed spawn takes it back');
  assert.match(modal, /disabled=\{p\.bindConnectors\.length === 0\} title=\{p\.bindConnectors\.length === 0 \? t\('addAgent\.wizard\.noConnection'\) : undefined\}/);
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const w = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent.wizard;
    for (const k of ['bindConnection', 'pickConnection', 'connectionScope', 'connectionScopeLabel', 'noConnection', 'boundConnection', 'boundConnectionReadOnly', 'connectionOff', 'connectionSignIn']) assert.ok(w[k], `${loc} ${k}`);
    assert.doesNotMatch(JSON.stringify(w), /[–—]/, loc);
  }
  assert.equal(JSON.parse(read('src/renderer/src/i18n/locales/en.json')).addAgent.wizard.connectionScope, 'the data in {{name}}');
});

test('when a bound hire leaves, their bound work goes back to the teammates', () => {
  // Value: protects=Michael never routes to someone who left: teammates lose their "Not for ...; that goes to <Name>." lines; fails_when=a leaving hire's lines stay, another person's or a pack's lines are touched, a crash or quit strips them, or the forget button skips it; why_new=owner 2026-10-03; seam=source pin for the call sites
  const H = loadTs('src/shared/hireTemplates.ts');
  const { own, others } = H.bindingLines('the data in HubSpot', 'Creed');
  assert.equal(own, 'Only the data in HubSpot.');
  const team = [
    { id: 'oscar', description: `Finance: Books. Not for deals; that goes to Sales Director. ${others}` },
    { id: 'dwight', description: `Sales Director: Deals. ${others} Not for the shop; that goes to Pam.` },
    { id: 'kelly', description: 'Support: Not for refunds; that goes to Creedence.' },
    { id: 'nick', description: 'IT Engineer: Fixes.' }
  ];
  assert.deepEqual(H.releaseBindings('Creed', team), [
    { id: 'oscar', description: 'Finance: Books. Not for deals; that goes to Sales Director.' },
    { id: 'dwight', description: 'Sales Director: Deals. Not for the shop; that goes to Pam.' }
  ]);
  assert.deepEqual(H.releaseBindings('', team), []);
  const shell = read('src/renderer/src/shell/releaseBindings.ts');
  assert.match(shell, /s\.rewriteInstructions\(patches\);/, 'roster, archived and restorable teammates alike');
  assert.match(shell, /window\.cth\.hivePatchAgentRole\(p\.id, p\.description\)/, 'and the registry Michael routes by');
  for (const f of ['AgentDetailPanel', 'FullscreenTerminal']) {
    const src = read(`src/renderer/src/components/${f}.tsx`);
    assert.match(src, /await window\.cth\.closeAgentByOwner\(agent\.id\)\.catch\(\(\) => undefined\);\s*\/\/[^\n]*\n\s*await releaseBindingsOf\(agent\.id\);/, `${f}: closing on purpose releases`);
  }
  assert.match(read('src/renderer/src/components/CommandCenterPanel.tsx'), /onClick=\{\(\) => \{ void releaseBindingsOf\(a\.id\)\.finally\(\(\) => removeArchivedAgent\(a\.id\)\); \}\}/, 'forgetting releases');
  // A crash or a quit only archives: the hive's archive event does not release.
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /if \(e\?\.id\) useStore\.getState\(\)\.archiveAgent\(e\.id\);/);
  assert.doesNotMatch(hive, /releaseBindingsOf/);
});

test('every connector is offered for a binding: switched off ones greyed, QuickBooks read only', () => {
  // Value: protects=the wizard never decides which connectors a hire may be bound to; fails_when=a switched on connector (QuickBooks) is left out, a switched off one is hidden instead of greyed, it can be bound while off, or QuickBooks is granted more than read only; why_new=owner 2026-10-03: "nothing should be hidden"; seam=source pin
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.doesNotMatch(modal.slice(modal.indexOf('const bindConnectors ='), modal.indexOf('const [bindConnector,')), /filter/, 'nothing filtered out');
  assert.match(modal, /<option key=\{c\.key\} value=\{c\.key\} disabled=\{!c\.on\}>/, 'switched off: shown, not bindable');
  assert.match(modal, /bindConnectors\.some\(\(c\) => c\.key === bindConnector && c\.on\)/, 'only a switched on one binds');
  // A hire saves for its new id before the spawn, so it says it is hiring (issue 132).
  assert.match(modal, /isQuickBooksKey\(binding\.connectorKey\)\s*\? window\.cth\.quickbooksSetAccess\(id, \{ enabled: true, changes: false \}, \{ hiring: true \}\)/, 'QuickBooks bound read only');
  assert.match(modal, /window\.cth\.quickbooksSetAccess\(id, \{ enabled: false, changes: false \}, \{ hiring: true \}\)/, 'and taken back if the spawn fails');
});

test('binding clears an earlier overlap message, and the message names every way to bind', () => {
  // Value: protects=after binding, no red "overlaps a teammate" stays on screen; fails_when=applyBinding or editing what they handle leaves the earlier error, or the message omits connections; why_new=owner 2026-10-03: bound to a connection and still saw the error; seam=source pin
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  const apply = modal.slice(modal.indexOf('const applyBinding ='), modal.indexOf('const clearBinding ='));
  assert.match(apply, /setError\(undefined\);/);
  assert.match(modal, /onChange=\{\(e\) => \{ setRouting\(e\.target\.value\); setError\(undefined\); \}\}/);
  assert.match(JSON.parse(read('src/renderer/src/i18n/locales/en.json')).addAgent.wizard.errOverlap, /a mailbox, a topic or a connection/);
});

test('a binding sentence never runs into the owner\'s text', () => {
  // Value: protects=the role line Michael reads stays readable after binding; fails_when=a line without a full stop gets "issues Only the data in HubSpot."; why_new=owner screenshot 2026-10-03; seam=none
  const H = loadTs('src/shared/hireTemplates.ts');
  assert.equal(H.appendOnce('Check for duplicate data and other typical data issues', 'Only the data in HubSpot.'), 'Check for duplicate data and other typical data issues. Only the data in HubSpot.');
  assert.equal(H.appendOnce('Keeps the books.', 'Only payroll.'), 'Keeps the books. Only payroll.');
  assert.equal(H.appendOnce('Keeps the books.  ', 'Only payroll.'), 'Keeps the books. Only payroll.');
  assert.equal(H.appendOnce('', 'Only payroll.'), 'Only payroll.');
  assert.equal(H.appendOnce('Keeps the books. Only payroll.', 'Only payroll.'), 'Keeps the books. Only payroll.', 'once');
});

test('people on the team are greyed with Clone, and a clone goes to a free person in the same job family', () => {
  // Value: protects=nobody hires a second Dwight, and cloning a teammate's job picks a sensible free person; fails_when=a teammate's tile can be picked, Michael can be cloned, a clone picks someone on the team or outside the family while the family has room, or the wizard opens on a teammate; why_new=owner 2026-10-03; seam=source pin for the tiles
  const H = loadTs('src/shared/hireTemplates.ts');
  const groups = [['michael', 'pam', 'erin'], ['dwight', 'jim', 'stanley', 'phyllis', 'andy', 'ryan'], ['oscar', 'angela', 'kevin'], ['toby', 'kelly'], ['nick', 'sadiq'], ['creed', 'meredith', 'darryl']];
  const taken = new Set(['michael', 'dwight', 'jim', 'pam', 'kelly', 'toby', 'oscar']);
  assert.equal(H.cloneCharacter('dwight', taken, groups), 'stanley', 'same family, first free');
  assert.equal(H.cloneCharacter('pam', taken, groups), 'erin');
  assert.equal(H.cloneCharacter('oscar', taken, groups), 'angela');
  assert.equal(H.cloneCharacter('kelly', taken, groups), 'erin', 'no free family or group member: first free anyone, in cast order');
  assert.equal(H.cloneCharacter('kelly', new Set([...taken, 'toby']), [['toby', 'kelly', 'sam']]), 'sam', 'same group before anyone');
  assert.equal(H.cloneCharacter('dwight', new Set(groups.flat()), groups), null, 'nobody free');
  assert.equal(H.firstFreeCharacter('jim', taken, groups), 'erin');
  assert.equal(H.firstFreeCharacter('angela', taken, groups), 'angela');
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(modal, /const onTeam = useMemo\(\(\) => new Set\(agents\.filter\(\(a\) => !a\.archived && a\.character\)/);
  assert.match(modal, /\{g\.members\.map\(\(m\) => CAST_BY_NAME\[m\]\)\.map\(\(c\) => onTeam\.has\(c\.name\) \? \(/, 'teammates render greyed');
  assert.match(modal, /c\.name === 'michael' \? \(/, 'Michael is never cloned');
  assert.match(modal, /onClick=\{\(\) => cloneFrom\(c\.name\)\}/);
  assert.match(modal, /setJobKey\(`team:\$\{mate\.id\}`\);/, 'the clone starts on the teammate\'s job');
  assert.match(modal, /if \(match && !onTeam\.has\(match\)\)/, 'typing a teammate\'s name never picks their tile');
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const w = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent.wizard;
    for (const k of ['clone', 'cloneAria', 'onTeam', 'onTeamShort', 'cloning']) assert.ok(w[k], `${loc} ${k}`);
  }
});

test('departments whose people are all on the team move to the end of the Who step', () => {
  // Value: protects=the owner sees the departments they can still hire from first; fails_when=a full department stays in place, the free ones lose their usual order, or a partly staffed one moves; why_new=owner 2026-10-03; seam=source pin
  const H = loadTs('src/shared/hireTemplates.ts');
  const groups = [
    { key: 'office', members: ['michael', 'pam', 'erin'] },
    { key: 'sales', members: ['dwight', 'jim', 'stanley', 'phyllis', 'andy', 'ryan'] },
    { key: 'accounting', members: ['oscar', 'angela', 'kevin'] },
    { key: 'people', members: ['toby', 'kelly'] },
    { key: 'it', members: ['nick', 'sadiq'] },
    { key: 'operations', members: ['creed', 'meredith', 'darryl'] }
  ];
  const taken = new Set(['michael', 'pam', 'erin', 'dwight', 'ryan', 'oscar', 'toby', 'kelly', 'nick', 'sadiq']);
  assert.deepEqual(H.freeGroupsFirst(groups, taken).map((g) => g.key), ['sales', 'accounting', 'operations', 'office', 'people', 'it']);
  assert.deepEqual(H.freeGroupsFirst(groups, new Set()).map((g) => g.key), groups.map((g) => g.key), 'nobody hired: usual order');
  assert.match(read('src/renderer/src/components/AddAgentModal.tsx'), /\{freeGroupsFirst\(CAST_GROUPS, onTeam\)\.map\(\(g\) => \(/);
});


test('a closed bound hire who comes back gets their bindings back', () => {
  // Value: protects=closing a bound hire remembers the lines it took off teammates and puts them back if it returns, so work never overlaps; fails_when=the lines are not recorded, or the watcher is not started; why_new=ship review SR3, 2026-10-03; seam=none
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const H = require('./load-ts.cjs')('src/shared/hireTemplates.ts');
  const { others } = H.bindingLines('orders over $1.5k', 'Creed');
  assert.deepEqual(H.bindingLinesFor('Creed', `Finance: Books. ${others}`), [others]);
  assert.deepEqual(H.bindingLinesFor('Nick', `Finance: Books. ${others}`), []);
  const rel = read('src/renderer/src/shell/releaseBindings.ts');
  assert.match(rel, /s\.updateAgent\(agentId, \{ releasedBindings: removed \}\);/);
  assert.match(rel, /for \(const r of returningBindings\(\{ agents: prev\.agents, archived: prev\.archivedAgents, restorable: prev\.restorableAgents \}, state\.agents\)\) \{\n\s+void restoreBindings\(r\.id, r\.lines\);/);
  assert.match(read('src/renderer/src/App.tsx'), /useEffect\(\(\) => watchReturningBindings\(\), \[\]\);/);
});

test('a returning hire\'s lines go back once, only on teammates still there, read from the entry it had before', () => {
  // Value: protects=the released binding lines come back when a closed hire is spawned again, even though the spawn builds a fresh roster entry; fails_when=restoredRoles adds a line twice or to someone gone, or the watcher reads only the new entry; why_new=ship review pass 2 testing finding (the restore never fired); seam=none
  const fs = require('node:fs');
  const path = require('node:path');
  const H = require('./load-ts.cjs')('src/shared/hireTemplates.ts');
  const { others } = H.bindingLines('orders over $1.5k', 'Creed');
  const team = [{ id: 'oscar', description: 'Finance: Books.' }, { id: 'dwight', description: `Sales Director: Deals. ${others}` }];
  assert.deepEqual(H.restoredRoles([{ id: 'oscar', line: others }, { id: 'oscar', line: others }, { id: 'dwight', line: others }, { id: 'gone', line: others }], team),
    [{ id: 'oscar', description: `Finance: Books. ${others}` }]);
  const rel = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/shell/releaseBindings.ts'), 'utf8');
  assert.match(rel, /returningBindings\(\{ agents: prev\.agents, archived: prev\.archivedAgents, restorable: prev\.restorableAgents \}, state\.agents\)/, 'the watcher reads the entry the hire had before');
});

test('an overlap check the owner moved past is stopped', () => {
  // Value: protects=clicking through jobs or going back stops the hidden overlap check behind it, so no extra claude sessions keep running; fails_when=runCheck or the back step stops calling hireCheckStop, or main stops passing the signal; why_new=ship review pass 2 performance finding; seam=none
  const fs = require('node:fs');
  const path = require('node:path');
  const r = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const modal = r('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(modal, /const seq = \+\+checkSeq\.current;\n\s+stopCheckRun\(\);/);
  assert.match(modal, /if \(step === 'who' \|\| step === 'job'\) \{\n\s+checkSeq\.current\+\+; stopCheckRun\(\);/);
  assert.match(modal, /useEffect\(\(\) => \(\) => stopCheckRun\(\), \[\]\);/);
  const main = r('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('hire:checkStop'/);
  assert.match(main, /signal: stop\.signal\n\s+\}\);/);
  assert.match(r('src/main/hireCheck.ts'), /if \(!result\.ok && result\.error === 'cancelled'\) return rulesVerdict\(job, team\);/);
});

test('who came back with released lines: a returning hire, not a new one, read from the entry it had', () => {
  // Value: protects=a closed hire spawned again (a fresh roster entry, the archived one dropped) gets its lines back, and a brand new hire restores nothing; fails_when=the archived entry is not consulted or a new id with no history restores lines; why_new=ship review pass 3 testing finding; seam=none
  const H = require('./load-ts.cjs')('src/shared/hireTemplates.ts');
  const lines = [{ id: 'oscar', line: 'Not for orders over $1.5k; that goes to Creed.' }];
  const prev = { agents: [{ id: 'oscar' }], archived: [{ id: 'creed', releasedBindings: lines }], restorable: [] };
  assert.deepEqual(H.returningBindings(prev, [{ id: 'oscar' }, { id: 'creed' }]), [{ id: 'creed', lines }]);
  assert.deepEqual(H.returningBindings(prev, [{ id: 'oscar' }, { id: 'nick' }]), []);
  assert.deepEqual(H.returningBindings(prev, [{ id: 'oscar' }]), []);
  const fs = require('node:fs');
  const path = require('node:path');
  const r = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  assert.match(r('src/renderer/src/shell/releaseBindings.ts'), /if \(s\.agents\.some\(\(a\) => a\.id !== agentId && a\.name\.trim\(\) === leaving\.name\.trim\(\)\)\) return;/, 'a newer hire with the name keeps their lines');
  assert.match(r('src/renderer/src/store/store.ts'), /releasedBindings: next\.releasedBindings\.map\(\(b\) => \(\{ \.\.\.b, line: swapName\(b\.line, previousName, nextName\) \}\)\)/, 'a rename keeps released lines true');
  const modal = r('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(modal, /if \(run\) \{ suggestRun\.current = null; void window\.cth\.workStyleSuggestStop\?\.\(run\.id\)\?\.catch\(\(\) => undefined\); setSuggesting\(false\); \}/, 'going back ends a suggestion for the job left behind');
  assert.match(modal, /title=\{cloneCharacter\(c\.name, onTeam, castGroups\) \? undefined : tr\('addAgent\.wizard\.cloneNoneFree'\)\}/);
  for (const loc of ['en', 'ar', 'zh-CN']) assert.ok(JSON.parse(r(`src/renderer/src/i18n/locales/${loc}.json`)).addAgent.wizard.cloneNoneFree, loc);
});

test('a returning hire keeps its released lines until the registry has them back', () => {
  // Value: protects=the only record of what to put back survives a failed registry write, and is cleared once every teammate has the line again; fails_when=releasedBindings is cleared before the patches are sent or regardless of their result; why_new=Codex adversarial review 2026-10-04; seam=none
  const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'src/renderer/src/shell/releaseBindings.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function restoreBindings'), src.indexOf('export function watchReturningBindings'));
  assert.match(fn, /const sent = await Promise\.all\(patches\.map\(\(p\) => window\.cth\.hivePatchAgentRole\(p\.id, p\.description\)\.then\(\(r\) => r\?\.ok !== false, \(\) => false\)\)\);/);
  assert.match(fn, /if \(sent\.every\(Boolean\)\) useStore\.getState\(\)\.updateAgent\(agentId, \{ releasedBindings: undefined \}\);/);
  assert.ok(fn.indexOf('releasedBindings: undefined') > fn.indexOf('hivePatchAgentRole'), 'cleared only after the writes');
});
