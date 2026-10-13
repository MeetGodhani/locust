/**
 * A COMMIT MESSAGE WRITTEN FROM THE CHANGES (0.771).
 *
 * From the 2026-10-13 look through t3code (Colin: "sounds good ill run with all your recs"). The Commit dialog
 * drafted its message from what the person asked, which says what was wanted, not what changed. Now "Write it from
 * the changes" asks the teammate whose conversation it is -- the model that made them, on its own route, in Ask
 * mode -- to write it from the diff: a subject line, and a short body, which a pull request then carries as its
 * description. It fills the box; nothing is committed until the person presses Commit.
 */
export const COMMIT_DRAFT_CHANNEL = 'folder:commit-draft'

/** How much of the diff the model reads: a big change is described by its files and its first 40,000 characters. */
export const MAX_DRAFT_DIFF_CHARS = 40_000
export const MAX_SUBJECT_CHARS = 72

export type CommitDraftResponse =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string }

/** What a commit would take, as the model reads it (main/folder-commit.ts `pending`). */
export interface PendingChanges {
  /** The uncommitted changes against HEAD, new files whole, cut at the limit. */
  readonly diff: string
  /** Every file changed, with its lines added and removed: whole even when the diff is cut. */
  readonly stat: string
  readonly cut: boolean
  /** The subjects of the folder's last commits, newest first. */
  readonly recent: readonly string[]
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

export function commitDraftPrompt(pending: PendingChanges, asks: readonly string[]): string {
  const asked = asks.map((ask) => ask.replace(/\s+/g, ' ').trim()).filter((ask) => ask.length > 0).slice(-5)
  return [
    'Write the commit message for the changes below, as the person committing them would. Use only what is here: do not read files or run commands.',
    [
      `- The first line says what changed, in at most ${String(MAX_SUBJECT_CHARS)} characters, in plain words.`,
      '- The body says what changed and why, in a few short lines or "- " points, leaving out what the diff already makes plain. A small change may have none.',
      '- Write it as this project writes its messages (its recent ones are below): no "feat:"-style prefix unless they use one.'
    ].join('\n'),
    ...(asked.length === 0 ? [] : [`What the person asked for in the conversation that made these changes:\n${asked.map((ask) => `- ${clip(ask, 300)}`).join('\n')}`]),
    ...(pending.recent.length === 0 ? [] : [`This project's recent commit messages:\n${pending.recent.slice(0, 8).map((subject) => `- ${clip(subject, 120)}`).join('\n')}`]),
    `The files changed:\n${pending.stat}`,
    `The changes${pending.cut ? ' (cut short; the list of files above is whole)' : ''}:\n${pending.diff}`,
    'Answer in exactly this shape, and nothing else:\nSUBJECT: <the first line>\nBODY:\n<the body, or nothing>\nEND'
  ].join('\n\n')
}

const SUBJECT = /^\s*[*_]*\s*SUBJECT\s*[*_]*\s*:\s*[*_]*\s*/i
const BODY = /^\s*[*_]*\s*BODY\s*[*_]*\s*:\s*[*_]*\s*/i
const END = /^\s*[*_]*\s*END\s*[*_]*\s*$/i

/**
 * The message in a draft's answer, or nothing when it is not in the shape asked for. What a model says around it
 * ("Here is the message:"), a code fence, or quotes around the subject are left out; a long subject is cut.
 */
export function draftedCommitMessage(answer: string): string | undefined {
  const lines = answer.replace(/\r\n?/g, '\n').split('\n')
  const at = lines.findIndex((line) => SUBJECT.test(line))
  if (at === -1) return undefined
  const subject = (lines[at] ?? '').replace(SUBJECT, '').replace(/[*_]+\s*$/, '').trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  if (subject.length === 0) return undefined
  const start = lines.findIndex((line, index) => index > at && BODY.test(line))
  let body = ''
  if (start !== -1) {
    const end = lines.findIndex((line, index) => index > start && END.test(line))
    body = [(lines[start] ?? '').replace(BODY, ''), ...lines.slice(start + 1, end === -1 ? undefined : end)]
      .filter((line) => !/^\s*```/.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const head = clip(subject.replace(/\s+/g, ' '), MAX_SUBJECT_CHARS)
  return body.length === 0 ? head : `${head}\n\n${body}`
}
