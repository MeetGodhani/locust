import { describe, expect, it } from 'vitest'

import { cursorChoiceFor, cursorModelsFrom } from './model-catalog.js'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

// 2026-10-16: a teammate saved as Gemini 4 Argon at High (`gemini-4-argon-low` + `high`), sent seconds after launch,
// before Cursor's list reached the window, went out as both and Cursor's builder refused it: "Cursor Agent takes no
// effort level". The run's own discovery has the list, so the start turns the level into its id.
const cursor = {
  id: 'cursor',
  readiness: 'ready',
  modelHints: {
    models: [
      { id: 'gemini-4-argon-low', displayName: 'Gemini 4 Argon Low' },
      { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon Medium' },
      { id: 'gemini-4-argon-high', displayName: 'Gemini 4 Argon High' },
      { id: 'composer-2.5', displayName: 'Composer 2.5' }
    ]
  }
} as unknown as RuntimeDiscovery
const models = cursorModelsFrom([cursor])

describe('a Cursor level becomes its id at the start of the run', () => {
  it('Argon Low at High starts as gemini-4-argon-high, with no level beside it', () => {
    expect(cursorChoiceFor(models, 'gemini-4-argon-low', 'high')).toEqual({ model: 'gemini-4-argon-high' })
  })
  it('an id already on its level is left as it is', () => {
    expect(cursorChoiceFor(models, 'gemini-4-argon-high', undefined)).toEqual({ model: 'gemini-4-argon-high' })
  })
  it('a level the family does not list, or a model not listed, is left as it came for the builder to refuse', () => {
    expect(cursorChoiceFor(models, 'gemini-4-argon-low', 'xhigh')).toEqual({ model: 'gemini-4-argon-low', effort: 'xhigh' })
    expect(cursorChoiceFor([], 'gemini-4-argon-low', 'high')).toEqual({ model: 'gemini-4-argon-low', effort: 'high' })
  })
  it('no model: the account default, with nothing to turn', () => {
    expect(cursorChoiceFor(models, undefined, undefined)).toEqual({})
  })
})
