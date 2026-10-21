import { useStore } from '@/store/store';
import { COMMAND_GROUPS } from '@shared/claudeCommands';
import { CODEX_COMMAND_GROUPS } from '@shared/codexCommands';
import { GROK_COMMAND_GROUPS } from '@shared/grokCommands';
import { ownerComposeTarget, withAttachments } from '@shared/ownerRequests';
import { CONTEXT_COMMAND_VERBS } from '@shared/providerAutomation';

/** Slash commands of every engine Michael can run on (R7): only these go
 *  straight to his terminal; anything else is a question for the dock.
 *  The command references cover claude, codex and grok; CONTEXT_COMMAND_VERBS
 *  adds the verbs the app itself types on the other engines, so a command the
 *  harness would send for the owner is never refused as a question. */
const COMMANDS: ReadonlySet<string> = new Set([
  ...[...COMMAND_GROUPS, ...CODEX_COMMAND_GROUPS, ...GROK_COMMAND_GROUPS]
    .flatMap((g) => g.items)
    .filter((c) => c.kind === 'slash')
    .map((c) => c.cmd.split(/\s+/)[0].toLowerCase()),
  ...CONTEXT_COMMAND_VERBS
]);

/**
 * What both composers do with a message to Michael (docs/designs/michael-replies.md,
 * R3, R6, R7): a known command is typed into his terminal as before; anything
 * else is filed as the owner's question and handed to him as its own work
 * order, and the dock opens on it. Resolves false when filing failed, so the
 * composer keeps the draft.
 */
export async function sendToMichael(godId: string, text: string, attachments: Array<{ path: string; name: string }>, reply?: { inReplyTo: string; conversation: string }): Promise<boolean> {
  const body = withAttachments(text, attachments);
  const { enqueueMessage, setDock } = useStore.getState();
  if (!reply && ownerComposeTarget(text, COMMANDS) === 'terminal' && !attachments.length) {
    enqueueMessage(godId, body);
    return true;
  }
  const res = await window.cth.ownerAsk({ text: body, ...(reply ?? {}) }).catch(() => null);
  if (!res?.ok || !res.id) return false;
  enqueueMessage(godId, body, { instruction: res.workOrder, ownerRequestId: res.id });
  setDock(true, res.id);
  return true;
}
