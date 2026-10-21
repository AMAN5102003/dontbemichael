import { RESEARCH_ID } from '../../../shared/research';
import { CapabilitiesTab } from './CapabilitiesTab';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { PtyTerminalView } from './PtyTerminalView';
import { terminalInstanceKey } from './terminalRecovery';
import { MessageQueueComposer } from './MessageQueueComposer';
import { CommandCenterPanel, MemoryTab } from './CommandCenterPanel';
import { disposeTerminal } from './terminalPool';
import { SidebarTabs } from './SidebarTabs';
import { ThreadsPanel } from './ThreadsPanel';
import { ProfileTab } from './ProfileTab';
import { ToolWaterfall } from './ToolWaterfall';
import { AgentControlStrip } from './AgentControlStrip';
import { ClearedBanner } from './ClearedBanner';
import { EditAgentModal } from './EditAgentModal';
import { GitTab } from './GitTab';
import { SHOW_TRACES, SHOW_FOCUS_MODE, SHOW_GIT, SHOW_IDE, SHOW_CLOSE_AGENT, SHOW_OPEN_TERMINAL } from '@shared/buildFeatures';
import { Icon } from './Icon';
import { useStore, type Agent } from '@/store/store';
import { releaseBindingsOf } from '@/shell/releaseBindings';
import { usePtyParser } from '@/hooks/usePtyParser';
import { closeConfirmText } from './triggers/ScheduleList';
import { OneOnOneLine, OwnerViaMichaelBar } from './OwnerViaMichaelBar';
import { PanelCard, PanelHeader } from '@/shell/PanelChrome';
import { roleOf } from '@/scene/studio/layout';
import { SilentPanelLine } from './SilentEngine';

export interface AgentDetailPanelProps {
  agent: Agent;
}

