import { FOUNDATION_QUESTIONS, fileAnswerLine, type FoundationId } from '@shared/foundations';

/**
 * The foundation card's Save, as its steps (components/FoundationCard.tsx
 * keeps the state around them). The window.cth calls come in as `cth`, so the
 * order can be run without the app (test/review-behavior.test.cjs).
 */
export type FoundationSaveCth = Pick<Window['cth'], 'foundationsAnswer' | 'foundationsAddFile' | 'foundationsAnswerFile' | 'kgRemove' | 'hiveSend'>;

/** Answer the card like any Ask me reply; false when the card did not take it. */
export type CardAnswer = (text: string) => Promise<boolean>;

/** Where the answer went once the card took it. */
export type SavedHow = 'saved' | 'michael' | 'failed';

/** Why the add step refused a file. */
export type AddFileRefusal = Extract<Awaited<ReturnType<FoundationSaveCth['foundationsAddFile']>>, { ok: false }>['error'];

/** A typed answer: the card first, then the foundations, else Michael. */
export async function saveTextAnswer(id: FoundationId, text: string, cth: FoundationSaveCth, onAnswer: CardAnswer): Promise<{ taken: false } | { taken: true; how: SavedHow }> {
  // The card first: the answer reaches Michael, who closes it.
  if (!(await onAnswer(text).catch(() => false))) return { taken: false };
  // The card took it and leaves the board: the board reports from here.
  const r = await cth.foundationsAnswer(id, text).catch(() => null);
  if (r?.ok) return { taken: true, how: 'saved' };
  // Not written: Michael adds it, as he does any owner answer.
  const sent = await cth.hiveSend({ to: 'michael', act: 'request', subject: 'Add my answer to the company foundations', body: `Please add my answer to the company foundations question "${FOUNDATION_QUESTIONS[id].text}" (${id}): ${text}` }, 'human').catch(() => null);
  return { taken: true, how: sent?.ok ? 'michael' : 'failed' };
}

/** A file answer's outcome: refused by the add step (with its line), failed
 *  there for another reason, not taken by the card, or taken. */
export type FileSaveOutcome =
  | { kind: 'refused'; error: AddFileRefusal; reason?: string }
  | { kind: 'failed' }
  | { kind: 'not-taken' }
  | { kind: 'taken'; how: SavedHow };

/**
 * A file answer (docs/designs/foundation-card-upload.md): the file is added
 * and checked first, then the card is answered, the document is removed again
 * if the card does not take it, then the answer naming the document is
 * written. `steps.checked` runs once the check is back, `steps.taken` once the
 * card took the answer, so the card can update between the steps.
 */
export async function saveFileAnswer(
  id: FoundationId,
  picked: { path: string },
  text: string,
  cth: FoundationSaveCth,
  onAnswer: CardAnswer,
  steps: { checked?: () => void; taken?: () => void } = {}
): Promise<FileSaveOutcome> {
  // Read and checked first: nothing is answered or added unless it fits (D3).
  const added = await cth.foundationsAddFile(id, picked.path).catch(() => null);
  steps.checked?.();
  if (!added?.ok) {
    if (added && added.error !== 'unknown' && added.error !== 'no-office') return { kind: 'refused', error: added.error, reason: added.reason };
    return { kind: 'failed' };
  }
  const note = `I added "${added.name}" to company knowledge for this (document ${added.docId}).`;
  if (!(await onAnswer(text ? `${text}\n\n${note}` : note).catch(() => false))) {
    // The card didn't take it: the document goes again, nothing is left over.
    await cth.kgRemove(added.docId).catch(() => null);
    return { kind: 'not-taken' };
  }
  steps.taken?.();
  const r = await cth.foundationsAnswerFile(id, added.docId, text).catch(() => null);
  if (r?.ok) return { kind: 'taken', how: 'saved' };
  // Michael adds it: the exact line, so the document id survives (Codex 3).
  const line = fileAnswerLine(text, added.docId, added.name);
  const sent = await cth.hiveSend({ to: 'michael', act: 'request', subject: 'Add my answer to the company foundations', body: `Please add my answer to the company foundations question "${FOUNDATION_QUESTIONS[id].text}" (${id}): ${line}` }, 'human').catch(() => null);
  return { kind: 'taken', how: sent?.ok ? 'michael' : 'failed' };
}
