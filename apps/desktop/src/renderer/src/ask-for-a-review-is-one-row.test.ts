import { expect, it } from 'vitest'

import { reviewMenuItem } from './reviewMenu.js'

/**
 * ASK FOR A REVIEW IS ONE ROW (0.799). Colin, 2026-10-19: "ask for a review should prob be folded into a dropdown".
 * Several reviewers open beside one row; one alone says who; none is no row.
 */
type T = { readonly name: string; readonly agent: string }
const BRO: T = { name: 'Bro', agent: 'Claude Code' }
const SCOUT: T = { name: 'Scout', agent: 'OpenCode' }
const CASPER: T = { name: 'Casper', agent: 'Codex CLI' }
const asked: string[] = []
const item = (reviewers: readonly T[], pair?: readonly [T, T]) =>
  reviewMenuItem(reviewers, pair, (one) => one.agent, (one) => asked.push(one.name), (two) => asked.push(`${two[0].name}+${two[1].name}`))

it('folds several reviewers and the pair into one row that opens beside it', () => {
  const row = item([BRO, SCOUT, CASPER], [BRO, SCOUT])
  expect(row?.label).toBe('Ask for a review')
  expect(row?.onSelect).toBeUndefined()
  expect(row?.submenu?.map((one) => one.label)).toEqual(['Bro', 'Scout', 'Casper', 'Bro (Claude Code) and Scout (OpenCode)'])
  expect(row?.submenu?.[3]?.dividerAbove).toBe(true)
  row?.submenu?.[1]?.onSelect?.()
  row?.submenu?.[3]?.onSelect?.()
  expect(asked.slice(-2)).toEqual(['Scout', 'Bro+Scout'])
})

it('keeps a lone reviewer one row that says who, and offers nothing with nobody to ask', () => {
  const row = item([CASPER])
  expect(row?.label).toBe('Ask Casper for a review')
  expect(row?.submenu).toBeUndefined()
  row?.onSelect?.()
  expect(asked.at(-1)).toBe('Casper')
  expect(item([])).toBeUndefined()
})
