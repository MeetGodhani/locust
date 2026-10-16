import { describe, expect, it } from 'vitest'

import type { PublicModel } from '../../shared/ipc.js'
import { routeFamilyName } from './routeName.js'

// 2026-10-16: a compare column on Cursor's Gemini 4 Argon, its effort set to High, read "Gemini 4 Argon Low" -- the
// id it stands on names Low -- and went out labelled "Gemini 4 Argon Low · High".
const ARGON: PublicModel = {
  id: 'gemini-4-argon-low',
  runtime: 'cursor',
  displayName: 'Gemini 4 Argon',
  description: '',
  supportedEfforts: ['low', 'medium', 'high'],
  variants: { low: 'gemini-4-argon-low', medium: 'gemini-4-argon-medium', high: 'gemini-4-argon-high' }
}
const resolved = new Map([['cursor:gemini-4-argon-low', 'Gemini 4 Argon Low']])

describe('a compare column is named by its family', () => {
  it('Cursor’s Argon on its Low id is "Gemini 4 Argon", the level being its own control', () => {
    expect(routeFamilyName({ runtime: 'cursor', model: 'gemini-4-argon-low' }, resolved, [ARGON])).toBe('Gemini 4 Argon')
    expect(routeFamilyName({ runtime: 'cursor', model: 'gemini-4-argon-high' }, new Map(), [ARGON])).toBe('Gemini 4 Argon')
  })
  it('before the catalogue answers, the route is named as before', () => {
    expect(routeFamilyName({ runtime: 'cursor', model: 'gemini-4-argon-low' }, resolved, [])).toBe('Gemini 4 Argon Low')
  })
})