export function AgentDetailPanel({ agent }: AgentDetailPanelProps) {
  const { t } = useTranslation();
  const [openTerminalState, setOpenTerminalState] = useState<'idle' | 'opening' | 'ok' | 'error'>('idle');
  const [openTerminalError, setOpenTerminalError] = useState<string | undefined>();
  const [editOpen, setEditOpen] = useState(false);
  // Change engine on a not reporting card opens Edit here, the engine open (issue #326).
  const [editEngine, setEditEngine] = useState(false);
  const editRequest = useStore(s => s.editAgentRequest);
  const clearEditRequest = useStore(s => s.clearEditAgentRequest);
  useEffect(() => {
    // Used once: a later visit to this panel never opens Edit by itself.
    if (editRequest && editRequest.agentId === agent.id) { setEditEngine(editRequest.engine); setEditOpen(true); clearEditRequest(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.seq]);

  const archiveAgent = useStore(s => s.archiveAgent);
  const updateAgent = useStore(s => s.updateAgent);
  const setFullscreen = useStore(s => s.setFullscreen);
  const fullscreenAgentId = useStore(s => s.fullscreenAgentId);
  const sidebarTab = useStore(s => s.sidebarTab);
  const setSidebarTab = useStore(s => s.setSidebarTab);
  const isReal = !!agent.ptyId;
  // While this agent is shown in the fullscreen overlay, the fullscreen view
  // owns the pty (it sizes it to fill the screen). Keeping the embedded terminal
  // mounted too means two xterms fight over the pty's cols/rows — which corrupts
  // the display and breaks scrolling. So we unmount the embedded one here; it
  // re-mounts and re-fits when fullscreen closes.
  const isFullscreenedHere = fullscreenAgentId === agent.id;

  const onPtyStream = usePtyParser(agent.id);

  // Michael gets the full command-center dashboard instead of the plain panel.
  if (agent.isGod) return <CommandCenterPanel agent={agent} />;

  const openTerminal = async () => {
    setOpenTerminalState('opening');
    setOpenTerminalError(undefined);
    try {
      const result = await window.cth.openTerminalAt(agent.cwd);
      if (result.ok) {
        setOpenTerminalState('ok');
        setTimeout(() => setOpenTerminalState('idle'), 1500);
      } else {
        setOpenTerminalState('error');
        setOpenTerminalError(result.error ?? 'unknown error');
        setTimeout(() => setOpenTerminalState('idle'), 4000);
      }
    } catch (e) {
      setOpenTerminalState('error');
      setOpenTerminalError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setOpenTerminalState('idle'), 4000);
    }
  };

  const onKill = async () => {
    if (!agent.ptyId) return;
    if (!confirm(closeConfirmText(agent.id, agent.name, t))) return;
    // Closing Research turns it off: its waiting asks go back (issue #230).
    if (agent.id === RESEARCH_ID) await window.cth.researchOff().catch(() => undefined);
    // The owner is closing this agent on purpose: its schedules pause (design
    // 6A). A crash or a quit only archives it and leaves them running.
    await window.cth.closeAgentByOwner(agent.id).catch(() => undefined);
    // Their bound work goes back to the teammates it was taken from.
    await releaseBindingsOf(agent.id);
    await window.cth.killPty(agent.ptyId);
    disposeTerminal(agent.ptyId);
    archiveAgent(agent.id);
  };

  return (
    <PanelCard>
      {/* Design v2 header (branding/DESIGN.md 7.10). The IDE, Open terminal and
          close buttons stay behind their build flags, beside Edit. */}
      <PanelHeader
        agent={agent}
        role={roleOf(agent)}
        onEdit={() => setEditOpen(true)}
        extra={<>
          {SHOW_IDE && (
            <PixelButton variant="secondary" size="md" onClick={() => useStore.getState().setIdeOpen(true, agent.id)}>
              <span className="cth-tip cth-tip-wrap" data-tip={t('agentDetail.ideTip', { project: agent.project })} aria-label={t('agentDetail.openIde')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="code" />{t('agentDetail.ide')}
              </span>
            </PixelButton>
          )}
          {SHOW_OPEN_TERMINAL && (
            <PixelButton variant="secondary" size="md" onClick={openTerminal} disabled={openTerminalState === 'opening'}>
              <span className="cth-tip cth-tip-wrap" data-tip={t('agentDetail.terminalTip', { cwd: agent.cwd })} aria-label={t('agentDetail.openTerminalAria')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="terminal" />
                {openTerminalState === 'opening' ? t('agentDetail.opening')
                  : openTerminalState === 'ok' ? t('agentDetail.ok')
                  : openTerminalState === 'error' ? t('agentDetail.err')
                  : t('agentDetail.open')}
              </span>
            </PixelButton>
          )}
          {isReal && SHOW_CLOSE_AGENT && (
            <PixelButton variant="destructive" size="md" onClick={onKill}>
              <Icon name="x" />
            </PixelButton>
          )}
        </>}
      />

      {openTerminalError && (
        <div style={{
          fontSize: 12, color: 'var(--cth-coral-text)',
          padding: '2px 14px',
          background: 'var(--cth-coral-soft)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{openTerminalError}</div>
      )}

      {/* #7C — operator control (pause / halt / steer) for live agents */}
      {isReal && <ClearedBanner agentId={agent.id} name={agent.name} />}
      {isReal && <AgentControlStrip agentId={agent.id} />}

      {/* Tabs */}
      {/* Its engine isn't reporting (issue #326, SD14): one amber line. */}
      <SilentPanelLine agentId={agent.id} name={agent.name} />
      <SidebarTabs current={sidebarTab} accent={agent.accent} onChange={setSidebarTab} />

      {/* Active tab body — fills remaining space. data-panel-body: a wide
          panel keeps its text at most 720 px across, the terminal full width. */}
      <div data-panel-body data-tab={sidebarTab} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {sidebarTab === 'terminal' && (
          isReal && agent.ptyId ? (
            isFullscreenedHere ? (
              <EmptyTab title={t('agentDetail.inFullscreen')}>
                {t('agentDetail.fullscreenDesc')}
              </EmptyTab>
            ) : (
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <PtyTerminalView
                  key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
                  ptyId={agent.ptyId}
                  onStreamData={onPtyStream}
                  onUserPrompt={(t) => {
                    updateAgent(agent.id, { lastPrompt: t });
                    if (t.trim().toLowerCase() === '/clear') {
                      updateAgent(agent.id, { contextTokens: 0, contextLimit: undefined, progress: 0 });
                    }
                    void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t });
                  }}
                  onToggleFullscreen={SHOW_FOCUS_MODE ? () => setFullscreen(agent.id) : undefined}
                  fullscreen={false}
                  embedded
                  // Team members take work from Michael; the owner types to
                  // one only in 1:1 (docs/designs/owner-talks-via-michael.md).
                  inputLocked={!agent.onHold}
                />
              </div>
              {agent.onHold ? <><OneOnOneLine agent={agent} /><MessageQueueComposer agent={agent} /></> : <OwnerViaMichaelBar agent={agent} />}
            </div>
            )
          ) : (
            <EmptyTab title={t('agentDetail.noPty')}>
              {t('agentDetail.noPtyDesc')}
            </EmptyTab>
          )
        )}

        {SHOW_GIT && sidebarTab === 'git' && (
          <GitTab cwd={agent.cwd} />
        )}

        {sidebarTab === 'profile' && (
          <ProfileTab agent={agent} />
        )}

        {sidebarTab === 'capabilities' && (
          <CapabilitiesTab agent={agent} />
        )}

        {sidebarTab === 'messages' && (
          <ThreadsPanel agentId={agent.id} />
        )}

        {sidebarTab === 'memory' && (
          <MemoryTab key={agent.id} godId={agent.id} ownOnly />
        )}

        {SHOW_TRACES && sidebarTab === 'traces' && (
          <ToolWaterfall agentId={agent.id} />
        )}
      </div>

      {editOpen && (
        <EditAgentModal agent={agent} onClose={() => { setEditOpen(false); setEditEngine(false); }} engineOpen={editEngine} />
      )}
    </PanelCard>
  );
}

function EmptyTab({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 16, gap: 8
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-2)' }}>{title}</div>
      <p style={{
        margin: 0, fontSize: 13, textAlign: 'center', color: 'var(--cth-ink-700)',
        maxWidth: 280
      }}>{children}</p>
    </div>
  );
}
