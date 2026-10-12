import { describe, expect, it } from 'vitest'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import { museModelsFrom } from './model-catalog.js'

/*
 * Muse Wonder came out on 2026-10-12, "through the Meta Model API and Muse Code" (Meta). Muse Code's CLI lists no
 * models, so Locust offered none and every Muse teammate ran on whatever the CLI chose -- which on 1.4.6 that day was
 * already Muse Wonder 1.0, though nothing said so and nothing else could be picked. Measured that day: a name Meta
 * does not serve ends "does not exist or you lack access" before any model is asked; these two answered.
 */
const muse = (readiness: RuntimeDiscovery['readiness']): RuntimeDiscovery => ({ id: 'muse', readiness } as unknown as RuntimeDiscovery)

describe("Muse Code's models", () => {
  it('are Muse Wonder 1.0 first, then Muse Spark 1.3, each with Muse Code\'s own eight efforts at its default', () => {
    const models = museModelsFrom([muse('ready')])
    expect(models.map((model) => [model.id, model.displayName])).toEqual([['muse-wonder-1.0', 'Muse Wonder 1.0'], ['muse-spark-1.3', 'Muse Spark 1.3']])
    for (const model of models) {
      expect(model.runtime).toBe('muse')
      expect(model.supportedEfforts).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
      expect(model.defaultEffort).toBe('high')
    }
  })

  it('are offered only when Muse Code is ready here', () => {
    expect(museModelsFrom([muse('unknown')])).toEqual([])
    expect(museModelsFrom([])).toEqual([])
  })
})
