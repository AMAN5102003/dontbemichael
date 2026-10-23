import { RESEARCH_ID } from '../../../shared/research';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FIRST_TASK_EDITED_MAX } from '@shared/firstTask';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { InfoTip } from './InfoTip';
import { Disclosure } from './triggers/ui';
import { Dialog } from '@/shell/Dialog';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useStore, type Agent } from '@/store/store';
import {
  type AgentProvider,
  type HarnessConfig,
  AGENT_PROVIDER_PRESETS,
  buildSpawnCommand,
  modelsForProvider,
  inferAgentProvider,
  providerPreset,
  isClaudeProvider
} from '@/store/config';
import { BUILD_ENGINES } from '@shared/agentProvider';
import { splitAgentRole, joinAgentRole } from '@shared/agentRole';
import { roleLabel, plainFallback } from '@shared/workStyleText';
import { applyJob, jobBase, jobFingerprint, plainFor, undoJob } from '@shared/jobChange';
import { JobChangeReview, type ReviseOk, type ReviseRun } from './JobChangeReview';
import { Field, JobParts, Panel as SoftPanel, fieldLabel, jobPartsFold, readBody } from './fieldText';
import { effectiveWorkStyle } from '@shared/michaelWorkStyle';
import { ScheduledJobsList } from './ScheduledJobs';
import { sendTypedFirstTask } from '@/shell/typedFirstTask';
import { useResearchName } from '@/shell/research';
import { canDeleteTeamMember, deleteTeamMember } from '@/shell/deleteTeamMember';
import { releaseBindingsOf } from '@/shell/releaseBindings';
import { disposeTerminal } from './terminalPool';
import { deleteConfirmText } from './triggers/ScheduleList';
import { WideButton } from '@/shell/PanelChrome';
import { PersonAvatar } from '@/scene/office/props';
import { roleOf } from '@/scene/studio/layout';
import { answerLeave, setLeaveGuard } from '@/store/leaveGuard';

export interface EditAgentModalProps {
  agent: Agent;
  onClose: () => void;
  /** False from the fullscreen view: no panel to lay over, so no wide mode
   *  and no panel changes to hold. */
  docked?: boolean;
  /** Open with the engine unfolded (Change engine on a not reporting card). */
  engineOpen?: boolean;
}

/**
 * Edit what can change on someone already hired (docs/designs/edit-agent.md):
 * name, role, job and engine, in one column. The job is read only: the owner
 * says what should change and Apply saves the rewrite
 * (docs/designs/work-style-change-request.md). The character and its
 * color are chosen once, in the hire wizard: picking another here turned Pam
 * into a second Michael, and the color drew almost nowhere (owner,
 * 2026-10-02). Save patches the name, role title and engine via updateAgent;
 * engine changes apply on the next restart. Under the engine, a Danger zone deletes the team
 * member for good (owner, 2026-10-14). Opened wide (wide panel WD1 to WD4) it
 * lays over the wide panel in two columns, and leaving with unsaved changes,
 * by any way out, asks first.
 */
