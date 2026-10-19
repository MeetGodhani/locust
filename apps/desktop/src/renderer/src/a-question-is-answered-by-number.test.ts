import { expect, it } from 'vitest'

import { numberKeyAnswer } from './questionKeys.js'

/**
 * A QUESTION IS ANSWERED BY NUMBER (0.801), as Claude Code's own question card is: 1 to 9 choose that option of the
 * question being answered. The roadmap's "number-key card answers" (2026-10-18).
 */
const QUESTIONS = [
  { id: 'q1', options: ['Postgres', 'SQLite', 'Keep the JSON file'] },
  { id: 'q2', options: ['Yes', 'No'] },
  { id: 'q3', options: [] }
]
const at = (key: string, change: Partial<Parameters<typeof numberKeyAnswer>[0]> = {}) =>
  numberKeyAnswer({ key, modified: false, typing: false, questions: QUESTIONS, chosen: {}, ...change })

it('chooses that option of the first question still without one', () => {
  expect(at('2')).toEqual({ questionId: 'q1', label: 'SQLite' })
  expect(at('1', { chosen: { q1: 'SQLite' } })).toEqual({ questionId: 'q2', label: 'Yes' })
})

it('answers the question the focus is in, even one already answered', () => {
  expect(at('3', { chosen: { q1: 'SQLite' }, focusedQuestion: 'q1' })).toEqual({ questionId: 'q1', label: 'Keep the JSON file' })
})

it('does nothing while typing, with a modifier held, past the options, or for other keys', () => {
  expect(at('1', { typing: true })).toBeUndefined()
  expect(at('1', { modified: true })).toBeUndefined()
  expect(at('4')).toBeUndefined()
  expect(at('0')).toBeUndefined()
  expect(at('a')).toBeUndefined()
  expect(at('Enter')).toBeUndefined()
})

it('does nothing once every question with options has its answer, unless the focus says which', () => {
  expect(at('1', { chosen: { q1: 'Postgres', q2: 'No' } })).toBeUndefined()
  expect(at('2', { chosen: { q1: 'Postgres', q2: 'Yes' }, focusedQuestion: 'q2' })).toEqual({ questionId: 'q2', label: 'No' })
})
