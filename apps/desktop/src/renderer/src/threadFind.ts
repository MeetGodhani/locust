/**
 * FIND IN A CONVERSATION (0.769). From the t3code scrub of 2026-10-13 ("find messages and plans in the current
 * thread"), which Colin took whole: "ill run with all your recs". Locust had no find at all -- Electron gives a window
 * none of its own -- so a long conversation could only be scrolled.
 *
 * A query is looked for in the conversation's text as the reader sees it, its letters' case aside. That text is the
 * page's own text nodes, so a match can cross a bold word or a code span in a sentence: each hit is said as the piece
 * it starts in and the piece it ends in, with the offset in each, which is what a DOM Range is made from.
 */
export interface FindHit {
  /** The piece the match starts in, and the offset of its first letter there. */
  readonly from: readonly [number, number]
  /** The piece it ends in, and the offset just past its last letter there. */
  readonly to: readonly [number, number]
}

/** The most hits looked for: a one-letter search in a long conversation still answers at once. */
export const MAX_FIND_HITS = 2000

export function findIn(pieces: readonly string[], query: string, max: number = MAX_FIND_HITS): readonly FindHit[] {
  if (query.trim().length === 0 || pieces.length === 0) return []
  const starts: number[] = []
  let length = 0
  for (const piece of pieces) {
    starts.push(length)
    length += piece.length
  }
  const text = pieces.join('')
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const hits: FindHit[] = []
  // Matches come in order, so the piece a match starts in only moves forward.
  let piece = 0
  for (const match of text.matchAll(pattern)) {
    if (hits.length >= max) break
    const start = match.index
    const end = start + match[0].length
    while (piece < pieces.length - 1 && start >= starts[piece]! + pieces[piece]!.length) piece += 1
    // The end belongs to the piece holding the match's last letter, so an end at a piece's edge stays in that piece.
    let last = piece
    while (last < pieces.length - 1 && end > starts[last]! + pieces[last]!.length) last += 1
    hits.push({ from: [piece, start - starts[piece]!], to: [last, end - starts[last]!] })
  }
  return hits
}

/** "3 of 12", "No matches", or nothing before anything is asked. */
export function findCountWords(hits: number, current: number, query: string): string {
  if (query.trim().length === 0) return ''
  if (hits === 0) return 'No matches'
  return `${String(Math.min(current, hits - 1) + 1)} of ${hits >= MAX_FIND_HITS ? `${String(MAX_FIND_HITS)}+` : String(hits)}`
}

/** The next hit, or the one before, round the end and back to the start. */
export function stepHit(current: number, hits: number, back: boolean): number {
  if (hits === 0) return 0
  return back ? (current - 1 + hits) % hits : (current + 1) % hits
}
