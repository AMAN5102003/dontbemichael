import { isReservedName, RESEARCH_ID, RESEARCH_ONLY_SKILLS } from '@shared/research';
import { useResearchName } from '@/shell/research';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { Icon } from './Icon';
import { ProviderLogo } from './ProviderLogo';
import { InfoTip } from './InfoTip';
import { Dialog } from '@/shell/Dialog';
import { useStore, type Agent, ACTION_CLOCKING_IN } from '@/store/store';
import { OFFICE_CAST, CAST_BY_NAME, CAST_GROUPS, DEFAULT_CHARACTER, HIREABLE_CAST, type OfficeCharacterName } from '@/scene/office/cast';
import { type AccentColorName } from '@/design/tokens';
import type { HireManifest } from '@shared/hire';
import { hireQueueProgress } from '@shared/hireQueue';
import { MCP_CATALOG } from '@shared/mcpCatalog';
import {
  type AgentProvider,
  type HarnessConfig,
  AGENT_PROVIDER_PRESETS,
  buildSpawnCommand,
  tokenizeCommand,
  modelsForProvider,
  inferAgentProvider,
  isClaudeProvider
} from '@/store/config';
import { BUILD_ENGINES } from '@shared/agentProvider';
import { splitAgentRole } from '@shared/agentRole';
import { FIRST_TASK_EDITED_MAX } from '@shared/firstTask';
import { teamAccent } from '@shared/teamPlan';
import { mailboxHolder } from '@shared/mailboxes';
import { connectorOn, isQuickBooksKey } from '@shared/claudeConnectors';
import { Select } from './triggers/ui';
import {
  NEW_JOB_KEY,
  cloneCharacter,
  firstFreeCharacter,
  freeGroupsFirst,
  newJobStart,
  activeTeam,
  appendOnce,
  bindingLines,
  cardJobs,
  hireAgentId,
  hireFolderName,
  hireRole,
  safeFolder,
  jobFor,
  overlapsByRules,
  ownJob,
  sameFamily,
  CHARACTER_CARD,
  teamJobs,
  type DistinctVerdict,
  type HireJob,
  type JobProfile
} from '@shared/hireTemplates';
import { firstTaskSection, roleLabel, plainFallback } from '@shared/workStyleText';
import { useRtl } from '@/i18n/useDirection';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { SHOW_IMPORT_HIRE, SHOW_ENGINE_PICKER, SHOW_MAILBOXES } from '@shared/buildFeatures';
import { seedStarterJobs } from '@/shell/seedStarterJobs';
import { sendTypedFirstTask } from '@/shell/typedFirstTask';

const ACCENTS: AccentColorName[] = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'];

// Copy-paste prompt the user hands to any AI to generate a hire manifest. It pins
// the exact JSON shape the importer accepts (src/shared/hire.ts). Shown only with
// SHOW_IMPORT_HIRE.
const HIRE_PROMPT = `You are designing a "hire": a ready to spawn AI agent for Don't Be Michael, an app that runs a team of AI agents. Output ONE JSON object (a hire manifest) and nothing else.

Return EXACTLY this shape (omit optional fields you don't need; keep the spec string verbatim):

{
  "spec": "munder-difflin/hire@1",
  "name": "Jim",
  "description": "Job title: what to send this agent",
  "goal": "work style: how the agent does the job",
  "provider": "claude",
  "tokenCap": 2000000,
  "author": "your name"
}

--- ADD YOUR DETAILS BELOW (the AI should use these) ---
Role / what I want this agent to do:
`;

/**
 * Hire a team member (docs/designs/hire-redesign.md). Three steps:
 *
 *   Who     the character tiles, grouped by job; the name follows the tile.
 *   Job     the character's own job (a teammate doing it today, else the pack
 *           card), every teammate's job ("Your office"), every pack's jobs, or
 *           a new one.
 *   Review  everything editable: name, job title, what to send, work style,
 *           folder (its own, suffixed on a clash) and model (Best or Fast).
 *           The job is checked against every teammate before Hire (D6): it is
 *           allowed only when distinct, or bound to its own mailbox or topic.
 *
 * A queued hire (deep link, import) opens on Review, prefilled from its manifest.
 */
// Role and Setup are two screens (owner, 2026-09-27): first the role is named
// and checked against the team, then, with a verified role, the work style,
// folder and model are set.
type Step = 'who' | 'job' | 'role' | 'setup';
const STEPS: Step[] = ['who', 'job', 'role', 'setup'];

/** Same folder, ignoring a trailing slash and (as macOS and Windows do) case. */
function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.trim().replace(/[\\/]+$/, '').toLowerCase();
  return n(a) === n(b);
}
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const joinPath = (root: string, name: string) => `${root.replace(/[\\/]+$/, '')}/${name}`;

const TOPIC_MAX = 120;

/** A binding that makes an overlapping job particular (D6). */
/** `connectorKey`: a connection binding (owner, 2026-10-03: "his only access
 *  would be to HubSpot"). The hire is given that one Claude connector before
 *  it starts, and holds no other. */
interface Binding { scope: string; mailboxId?: string; connectorKey?: string; others: string[] }

export interface AddAgentModalProps {
  onClose: () => void;
  config: HarnessConfig;
  /** Lift config changes back up to App so the rest of the UI sees them. */
  onConfigChange?: (config: HarnessConfig) => void;
}

