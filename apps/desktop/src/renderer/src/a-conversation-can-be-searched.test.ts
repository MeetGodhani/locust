import { describe, expect, it } from 'vitest'

import { findCountWords, findIn, MAX_FIND_HITS, stepHit } from './threadFind.js'

/*
 * FIND IN A CONVERSATION (0.769): a query is found in the conversation's text as the reader sees it, case aside --
 * across a bold word or a code span in a sentence -- and every hit says where it starts and ends in the page's own
 * pieces of text, which is what the highlight is drawn from.
 */
describe('finding words in a conversation', () => {
  it('finds every place the words are, whatever their case', () => {
    expect(findIn(['The deploy failed. Deploy again?'], 'deploy')).toEqual([
      { from: [0, 4], to: [0, 10] },
      { from: [0, 19], to: [0, 25] }
    ])
  })

  it('finds words that cross a bold word or a code span, and ends inside the piece that holds the last letter', () => {
    // "Run " + "npm test" (a code span) + " again": the query spans all three pieces.
    expect(findIn(['Run ', 'npm test', ' again'], 'run npm test a')).toEqual([{ from: [0, 0], to: [2, 2] }])
    // A match that ends exactly where a piece ends stays in it, not at the start of the next.
    expect(findIn(['Run ', 'npm test', ' again'], 'npm test')).toEqual([{ from: [1, 0], to: [1, 8] }])
    // Empty pieces in between change nothing.
    expect(findIn(['ab', '', 'cd'], 'bc')).toEqual([{ from: [0, 1], to: [2, 1] }])
  })

  it('takes what is typed as words, never as a pattern', () => {
    expect(findIn(['cost (USD): $4.20 vs $4x20'], '$4.20')).toEqual([{ from: [0, 12], to: [0, 17] }])
    expect(findIn(['a+b and a*b'], 'a*b')).toEqual([{ from: [0, 8], to: [0, 11] }])
  })

  it('finds nothing for an empty or blank query, and stops at the most it looks for', () => {
    expect(findIn(['anything'], '')).toEqual([])
    expect(findIn(['anything'], '   ')).toEqual([])
    expect(findIn([], 'a')).toEqual([])
    expect(findIn(['a'.repeat(MAX_FIND_HITS + 50)], 'a')).toHaveLength(MAX_FIND_HITS)
  })
})

describe('the find bar', () => {
  it('counts the hit it is on, says when there are none, and says nothing before anything is typed', () => {
    expect(findCountWords(12, 2, 'deploy')).toBe('3 of 12')
    expect(findCountWords(0, 0, 'deploy')).toBe('No matches')
    expect(findCountWords(0, 0, '')).toBe('')
    expect(findCountWords(MAX_FIND_HITS, 0, 'a')).toBe(`1 of ${String(MAX_FIND_HITS)}+`)
  })

  it('steps to the next hit and the one before, round the end and back to the start', () => {
    expect(stepHit(0, 3, false)).toBe(1)
    expect(stepHit(2, 3, false)).toBe(0)
    expect(stepHit(0, 3, true)).toBe(2)
    expect(stepHit(0, 0, false)).toBe(0)
  })
})
