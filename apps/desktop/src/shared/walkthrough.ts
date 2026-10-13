/**
 * WALK ME THROUGH THIS CHANGE (0.771).
 *
 * From the 2026-10-13 look through t3code (Colin: "sounds good ill run with all your recs"). The Changes panel shows
 * every file a conversation changed, in git's order, and leaves the reading to the person. "Walk me through it"
 * asks the teammate whose conversation it is -- the model that made the change, on its own route, in Ask mode --
 * to go through it as its author would in a review: what it does, then each file in the order to read it, why it
 * changed, and what to check. The panel then shows the change that way: the summary over the files, the files in
 * that order, each with its note. It changes nothing.
 */
export const WALKTHROUGH_CHANNEL = 'folder:walkthrough'

/** How much of the change the model reads: past this, its files and their first 40,000 characters. */
export const MAX_WALK_DIFF_CHARS = 40_000
const MAX_SUMMARY_CHARS = 700
const MAX_NOTE_CHARS = 400

export interface WalkthroughFile {
  /** The file's path, as the panel lists it. */
  readonly path: string
  /** What changed in it, and why. */
  readonly why: string
  /** One thing worth checking or testing there. */
  readonly check?: string
}

export interface Walkthrough {
  readonly summary: string
  /** The files in the order to read them; a file it did not mention is not here. */
  readonly files: readonly WalkthroughFile[]
}

export type WalkthroughResponse =
  | { readonly ok: true; readonly walkthrough: Walkthrough }
  | { readonly ok: false; readonly message: string }

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

/** The paths a unified diff changes, as `diff --git a/x b/y` names them: the `b` side, each once, in order. */
export function changedPaths(diff: string): readonly string[] {
  const seen = new Set<string>()
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    const path = (match[2] ?? '').trim()
    if (path.length > 0) seen.add(path)
  }
  return [...seen]
}

export function walkthroughPrompt(input: {
  readonly diff: string
  readonly cut: boolean
  readonly paths: readonly string[]
  readonly asks: readonly string[]
  /** What the teammate said when it finished: its own account of the work. */
  readonly said?: string
}): string {
  const asked = input.asks.map((ask) => ask.replace(/\s+/g, ' ').trim()).filter((ask) => ask.length > 0).slice(-5)
  const diff = input.diff.length > MAX_WALK_DIFF_CHARS ? input.diff.slice(0, MAX_WALK_DIFF_CHARS) : input.diff
  const cut = input.cut || input.diff.length > MAX_WALK_DIFF_CHARS
  return [
    'Walk the person through this change as its author would in a review. Use only what is here: do not read files or run commands.',
    [
      '- First, in two or three sentences, what the change does and why.',
      '- Then each file, in the order a reviewer should read them: what changed in it and why, in one or two sentences, and one thing worth checking or testing there, if there is one.',
      '- Name each file by its path exactly as it is listed below. Keep to what is in the change.'
    ].join('\n'),
    ...(asked.length === 0 ? [] : [`What the person asked for:\n${asked.map((ask) => `- ${clip(ask, 300)}`).join('\n')}`]),
    ...(input.said === undefined || input.said.trim().length === 0 ? [] : [`What was said when the work was done:\n${clip(input.said.trim(), 2_000)}`]),
    `The files changed:\n${input.paths.map((path) => `- ${path}`).join('\n')}`,
    `The change${cut ? ' (cut short; the list of files above is whole)' : ''}:\n${diff}`,
    'Answer in exactly this shape, and nothing else:\nSUMMARY: <what the change does and why>\nFILE: <a path from the list>\nWHY: <what changed in it and why>\nCHECK: <one thing to check there, or leave this line out>\n(FILE, WHY and CHECK again for each file, in reading order)\nEND'
  ].join('\n\n')
}

// A label needs its colon: a line of a note that begins "Check the..." or "End users..." is still the note.
const LABEL = /^\s*[*_]*\s*(SUMMARY|FILE|WHY|CHECK)\s*[*_]*\s*:\s*[*_]*\s*(.*)$/i
const END = /^\s*[*_]*\s*END\s*[*_]*\s*$/i

/** A path the model named, as one the panel lists: exactly, by its end, or by a name only one file has. */
function knownPath(named: string, paths: readonly string[]): string | undefined {
  const clean = named.replace(/\s+\([^)]*\)\s*$/, '').replace(/^[`'"]+|[`'"]+$/g, '').replace(/^\.?\/+/, '').replace(/^[ab]\//, '').trim()
  if (clean.length === 0) return undefined
  if (paths.includes(clean)) return clean
  const ending = paths.filter((path) => path.endsWith(`/${clean}`))
  if (ending.length === 1) return ending[0]
  const base = clean.split('/').pop() ?? clean
  const same = paths.filter((path) => (path.split('/').pop() ?? path) === base)
  return same.length === 1 ? same[0] : undefined
}

/**
 * The walkthrough in an answer, or nothing when it is not in the shape asked for. Each file is one the change has,
 * once, in the order given; what a model says around the shape, and a file it invented, are left out.
 */
export function readWalkthrough(answer: string, paths: readonly string[]): Walkthrough | undefined {
  let summary = ''
  const files: WalkthroughFile[] = []
  let current: { path?: string; why: string; check: string } | undefined
  let field: 'summary' | 'why' | 'check' | undefined
  const close = (): void => {
    if (current?.path !== undefined && current.why.trim().length > 0 && !files.some((file) => file.path === current!.path)) {
      const check = current.check.trim()
      files.push({ path: current.path, why: clip(current.why.trim().replace(/\s+/g, ' '), MAX_NOTE_CHARS), ...(check.length === 0 ? {} : { check: clip(check.replace(/\s+/g, ' '), MAX_NOTE_CHARS) }) })
    }
    current = undefined
  }
  for (const line of answer.replace(/\r\n?/g, '\n').split('\n')) {
    if (END.test(line)) break
    const labelled = LABEL.exec(line)
    const label = labelled?.[1]?.toUpperCase()
    const rest = labelled?.[2] ?? ''
    if (label === 'SUMMARY') {
      field = 'summary'
      summary = rest
    } else if (label === 'FILE') {
      close()
      const path = knownPath(rest, paths)
      current = { ...(path === undefined ? {} : { path }), why: '', check: '' }
      field = undefined
    } else if (label === 'WHY' && current !== undefined) {
      field = 'why'
      current.why = rest
    } else if (label === 'CHECK' && current !== undefined) {
      field = 'check'
      current.check = rest
    } else if (field === 'summary') {
      summary += `\n${line}`
    } else if (field === 'why' && current !== undefined) {
      current.why += `\n${line}`
    } else if (field === 'check' && current !== undefined) {
      current.check += `\n${line}`
    }
  }
  close()
  const said = summary.trim().replace(/\s+/g, ' ')
  if (said.length === 0) return undefined
  return { summary: clip(said, MAX_SUMMARY_CHARS), files }
}