export function AddAgentModal({ onClose, config, onConfigChange }: AddAgentModalProps) {
  const { t: tr } = useTranslation();
  const rtl = useRtl();
  const godName = useResolvedGodName();
  const addAgent = useStore(s => s.addAgent);
  const updateAgent = useStore(s => s.updateAgent);
  const setSidebarTab = useStore(s => s.setSidebarTab);
  const agents = useStore(s => s.agents);
  const researchName = useResearchName();
  // Deep links and file batches share one FIFO. The head alone seeds the form;
  // every item still requires an explicit hire or skip.
  const hireQueue = useStore(s => s.hireQueue);
  const enqueuePendingHires = useStore(s => s.enqueuePendingHires);
  const finishPendingHire = useStore(s => s.finishPendingHire);
  const pendingHire = hireQueue.pending[0];
  const reviewProgress = hireQueueProgress(hireQueue);

  const knownCharacter = (c?: string): OfficeCharacterName =>
    (HIREABLE_CAST.some(m => m.name === c) ? (c as OfficeCharacterName) : DEFAULT_CHARACTER);
  const knownAccent = (a?: string): AccentColorName | undefined =>
    (ACCENTS.includes(a as AccentColorName) ? (a as AccentColorName) : undefined);
  /** The cast member a typed name refers to, if any (typing "Meredith" picks her
   *  tile; no match leaves the pick alone). */
  const characterForName = (n: string): OfficeCharacterName | null => {
    const q = n.trim().toLowerCase();
    if (!q) return null;
    const hit = HIREABLE_CAST.find(c => c.displayName.toLowerCase() === q || c.name === q);
    return hit ? hit.name : null;
  };

  const team = useMemo(() => activeTeam(agents), [agents]);
  const michaelFolder = config.businessFolder;
  const business = useMemo(() => ({ name: config.businessName, city: config.businessCity }), [config.businessName, config.businessCity]);

  // ── Engine: the Settings engine; Best or Fast model on Review (D3) ──
  const initialProvider = inferAgentProvider(config.defaultCommand);
  const [provider, setProvider] = useState<AgentProvider>(pendingHire?.provider ?? initialProvider);
  // The model starts on the default for agents set in Settings, and the owner
  // can pick any other from the same list (owner, 2026-09-27: Best or Fast told
  // them nothing).
  const defaultModel = isClaudeProvider(provider) ? config.defaultModel : config.providerDefaultModels?.[provider];
  const [customModel, setCustomModel] = useState<string | undefined>(pendingHire?.model);
  const model = customModel ?? defaultModel;
  const modelOptions = (() => {
    const known = modelsForProvider(provider).filter((m) => !!m.id) as Array<{ id: string; label: string }>;
    const extra = [defaultModel, customModel].filter((id): id is string => !!id && !known.some((m) => m.id === id));
    return [...known, ...extra.map((id) => ({ id, label: id }))];
  })();
  const hireCommand = (m: HireManifest): string => {
    const prov: AgentProvider = m.provider ?? initialProvider;
    const base = buildSpawnCommand(config, m.model, prov);
    return m.commandFlags?.length ? `${base} ${m.commandFlags.join(' ')}` : base;
  };
  const [commandEdit, setCommandEdit] = useState<string | undefined>(pendingHire ? hireCommand(pendingHire) : undefined);
  const command = commandEdit ?? buildSpawnCommand(config, model, provider);

  // ── Who ──
  // People already on the team, Michael included: their tiles are greyed with
  // "Clone" instead (owner, 2026-10-03: no second Dwight, and a calmer grid).
  const onTeam = useMemo(() => new Set(agents.filter((a) => !a.archived && a.character).map((a) => a.character as string)), [agents]);
  const castGroups = CAST_GROUPS.map((g) => g.members as string[]);
  const firstCharacter = pendingHire?.character
    ? knownCharacter(pendingHire.character)
    : (characterForName(pendingHire?.name ?? '') ?? (firstFreeCharacter(DEFAULT_CHARACTER, onTeam, castGroups) as OfficeCharacterName));
  const [step, setStep] = useState<Step>(pendingHire ? 'role' : 'who');
  const [character, setCharacter] = useState<OfficeCharacterName>(firstCharacter);
  const [name, setName] = useState(pendingHire?.name ?? CAST_BY_NAME[firstCharacter].displayName);
  const [hireMeta, setHireMeta] = useState<HireManifest | null>(pendingHire ?? null);
  /** The teammate whose job is being cloned, by agent id. */
  const [cloneOf, setCloneOf] = useState<string | null>(null);
  const cloneFrom = (of: OfficeCharacterName): void => {
    const mate = team.find((a) => a.character === of);
    const next = cloneCharacter(of, onTeam, castGroups) as OfficeCharacterName | null;
    if (!mate || !next) return;
    setCharacter(next);
    setName(CAST_BY_NAME[next].displayName);
    setCloneOf(mate.id);
    setJobKey(`team:${mate.id}`);
  };

  // ── Job ──
  const [cards, setCards] = useState<HireJob[]>([]);
  useEffect(() => {
    let alive = true;
    window.cth.packsList()
      .then((res) => { if (alive) setCards(cardJobs(res.packs.map((p) => p.pack), res.core, config.businessType, business)); })
      .catch(() => { /* the owner can still write a new job */ });
    return () => { alive = false; };
  }, [config.businessType, business]);
  const officeJobs = useMemo(() => teamJobs(team, cards), [team, cards]);
  // A clone's own job is the teammate's it copies.
  const theirJob = useMemo(
    () => (cloneOf && officeJobs.find((j) => j.key === `team:${cloneOf}`)) || ownJob(character, officeJobs, cards),
    [character, officeJobs, cards, cloneOf]
  );
  // Every job list opens on the character's own family, office and packs alike;
  // "show all jobs" opens the rest (owner, 2026-09-27). A character with no
  // family shows everything.
  const family = CHARACTER_CARD[character];
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [character]);
  const listAll = showAll || !family;
  const inFamily = (j: HireJob) => !family || sameFamily(j, character);
  const familyJobs = useMemo(
    () => officeJobs.filter((j) => j.key !== theirJob?.key && (listAll || sameFamily(j, character))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [officeJobs, theirJob, character, listAll]
  );
  const hiddenCount = family
    ? officeJobs.filter((j) => j.key !== theirJob?.key && !sameFamily(j, character)).length
      + cards.filter((j) => j.key !== theirJob?.key && !sameFamily(j, character)).length
    : 0;
  const [jobKey, setJobKey] = useState<string | null>(null);
  const allJobs = useMemo(() => [...officeJobs, ...cards], [officeJobs, cards]);
  const chosenKey = jobKey ?? theirJob?.key ?? NEW_JOB_KEY;
  const chosenJob = allJobs.find((j) => j.key === chosenKey);

  // ── Review fields; filled from the chosen job each time the job or the name
  //    changes, so edits survive going back and forth otherwise ──
  const [title, setTitle] = useState(() => splitAgentRole(pendingHire?.description).role);
  const [routing, setRouting] = useState(() => splitAgentRole(pendingHire?.description).roleDescription);
  // Work style in two forms (owner, 2026-09-27): the owner reads and edits a
  // plain description (`workStyle`); the agent gets instructions written from
  // it at Hire. `baseInstructions` are the copied job's instructions, used as
  // they are when the owner leaves the description unchanged.
  const [workStyle, setWorkStyle] = useState(pendingHire?.goal ? plainFallback(pendingHire.goal, roleLabel(splitAgentRole(pendingHire.description).role)) : '');
  const [baseInstructions, setBaseInstructions] = useState(pendingHire?.goal ?? '');
  const [plainOfBase, setPlainOfBase] = useState(pendingHire?.goal ? plainFallback(pendingHire.goal, roleLabel(splitAgentRole(pendingHire.description).role)) : '');
  const [describing, setDescribing] = useState(false);
  // "Suggest me" (owner, 2026-10-03): a first work style written from the
  // role, what they handle, the business and the team, for the owner to edit.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestFailed, setSuggestFailed] = useState(false);
  const [writingInstructions, setWritingInstructions] = useState(false);
  const describeSeq = useRef(0);
  const styleCtx = () => ({ name: name.trim(), title: title.trim() || undefined, business, manager: godName });
  // The run being written, with the text it replaces, so Stop puts it back.
  const suggestRun = useRef<{ id: string; before: string } | null>(null);
  const suggestWorkStyle = async (): Promise<void> => {
    if (suggesting || !routing.trim()) return;
    if (workStyle.trim() && !window.confirm(tr('addAgent.wizard.suggestReplace', { name: name.trim() }))) return;
    // A suggestion replaces the description, so a rewrite still on its way
    // from the picked job must not land on top of it.
    describeSeq.current++;
    setDescribing(false);
    setSuggestFailed(false);
    setSuggesting(true);
    const id = `suggest-${crypto.randomUUID()}`;
    const before = workStyle;
    suggestRun.current = { id, before };
    // The draft streams into the field as it is written (owner, 2026-10-03:
    // "the user has no clue if it is still working").
    const off = window.cth.onWorkStyleSuggestText?.((e) => {
      if (e.requestId === id && suggestRun.current?.id === id) setWorkStyle(e.text);
    });
    try {
      const res = await window.cth.workStyleSuggest({
        requestId: id,
        ctx: styleCtx(),
        handles: routing.trim(),
        businessType: cards.find((c) => c.sourceCard?.startsWith(`${config.businessType}/`))?.business,
        team: team.map((a) => { const r = splitAgentRole(a.description); return { name: a.name, title: r.role || undefined, handles: r.roleDescription || undefined }; })
      });
      if (suggestRun.current?.id !== id) return; // stopped
      const text = res?.text?.trim();
      if (!text) { setWorkStyle(before); if (!res?.cancelled) setSuggestFailed(true); return; }
      setWorkStyle(text);
      // It is the owner's new description, not an edit of the picked job's
      // instructions: Hire writes the instructions from it alone.
      setBaseInstructions('');
      setPlainOfBase('');
    } catch {
      // Whatever went wrong, the field and the button come back.
      if (suggestRun.current?.id === id) { setWorkStyle(before); setSuggestFailed(true); }
    } finally {
      off?.();
      if (suggestRun.current?.id === id) suggestRun.current = null;
      setSuggesting(false);
    }
  };
  /** Stop: the session ends and the field goes back to what it held. */
  const stopSuggest = (): void => {
    const run = suggestRun.current;
    if (!run) return;
    suggestRun.current = null;
    void window.cth.workStyleSuggestStop?.(run.id)?.catch(() => undefined);
    setWorkStyle(run.before);
    setSuggesting(false);
  };
  // Closing the wizard mid suggestion stops it.
  useEffect(() => () => { const run = suggestRun.current; if (run) void window.cth.workStyleSuggestStop?.(run.id)?.catch(() => undefined); }, []);
  /** Show a job's instructions as a plain description: the quick rewrite at
   *  once, the model's when it arrives, unless the owner has started typing. */
  const setInstructions = (instructions: string, forName = name.trim(), forTitle = title.trim()): void => {
    const seq = ++describeSeq.current;
    setBaseInstructions(instructions);
    const quick = instructions.trim() ? plainFallback(instructions, roleLabel(forTitle)) : '';
    setWorkStyle(quick);
    setPlainOfBase(quick);
    if (!instructions.trim()) { setDescribing(false); return; }
    setDescribing(true);
    window.cth.workStyleConvert({ to: 'plain', text: instructions, ctx: { name: forName, title: forTitle || undefined, business, manager: godName } })
      .then((res) => {
        if (seq !== describeSeq.current || res.source !== 'ai' || !res.text) return;
        setWorkStyle((cur) => (cur === quick ? res.text : cur));
        setPlainOfBase((cur) => (cur === quick ? res.text : cur));
      })
      .catch(() => { /* the quick rewrite stays */ })
      .finally(() => { if (seq === describeSeq.current) setDescribing(false); });
  };
  const [sourceCard, setSourceCard] = useState<string | undefined>(undefined);
  const applied = useRef<string | null>(pendingHire ? 'manifest' : null);
  const applyJob = (): void => {
    const sig = `${chosenKey}|${name.trim()}|${character}`;
    if (applied.current === sig) return;
    // A queued hire keeps its manifest's job until the owner picks another.
    if (applied.current === 'manifest' && jobKey === null) return;
    applied.current = sig;
    setBinding(null);
    // A new job keeps the picked character's role (Creed: Quality Control),
    // for the owner to change.
    if (!chosenJob) { setTitle(newJobStart(character).title); setRouting(''); setInstructions(''); setSourceCard(undefined); return; }
    const copy = jobFor(chosenJob, name.trim());
    setTitle(copy.title);
    setRouting(copy.routing);
    setInstructions(copy.workStyle, name.trim(), copy.title);
    setSourceCard(chosenJob.sourceCard);
  };

  // ── Folder: its own, suffixed with the name on a clash (point 2) ──
  const [folderName, setFolderName] = useState('');
  const [customCwd, setCustomCwd] = useState<string | undefined>(
    michaelFolder ? undefined : (config.registeredRepos[0] ?? '')
  );
  const cwd = customCwd ?? (michaelFolder && safeFolder(folderName) ? joinPath(michaelFolder, safeFolder(folderName)) : '');
  const suggestFolder = async (): Promise<void> => {
    if (!michaelFolder) return;
    const base = safeFolder(chosenJob?.folder ?? (title.trim() === newJobStart(character).title ? newJobStart(character).folder : undefined) ?? title) || safeFolder(name);
    const n = name.trim();
    const candidates = [base, `${base}_${n}`, ...Array.from({ length: 8 }, (_, i) => `${base}_${n}_${i + 2}`)];
    const onDisk = await window.cth.foldersExist(michaelFolder, candidates).catch(() => ({} as Record<string, boolean>));
    const used = new Set(team.map((a) => basename(a.cwd ?? '').toLowerCase()));
    setFolderName(hireFolderName(base, n, (f) => !!onDisk[f] || used.has(f.toLowerCase())));
  };

  // ── The distinct job check (D6) ──
  const mailboxes = config.mailboxes ?? [];
  const mailboxAddress = (id?: string) => mailboxes.find((m) => m.id === id)?.address;
  const teamProfiles: JobProfile[] = useMemo(() => team.map((a) => {
    const split = splitAgentRole(a.description);
    const email = config.agentCapabilities?.[a.id]?.email;
    return {
      name: a.name,
      title: split.role,
      routing: split.roleDescription,
      workStyle: a.goal,
      mailbox: email?.enabled ? mailboxAddress(email.mailboxes[0]) : undefined
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [team, config.agentCapabilities, mailboxes]);
  const [binding, setBinding] = useState<Binding | null>(null);
  const profile: JobProfile = {
    name: name.trim(), title: title.trim(), routing: routing.trim(), workStyle,
    mailbox: mailboxAddress(binding?.mailboxId)
  };
  // The check judges what to send, never the title: renaming "Sales Director"
  // to "Sales Director1" must not clear an overlap (owner, 2026-09-27).
  const checkSig = `${profile.name}\n${profile.routing}`;
  const [check, setCheck] = useState<{ sig: string; verdict: DistinctVerdict } | null>(null);
  const [checking, setChecking] = useState(false);
  const checkSeq = useRef(0);
  const ruleOverlaps = overlapsByRules(profile, teamProfiles);
  const verdict = check && check.sig === checkSig ? check.verdict : null;
  // The hidden session behind the check still running, stopped once nobody
  // will read its answer (ship review: superseded checks kept running).
  const checkRun = useRef<string | null>(null);
  const stopCheckRun = (): void => {
    if (checkRun.current) void window.cth.hireCheckStop?.(checkRun.current).catch(() => undefined);
    checkRun.current = null;
  };
  useEffect(() => () => stopCheckRun(), []);
  // `job` and `sig` default to the form; the job step passes the picked job's
  // text instead, so its check can start before Review opens.
  const runCheck = async (job: JobProfile = profile, sig = checkSig): Promise<DistinctVerdict | null> => {
    const seq = ++checkSeq.current;
    stopCheckRun();
    const run = `check-${crypto.randomUUID()}`;
    checkRun.current = run;
    setChecking(true);
    try {
      const v = await window.cth.hireCheckDistinct(job, teamProfiles, run);
      if (checkRun.current === run) checkRun.current = null;
      if (seq !== checkSeq.current) return null;
      setCheck({ sig, verdict: v });
      return v;
    } catch {
      const overlaps = overlapsByRules(job, teamProfiles);
      const v: DistinctVerdict = { distinct: overlaps.length === 0, overlapsWith: overlaps, why: '', source: 'rules' };
      if (seq === checkSeq.current) setCheck({ sig, verdict: v });
      return v;
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  };
  // Run once when Review opens with a job to check: the check judges what to
  // send, so a title alone (a new job keeps the character's role) is nothing to
  // check yet.
  useEffect(() => {
    if (step === 'role' && profile.name && profile.routing && !verdict && !checking) void runCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  // Going back to pick another person or job drops a check still running: its
  // answer is for a job that is no longer on the form, and it must not keep
  // Review showing "checking" (owner, 2026-10-03).
  const prefetchSig = useRef('');
  useEffect(() => {
    if (step === 'who' || step === 'job') {
      checkSeq.current++; stopCheckRun(); setChecking(false); prefetchSig.current = '';
      // A suggestion still streaming was for the job left behind: end it, and
      // leave the field to the job picked next (ship review pass 3).
      const run = suggestRun.current;
      if (run) { suggestRun.current = null; void window.cth.workStyleSuggestStop?.(run.id)?.catch(() => undefined); setSuggesting(false); }
    }
  }, [step]);
  // The check starts as soon as a job is picked on the job step (owner,
  // 2026-10-03: waiting for it on Review was slow), with the same name and
  // what they handle that Review will show, so Review reuses the answer or
  // shows the check already under way. A short pause lets the owner click
  // through jobs without starting one for each.
  useEffect(() => {
    if (step !== 'job' || !chosenJob || !name.trim()) return;
    const copy = jobFor(chosenJob, name.trim());
    const job: JobProfile = { name: name.trim(), title: copy.title.trim(), routing: copy.routing.trim(), workStyle: copy.workStyle };
    if (!job.routing) return;
    const sig = `${job.name}\n${job.routing}`;
    if (check?.sig === sig || prefetchSig.current === sig) return;
    const timer = window.setTimeout(() => { prefetchSig.current = sig; void runCheck(job, sig); }, 400);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, chosenKey, name]);

  // The instant rules always count, live on every edit, so a job whose what to
  // send reads like a teammate's is flagged even before or after the AI check.
  const overlapNames = [...new Set([...(verdict?.overlapsWith ?? []), ...ruleOverlaps])];
  const cleared = !!verdict && (overlapNames.length === 0 || !!binding);

  const [bindMode, setBindMode] = useState<'mailbox' | 'topic' | 'connection' | null>(null);
  const [topic, setTopic] = useState('');
  const [bindMailbox, setBindMailbox] = useState('');
  const freeMailboxes = mailboxes.filter((m) => !mailboxHolder(config.agentCapabilities, m.id));
  // Every connector on the owner's Claude account is listed (owner, 2026-10-03:
  // "do not let system decide which connector make available ... nothing
  // should be hidden"). Those switched on can be bound; those switched off
  // show greyed with where to turn them on. A binding grants its most
  // restrictive access: QuickBooks read only.
  const bindConnectors = (config.claudeConnectors?.list ?? [])
    .map((c) => ({ key: c.key, on: connectorOn(config, c.key), signIn: c.status === 'needs-sign-in' }))
    .sort((a, b) => Number(b.on) - Number(a.on));
  const [bindConnector, setBindConnector] = useState('');
  const [connectionScope, setConnectionScope] = useState('');
  const pickConnector = (key: string): void => {
    setBindConnector(key);
    setConnectionScope(key ? tr('addAgent.wizard.connectionScope', { name: key }) : '');
  };
  const applyBinding = (scope: string, mailboxId?: string, connectorKey?: string): void => {
    const s = scope.trim().slice(0, TOPIC_MAX);
    if (!s) return;
    const lines = bindingLines(s, name.trim());
    setRouting((r) => appendOnce(binding ? r.replace(bindingLines(binding.scope, name.trim()).own, '').trim() : r, lines.own));
    setBinding({ scope: s, mailboxId, connectorKey, others: overlapNames });
    setBindMode(null);
    // The overlap is resolved: an "overlaps a teammate" message from an earlier
    // Next no longer applies (owner, 2026-10-03: it stayed after binding).
    setError(undefined);
  };
  const clearBinding = (): void => {
    if (binding) setRouting((r) => r.replace(bindingLines(binding.scope, name.trim()).own, '').trim());
    setBinding(null);
  };
  // The routing line changes when a binding is applied; keep the verdict that
  // led to it so the overlap box stays in view.
  const [shownVerdict, setShownVerdict] = useState<DistinctVerdict | null>(null);
  useEffect(() => { if (verdict) setShownVerdict(verdict); }, [verdict]);

  // ── Queue: re-seed every field when the queue head changes ──
  const applyManifest = (m: HireManifest) => {
    setHireMeta(m);
    setName(m.name);
    setCharacter(m.character ? knownCharacter(m.character) : (characterForName(m.name ?? '') ?? knownCharacter(undefined)));
    setProvider(m.provider ?? initialProvider);
    setCustomModel(m.model);
    setCommandEdit(hireCommand(m));
    const split = splitAgentRole(m.description);
    setTitle(split.role);
    setRouting(split.roleDescription);
    setInstructions(m.goal ?? '', m.name, split.role);
    setSourceCard(undefined);
    setBinding(null);
    applied.current = 'manifest';
    setStep('role');
  };
  useLayoutEffect(() => {
    if (pendingHire) applyManifest(pendingHire);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHire]);
  const advanceHireReview = () => {
    const next = hireQueue.pending[1];
    finishPendingHire();
    if (!next) onClose();
  };

  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [showHirePrompt, setShowHirePrompt] = useState(false);

  // While Hire runs (checks, instructions, spawn) the dialog can't be closed:
  // closing then would still hire the person (pre-landing review, 2026-09-27).
  const submitting = useRef(false);
  const close = (): void => { if (!submitting.current) onClose(); };
  // Esc, the backdrop and the close button all go through close(), via the
  // dialog frame (shell/Dialog.tsx); Esc in a field stays in the field.

  const importHire = async () => {
    setError(undefined);
    const res = await window.cth.importHireFiles();
    if (res.manifests.length > 0) enqueuePendingHires(res.manifests);
    if (res.errors.length > 0) {
      const noun = res.errors.length === 1 ? 'file' : 'files';
      setError(`Skipped ${res.errors.length} invalid ${noun}: ${res.errors.join(' · ')}`);
    } else if (!res.ok && res.error && res.error !== 'cancelled') {
      setError(res.error);
    }
  };

  const skipHire = () => {
    if (!pendingHire) return;
    setError(undefined);
    advanceHireReview();
  };

  const nameTaken = (n: string) => isReservedName(n, undefined, { [RESEARCH_ID]: { name: researchName } }) || agents.some((a) => a.name.trim().toLowerCase() === n.trim().toLowerCase());
  const whoError = !name.trim() ? tr('addAgent.errName') : nameTaken(name) ? tr('addAgent.wizard.nameTaken', { name: name.trim() }) : undefined;

  /** The role step's gate: a name, what they handle, and a job that is
   *  distinct from every teammate's or bound to its own mailbox, topic or
   *  connection (D6). */
  const roleReady = async (): Promise<boolean> => {
    // What they handle is what the check judges and what Michael routes by, so
    // there is nothing to check, or to hire, without it (owner, 2026-10-03).
    if (!routing.trim()) { setError(tr('addAgent.wizard.errJob', { name: name.trim(), godName })); return false; }
    let v = verdict;
    if (!v) v = await runCheck();
    if (!v) return false;
    const overlaps = [...new Set([...v.overlapsWith, ...overlapsByRules(profile, teamProfiles)])];
    if (overlaps.length > 0 && !binding) { setError(tr('addAgent.wizard.errOverlap')); return false; }
    return true;
  };

  const goTo = async (next: Step): Promise<void> => {
    setError(undefined);
    if (next !== 'who' && whoError) { setError(whoError); setStep('who'); return; }
    if (next === 'role' && (step === 'who' || step === 'job')) {
      applyJob();
      setFolderName('');
    }
    if (next === 'setup' && step !== 'setup') {
      if (step === 'who' || step === 'job') { applyJob(); setStep('role'); return; }
      if (!(await roleReady())) { setStep('role'); return; }
    }
    setStep(next);
  };
  // After the job is applied, suggest the folder for it.
  const onRoleOrSetup = step === 'role' || step === 'setup';
  useEffect(() => { if (onRoleOrSetup) void suggestFolder(); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [onRoleOrSetup ? `${title}|${chosenKey}|${name}` : '']);

  const pickFolder = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) setCustomCwd(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    try { await submitHire(); } finally { submitting.current = false; }
  };
  const submitHire = async () => {
    setError(undefined);
    if (whoError) { setError(whoError); setStep('who'); return; }
    if (!(await roleReady())) { setStep('role'); return; }
    // Work style is required: it is how the new hire does the job (owner, 2026-09-27).
    if (!workStyle.trim()) { setError(tr('addAgent.wizard.errWorkStyle')); return; }
    if (!cwd) { setError(tr('addAgent.errFolder')); return; }
    // Michael's folder is private to him (src/shared/folderAccess.ts).
    if (michaelFolder && samePath(michaelFolder, cwd)) { setError(tr('addAgent.errFolderShared', { godName })); return; }
    if (!command.trim()) { setError(tr('addAgent.errCommand')); return; }
    setBusy(true);
    // The agent's instructions: the copied job's own when the owner left the
    // description as it was, else written from the description, to the house
    // prompting guidelines (owner, 2026-09-27).
    let goal = baseInstructions.trim();
    // What the owner typed under "First task", which the instructions leave out.
    const typedFirstTask = firstTaskSection(workStyle)?.body.trim().slice(0, FIRST_TASK_EDITED_MAX) || '';
    if (!goal || workStyle.trim() !== plainOfBase.trim()) {
      setWritingInstructions(true);
      const res = await window.cth.workStyleConvert({ to: 'instructions', text: workStyle, ctx: styleCtx(), previous: baseInstructions || undefined })
        .catch(() => null);
      setWritingInstructions(false);
      goal = res?.text?.trim() || '';
      if (!goal) { setBusy(false); setError(tr('addAgent.wizard.errInstructions')); return; }
    }
    // The folder is made here, the first time it's needed; an existing one is
    // left exactly as it is.
    if (michaelFolder && !customCwd) {
      const [made] = await window.cth.foldersEnsure([cwd]).catch(() => [undefined]);
      if (!made || !made.ok) {
        setBusy(false);
        setError(made && !made.ok ? made.reason : tr('addAgent.errFolder'));
        return;
      }
    }
    const id = hireAgentId(name);
    const ptyId = `pty-${id}`;
    const description = hireRole(title, routing);
    // Give back what a binding granted (a mailbox, a connector) when the hire fails.
    const releaseBindingAccess = (): void => {
      if (binding?.mailboxId) void window.cth.mailSetCapabilities(id, { email: { enabled: false, mailboxes: [], send: false } }).catch(() => undefined);
      if (binding?.connectorKey) {
        void (isQuickBooksKey(binding.connectorKey)
          ? window.cth.quickbooksSetAccess(id, { enabled: false, changes: false }, { hiring: true })
          : window.cth.connectorsSetGrant(id, binding.connectorKey, false)).catch(() => undefined);
      }
    };
    // A mailbox binding is set before the spawn, so the agent starts with it.
    if (binding?.mailboxId) {
      const res = await window.cth.mailSetCapabilities(id, { email: { enabled: true, mailboxes: [binding.mailboxId], send: false } }).catch(() => null);
      if (!res?.ok) { setBusy(false); setError(tr('capabilities.saveFailed')); return; }
    }
    // So is a connection binding: the agent starts holding that one connector.
    if (binding?.connectorKey) {
      const res = await (isQuickBooksKey(binding.connectorKey)
        ? window.cth.quickbooksSetAccess(id, { enabled: true, changes: false }, { hiring: true })
        : window.cth.connectorsSetGrant(id, binding.connectorKey, true)).catch(() => null);
      if (!res?.ok) {
        releaseBindingAccess();
        setBusy(false); setError(tr('capabilities.saveFailed')); return;
      }
    }
    const [exe, ...args] = tokenizeCommand(command.trim());
    const spawnRes = await window.cth.spawnPty({
      id: ptyId,
      cwd,
      command: exe,
      provider,
      args,
      cols: 100,
      rows: 30,
      isolate: false,
      hive: {
        id,
        name: name.trim(),
        provider,
        cwd,
        role: description || undefined,
        // A hire manifest may carry validated capability tags (routing hints).
        capabilities: hireMeta?.capabilities
      }
    }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), cwd: undefined, seedPrompt: undefined }));
    if (!spawnRes.ok) {
      // Give back what the failed hire was holding.
      releaseBindingAccess();
      setBusy(false);
      setError(spawnRes.error ?? 'spawn failed');
      return;
    }
    const spawnedCwd = spawnRes.cwd || cwd;
    const agent: Agent = {
      id,
      name: name.trim(),
      character,
      accent: knownAccent(hireMeta?.accent) ?? teamAccent(team.length),
      description: description || 'a fresh harness',
      project: basename(spawnedCwd),
      tmuxTarget: '',
      cwd: spawnedCwd,
      goal: goal || undefined,
      sourceCard,
      status: 'idle',
      action: ACTION_CLOCKING_IN,
      progress: 0,
      currentStation: 'desk',
      ptyId,
      command: command.trim(),
      provider,
      model,
      seedPrompt: spawnRes.seedPrompt,
      recentTextTs: Date.now()
    };
    addAgent(agent);
    // The card's starter jobs, each with its focus area (inbox zero, 2026-10-03),
    // and its first task as a card Michael hands out (first-task-card.md).
    void seedStarterJobs(sourceCard, id);
    // A First task the owner typed into the Work style is one-time work: it
    // becomes this hire's first task card (ship review SR5), in place of the
    // pack's. Otherwise only a job taken straight from a pack card sends its
    // first task: a clone copies the teammate's job, not their one-time work (SR1).
    if (typedFirstTask) void sendTypedFirstTask(sourceCard, id, name.trim(), { ask: typedFirstTask, role: title.trim(), existing: false });
    else if (sourceCard && chosenJob?.source === 'card') void window.cth.hiveFirstTask(sourceCard, id, name.trim()).catch(() => undefined);
    // A binding hands the bound work back from every overlapping teammate:
    // their line gains "Not for ...; that goes to <Name>." (D6).
    if (binding) {
      const others = bindingLines(binding.scope, name.trim()).others;
      for (const mate of team) {
        if (!binding.others.includes(mate.name)) continue;
        const split = splitAgentRole(mate.description);
        const next = hireRole(split.role, appendOnce(split.roleDescription, others));
        if (next === mate.description) continue;
        updateAgent(mate.id, { description: next });
        void window.cth.hivePatchAgentRole(mate.id, next).catch(() => undefined);
      }
    }
    // A hire manifest may carry a per-agent token budget. Await it before
    // advancing a batch: the next hire reuses this mounted modal.
    if (hireMeta?.tokenCap) {
      try {
        const updated = await window.cth.setAgentTokenCap(id, hireMeta.tokenCap);
        onConfigChange?.(updated);
      } catch { /* best-effort */ }
    }
    setBusy(false);
    if (pendingHire) {
      advanceHireReview();
    } else {
      // The new hire opens on Capabilities: mailbox and schedules are not
      // copied from anyone, so that is the next thing to set (E4).
      setSidebarTab('capabilities');
      onClose();
    }
  };

  const stepIndex = STEPS.indexOf(step);
  const jobGroups = useMemo(() => {
    const byTitle = new Map<string, HireJob[]>();
    // This business's own card for the character's job is already their job
    // (or a teammate's copy of it) above, so it isn't listed again among the
    // other businesses' versions (owner, 2026-09-27).
    const ownBusinessCard = (j: HireJob) => !!config.businessType && j.sourceCard?.startsWith(`${config.businessType}/`) && inFamily(j) && !!family;
    for (const c of cards.filter((j) => (listAll || inFamily(j)) && !ownBusinessCard(j))) {
      const list = byTitle.get(c.title) ?? [];
      list.push(c);
      byTitle.set(c.title, list);
    }
    return [...byTitle.entries()];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, listAll, character, config.businessType]);

  return (
    // Must sit above focus mode and its file overlays (250/280).
    <Dialog
      title={tr('addAgent.title')}
      onClose={close}
      width={940}
      zIndex={500}
      footer={(
        <>
          {SHOW_IMPORT_HIRE && (
            <PixelButton
              variant="secondary"
              size="md"
              onClick={importHire}
              disabled={busy}
              title={tr('addAgent.importHireBtnTitle')}
            >
              {tr('addAgent.importHireBtn')}
            </PixelButton>
          )}
          <div style={{ flex: 1 }} />
          {pendingHire && (
            <PixelButton variant="secondary" size="md" onClick={skipHire} disabled={busy}>{tr('addAgent.skipHire')}</PixelButton>
          )}
          <PixelButton variant="ghost" size="md" onClick={close} disabled={busy || checking || writingInstructions}>{tr('common.cancel')}</PixelButton>
          {stepIndex > 0 && (
            <PixelButton variant="secondary" size="md" onClick={() => { void goTo(STEPS[stepIndex - 1]); }} disabled={busy}>{tr('addAgent.wizard.back')}</PixelButton>
          )}
          {step !== 'setup' ? (
            <PixelButton
              variant="primary"
              size="md"
              onClick={() => { void goTo(STEPS[stepIndex + 1]); }}
              disabled={(step === 'who' && !!whoError) || (step === 'role' && (checking || (overlapNames.length > 0 && !binding)))}
            >
              {step === 'role' && checking ? tr('addAgent.wizard.checking') : tr('addAgent.wizard.next')}
            </PixelButton>
          ) : (
            <PixelButton variant="primary" size="md" onClick={submit} disabled={busy || checking || suggesting || !workStyle.trim()}>
              {writingInstructions ? tr('addAgent.wizard.writingInstructions', { name: name.trim() }) : busy ? tr('addAgent.spawning') : checking ? tr('addAgent.wizard.checking') : tr('addAgent.spawn')}
            </PixelButton>
          )}
        </>
      )}
    >
        {hireMeta && (
          <div style={{
            padding: '8px 12px', borderRadius: 'var(--cth-r-md)', background: 'var(--cth-amber-soft)',
            boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 35%, transparent)', fontSize: 12.5, color: 'var(--cth-ink)',
            display: 'flex', flexDirection: 'column', gap: 2
          }}>
            <span>
              {tr('addAgent.hireImported')} <strong>{hireMeta.name}</strong>
              {hireMeta.author ? <> · {tr('addAgent.byAuthor', { author: hireMeta.author })}</> : null}
              {reviewProgress ? <> · {tr('addAgent.hireProgress', { current: reviewProgress.current, total: reviewProgress.total })}</> : null}
            </span>
            <span>{tr('addAgent.reviewFields')}</span>
            {hireMeta.commandFlags && hireMeta.commandFlags.length > 0 && (
              <span style={chipRow}>
                <span style={{ fontSize: 12 }}>{tr('addAgent.hireFlags')}</span>
                {hireMeta.commandFlags.map((f, i) => <code key={`${f}-${i}`} style={codeChip('paprika')}>{f}</code>)}
              </span>
            )}
            {hireMeta.skills && hireMeta.skills.some((s) => !RESEARCH_ONLY_SKILLS.includes(s)) && (
              <span style={chipRow}>
                <span style={{ fontSize: 12 }}>{tr('addAgent.hireSkills')}</span>
                {hireMeta.skills.filter((s) => !RESEARCH_ONLY_SKILLS.includes(s)).map((s) => <code key={s} style={codeChip('mint')}>{s}</code>)}
              </span>
            )}
            {hireMeta.mcpServers && hireMeta.mcpServers.length > 0 && (() => {
              const safe = hireMeta.mcpServers!.filter((mid) => MCP_CATALOG.find((e) => e.id === mid)?.tier === 'safe-readonly');
              const consent = hireMeta.mcpServers!.filter((mid) => MCP_CATALOG.find((e) => e.id === mid)?.tier !== 'safe-readonly');
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                  {safe.length > 0 && <span style={chipRow}><span style={{ fontSize: 12 }}>{tr('addAgent.mcpSafe')}:</span>{safe.map((mid) => <code key={mid} style={codeChip('sky')}>{mid}</code>)}</span>}
                  {consent.length > 0 && (
                    <span style={chipRow}>
                      <span style={{ fontSize: 12 }}>{tr('addAgent.mcpConsent')}:</span>
                      {consent.map((mid) => <code key={mid} style={codeChip('paprika')}>{mid}</code>)}
                      <span style={{ fontSize: 11.5, color: 'var(--cth-ink-2)' }}>{tr('addAgent.mcpEnableInSettings')}</span>
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Step bar: go back to any step; forward through Next. */}
        <nav aria-label={tr('addAgent.wizard.steps')} style={{ display: 'flex', gap: 8 }}>
          {STEPS.map((s, i) => {
            const active = s === step;
            return (
              <button
                key={s}
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={i > stepIndex}
                onClick={() => { void goTo(s); }}
                style={{
                  flex: 1, textAlign: 'start', padding: '8px 10px', border: 'none', borderRadius: 'var(--cth-r-lg)',
                  cursor: i > stepIndex ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                  background: active ? 'var(--cth-card)' : 'var(--cth-card-2)',
                  boxShadow: active ? 'inset 0 0 0 1.5px var(--cth-ink)' : 'inset 0 0 0 1px var(--cth-line)',
                  opacity: i > stepIndex ? 0.6 : 1, fontFamily: 'var(--cth-font-ui)'
                }}
              >
                <span aria-hidden="true" style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600,
                  background: i < stepIndex ? 'var(--cth-green)' : active ? 'var(--cth-ink)' : 'transparent',
                  color: i < stepIndex || active ? 'var(--cth-bg)' : 'var(--cth-ink-3)',
                  boxShadow: i < stepIndex || active ? 'none' : 'inset 0 0 0 1px var(--cth-line-2)'
                }}>{i < stepIndex ? '✓' : i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, lineHeight: '16px', color: 'var(--cth-ink)' }}>
                    {tr(`addAgent.wizard.step.${s}`)}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, lineHeight: '15px', color: 'var(--cth-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr(`addAgent.wizard.stepHint.${s}`)}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {step === 'who' && (
            <>
              <Row label={tr('addAgent.character')}>
                {/* Grouped by each character's job in the show (owner, 2026-09-27). */}
                <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 20, rowGap: 12, alignItems: 'flex-start' }}>
                  {/* Departments with someone free come first; those whose people are
                      all on the team move to the end (owner, 2026-10-03). */}
                  {freeGroupsFirst(CAST_GROUPS, onTeam).map((g) => (
                    <div key={g.key} role="group" aria-label={tr(`addAgent.castGroup.${g.key}`)} style={{ flex: '0 0 auto' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)', marginBottom: 6 }}>{tr(`addAgent.castGroup.${g.key}`)}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {g.members.map((m) => CAST_BY_NAME[m]).map((c) => onTeam.has(c.name) ? (
                          <div
                            key={c.name}
                            title={tr('addAgent.wizard.onTeam', { name: c.displayName })}
                            style={{
                              padding: '8px 4px 7px', borderRadius: 'var(--cth-r-lg)', background: 'var(--cth-card)',
                              boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'flex', flexDirection: 'column',
                              alignItems: 'center', gap: 3, width: 78, fontFamily: 'var(--cth-font-ui)'
                            }}
                          >
                            {/* Faded portrait, readable name: the name stays at ink-3, not
                                at 40% (ship review 2026-10-03: about 2.4:1 before). */}
                            <span style={{ opacity: 0.4, display: 'flex' }}><SpritePortrait character={c.name} scale={1.5} /></span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-3)' }}>{c.displayName}</span>
                            {c.name === 'michael' ? (
                              <span style={{ fontSize: 11, lineHeight: '13px', color: 'var(--cth-ink-3)' }}>{tr('addAgent.wizard.onTeamShort')}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => cloneFrom(c.name)}
                                disabled={!cloneCharacter(c.name, onTeam, castGroups)}
                                title={cloneCharacter(c.name, onTeam, castGroups) ? undefined : tr('addAgent.wizard.cloneNoneFree')}
                                aria-label={tr('addAgent.wizard.cloneAria', { name: c.displayName })}
                                style={{
                                  ...linkStyle, fontSize: 11, lineHeight: '13px',
                                  ...(cloneCharacter(c.name, onTeam, castGroups) ? {} : { color: 'var(--cth-ink-4)', textDecoration: 'none', cursor: 'default' })
                                }}
                              >{tr('addAgent.wizard.clone')}</button>
                            )}
                          </div>
                        ) : (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() => { setCharacter(c.name); setName(c.displayName); setJobKey(null); setCloneOf(null); }}
                            title={c.blurb}
                            aria-pressed={character === c.name}
                            style={{
                              padding: '8px 4px 7px', borderRadius: 'var(--cth-r-lg)',
                              background: character === c.name ? 'var(--cth-indigo-soft)' : 'var(--cth-card)',
                              boxShadow: character === c.name ? 'inset 0 0 0 1.5px var(--cth-indigo)' : 'inset 0 0 0 1px var(--cth-line)',
                              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                              border: 'none', width: 78, fontFamily: 'var(--cth-font-ui)'
                            }}
                          >
                            <SpritePortrait character={c.name} scale={1.5} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink)' }}>{c.displayName}</span>
                            {/* Groups club related jobs, so each tile names its own (owner, 2026-09-27). */}
                            <span style={{ fontSize: 11, lineHeight: '13px', color: 'var(--cth-ink-3)', textAlign: 'center' }}>{tr(`addAgent.castRole.${c.name}`)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Row>
              <Row label={tr('addAgent.name')}>
                <input
                  value={name}
                  onChange={(e) => {
                    const next = e.target.value;
                    setName(next);
                    const match = characterForName(next);
                    // A teammate's name never picks their greyed tile.
                    if (match && !onTeam.has(match)) { setCharacter(match); setJobKey(null); setCloneOf(null); }
                  }}
                  placeholder={tr('addAgent.namePlaceholder')}
                  className="cth-input" style={inputStyle}
                />
                {name.trim() && nameTaken(name) && <span role="alert" style={helperStyle}>{tr('addAgent.wizard.nameTaken', { name: name.trim() })}</span>}
                {cloneOf && <span style={helperStyle}>{tr('addAgent.wizard.cloning', { name: name.trim() || CAST_BY_NAME[character].displayName, mate: team.find((a) => a.id === cloneOf)?.name ?? '' })}</span>}
              </Row>
            </>
          )}

          {step === 'job' && (
            <div role="radiogroup" aria-label={tr('addAgent.wizard.step.job')} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '58vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
              {theirJob && (
                <JobGroup label={tr('addAgent.wizard.theirJob', { name: name.trim() || CAST_BY_NAME[character].displayName })}>
                  <JobRow job={theirJob} tag={theirJob.source === 'team' ? tr('addAgent.wizard.likeTeammate', { name: theirJob.fromName }) : theirJob.business} selected={chosenKey === theirJob.key} onPick={() => setJobKey(theirJob.key)} />
                </JobGroup>
              )}
              {familyJobs.length > 0 && (
                <JobGroup label={tr('addAgent.wizard.yourOffice')}>
                  {familyJobs.map((j) => (
                    <JobRow key={j.key} job={j} tag={j.fromName} selected={chosenKey === j.key} onPick={() => setJobKey(j.key)} />
                  ))}
                </JobGroup>
              )}
              <JobGroup label={tr('addAgent.wizard.newJob')}>
                <JobRow job={{ key: NEW_JOB_KEY, source: 'new', title: tr('addAgent.wizard.newJobTitle'), routing: '', workStyle: '', summary: tr('addAgent.wizard.newJobSummary') }} selected={chosenKey === NEW_JOB_KEY} onPick={() => setJobKey(NEW_JOB_KEY)} />
              </JobGroup>
              <JobGroup label={listAll ? tr('addAgent.wizard.allJobs') : tr('addAgent.wizard.familyJobs', { role: tr(`addAgent.castRole.${character}`) })}>
                {jobGroups.map(([jobTitle, list]) => (
                  <div key={jobTitle} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {list.filter((j) => j.key !== theirJob?.key).map((j) => (
                      <JobRow key={j.key} job={j} tag={j.business} selected={chosenKey === j.key} onPick={() => setJobKey(j.key)} />
                    ))}
                  </div>
                ))}
              </JobGroup>
              {family && hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    // Closing the list again drops a pick it no longer shows.
                    if (showAll && chosenJob && !inFamily(chosenJob) && chosenJob.key !== theirJob?.key) setJobKey(null);
                    setShowAll(!showAll);
                  }}
                  style={{ ...linkStyle, alignSelf: 'flex-start' }}
                >
                  {showAll
                    ? tr('addAgent.wizard.showFamily', { role: tr(`addAgent.castRole.${character}`) })
                    : tr('addAgent.wizard.showAll', { count: hiddenCount })}
                </button>
              )}
            </div>
          )}

          {step === 'role' && (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flexShrink: 0 }}>
                  <SpritePortrait character={character} scale={2} />
                </div>
                <div style={{ flex: 1 }}>
                  <Row label={tr('addAgent.name')}>
                    <input value={name} onChange={(e) => setName(e.target.value)} className="cth-input" style={inputStyle} />
                  </Row>
                </div>
                <div style={{ flex: 1 }}>
                  <Row label={tr('addAgent.role')}>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr('addAgent.rolePlaceholder')} className="cth-input" style={inputStyle} />
                  </Row>
                </div>
              </div>

              <Row label={tr('addAgent.wizard.whatToSend', { name: name.trim() })} info={tr('addAgent.roleHelp', { godName, name: name.trim() })}>
                <textarea
                  dir={rtl ? 'auto' : undefined}
                  value={routing}
                  onChange={(e) => { setRouting(e.target.value); setError(undefined); }}
                  placeholder={tr('addAgent.roleDescriptionPlaceholder')}
                  rows={3}
                  className="cth-input" style={{ ...inputStyle, fontFamily: 'var(--cth-font-ui)', resize: 'vertical' }}
                />
              </Row>

              <DistinctBox
                checking={checking}
                verdict={verdict ?? (binding ? shownVerdict : null)}
                overlapNames={binding ? [...new Set([...overlapNames, ...binding.others])] : overlapNames}
                binding={binding}
                name={name.trim()}
                team={team}
                onRecheck={() => { void runCheck(); }}
                bindMode={bindMode}
                setBindMode={setBindMode}
                freeMailboxes={freeMailboxes.map((m) => ({ id: m.id, address: m.address }))}
                bindMailbox={bindMailbox}
                setBindMailbox={setBindMailbox}
                topic={topic}
                setTopic={setTopic}
                onBindMailbox={() => { const a = mailboxAddress(bindMailbox); if (a) applyBinding(tr('addAgent.wizard.mailboxScope', { address: a }), bindMailbox); }}
                onBindTopic={() => applyBinding(topic)}
                bindConnectors={bindConnectors}
                bindConnector={bindConnector}
                setBindConnector={pickConnector}
                connectionScope={connectionScope}
                setConnectionScope={setConnectionScope}
                onBindConnection={() => { if (bindConnector && bindConnectors.some((c) => c.key === bindConnector && c.on)) applyBinding(connectionScope, undefined, bindConnector); }}
                onClearBinding={clearBinding}
              />
            </>
          )}

          {step === 'setup' && (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flexShrink: 0 }}>
                  <SpritePortrait character={character} scale={2} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--cth-ink)' }}>{name.trim()}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--cth-ink-3)' }}>{title.trim()}</div>
                </div>
              </div>

              <Row label={tr('addAgent.workStyle')} info={tr('addAgent.wizard.workStyleIntro', { name: name.trim(), godName })}>
                <textarea
                  dir={rtl ? 'auto' : undefined}
                  value={workStyle}
                  readOnly={suggesting}
                  aria-busy={suggesting}
                  onChange={(e) => { describeSeq.current++; setDescribing(false); setWorkStyle(e.target.value); }}
                  placeholder={tr('addAgent.wizard.workStylePlaceholder', { name: name.trim() })}
                  rows={7}
                  className="cth-input" style={{ ...inputStyle, fontFamily: 'var(--cth-font-ui)', resize: 'vertical' }}
                />
                {describing && <span aria-live="polite" style={helperStyle}>{tr('addAgent.wizard.describing')}</span>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {suggesting ? (
                    <>
                      <span aria-live="polite" style={helperStyle}>{tr('addAgent.wizard.suggesting', { name: name.trim() })}</span>
                      <PixelButton variant="secondary" size="sm" onClick={stopSuggest}>{tr('addAgent.wizard.suggestStop')}</PixelButton>
                    </>
                  ) : (
                    <PixelButton variant="secondary" size="sm" onClick={() => { void suggestWorkStyle(); }} disabled={busy || !routing.trim()}
                      title={!routing.trim() ? tr('addAgent.wizard.suggestNeedsHandles', { name: name.trim() || CAST_BY_NAME[character].displayName }) : undefined}>
                      {tr('addAgent.wizard.suggest')}
                    </PixelButton>
                  )}
                  {suggestFailed && <span role="alert" style={{ ...helperStyle, color: 'var(--cth-ink-2)' }}>{tr('addAgent.wizard.suggestFailed')}</span>}
                </div>
              </Row>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 380px', minWidth: 0 }}>
                  <Row label={tr('addAgent.wizard.folder')} info={tr('addAgent.wizard.folderPurpose', { name: name.trim(), godName })}>
                    {michaelFolder && !customCwd ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input value={folderName} onChange={(e) => setFolderName(e.target.value)} className="cth-input" style={{ ...inputStyle, flex: 1 }} aria-label={tr('addAgent.wizard.folder')} />
                        <PixelButton variant="secondary" size="md" onClick={pickFolder}>
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="folder" /> {tr('addAgent.pick')}</span>
                        </PixelButton>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input value={customCwd ?? ''} onChange={(e) => setCustomCwd(e.target.value)} className="cth-input" style={{ ...inputStyle, flex: 1, fontFamily: 'var(--cth-font-mono)', fontSize: 13 }} aria-label={tr('addAgent.wizard.folder')} />
                        <PixelButton variant="secondary" size="md" onClick={pickFolder}>
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="folder" /> {tr('addAgent.pick')}</span>
                        </PixelButton>
                        {michaelFolder && <button type="button" onClick={() => setCustomCwd(undefined)} style={linkStyle}>{tr('addAgent.wizard.folderDefault')}</button>}
                      </div>
                    )}
                    {michaelFolder && !customCwd && cwd && (
                      <span style={{ ...helperStyle, fontFamily: 'var(--cth-font-mono)', fontSize: 11, wordBreak: 'break-all' }}>{cwd}</span>
                    )}
                  </Row>
                </div>
                <div style={{ flex: '0 0 auto' }}>
                  <Row label={tr('addAgent.model')} info={tr('addAgent.wizard.modelPurpose', { name: name.trim() })}>
                    <Select
                      label={tr('addAgent.model')}
                      value={model ?? ''}
                      onChange={(v) => { setCommandEdit(undefined); setCustomModel(v && v !== defaultModel ? v : undefined); }}
                      style={{ fontSize: 14, lineHeight: '20px' }}
                    >
                      {!defaultModel && <option value="">{tr('addAgent.wizard.modelDefault', { model: tr('addAgent.wizard.cliDefault') })}</option>}
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id === defaultModel ? tr('addAgent.wizard.modelDefault', { model: m.label }) : m.label}
                        </option>
                      ))}
                    </Select>
                  </Row>
                </div>
              </div>

              {/* Engine, model list and the raw command: developer options,
                  hidden with SHOW_ENGINE_PICKER (owner, 2026-09-27). */}
              {SHOW_ENGINE_PICKER && <>
                <Row label={tr('addAgent.provider')}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {AGENT_PROVIDER_PRESETS
                      .filter((p) => BUILD_ENGINES.includes(p.id) || p.id === provider)
                      .map((p) => (
                        <button key={p.id} type="button" onClick={() => { setProvider(p.id); setCustomModel(undefined); setCommandEdit(undefined); }} style={{ ...chip(provider === p.id), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <ProviderLogo provider={p.id} size={14} />
                          {p.label}
                        </button>
                      ))}
                  </div>
                </Row>
                <Row label={tr('addAgent.command')}>
                  <input value={command} onChange={(e) => setCommandEdit(e.target.value)} className="cth-input" style={{ ...inputStyle, fontFamily: 'var(--cth-font-mono)' }} />
                </Row>
              </>}
            </>
          )}
        </div>

        {error && (
          <div role="alert" style={{ padding: '8px 12px', borderRadius: 'var(--cth-r-md)', background: 'var(--cth-coral-soft)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-coral) 35%, transparent)', fontSize: 12.5, color: 'var(--cth-coral-text)' }}>
            {error}
          </div>
        )}

        {/* Import-hire explainer + AI prompt generator; hidden with
            SHOW_IMPORT_HIRE (owner, 2026-09-27). */}
        {SHOW_IMPORT_HIRE && <div style={{
          padding: '10px 12px', borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)',
          display: 'flex', flexDirection: 'column', gap: 6
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--cth-ink-2)', lineHeight: '17px' }}>{tr('addAgent.importHireDesc')}</span>
            <button type="button" onClick={() => setShowHirePrompt((v) => !v)} style={{ ...chip(showHirePrompt), flexShrink: 0 }}>
              {showHirePrompt ? tr('addAgent.hideAIPrompt') : tr('addAgent.generateWithAI')}
            </button>
          </div>
          {showHirePrompt && (
            <textarea readOnly value={HIRE_PROMPT} onFocus={(e) => e.currentTarget.select()} rows={10}
              className="cth-input" style={{ ...inputStyle, width: '100%', fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px', resize: 'vertical' }} />
          )}
        </div>}

    </Dialog>
  );
}

function JobGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)', marginTop: 2 }}>{label}</div>
      {children}
    </div>
  );
}

function JobRow({ job, tag, selected, onPick }: { job: HireJob; tag?: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      style={{
        textAlign: 'start', border: 'none', cursor: 'pointer', padding: '9px 12px', borderRadius: 'var(--cth-r-lg)',
        background: selected ? 'var(--cth-indigo-soft)' : 'var(--cth-card)',
        boxShadow: selected ? 'inset 0 0 0 1.5px var(--cth-indigo)' : 'inset 0 0 0 1px var(--cth-line)',
        display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'var(--cth-font-ui)'
      }}
    >
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink)' }}>{job.title}</span>
        {tag && <span style={{ fontSize: 11.5, color: 'var(--cth-ink-3)' }}>{tag}</span>}
      </span>
      {job.summary && (
        <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {job.summary}
        </span>
      )}
    </button>
  );
}

/**
 * What the owner watches while the job check runs, which can take a while
 * (owner, 2026-09-27): each teammate's portrait takes a turn hopping as
 * "Comparing with Pam...", then the next. With reduced motion the line stays
 * put and says it is checking the team.
 */
function CheckingTeam({ team }: { team: Agent[] }) {
  const { t } = useTranslation();
  const [turn, setTurn] = useState(0);
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const shown = team.slice(0, 10);
  useEffect(() => {
    if (still || shown.length === 0) return;
    const timer = setInterval(() => setTurn((n) => n + 1), 900);
    return () => clearInterval(timer);
  }, [still, shown.length]);
  const current = shown.length ? shown[turn % shown.length] : undefined;
  const dots = '.'.repeat((turn % 3) + 1);
  return (
    <div aria-live="polite" aria-busy="true" style={{ ...box, background: 'var(--cth-card-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {shown.length > 0 && (
        <div aria-hidden="true" style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {shown.map((m, i) => {
            const on = !still && i === turn % shown.length;
            return (
              <span
                key={m.id}
                style={{
                  display: 'inline-flex', borderRadius: '50%',
                  boxShadow: on ? '0 0 0 2px var(--cth-indigo)' : 'none',
                  opacity: on || still ? 1 : 0.45,
                  animation: on ? 'cth-hop 0.9s ease-in-out infinite' : undefined
                }}
              >
                <SpritePortrait character={m.character} scale={1} />
              </span>
            );
          })}
        </div>
      )}
      <span>
        {current && !still
          ? `${t('addAgent.wizard.comparingWith', { name: current.name })}${dots}`
          : t('addAgent.wizard.checkingTeam')}
      </span>
    </div>
  );
}

