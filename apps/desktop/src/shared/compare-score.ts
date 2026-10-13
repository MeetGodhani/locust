/**
 * THE JUDGE'S SCORECARD (0.759), after Artificial Analysis's Optima, which grades each model "against custom rubric
 * criteria": the judge (0.520) still says in prose what each answer did and which it would keep, and now also scores
 * every answer on every point of what a good answer does -- met or not met, and why in a line -- so the comparison
 * shows a table under its answers rather than only a paragraph to read.
 *
 * The points are the person's own, one a line of "what a good answer does"; when they wrote none, the judge sets
 * three from the request, and the table says they are the judge's. The judge writes its scorecard in a strict line
 * form; it is read loosely (bold, bullets, "Answer A", a dash for a colon) and kept strictly: a letter that is not a
 * column, a point that was not set, or a second verdict on the same cell is left out. Nothing here keeps an answer;
 * the person does.
 */

export const MAX_SCORE_POINTS = 8
const MAX_POINT_CHARS = 160
const MAX_WHY_CHARS = 160
/** Points the judge sets when the person wrote none. */
export const JUDGE_POINTS = 3

export interface ScoreVerdict {
  readonly met: boolean
  /** Why, in the judge's words: one line. */
  readonly why: string
  /** Three judges voting (0.765): how many of the judges that scored this said met, of how many did. */
  readonly votes?: { readonly met: number; readonly of: number }
}

export interface Scorecard {
  /** What a good answer does, in order: the person's lines, or the judge's own. */
  readonly points: readonly string[]
  /** The judge set the points itself: the person wrote none. */
  readonly byJudge: boolean
  /** Each column's verdict on each point, in the points' order; undefined where the judge gave none. */
  readonly verdicts: Readonly<Record<string, readonly (ScoreVerdict | undefined)[]>>
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** The person's points: one a line, a list's bullet or number taken off, at most `MAX_SCORE_POINTS`. */
export function criteriaLines(criteria: string | undefined): readonly string[] {
  if (criteria === undefined) return []
  return criteria
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_SCORE_POINTS)
    .map((line) => clip(line, MAX_POINT_CHARS))
}

/** What the judge is asked for, after its view: the points (its own, when the person gave none), then the scores. */
export function scorecardRequest(points: readonly string[], letters: readonly string[]): string {
  const first = letters[0] ?? 'A'
  const second = letters[1] ?? first
  const form = [
    'Score every answer on every point, one line each, in exactly this form and with nothing else on the line:',
    `SCORE ${first} 1: met. <why, in at most twelve words>`,
    `SCORE ${second} 1: not met. <why, in at most twelve words>`
  ].join('\n')
  if (points.length > 0) {
    return [
      'Last, after your view, a scorecard. The points to score are what the person says a good answer does:',
      points.map((point, index) => `${String(index + 1)}. ${point}`).join('\n'),
      form
    ].join('\n\n')
  }
  return [
    `Last, after your view, a scorecard. First set ${String(JUDGE_POINTS)} points a good answer to this request must meet, one line each, in exactly this form:`,
    Array.from({ length: JUDGE_POINTS }, (_unused, index) => `POINT ${String(index + 1)}: <a point, in at most ten words>`).join('\n'),
    `Then ${form.charAt(0).toLowerCase()}${form.slice(1)}`
  ].join('\n\n')
}

