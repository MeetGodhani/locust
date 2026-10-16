import { describe, expect, it } from 'vitest'

import { criteriaLines, criteriaWeights, panelVote, parseScorecard, scoreOf, weighted } from './compare-score.js'

/*
 * WEIGHTED POINTS (0.767), the canvas "Your Own Benchmark": "Score = the weighted lines met." A point ending in x2 to
 * x5 counts that many times in the score; the judges are given it without the weight and score it as any other.
 */
const CRITERIA = 'Names a price for five seats ×2\n- Says which CRM to buy\nFits in one sentence (x3)\nKeeps it short x9'
const SAID = ['SCORE A 1: met. yes', 'SCORE A 2: not met. no', 'SCORE A 3: met. yes', 'SCORE A 4: met. yes', 'SCORE B 1: not met. no', 'SCORE B 2: met. yes', 'SCORE B 3: met. yes', 'SCORE B 4: met. yes'].join('\n')

describe('a point that counts more than once', () => {
  it('reads its weight off the end of the line, and gives the judges the point without it', () => {
    expect(criteriaLines(CRITERIA)).toEqual(['Names a price for five seats', 'Says which CRM to buy', 'Fits in one sentence', 'Keeps it short x9'])
    expect(criteriaWeights(CRITERIA)).toEqual([2, 1, 3, 1])
  })

  it('scores the points met by their weight', () => {
    const card = weighted(parseScorecard(SAID, ['a', 'b'], criteriaLines(CRITERIA)), criteriaWeights(CRITERIA))!
    expect(card.weights).toEqual([2, 1, 3, 1])
    expect(scoreOf(card.verdicts.a, card.weights)).toEqual({ met: 6, of: 7 })
    expect(scoreOf(card.verdicts.b, card.weights)).toEqual({ met: 5, of: 7 })
    // Unweighted, as before.
    expect(scoreOf(card.verdicts.a)).toEqual({ met: 3, of: 4 })
  })

  it('keeps a scorecard of points that all count once as it was, and its weights through a vote', () => {
    const plain = parseScorecard(SAID, ['a', 'b'], criteriaLines('One\nTwo\nThree\nFour'))
    expect(weighted(plain, criteriaWeights('One\nTwo\nThree\nFour'))?.weights).toBeUndefined()
    const card = weighted(parseScorecard(SAID, ['a', 'b'], criteriaLines(CRITERIA)), criteriaWeights(CRITERIA))!
    expect(panelVote([card, card, card])?.weights).toEqual([2, 1, 3, 1])
  })

  it('never reads a size or a name that ends in a number as a weight (review 2026-10-15, C3)', () => {
    const inWords = ['The result is a 4x4', 'Works on Linux2', 'Draws a 3×3 grid', 'Handles empty input x3', 'Covers the edge cases(x2)'].join('\n')
    expect(criteriaLines(inWords)).toEqual(['The result is a 4x4', 'Works on Linux2', 'Draws a 3×3 grid', 'Handles empty input', 'Covers the edge cases'])
    // The last two are the controls: a weight after a space, and in brackets, still count.
    expect(criteriaWeights(inWords)).toEqual([1, 1, 1, 3, 2])
  })
})