interface DistinctBoxProps {
  checking: boolean;
  verdict: DistinctVerdict | null;
  overlapNames: string[];
  binding: Binding | null;
  name: string;
  team: Agent[];
  onRecheck: () => void;
  bindMode: 'mailbox' | 'topic' | 'connection' | null;
  setBindMode: (m: 'mailbox' | 'topic' | 'connection' | null) => void;
  freeMailboxes: Array<{ id: string; address: string }>;
  bindMailbox: string;
  setBindMailbox: (id: string) => void;
  topic: string;
  setTopic: (t: string) => void;
  onBindMailbox: () => void;
  onBindTopic: () => void;
  /** Every connector on the Claude account; only those switched on can be bound. */
  bindConnectors: Array<{ key: string; on: boolean; signIn: boolean }>;
  bindConnector: string;
  setBindConnector: (key: string) => void;
  connectionScope: string;
  setConnectionScope: (s: string) => void;
  onBindConnection: () => void;
  onClearBinding: () => void;
}

/** The distinct job check's result on Review (D6): checking, distinct, or the
 *  overlap with the ways to make the job particular. */
function DistinctBox(p: DistinctBoxProps) {
  const { t } = useTranslation();
  const listJoin = t('profile.listJoiner');
  if (p.checking) return <CheckingTeam team={p.team} />;
  if (!p.verdict && p.overlapNames.length === 0) {
    return (
      <div aria-live="polite" style={{ ...box, background: 'var(--cth-card-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{t('addAgent.wizard.notChecked')}</span>
        <button type="button" onClick={p.onRecheck} style={linkStyle}>{t('addAgent.wizard.checkNow')}</button>
      </div>
    );
  }
  const fallback = p.verdict?.source === 'rules' ? <div style={helperStyle}>{t('addAgent.wizard.fullCheckFailed')}</div> : null;
  if (p.overlapNames.length === 0) {
    return (
      <div aria-live="polite" style={{ ...box, background: 'var(--cth-green-soft)' }}>
        {t('addAgent.wizard.distinct')}
        {fallback}
      </div>
    );
  }
  const others = p.binding ? bindingLines(p.binding.scope, p.name).others : '';
  return (
    <div aria-live="polite" style={{ ...box, background: p.binding ? 'var(--cth-green-soft)' : 'var(--cth-amber-soft)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* A binding resolves the overlap, so the heading says so instead of
          repeating the problem (owner, 2026-09-27). */}
      <strong style={{ fontSize: 13 }}>
        {p.binding
          ? t('addAgent.wizard.resolved', { name: p.name, names: p.overlapNames.join(listJoin) })
          : t('addAgent.wizard.overlaps', { names: p.overlapNames.join(listJoin) })}
      </strong>
      {!p.binding && <span>{p.verdict?.why || t('addAgent.wizard.sameWork', { name: p.name })}</span>}
      {p.binding ? (
        <>
          <span>{t('addAgent.wizard.boundTo', { name: p.name, scope: p.binding.scope })}</span>
          {p.binding.connectorKey && <span>{t(isQuickBooksKey(p.binding.connectorKey) ? 'addAgent.wizard.boundConnectionReadOnly' : 'addAgent.wizard.boundConnection', { name: p.name, connector: p.binding.connectorKey })}</span>}
          {p.team.filter((m) => p.binding!.others.includes(m.name)).map((m) => (
            <span key={m.id} style={helperStyle}>{t('addAgent.wizard.otherLine', { name: m.name, line: others })}</span>
          ))}
          <button type="button" onClick={p.onClearBinding} style={{ ...linkStyle, alignSelf: 'flex-start' }}>{t('addAgent.wizard.unbind')}</button>
        </>
      ) : (
        <>
          <span>{t('addAgent.wizard.makeParticular', { name: p.name })}</span>
          {p.verdict?.suggestion && <span style={helperStyle}>{t('addAgent.wizard.suggestion', { text: p.verdict.suggestion })}</span>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SHOW_MAILBOXES && <button type="button" onClick={() => p.setBindMode('mailbox')} style={chip(p.bindMode === 'mailbox', p.freeMailboxes.length === 0)} disabled={p.freeMailboxes.length === 0} title={p.freeMailboxes.length === 0 ? t('addAgent.wizard.noFreeMailbox') : undefined}>{t('addAgent.wizard.bindMailbox')}</button>}
            <button type="button" onClick={() => p.setBindMode('topic')} style={chip(p.bindMode === 'topic')}>{t('addAgent.wizard.bindTopic')}</button>
            <button type="button" onClick={() => p.setBindMode('connection')} style={chip(p.bindMode === 'connection', p.bindConnectors.length === 0)} disabled={p.bindConnectors.length === 0} title={p.bindConnectors.length === 0 ? t('addAgent.wizard.noConnection') : undefined}>{t('addAgent.wizard.bindConnection')}</button>
            <button type="button" onClick={p.onRecheck} style={chip(false)}>{t('addAgent.wizard.checkAgain')}</button>
          </div>
          {SHOW_MAILBOXES && p.bindMode === 'mailbox' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={p.bindMailbox} onChange={(e) => p.setBindMailbox(e.target.value)} aria-label={t('addAgent.wizard.bindMailbox')} className="cth-input" style={{ ...inputStyle, width: 'auto' }}>
                <option value="">{t('capabilities.pickMailbox')}</option>
                {p.freeMailboxes.map((m) => <option key={m.id} value={m.id}>{m.address}</option>)}
              </select>
              <PixelButton variant="secondary" size="sm" onClick={p.onBindMailbox} disabled={!p.bindMailbox}>{t('addAgent.wizard.bind')}</PixelButton>
            </div>
          )}
          {p.bindMode === 'connection' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={p.bindConnector} onChange={(e) => p.setBindConnector(e.target.value)} aria-label={t('addAgent.wizard.bindConnection')} className="cth-input" style={{ ...inputStyle, width: 'auto' }}>
                <option value="">{t('addAgent.wizard.pickConnection')}</option>
                {p.bindConnectors.map((c) => (
                  <option key={c.key} value={c.key} disabled={!c.on}>
                    {!c.on ? t('addAgent.wizard.connectionOff', { name: c.key }) : c.signIn ? t('addAgent.wizard.connectionSignIn', { name: c.key }) : c.key}
                  </option>
                ))}
              </select>
              {p.bindConnector && <input value={p.connectionScope} maxLength={TOPIC_MAX} onChange={(e) => p.setConnectionScope(e.target.value)} aria-label={t('addAgent.wizard.connectionScopeLabel', { name: p.name })} placeholder={t('addAgent.wizard.connectionScopeLabel', { name: p.name })} className="cth-input" style={{ ...inputStyle, flex: 1 }} />}
              <PixelButton variant="secondary" size="sm" onClick={p.onBindConnection} disabled={!p.bindConnector || !p.connectionScope.trim()}>{t('addAgent.wizard.bind')}</PixelButton>
            </div>
          )}
          {p.bindMode === 'topic' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={p.topic} maxLength={TOPIC_MAX} onChange={(e) => p.setTopic(e.target.value)} placeholder={t('addAgent.wizard.topicPlaceholder')} aria-label={t('addAgent.wizard.bindTopic')} className="cth-input" style={{ ...inputStyle, flex: 1 }} />
              <PixelButton variant="secondary" size="sm" onClick={p.onBindTopic} disabled={!p.topic.trim()}>{t('addAgent.wizard.bind')}</PixelButton>
            </div>
          )}
          <span style={helperStyle}>{t('addAgent.wizard.editToFix', { name: p.name })}</span>
        </>
      )}
      {fallback}
    </div>
  );
}

