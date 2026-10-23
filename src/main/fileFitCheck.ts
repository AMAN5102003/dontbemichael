/**
 * The check that a file the owner adds on a foundation card answers that
 * card's question (owner, 2026-10-22, D3 and D10; docs/designs/
 * foundation-card-upload.md). A quick model with no tools reads the file's
 * text, or looks at the picture, and answers FITS or NO with a reason. The
 * same runner, model and limits as the standing approval check. A check that
 * can't run, or answers anything else, is null: the card refuses the file (D5).
 */
import { randomBytes } from 'node:crypto';
import { runHiddenModel, type HiddenModelEngine } from './hiddenModel';
import { fileFitPrompt, parseFileFit, type FoundationId } from '../shared/foundations';

const MODEL = 'claude-haiku-4-5';
const TIMEOUT_MS = 60_000;

export interface FileFitInput { id: FoundationId; name: string; text?: string; picture?: string }
/** `engine`: a picture with an engine that can't be shown one (Codex), so
 *  the owner is told, not asked to try again. */
export type FileFitCheck = (f: FileFitInput) => Promise<{ fits: true } | { fits: false; reason: string } | { engine: true } | null>;

export function fileFitCheck(deps: { cwd: () => string; command: () => string; modelEngine?: () => HiddenModelEngine; env?: () => Record<string, string> | undefined; log?: (e: Record<string, unknown>) => void }): FileFitCheck {
  return async (f) => {
    try {
      const result = await runHiddenModel(fileFitPrompt({ id: f.id, name: f.name, text: f.text, picture: !!f.picture }, randomBytes(6).toString('hex')), {
        ...deps.modelEngine?.(),
        model: MODEL,
        cwd: deps.cwd(),
        command: deps.command(),
        noTools: true,
        // Only the owner's own user settings: no project settings or hooks.
        settingSources: 'user',
        // No hook sees the file, whatever settings the check finds.
        settingsJson: JSON.stringify({ disableAllHooks: true }),
        thinking: false,
        env: deps.env?.(),
        timeoutMs: TIMEOUT_MS,
        // The file may be private (the financial statement picked by mistake):
        // nothing of it stays in a transcript after the check.
        dropTranscript: true,
        // Nor in Claude Code's shared prompt history or paste cache.
        isolateConfig: true,
        ...(f.picture ? { images: [f.picture] } : {})
      });
      if (f.picture && result.error === 'engine unavailable') return { engine: true };
      const verdict = result.ok && result.text ? parseFileFit(result.text) : null;
      if (!verdict) deps.log?.({ kind: 'foundation-file-check-unread', question: f.id, reason: result.ok ? 'unreadable' : (result.error ?? 'failed') });
      return verdict;
    } catch (e) {
      deps.log?.({ kind: 'foundation-file-check-unread', question: f.id, reason: String(e).slice(0, 200) });
      return null;
    }
  };
}