export function EditAgentModal({ agent, onClose, docked = true, engineOpen: openEngine = false }: EditAgentModalProps) {
  const { t, i18n } = useTranslation();
  const researchName = useResearchName();
  const updateAgent = useStore((s) => s.updateAgent);
  const godName = useResolvedGodName();
  const renameAgent = useStore((s) => s.renameAgent);
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  // Opened over a panel in the right column it can go wide; opened from the
  // fullscreen view there is no panel, so it keeps today's box.
  const [inColumn] = useState(() => docked && !!panelBehind());
  const panelWide = useStore((s) => s.panelWide);
  const wide = inColumn && panelWide;
  // "Discard changes?": 'close' from this dialog's own ways out, 'leave' when
  // a change of panel waits on the answer (leaveGuard.ts).
  const [asking, setAsking] = useState<'close' | 'leave' | null>(null);

  // The member as saved now: Apply and Undo write it while the dialog is open.
  const live = useStore((s) => s.agents.find((a) => a.id === agent.id)) ?? agent;
  const lead = !!(agent.isGod || agent.isAssistant);
  const [name, setName] = useState(agent.name);
  const isResearch = agent.id === RESEARCH_ID;
  const [provider, setProvider] = useState<AgentProvider>(
    inferAgentProvider(agent.command, agent.provider)
  );
  // On Claude, Research's engine is fixed; on anything else only Claude is offered.
  // Judged on the saved engine, so picking Claude for a Research on an old
  // engine never locks the list under the owner's hand before Save.
  const researchLocked = isResearch && isClaudeProvider(inferAgentProvider(agent.command, agent.provider))
    && AGENT_PROVIDER_PRESETS.filter((p) => BUILD_ENGINES.includes(p.id) && isClaudeProvider(p.id)).length <= 1;
  const [model, setModel] = useState<string | undefined>(agent.model);
  // Folded by default: the engine rarely changes after hiring.
  const [engineOpen, setEngineOpen] = useState(openEngine);
  // The stored role is one string ("Finance: Keeps track of..."): the title is
  // the owner's typed field; "What X handles" changes only through "What
  // should change?" (work-style-change-request.md, D6 and OV2).
  const [role, setRole] = useState(() => splitAgentRole(agent.description).role);
  const saved = splitAgentRole(live.description);
  // The job is read only, in the plain words saved with it (eng D5). Words
  // that no longer describe the instructions (another writer changed them)
  // show the quick rewrite at once and are written again once, here.
  // Michael starts from his default Work style (schedule-focus-areas.md F6).
  const instructions = effectiveWorkStyle(live);
  const savedPlain = plainFor(live, instructions);
  const [quickPlain, setQuickPlain] = useState<{ of: string; text: string } | null>(null);
  const [describing, setDescribing] = useState(false);
  const plain = savedPlain ?? (quickPlain?.of === jobFingerprint(instructions) ? quickPlain.text : plainFallback(instructions, roleLabel(saved.role)));
  useEffect(() => {
    if (savedPlain || !instructions.trim()) return;
    const of = jobFingerprint(instructions);
    let gone = false;
    setDescribing(true);
    window.cth.workStyleConvert({ to: 'plain', text: instructions, ctx: { name: live.name, title: saved.role || undefined, manager: godName } })
      .then((res) => {
        if (gone || res.source !== 'ai' || !res.text) return;
        setQuickPlain({ of, text: res.text });
        // Saved only while they still describe the instructions.
        const now = useStore.getState().agents.find((a) => a.id === agent.id);
        if (now && jobFingerprint(effectiveWorkStyle(now)) === of) updateAgent(agent.id, { goalPlain: { text: res.text, of } });
      })
      .catch(() => { /* the quick rewrite stays */ })
      .finally(() => { if (!gone) setDescribing(false); });
    return () => { gone = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, savedPlain ? '' : jobFingerprint(instructions)]);
  const [showAll, setShowAll] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [draft, setDraft] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    void window.cth.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Keep form in sync when the selected agent changes while the modal is open.
  useEffect(() => {
    setName(agent.name);
    setProvider(inferAgentProvider(agent.command, agent.provider));
    setModel(agent.model);
    setRole(splitAgentRole(agent.description).role);
    setStatus(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const pickProvider = (id: AgentProvider) => {
    setProvider(id);
    if (!config) {
      setModel(undefined);
      return;
    }
    const nextModel = isClaudeProvider(id) ? config.defaultModel : config.providerDefaultModels?.[id];
    setModel(nextModel);
  };

  const preset = providerPreset(provider);
  const business = { name: config?.businessName, city: config?.businessCity };
  const current = () => useStore.getState().agents.find((a) => a.id === agent.id) ?? live;

  /** "What should change?": main rewrites the job from this one change. */
  const runChange = ({ typed, extras, answer, requestId }: ReviseRun) => {
    const cur = current();
    const split = splitAgentRole(cur.description);
    return window.cth.workStyleRevise({
      requestId,
      ctx: { name: cur.name, title: split.role || undefined, business, manager: godName },
      current: { instructions: effectiveWorkStyle(cur), handles: lead ? '' : split.roleDescription },
      changes: [typed, ...extras],
      answer,
      lead
    });
  };
  /** New duties are checked against every teammate's, as a hire is (D6). */
  const checkOverlap = async (ok: ReviseOk): Promise<{ names: string[]; why: string } | null> => {
    const cur = current();
    const mailboxes = config?.mailboxes ?? [];
    const team = useStore.getState().agents
      .filter((a) => a.id !== agent.id && !a.isGod && !a.isAssistant)
      .map((a) => {
        const split = splitAgentRole(a.description);
        const email = config?.agentCapabilities?.[a.id]?.email;
        return { name: a.name, title: split.role, routing: split.roleDescription, workStyle: a.goal, mailbox: email?.enabled ? mailboxes.find((m) => m.id === email.mailboxes[0])?.address : undefined };
      });
    if (!team.length || !ok.handles) return null;
    const v = await window.cth.hireCheckDistinct({ name: cur.name, title: splitAgentRole(cur.description).role, routing: ok.handles, workStyle: ok.instructions }, team);
    return v.overlapsWith.length ? { names: v.overlapsWith, why: v.why } : null;
  };
  /** Apply saves the job at once (DR3): the instructions, the plain words,
   *  "What X handles" and Michael's routing line, the change kept for Undo and
   *  a pack's next default. Refused when the job moved since the run began (A3). */
  const applyChange = async (ok: ReviseOk, change: string, from: string): Promise<'applied' | 'moved' | 'failed'> => {
    const cur = current();
    if (jobBase(cur) !== from) return 'moved';
    const title = splitAgentRole(cur.description).role;
    const patch = applyJob(cur, ok, { title, change, now: new Date().toISOString() });
    // Michael routes work by the role in the office registry: it goes first,
    // and nothing saves if it can't (as a pack update does).
    if (patch.description !== cur.description) {
      const r = await window.cth.hivePatchAgentRole(agent.id, patch.description).catch(() => null);
      if (!r?.ok) return 'failed';
    }
    updateAgent(agent.id, patch);
    // One-time work is a card for Michael, never part of the job (finding 4).
    if (ok.oneTimeTask && !agent.isGod) {
      void sendTypedFirstTask(cur.sourceCard, agent.id, cur.name, { ask: ok.oneTimeTask.slice(0, FIRST_TASK_EDITED_MAX), role: title, existing: true });
    }
    setStatus(t('jobChange.applied', { name: cur.name }));
    return 'applied';
  };
  /** Undo: the job before the last change, at once, routing line too (DR7). */
  const undoChange = async (): Promise<void> => {
    const cur = current();
    const patch = undoJob(cur);
    if (!patch) return;
    if (patch.description !== cur.description) {
      const r = await window.cth.hivePatchAgentRole(agent.id, patch.description).catch(() => null);
      if (!r?.ok) { setStatus(t('jobChange.undoFailed')); return; }
    }
    updateAgent(agent.id, patch);
    setStatus(t('jobChange.undone', { name: cur.name }));
    setFocusKey((k) => k + 1);
  };

  // Save is for what is typed here: the name, the role title and the engine.
  // The job saves through Apply.
  const save = async () => {
    if (saving) return;
    const trimmedName = name.trim() || agent.name;
    // A new name goes through the office registry first, the rename Michael
    // and the team read names from. If it's refused (say, the name is taken),
    // the dialog stays open and nothing is saved (owner, 2026-09-25).
    if (trimmedName !== agent.name) {
      setSaving(true);
      const renamed = await renameAgent(agent.id, trimmedName);
      setSaving(false);
      if (!renamed.ok) { setNameError(renamed.error ?? t('editAgent.errRename')); return; }
    }
    setNameError(undefined);
    const cur = current();
    // A cleared title keeps the role it had, rather than saving a blank.
    const trimmedDescription = joinAgentRole(role, splitAgentRole(cur.description).roleDescription) || cur.description;
    const command = config
      ? buildSpawnCommand(config, model, provider)
      : agent.command;

    updateAgent(agent.id, {
      provider,
      model,
      command,
      description: trimmedDescription
    });
    // Michael routes work by the role in the office registry. Update it now, so
    // he sees the change on his next message instead of after a restart.
    if (trimmedDescription !== cur.description) {
      void window.cth.hivePatchAgentRole(agent.id, trimmedDescription).catch(() => undefined);
    }
    // A new engine for a member that isn't reporting starts it on that engine
    // now (issue #326, Change engine); main ignores members with no episode.
    if (command !== agent.command) void window.cth.silentRestart?.([agent.id]);
    onClose();
  };

  // Deleting is final (owner, 2026-10-14): one confirm, then they are gone.
  const remove = async () => {
    if (deleting || saving || changing) return;
    if (!confirm(deleteConfirmText(agent.id, agent.name, t))) return;
    setDeleting(true);
    const st = useStore.getState();
    await deleteTeamMember(agent, {
      closeByOwner: (id) => window.cth.closeAgentByOwner(id),
      releaseBindings: releaseBindingsOf,
      killPty: (ptyId) => window.cth.killPty(ptyId),
      disposeTerminal,
      archiveInRegistry: (id) => window.cth.hiveSetArchived(id, true),
      settleWork: (id) => window.cth.memberDeleted(id),
      forget: (id) => { st.archiveAgent(id); st.removeArchivedAgent(id); st.removeRestorableAgent(id); }
    });
    setDeleting(false);
    onClose();
  };

  // The footer is Close until a typed field changes (DR3).
  const edited = name !== agent.name || role !== splitAgentRole(agent.description).role
    || provider !== inferAgentProvider(agent.command, agent.provider) || model !== agent.model;
  const dirty = edited || draft;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // A change of panel that would take this one away waits while there are
  // unsaved changes (the Needs you pill or strip, another person, a menu item).
  useEffect(() => {
    if (!inColumn) return;
    return setLeaveGuard({
      holds: (next) => dirtyRef.current && (next.rightColumn !== 'person' || next.selectedId !== agent.id),
      ask: () => setAsking('leave')
    });
  }, [inColumn, agent.id]);
  const requestClose = (): void => { if (dirtyRef.current) setAsking('close'); else onClose(); };
  // Where to go once the dialog has closed: the Access tab's On a schedule.
  const afterClose = useRef<(() => void) | null>(null);
  const goToSchedules = (): void => {
    const go = (): void => {
      if (!docked) useStore.getState().setFullscreen(null);
      useStore.getState().openSchedules(agent.id);
    };
    if (dirtyRef.current) { afterClose.current = go; setAsking('close'); return; }
    onClose();
    go();
  };
  const keepEditing = (): void => { afterClose.current = null; if (asking === 'leave') answerLeave(false); setAsking(null); };
  const discard = (): void => {
    const leaving = asking === 'leave';
    const after = afterClose.current;
    afterClose.current = null;
    setAsking(null);
    onClose();
    if (leaving) answerLeave(true);
    after?.();
  };

  const who = name.trim() || agent.name;
  // What the folded Engine line shows: the provider, and the model when it has one.
  const providerLabel = AGENT_PROVIDER_PRESETS.find((p) => p.id === provider)?.label ?? provider;
  const modelLabel = preset.supportsModel && model ? (modelsForProvider(provider).find((m) => m.id === model)?.label ?? model) : '';
  const busy = saving || deleting;
  const lastChange = live.jobChanges?.[live.jobChanges.length - 1];

  const nameRow = (
    // The owner names the Research member (owner, ship 2 D17); whatever its
    // name, the app knows it as Research, the one on the internet.
    <Row label={t('editAgent.name')} info={isResearch ? t('editAgent.researchName', { name: researchName }) : undefined}>
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); setNameError(undefined); }}
        placeholder={t('editAgent.namePlaceholder')}
        aria-invalid={nameError ? true : undefined}
        className="cth-input"
        dir="auto"
        style={nameError ? { ...inputStyle, boxShadow: 'inset 0 0 0 1.5px var(--cth-coral)' } : inputStyle}
        autoFocus
      />
      {nameError && (
        <span role="alert" style={{ ...helperStyle, color: 'var(--cth-coral-text)' }}>{nameError}</span>
      )}
    </Row>
  );
  const roleRow = (
    <Row label={t('editAgent.role')}>
      <input
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder={t('editAgent.rolePlaceholder')}
        className="cth-input"
        dir="auto"
        style={inputStyle}
      />
    </Row>
  );
  // Michael and his assistant have no "What X handles" (finding 5).
  const handlesRow = !lead && (
    <ReadRow label={t('editAgent.handles', { name: who })} info={t('editAgent.handlesInfo', { manager: godName, name: who })}>
      <div dir="auto" style={readBody(wide)}>{saved.roleDescription || t('jobChange.noWorkStyle', { name: who })}</div>
    </ReadRow>
  );
  const changeRow = (
    <JobChangeReview
      who={who}
      lead={lead}
      box={{ label: t('jobChange.whatChange'), info: t('jobChange.whatChangeInfo', { name: who }), placeholder: t('jobChange.whatChangePlaceholder'), button: t('jobChange.see') }}
      run={runChange}
      checkOverlap={lead ? undefined : checkOverlap}
      base={() => jobBase(current())}
      apply={applyChange}
      applyLabel={t('jobChange.apply')}
      status={status}
      focusKey={focusKey}
      onDraft={setDraft}
      onBusy={(b) => { setChanging(b); if (b) setStatus(null); }}
      sendsTask={!agent.isGod}
    />
  );
  // In its parts, folded to the first (H4), with Undo and the last change
  // under it; the change box sits below it, after the job is read (owner,
  // 2026-10-23).
  const long = jobPartsFold(plain);
  const workStyleRow = (
    <ReadRow label={t('jobChange.howWorks', { name: who })} info={t('jobChange.howWorksInfo', { name: who })}>
      {plain.trim() ? (
        <JobParts plain={plain} wide={wide} folded={!showAll} />
      ) : (
        <span style={helperStyle}>{t('jobChange.noWorkStyle', { name: who })}</span>
      )}
      {describing && <span aria-live="polite" style={helperStyle}>{t('jobChange.describing')}</span>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {long && <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} style={linkStyle}>{showAll ? t('jobChange.showLess') : t('jobChange.showAll')}</button>}
        {live.jobPrevious && <button type="button" onClick={() => { void undoChange(); }} disabled={changing} style={linkStyle}>{t('jobChange.undo')}</button>}
      </div>
      {lastChange && (
        <span style={helperStyle}>{t('jobChange.lastChange', { date: new Date(lastChange.at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }), text: lastChange.text })}</span>
      )}
    </ReadRow>
  );
  // Scheduled jobs are their own group, apart from the duties
  // (edit-agent-scheduled-jobs.md, SJ2); "Change on Access" closes this
  // dialog first, asking when something is unsaved (SJ3).
  const schedules = <ScheduledJobsList agentId={agent.id} name={who} onChange={goToSchedules} />;
  const engine = (
    <>
      {/* The engine rarely changes: one folded line naming it, closed by default. */}
      <button
        type="button"
        aria-expanded={engineOpen}
        aria-controls={engineOpen ? 'edit-agent-engine' : undefined}
        onClick={() => setEngineOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', border: 'none', background: 'transparent',
          cursor: 'pointer', fontFamily: 'var(--cth-font-ui)', textAlign: 'start'
        }}
      >
        <Disclosure open={engineOpen} />
        <span style={fieldLabel}>{t('editAgent.engine')}</span>
        {!engineOpen && (
          <span style={{ fontSize: 12, color: 'var(--cth-ink-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {modelLabel ? `${providerLabel}, ${modelLabel}` : providerLabel}
          </span>
        )}
      </button>
      {engineOpen && (
      <Fields id="engine">
        {/* Research's walls are Claude Code's, so its engine is locked
            (ship review D6.2). */}
        <Row label={t('editAgent.provider')} info={isResearch ? t('editAgent.researchEngine', { name: researchName }) : undefined}>
          {/* A list, not a grid of buttons. Only the engines this build
              offers (BUILD_ENGINES, like setup), plus the agent's own if it
              runs on another, so a list never hides what it is on. */}
          {researchLocked ? (
            // Nothing to choose: the engine as plain text, with its reason
            // behind the info icon.
            <input readOnly value={providerLabel} aria-label={t('editAgent.provider')} style={lockedValueStyle} />
          ) : (
          <select
            value={provider}
            onChange={(e) => pickProvider(e.target.value as AgentProvider)}
            aria-label={t('editAgent.provider')}
            className="cth-input"
            style={inputStyle}
          >
            {AGENT_PROVIDER_PRESETS
              .filter((p) => (BUILD_ENGINES.includes(p.id) && (!isResearch || isClaudeProvider(p.id))) || p.id === provider)
              .map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          )}
        </Row>

        {preset.supportsModel && (
          <Row label={t('editAgent.model')}>
            <select
              value={model ?? ''}
              onChange={(e) => setModel(e.target.value || undefined)}
              className="cth-input"
              style={inputStyle}
            >
              {/* Always list the current model: a <select> whose value
                  matches no option shows its first row while the saved
                  model stays the other one. */}
              {(() => {
                const known = modelsForProvider(provider);
                return model && !known.some((m) => m.id === model)
                  ? [...known, { id: model, label: t('editAgent.modelCurrent', { model }) }]
                  : known;
              })().map((m) => <option key={m.id ?? m.label} value={m.id ?? ''}>{m.label}</option>)}
            </select>
          </Row>
        )}

        <span style={helperStyle}>
          {t('editAgent.engineNote')}
        </span>
      </Fields>
      )}
    </>
  );
  const danger = canDeleteTeamMember(agent) && (
    // Danger zone, under the engine (owner, 2026-10-14): delete for good.
    <div
      id="edit-agent-danger"
      data-fields="danger"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 'var(--cth-r-xl)',
        // The Settings Danger zone's ring (DESIGN.md 6.3).
        boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--cth-coral-base) 55%, transparent)', background: 'var(--cth-coral-soft)'
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-coral-text)' }}>{t('editAgent.danger')}</span>
        <InfoTip text={t('editAgent.deleteInfo', { name: agent.name })} label={t('editAgent.danger')} />
      </span>
      <PixelButton variant="destructive" size="md" onClick={() => { void remove(); }} disabled={busy}>
        {deleting ? t('editAgent.deleting') : t('editAgent.delete', { name: agent.name })}
      </PixelButton>
    </div>
  );

  return (
    <>
    <Dialog
      // Wide, the title says who (WD3): their avatar, "Edit {name}", the role.
      title={wide ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <PersonAvatar who={agent} size={28} />
          <span style={{ fontSize: 15, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('editAgent.titleWide', { name: agent.name })}</span>
          <span style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, color: 'var(--cth-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roleOf(agent)}</span>
        </span>
      ) : t('editAgent.title')}
      label={wide ? t('editAgent.titleWide', { name: agent.name }) : undefined}
      onClose={requestClose}
      busy={busy}
      width={640}
      fill
      align="end"
      over={docked ? panelBehind : undefined}
      zIndex={500}
      // Wide, the office is already dimmed under the top bar, and a click on
      // the margins does nothing (WD4, WD8).
      below={wide}
      dim={!wide}
      actions={inColumn ? <WideButton disabled={busy} size={30} /> : undefined}
      footer={edited ? (
        <>
          <PixelButton variant="ghost" size="md" onClick={requestClose}>{t('editAgent.cancel')}</PixelButton>
          <div style={{ flex: 1 }} />
          <PixelButton variant="primary" size="md" onClick={() => { void save(); }} disabled={busy || changing}>{t('editAgent.save')}</PixelButton>
        </>
      ) : (
        <>
          <div style={{ flex: 1 }} />
          <PixelButton variant="secondary" size="md" onClick={requestClose}>{t('editAgent.close')}</PixelButton>
        </>
      )}
    >
      {/* One tree for both layouts (owner, 2026-10-23: going wide mid change
          lost the run and the typed words): the job and What should change?
          stay in the column keyed "job", so React keeps them, and their run,
          when the panel goes wide or back. Wide (WD2): two columns, who they
          are, their timers and engine at 300 to 360 px, the whole job beside
          them at most 720 px across; in Arabic the grid mirrors with the page.
          One column (DR4, H2): name and role, the job with what should change
          under it, then the scheduled jobs and the engine. Each group sits on
          its own soft panel, field labels only (mockup 2B; edit-agent-hierarchy.md
          H1, H2). */}
      <div style={wide
        ? { display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) minmax(0, 720px)', justifyContent: 'center', gap: 32, flex: 1, minHeight: 0 }
        : { display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div key="side" style={column}>
          <Panel id="name">{nameRow}{roleRow}</Panel>
          {wide && (
            <>
              {!isResearch && <Panel id="schedules">{schedules}</Panel>}
              {engine}
              <div style={{ flex: 1 }} />
              {danger}
            </>
          )}
        </div>
        <div key="job" style={column}>
          <Panel id="job">
            {handlesRow}
            {workStyleRow}
          </Panel>
          {changeRow}
        </div>
        {!wide && (
          <div key="more" style={column}>
            {!isResearch && <Panel id="schedules">{schedules}</Panel>}
            {engine}
            {danger}
          </div>
        )}
      </div>
    </Dialog>
    {asking && (
      // WD4: leaving with unsaved changes asks; Keep editing is the default.
      <Dialog
        title={t('editAgent.discardTitle', { name: agent.name })}
        onClose={keepEditing}
        width={380}
        zIndex={600}
        // Wide, the Needs you pill stays bright above it, as it does above
        // the wide panel (WD8).
        below={wide}
        footer={(
          <>
            <PixelButton variant="ghost" size="md" onClick={discard}>{t('editAgent.discard')}</PixelButton>
            <PixelButton variant="primary" size="md" onClick={keepEditing} autoFocus>{t('editAgent.keepEditing')}</PixelButton>
          </>
        )}
        bodyStyle={{ display: 'none' }}
      >
        {null}
      </Dialog>
    )}
    </>
  );
}

/** The person's panel this dialog edits: Edit agent lays itself exactly over
 *  it (owner, 2026-10-02). Opened from somewhere with no panel, it falls back to
 *  the full height on the right. */
function panelBehind(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-right-column] [data-panel-card]');
}

