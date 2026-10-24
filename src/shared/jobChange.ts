/**
 * A team member's job as the owner changes it (docs/designs/work-style-change-request.md):
 * the owner says what should change, a rewrite returns the new job, and
 * Apply saves it with what Undo and a pack update need. Pure: Edit agent, the
 * hire wizard and the pack update card share it, and tests load it directly.
 *
 *   goal         the instructions the agent reads
 *   goalPlain    the plain words the owner reads, with the fingerprint of the
 *                instructions they describe: another writer that changes the
 *                instructions (a pack update, a first task fallback) leaves
 *                them stale, and Edit agent writes them again once (eng D5, OV3)
 *   description  the role line Michael routes by, "Title: what X handles"
 *   jobPrevious  the job before the last change: one level of Undo, text only (OV4)
 *   jobChanges   the change requests applied, oldest first, reapplied on a
 *                pack's new default (eng D7)
 */
import { splitAgentRole } from './agentRole';
import { appendOnce, splitBindings } from './hireTemplates';

export interface PlainWords {
  text: string;
  /** jobFingerprint of the instructions these words describe. */
  of: string;
}

export interface JobChangeEntry {
  text: string;
  /** ISO time it was applied. */
  at: string;
}

export interface JobVersion {
  goal?: string;
  goalPlain?: PlainWords;
  description: string;
  /** The change list as it was, so Undo after a pack update keeps the owner's. */
  jobChanges?: JobChangeEntry[];
}

export interface JobFields {
  goal?: string;
  goalPlain?: PlainWords;
  description: string;
  jobPrevious?: JobVersion;
  jobChanges?: JobChangeEntry[];
}

/** What a rewrite returned, as Apply saves it. */
export interface RevisedJob {
  instructions: string;
  plain: string;
  /** The new "What X handles", or null when the duties didn't change. */
  handles: string | null;
}

/** The list kept per member: enough for every change an owner makes, short
 *  enough to send in one rewrite. */
export const JOB_CHANGES_MAX = 20;

/** FNV-1a over the text, as 8 hex digits: says "these are the same words",
 *  nothing more. */
export function jobFingerprint(text: string | undefined): string {
  let h = 0x811c9dc5;
  const s = (text ?? '').trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The saved plain words when they still describe these instructions. */
export function plainFor(job: { goalPlain?: PlainWords }, instructions: string): string | null {
  const p = job.goalPlain;
  return p?.text?.trim() && p.of === jobFingerprint(instructions) ? p.text : null;
}

/** The job a rewrite started from, to tell at Apply whether it moved meanwhile (A3). */
export function jobBase(job: { goal?: string; description?: string }): string {
  return `${jobFingerprint(job.goal)}:${jobFingerprint(job.description)}`;
}

/** `before`'s role line with `now`'s binding lines in place of its own.
 *  A job saved before routing lines existed has none to go back to. */
function withBindingsOf(before: string, now: string): string {
  if (typeof before !== 'string') return before;
  const was = splitAgentRole(before);
  const lines = splitBindings(splitAgentRole(now).roleDescription).lines;
  const handles = lines.reduce((h, l) => appendOnce(h, l), splitBindings(was.roleDescription).text);
  return withHandles(was.role, handles);
}

/** "Title: handles" with a new handles part; the title is the owner's typed field (OV2). */
export function withHandles(title: string, handles: string): string {
  const t = title.trim().replace(/:+$/, '').trim();
  const h = handles.trim();
  return t && h ? `${t}: ${h}` : t || h;
}

/**
 * The fields Apply writes: the new job, the one before it for Undo, and the
 * change appended to the list (none for a pack default, which is no change of
 * the owner's). `title` is the role title the line keeps.
 */
export function applyJob(
  job: JobFields,
  revised: RevisedJob,
  opts: { title: string; change?: string; now: string }
): Pick<JobFields, 'goal' | 'goalPlain' | 'description' | 'jobPrevious' | 'jobChanges'> {
  const instructions = revised.instructions.trim();
  const description = revised.handles ? withHandles(opts.title, revised.handles) : job.description;
  const change = opts.change?.trim();
  return {
    goal: instructions,
    goalPlain: { text: revised.plain.trim(), of: jobFingerprint(instructions) },
    description,
    jobPrevious: { goal: job.goal, goalPlain: job.goalPlain, description: job.description, jobChanges: job.jobChanges },
    jobChanges: change ? [...(job.jobChanges ?? []), { text: change, at: opts.now }].slice(-JOB_CHANGES_MAX) : job.jobChanges
  };
}

/** Undo: the job and the change list as they were before the last change;
 *  null when there is nothing to go back to. The routing line keeps today's
 *  binding lines ("Not for refunds; that goes to Dwight."): a hire, a release
 *  or a rename since the change set them, and Michael routes by them (ship
 *  review, 2026-10-23). */
export function undoJob(job: JobFields): Pick<JobFields, 'goal' | 'goalPlain' | 'description' | 'jobPrevious' | 'jobChanges'> | null {
  const prev = job.jobPrevious;
  if (!prev) return null;
  return {
    goal: prev.goal,
    goalPlain: prev.goalPlain,
    description: withBindingsOf(prev.description, job.description),
    jobPrevious: undefined,
    jobChanges: prev.jobChanges
  };
}
