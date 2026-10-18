/** Where Michael's engine stands for the Get Michael ready step and its Ask me
 *  card (docs/designs/get-michael-ready.md). Shared by main and the renderer. */

/** The setup terminals main runs. Not agents: no hive record, no relaunch. */
export const ENGINE_INSTALL_PTY = 'engine-setup-install';
export const ENGINE_SIGNIN_PTY = 'engine-setup-signin';

export function isEngineSetupPty(id: string): boolean {
  return id === ENGINE_INSTALL_PTY || id === ENGINE_SIGNIN_PTY;
}

export interface EngineSetupStatus {
  /** False for an engine this step does not set up (anything but Claude). */
  applies: boolean;
  /** Michael runs on another engine, but a team member on Claude could not
   *  start for want of it: the card speaks about the team, not Michael. */
  forTeam?: boolean;
  installed: boolean;
  /** null: installed, but the sign in state could not be read. Never blocks. */
  signedIn: boolean | null;
  email?: string;
  /** How Claude signs in: the owner's Claude account or an Anthropic API key. */
  method?: 'account' | 'apiKey';
  /** Michael cannot start until this is done. */
  needed: boolean;
  /** Once ready: the terminals that could not start for want of Claude and
   *  should start now. Only those restart; agents already working keep going. */
  restart?: string[];
}

/** Whether Michael can start: installed, and not known to be signed out. */
export function engineSetupNeeded(installed: boolean, signedIn: boolean | null): boolean {
  return !installed || signedIn === false;
}

export type EngineSetupPhase = 'checking' | 'checkFailed' | 'installing' | 'installFailed' | 'signin' | 'browser' | 'unknown' | 'ready';

/** What the rows show, from what main reports and what the step started. */
export function engineSetupPhase(
  status: EngineSetupStatus | undefined,
  s: { installing: boolean; installFailed: boolean; browser: boolean; statusFailed?: boolean }
): EngineSetupPhase {
  if (!status && s.statusFailed) return 'checkFailed';
  if (!status) return 'checking';
  if (!status.installed) return s.installFailed ? 'installFailed' : 'installing';
  if (status.signedIn === false) return s.browser ? 'browser' : 'signin';
  // Installed, but sign in could not be read (an old Claude without `auth
  // status`): never blocks, never a green check either.
  if (status.signedIn === null) return s.browser ? 'browser' : 'unknown';
  return 'ready';
}

/** Michael can start from here: signed in, or sign in could not be read. */
export function engineSetupPhaseOpensOffice(phase: EngineSetupPhase): boolean {
  return phase === 'ready' || phase === 'unknown';
}