/** A plain note under a field: what it is for, in the owner's words. */
const helperStyle: CSSProperties = {
  fontSize: 12.5,
  lineHeight: '18px',
  color: 'var(--cth-ink-3)'
};

/** A v2 input (DESIGN.md 7.19): card fill; the ring and radius come from
 *  .cth-input, so focus can thicken it. */
const inputStyle: CSSProperties = {
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

/** A value that can't be changed here, shown as text but still a labelled,
 *  read only field for screen readers (the Research member's engine). */
const lockedValueStyle: CSSProperties = {
  border: 'none', background: 'transparent', padding: 0,
  fontSize: 13, color: 'var(--cth-ink)', fontFamily: 'var(--cth-font-ui)'
};

/** A quiet underlined link: Show all, Undo. */
const linkStyle: CSSProperties = {
  padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-2)', textDecoration: 'underline', textUnderlineOffset: 2
};

/** The engine's fields, unfolded under its line. `id` names the group for
 *  tests and the reader; nothing shows it. */
function Fields({ id, children }: { id: 'engine'; children: React.ReactNode }) {
  return <div id={`edit-agent-${id}`} data-fields={id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>;
}

/** A column of groups, 14 px apart, in either layout. */
const column: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 };

/** One group of fields on the shared soft panel (owner, 2026-10-23, mockup
 *  2B; edit-agent-hierarchy.md H1). */
function Panel({ id, children }: { id: 'name' | 'job' | 'schedules'; children: React.ReactNode }) {
  return <SoftPanel id={`edit-agent-${id}`}>{children}</SoftPanel>;
}

/** A field and a read only field, in the app's field style (fieldText). */
function Row(p: { label: string; info?: string; children: React.ReactNode }) {
  return <Field label={p.label} info={p.info}>{p.children}</Field>;
}
function ReadRow(p: { label: string; info?: string; children: React.ReactNode }) {
  return <Field read label={p.label} info={p.info}>{p.children}</Field>;
}