const chip = (active: boolean, disabled = false): CSSProperties => ({
  height: 28, padding: '0 11px', borderRadius: 999,
  background: active ? 'var(--cth-indigo-soft)' : 'var(--cth-card)',
  boxShadow: active ? 'inset 0 0 0 1.5px var(--cth-indigo)' : 'inset 0 0 0 1px var(--cth-line-2)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, fontWeight: active ? 600 : 500,
  color: disabled ? 'var(--cth-ink-4)' : 'var(--cth-ink)', cursor: disabled ? 'default' : 'pointer', border: 'none'
});
const chipRow: CSSProperties = { display: 'flex', gap: 4, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 };
const TONE = { paprika: 'coral', mint: 'green', sky: 'blue' } as const;
const codeChip = (tone: 'paprika' | 'mint' | 'sky'): CSSProperties => ({
  fontFamily: 'var(--cth-font-mono)', fontSize: 11.5, padding: '1px 6px', borderRadius: 'var(--cth-r-sm)',
  background: `var(--cth-${TONE[tone]}-soft)`, color: `var(--cth-${TONE[tone]}-text)`
});
const box: CSSProperties = { padding: '10px 12px', borderRadius: 'var(--cth-r-md)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink)' };
const linkStyle: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--cth-indigo-text)', textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--cth-font-ui)' };

/** A plain note under a field: what it is for, in the owner's words. */
const helperStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-3)'
};

/** A v2 input (DESIGN.md 7.19); the ring and radius come from .cth-input. */
const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 34,
  padding: '7px 10px',
  background: 'var(--cth-card)',
  border: 'none',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 13,
  color: 'var(--cth-ink)',
  outline: 'none',
  boxSizing: 'border-box'
};

/** A field with its label; `info` puts the explanation behind an info icon
 *  beside the label instead of text on the screen (owner, 2026-09-27). */
function Row({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)' }}>{label}</span>
        {info && <InfoTip text={info} label={label} />}
      </span>
      {children}
    </label>
  );
}
