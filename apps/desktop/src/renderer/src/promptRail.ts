/**
 * The prompt rail: one mark per message you sent, once a conversation is long
 * enough to be worth jumping through.
 *
 * Fewer than four of your messages, a thread that does not scroll, a compare
 * column, or a thread too narrow to spare the strip: no rail. Positions are
 * measured when the layout changes. The current mark is whichever of those
 * positions sits nearest the top of the view.
 */

/** How many of your own messages a conversation needs before the rail appears. */
export const PROMPT_RAIL_MIN = 4

/** Clear pixels the strip needs to the right of the words, so it never sits on them. */
export const PROMPT_RAIL_ROOM = 18

/** Said on the hover, and the keys `promptRailStep` accepts. */
export const PROMPT_RAIL_KEYS = 'Ctrl+Alt+Up and Ctrl+Alt+Down'

const HOVER_LIMIT = 72

/** The first line of a message, as the hover should read it. */
export function promptRailLine(text: string): string {
  const raw = text.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  const plain = raw
    .replace(/^#{1,6}\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= HOVER_LIMIT) return plain
  return `${plain.slice(0, HOVER_LIMIT - 1).trimEnd()}…`
}

export function promptRailScrollable(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1
}

/** Space between the words and the scrollbar. The strip lives here, or not at all. */
export function promptRailRoom(input: {
  readonly threadRight: number
  readonly scrollbar: number
  readonly paddingRight: number
  readonly columnRight: number
}): number {
  return input.threadRight - input.scrollbar - input.paddingRight - input.columnRight
}

export function promptRailShows(input: {
  readonly messages: number
  readonly scrollable: boolean
  readonly compare: boolean
  readonly room: number
}): boolean {
  return input.messages >= PROMPT_RAIL_MIN && input.scrollable && !input.compare && input.room >= PROMPT_RAIL_ROOM
}

/** Where a mark sits on the strip: 0 at the top of the thread, 1 at the bottom. */
export function promptMarkPlace(messageTop: number, threadHeight: number): number {
  if (threadHeight <= 0) return 0
  return Math.min(1, Math.max(0, messageTop / threadHeight))
}

/** The message whose top is nearest the top of the view. A tie keeps the earlier one. */
export function currentPromptMark(tops: readonly number[], viewTop: number): number {
  let best = 0
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < tops.length; index += 1) {
    const next = Math.abs((tops[index] ?? 0) - viewTop)
    if (next < distance) {
      best = index
      distance = next
    }
  }
  return best
}

export interface RailKey {
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly key: string
}

/**
 * Ctrl+Alt+Up / Ctrl+Alt+Down move among your own messages.
 * Alt+Up and Alt+Down stay the conversation step; they do not match here.
 */
export function promptRailStep(event: RailKey): -1 | 1 | undefined {
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return undefined
  if (event.key === 'ArrowUp') return -1
  if (event.key === 'ArrowDown') return 1
  return undefined
}

/** Reduced motion jumps and does not flash the line. Otherwise the jump eases, and the line is marked the way Find marks a match. */
export function promptRailMotion(reduced: boolean): { readonly scroll: 'auto' | 'smooth'; readonly highlight: boolean } {
  return reduced ? { scroll: 'auto', highlight: false } : { scroll: 'smooth', highlight: true }
}
