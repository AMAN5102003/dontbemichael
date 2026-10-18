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
import { firstTaskSection, roleLabel, plainFallback } from '@shared/workStyleText';
import { effectiveWorkStyle } from '@shared/michaelWorkStyle';
import { ScheduledJobsList } from './ScheduledJobs';
import { sendTypedFirstTask } from '@/shell/typedFirstTask';
import { useResearchName } from '@/shell/research';
import { canDeleteTeamMember, deleteTeamMember } from '@/shell/deleteTeamMember';
import { releaseBindingsOf } from '@/shell/releaseBindings';
import { disposeTerminal } from './terminalPool';
import { deleteConfirmText } from './triggers/ScheduleList';

export interface EditAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

/**
 * Edit what can change on someone already hired (docs/designs/edit-agent.md):
 * name, job, work style and engine, in one column. The character and its
 * color are chosen once, in the hire wizard: picking another here turned Pam
 * into a second Michael, and the color drew almost nowhere (owner,
 * 2026-10-02). Save patches the durable roster via updateAgent; engine changes
 * apply on the next restart. Under the engine, a Danger zone deletes the team
 * member for good (owner, 2026-10-14).
 */
export function EditAgentModal({ agent, onClose }: EditAgentModalProps) {
  const { t } = useTranslation();
  const researchName = useResearchName();
  const updateAgent = useStore((s) => s.updateAgent);
  const godName = useResolvedGodName();
  const renameAgent = useStore((s) => s.renameAgent);
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [config, setConfig] = useState<HarnessConfig | null>(null);

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
  const [engineOpen, setEngineOpen] = useState(false);
  // The stored role is one string ("Finance: Keeps track of..."), shown here as
  // two fields and joined back on save (agentRole.ts).
  const [role, setRole] = useState(() => splitAgentRole(agent.description).role);
  const [roleDescription, setRoleDescription] = useState(() => splitAgentRole(agent.description).roleDescription);
  // Work style in two forms (owner, 2026-09-27): the owner edits a plain
  // description (`goal` here); the agent keeps its instructions (agent.goal),
  // rewritten from the description on save only when it changed.
  // Michael starts from his default Work style (schedule-focus-areas.md F6).
  const [goal, setGoal] = useState(() => plainFallback(effectiveWorkStyle(agent), roleLabel(splitAgentRole(agent.description).role)));
  const [plainOfGoal, setPlainOfGoal] = useState(() => plainFallback(effectiveWorkStyle(agent), roleLabel(splitAgentRole(agent.description).role)));
  const [describing, setDescribing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [goalError, setGoalError] = useState(false);
  const [writeError, setWriteError] = useState(false);
  const describeSeq = useRef(0);
  /** Show the agent's instructions as a plain description: the quick rewrite
   *  at once, the model's when it arrives, unless the owner started typing. */
  const describe = (instructions: string): void => {
    const seq = ++describeSeq.current;
    const quick = instructions.trim() ? plainFallback(instructions, roleLabel(splitAgentRole(agent.description).role)) : '';
    setGoal(quick);
    setPlainOfGoal(quick);
    if (!instructions.trim()) { setDescribing(false); return; }
    setDescribing(true);
    const title = splitAgentRole(agent.description).role;
    window.cth.workStyleConvert({ to: 'plain', text: instructions, ctx: { name: agent.name, title: title || undefined, manager: godName } })
      .then((res) => {
        if (seq !== describeSeq.current || res.source !== 'ai' || !res.text) return;
        setGoal((cur) => (cur === quick ? res.text : cur));
        setPlainOfGoal((cur) => (cur === quick ? res.text : cur));
      })
      .catch(() => { /* the quick rewrite stays */ })
      .finally(() => { if (seq === describeSeq.current) setDescribing(false); });
  };

  useEffect(() => {
    void window.cth.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Keep form in sync when the selected agent changes while the modal is open.
  useEffect(() => {
    setName(agent.name);
    setProvider(inferAgentProvider(agent.command, agent.provider));
    setModel(agent.model);
    setRole(splitAgentRole(agent.description).role);
    setRoleDescription(splitAgentRole(agent.description).roleDescription);
    describe(effectiveWorkStyle(agent));
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

  const save = async () => {
    if (saving || writing) return;
    const trimmedName = name.trim() || agent.name;
    // Work style is required for a team member (owner, 2026-09-27); Michael and
    // his assistant have none.
    if (!agent.isGod && !agent.isAssistant && !goal.trim()) { setGoalError(true); return; }
    setGoalError(false);
    // The instructions: unchanged when the description is, else written from
    // it to the house prompting guidelines, keeping the old wording that fits.
    let trimmedGoal = (agent.goal ?? '').trim();
    // Michael and his assistant may clear theirs; that saves no work style.
    if (!goal.trim()) trimmedGoal = '';
    else if (goal.trim() !== plainOfGoal.trim()) {
      setWriting(true);
      setWriteError(false);
      const res = await window.cth.workStyleConvert({
        to: 'instructions',
        text: goal,
        ctx: {
          name: trimmedName,
          title: role.trim() || undefined,
          business: { name: config?.businessName, city: config?.businessCity },
          manager: godName
        },
        previous: effectiveWorkStyle(agent) || undefined
      }).catch(() => null);
      setWriting(false);
      if (!res?.text?.trim()) { setWriteError(true); return; }
      trimmedGoal = res.text.trim();
    }
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
    // Both fields cleared keeps the role it had, rather than saving a blank.
    const trimmedDescription = joinAgentRole(role, roleDescription) || agent.description;
    const command = config
      ? buildSpawnCommand(config, model, provider)
      : agent.command;

    updateAgent(agent.id, {
      provider,
      model,
      command,
      description: trimmedDescription,
      goal: trimmedGoal || undefined
    });
    // A First task the owner typed is one-time work, which the instructions
    // leave out: it goes to Michael as a card instead (ship review SR5).
    const typedFirstTask = goal.trim() !== plainOfGoal.trim() ? firstTaskSection(goal)?.body.trim().slice(0, FIRST_TASK_EDITED_MAX) : '';
    if (typedFirstTask && !agent.isGod) {
      void sendTypedFirstTask(agent.sourceCard, agent.id, trimmedName, { ask: typedFirstTask, role: role.trim(), existing: true });
    }
    // Michael routes work by the role in the office registry. Update it now, so
    // he sees the change on his next message instead of after a restart.
    if (trimmedDescription !== agent.description) {
      void window.cth.hivePatchAgentRole(agent.id, trimmedDescription).catch(() => undefined);
    }
    onClose();
  };

  // Deleting is final (owner, 2026-10-14): one confirm, then they are gone.
  const remove = async () => {
    if (deleting || saving || writing) return;
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

  const who = name.trim() || agent.name;
  // What the folded Engine line shows: the provider, and the model when it has one.
  const providerLabel = AGENT_PROVIDER_PRESETS.find((p) => p.id === provider)?.label ?? provider;
  const modelLabel = preset.supportsModel && model ? (modelsForProvider(provider).find((m) => m.id === model)?.label ?? model) : '';
  return (
    // One column (D3): name, job, work style, then the engine folded away, so
    // what they handle and the work style get the room (owner, 2026-10-02).
    // Field labels only; explanations sit behind info icons.
    <Dialog
      title={t('editAgent.title')}
      onClose={onClose}
      busy={saving || writing || deleting}
      width={640}
      fill
      align="end"
      over={panelBehind}
      zIndex={500}
      footer={(
        <>
          <PixelButton variant="ghost" size="md" onClick={onClose}>{t('editAgent.cancel')}</PixelButton>
          <div style={{ flex: 1 }} />
          <PixelButton variant="primary" size="md" onClick={() => { void save(); }} disabled={saving || writing || deleting}>{writing ? t('editAgent.writing') : t('editAgent.save')}</PixelButton>
        </>
      )}
    >
      {/* The whole window's height (owner, 2026-10-02): the work style box
          takes whatever the other fields leave, and the body scrolls only on
          a window too short for its minimum. No `minHeight: 0` on this column,
          the briefing fields or the work style row: each must keep its content's
          height, or the work style box (min 320) spills out of its row and the
          scheduled jobs under it draw on top of it (owner, 2026-10-10). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        <Fields id="name">
          {/* The owner names the Research member (owner, ship 2 D17); whatever its
              name, the app knows it as Research, the one on the internet. */}
          <Row label={t('editAgent.name')} info={isResearch ? t('editAgent.researchName', { name: researchName }) : undefined}>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(undefined); }}
              placeholder={t('editAgent.namePlaceholder')}
              aria-invalid={nameError ? true : undefined}
              className="cth-input"
              style={nameError ? { ...inputStyle, boxShadow: 'inset 0 0 0 1.5px var(--cth-coral)' } : inputStyle}
              autoFocus
            />
            {nameError && (
              <span role="alert" style={{ ...helperStyle, color: 'var(--cth-coral-text)' }}>{nameError}</span>
            )}
          </Row>
        </Fields>

        <Fields id="briefing" grow>
          <Row label={t('editAgent.role')}>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t('editAgent.rolePlaceholder')}
              className="cth-input"
              style={inputStyle}
            />
          </Row>

          <Row
            label={t('editAgent.handles', { name: who })}
            info={t('editAgent.handlesInfo', { manager: godName, name: who })}
          >
            <textarea
              value={roleDescription}
              onChange={(e) => setRoleDescription(e.target.value)}
              placeholder={t('editAgent.handlesPlaceholder')}
              rows={5}
              className="cth-input"
              style={{ ...inputStyle, fontFamily: 'var(--cth-font-ui)', resize: 'vertical', minHeight: 110 }}
            />
          </Row>

          <Row
            grow
            label={t('editAgent.workStyle')}
            info={t('editAgent.workStyleInfo', { name: who })}
          >
            <textarea
              value={goal}
              onChange={(e) => { describeSeq.current++; setDescribing(false); setGoal(e.target.value); if (e.target.value.trim()) setGoalError(false); }}
              aria-invalid={goalError || undefined}
              placeholder={t('editAgent.workStylePlaceholder', { name: who })}
              rows={4}
              className="cth-input"
              style={{ ...inputStyle, fontFamily: 'var(--cth-font-ui)', resize: 'none', minHeight: 320, flex: 1 }}
            />
          </Row>
          <ScheduledJobsList agentId={agent.id} compact />
          {goalError && (
            <span role="alert" style={{ ...helperStyle, color: 'var(--cth-coral-text)' }}>
              {t('editAgent.errWorkStyle', { name: agent.name })}
            </span>
          )}
          {describing && <span aria-live="polite" style={helperStyle}>{t('editAgent.describing')}</span>}
          {writeError && (
            <span role="alert" style={{ ...helperStyle, color: 'var(--cth-coral-text)' }}>
              {t('editAgent.errWrite')}
            </span>
          )}
        </Fields>

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
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)' }}>{t('editAgent.engine')}</span>
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

        {/* Danger zone, under the engine (owner, 2026-10-14): delete for good. */}
        {canDeleteTeamMember(agent) && (
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
            <PixelButton variant="destructive" size="md" onClick={() => { void remove(); }} disabled={deleting || saving || writing}>
              {deleting ? t('editAgent.deleting') : t('editAgent.delete', { name: agent.name })}
            </PixelButton>
          </div>
        )}
      </div>
    </Dialog>
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

/** A group of fields with no heading (D3: field labels only). `id` names the
 *  group for tests and the reader; nothing shows it. */
function Fields({ id, grow, children }: { id: 'name' | 'briefing' | 'engine'; grow?: boolean; children: React.ReactNode }) {
  return <div id={`edit-agent-${id}`} data-fields={id} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...(grow ? { flex: 1 } : {}) }}>{children}</div>;
}

/** A field with its label; `info` puts the explanation behind an info icon
 *  (owner, 2026-09-27: less verbose everywhere). */
function Row({ label, info, grow, children }: { label: string; info?: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, ...(grow ? { flex: 1 } : {}) }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)' }}>{label}</span>
        {info && <InfoTip text={info} label={label} />}
      </span>
      {children}
    </label>
  );
}