// A line of the scorecard, read loosely: bullets, bold and code marks, "Answer A", "point 2", a dash for a colon.
const plain = (line: string): string => line.replace(/[*_`]/g, '').replace(/^\s*(?:[-•>]\s*)+/, '').trim()
const POINT_LINE = /^POINT\s*(\d{1,2})\s*[:.\-–—]\s*(.+)$/i
const SCORE_LINE = /^SCORE\s*:?\s*(?:answer\s+)?([a-z])\s*[,:]?\s*(?:point\s*)?(\d{1,2})\s*[:.\-–—]\s*(not\s+met|met)\b[\s.:;,\-–—]*(.*)$/i
const HEADING_LINE = /^#{0,6}\s*(?:the\s+)?score\s*card\s*:?$/i

/** The scorecard in the judge's answer, or undefined when it gave none to read. */
export function parseScorecard(text: string, slots: readonly string[], given: readonly string[]): Scorecard | undefined {
  const lines = text.split(/\r?\n/).map(plain)
  const byJudge = given.length === 0
  let points: readonly string[] = given
  if (byJudge) {
    const set: string[] = []
    for (const line of lines) {
      const point = POINT_LINE.exec(line)
      if (point === null) continue
      const at = Number(point[1])
      // In order from 1, each once: a point out of order or said twice is not a point.
      if (at === set.length + 1 && set.length < MAX_SCORE_POINTS) set.push(clip(point[2] ?? '', MAX_POINT_CHARS))
    }
    points = set.filter((point) => point.length > 0)
  }
  if (points.length === 0) return undefined
  const verdicts: Record<string, (ScoreVerdict | undefined)[]> = Object.fromEntries(slots.map((slot) => [slot, points.map(() => undefined)]))
  let read = 0
  for (const line of lines) {
    const score = SCORE_LINE.exec(line)
    if (score === null) continue
    const slot = (score[1] ?? '').toLowerCase()
    const at = Number(score[2]) - 1
    const row = verdicts[slot]
    if (row === undefined || at < 0 || at >= points.length || row[at] !== undefined) continue
    row[at] = { met: !/^not/i.test(score[3] ?? ''), why: clip(score[4] ?? '', MAX_WHY_CHARS) }
    read += 1
  }
  return read === 0 ? undefined : { points, byJudge, verdicts }
}

// A scorecard line still being written ("SCORE B 2: no"): the form's own capitals, which prose does not start a line with.
const BEING_WRITTEN = /^(?:SCORE|POINT)\b/

/** The judge's prose without its scorecard lines, which the table says -- and without one still being written. */
export function withoutScorecard(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const bare = plain(line)
      return !POINT_LINE.test(bare) && !SCORE_LINE.test(bare) && !HEADING_LINE.test(bare) && !BEING_WRITTEN.test(bare)
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * THREE JUDGES VOTING (0.765), as the canvas has it: "A line counts when two of three agree." Each judge scored the
 * same points, the person's, on its own. A point is met when more of the judges that scored it said met than not -- a
 * split of two is not met -- and its why is the first agreeing judge's. A judge whose scorecard could not be read, or
 * that scored other points, has no vote. Undefined when none could be read.
 */
export function panelVote(cards: readonly (Scorecard | undefined)[]): Scorecard | undefined {
  const read = cards.filter((card): card is Scorecard => card !== undefined)
  const first = read[0]
  if (first === undefined) return undefined
  const same = read.filter((card) => card.points.length === first.points.length && card.points.every((point, index) => point === first.points[index]))
  const verdicts = Object.fromEntries(Object.keys(first.verdicts).map((slot) => [slot, first.points.map((_point, index): ScoreVerdict | undefined => {
    const cast = same.flatMap((card) => {
      const verdict = card.verdicts[slot]?.[index]
      return verdict === undefined ? [] : [verdict]
    })
    if (cast.length === 0) return undefined
    const met = cast.filter((verdict) => verdict.met).length
    const passed = met * 2 > cast.length
    return { met: passed, why: cast.find((verdict) => verdict.met === passed)?.why ?? '', votes: { met, of: cast.length } }
  })]))
  return { points: first.points, byJudge: first.byJudge, verdicts }
}

/** The judges' pick: the answer more than half of those that answered would keep, or none when they do not agree. */
export function panelPick<T extends string>(picks: readonly (T | undefined)[], answered: number): T | undefined {
  const counted = new Map<T, number>()
  for (const pick of picks) if (pick !== undefined) counted.set(pick, (counted.get(pick) ?? 0) + 1)
  return [...counted].find(([, count]) => count * 2 > answered)?.[0]
}

/** Points a draft holds (0.766): enough to say what a good answer does, few enough to read and edit. */
export const DRAFT_MIN_POINTS = 3
export const DRAFT_MAX_POINTS = 5

/**
 * DRAFT THE POINTS (0.766), the canvas's "Locust drafts that list (the rubric) from the task with a cheap model. You
 * edit it." What the model is asked: not to answer, only to say what a good answer must do, in the scorecard's own
 * POINT form so it is read as a judge's points are.
 */
export function pointsDraftRequest(ask: string): string {
  return [
    'Several AI models are about to be compared on this request:',
    clip(ask, 4_000),
    `Do not answer it. Write the points a good answer to it must meet, so that a judge can check each one: ${String(DRAFT_MIN_POINTS)} to ${String(DRAFT_MAX_POINTS)} of them, each specific and checkable, one line each, in exactly this form and with nothing else:`,
    'POINT 1: <a point, in at most ten words>\nPOINT 2: <a point, in at most ten words>'
  ].join('\n\n')
}

/** The points in a draft, in order from 1, each once; at most `DRAFT_MAX_POINTS`. */
export function draftedPoints(text: string): readonly string[] {
  const set: string[] = []
  for (const line of text.split(/\r?\n/).map(plain)) {
    const point = POINT_LINE.exec(line)
    if (point !== null && Number(point[1]) === set.length + 1 && set.length < DRAFT_MAX_POINTS) set.push(clip(point[2] ?? '', MAX_POINT_CHARS))
  }
  return set.filter((point) => point.length > 0)
}

/** How many points a column met, of how many were scored. */
export function scoreOf(row: readonly (ScoreVerdict | undefined)[] | undefined): { readonly met: number; readonly of: number } {
  const scored = (row ?? []).filter((verdict): verdict is ScoreVerdict => verdict !== undefined)
  return { met: scored.filter((verdict) => verdict.met).length, of: (row ?? []).length }
}
