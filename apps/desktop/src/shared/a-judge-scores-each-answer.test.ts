import { describe, expect, it } from 'vitest'

import { criteriaLines, JUDGE_POINTS, MAX_SCORE_POINTS, parseScorecard, scoreOf, scorecardRequest, withoutScorecard } from './compare-score.js'

/*
 * A JUDGE SCORES EACH ANSWER (0.759), after Artificial Analysis's Optima. Colin, 2026-10-12, of Optima: "would
 * probably be a cool implementation for our arena/compare", and of its design, "make sure its polished". The judge
 * still writes its view; now every answer is also met or not met on every point of what a good answer does.
 */
describe('the points', () => {
  it("are the person's, one a line, a list's bullet or number taken off, eight at most", () => {
    expect(criteriaLines('- Exactly four lines\n2. About a swarm at dusk\n\n* Rhymes')).toEqual(['Exactly four lines', 'About a swarm at dusk', 'Rhymes'])
    expect(criteriaLines(Array.from({ length: 12 }, (_unused, index) => `Point ${String(index + 1)}`).join('\n'))).toHaveLength(MAX_SCORE_POINTS)
    expect(criteriaLines(undefined)).toEqual([])
    expect(criteriaLines('  \n ')).toEqual([])
  })

  it("are asked for after the judge's view: the person's numbered, or three of its own to set first", () => {
    const given = scorecardRequest(['Exactly four lines', 'Rhymes'], ['A', 'B'])
    expect(given).toContain('1. Exactly four lines\n2. Rhymes')
    expect(given).toContain('SCORE A 1: met. <why, in at most twelve words>')
    expect(given).toContain('SCORE B 1: not met. <why, in at most twelve words>')
    const own = scorecardRequest([], ['A', 'B', 'C'])
    expect(own).toContain(`First set ${String(JUDGE_POINTS)} points`)
    expect(own).toContain('POINT 1: <a point, in at most ten words>\nPOINT 2: <a point, in at most ten words>\nPOINT 3: <a point, in at most ten words>')
  })
})

describe('the scorecard', () => {
  const said = [
    'Answer A keeps to four lines and rhymes throughout. Answer B rhymes only half the time.',
    'I would keep Answer A.',
    '',
    '**Scorecard**',
    '- **SCORE A 1: met.** Four lines exactly.',
    '- SCORE Answer A, point 2 - met - every pair rhymes',
    'SCORE B 1: met. Four lines.',
    'SCORE B 2: not met. Lines 1 and 3 do not rhyme.',
    'SCORE B 2: met. A second verdict on the same cell is not read.',
    'SCORE C 1: met. There is no column C.',
    'SCORE A 3: met. There is no point 3.'
  ].join('\n')

  it('is read loosely -- bold, bullets, "Answer A", "point 2", a dash -- and kept strictly', () => {
    const card = parseScorecard(said, ['a', 'b'], ['Exactly four lines', 'Each pair rhymes'])
    expect(card?.byJudge).toBe(false)
    expect(card?.points).toEqual(['Exactly four lines', 'Each pair rhymes'])
    expect(card?.verdicts.a).toEqual([{ met: true, why: 'Four lines exactly.' }, { met: true, why: 'every pair rhymes' }])
    expect(card?.verdicts.b).toEqual([{ met: true, why: 'Four lines.' }, { met: false, why: 'Lines 1 and 3 do not rhyme.' }])
    expect(card?.verdicts).not.toHaveProperty('c')
  })

  it("takes the judge's own points, in order from one, when the person wrote none", () => {
    const own = ['POINT 1: Four lines', 'POINT 3: Out of order', 'POINT 2: About a swarm', 'SCORE A 1: met. Yes.', 'SCORE A 2: not met. A field, not a swarm.'].join('\n')
    const card = parseScorecard(own, ['a', 'b'], [])
    expect(card?.byJudge).toBe(true)
    expect(card?.points).toEqual(['Four lines', 'About a swarm'])
    expect(card?.verdicts.a).toEqual([{ met: true, why: 'Yes.' }, { met: false, why: 'A field, not a swarm.' }])
    // A cell the judge left out is no verdict, never a guess.
    expect(card?.verdicts.b).toEqual([undefined, undefined])
  })

  it('is nothing when the judge gave none to read: its view still stands on its own', () => {
    expect(parseScorecard('I would keep Answer A.', ['a', 'b'], ['Four lines'])).toBeUndefined()
    expect(parseScorecard('SCORE A 1: met. Yes.', ['a', 'b'], [])).toBeUndefined()
  })

  it('counts what each column met, of every point', () => {
    expect(scoreOf([{ met: true, why: '' }, { met: false, why: '' }, undefined])).toEqual({ met: 1, of: 3 })
    expect(scoreOf(undefined)).toEqual({ met: 0, of: 0 })
  })
})

describe("the judge's view", () => {
  it('is drawn without its scorecard, which the table says -- and without a line of it still being written', () => {
    expect(withoutScorecard('Answer A is better.\n\n**Scorecard**\nSCORE A 1: met. Yes.\nPOINT 1: Four lines')).toBe('Answer A is better.')
    expect(withoutScorecard('Answer A is better.\n\nSCORE B 2: no')).toBe('Answer A is better.')
    // Prose that only starts with the word keeps its place.
    expect(withoutScorecard('Score aside, both read well.')).toBe('Score aside, both read well.')
  })
})
