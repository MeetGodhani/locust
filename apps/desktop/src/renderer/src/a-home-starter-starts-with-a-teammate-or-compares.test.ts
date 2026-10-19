import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { STARTERS } from './components/StarterList.js'

/**
 * A HOME STARTER STARTS WITH A TEAMMATE, OR COMPARES (2026-10-19). Colin, of Claude Code's starter rows beside
 * Locust's "Try two models on" chips: "maybe with a compare button or dropdown beside it? so the user can decide
 * whether to start it with a teammate or compare different models", and then "ill run with your recommendations":
 * a row each, the row for the teammate, a quiet Compare beside it, nothing sent until Send.
 */
describe('the Home starters', () => {
  it('are four rows, each saying what it does', () => {
    expect(STARTERS.map((starter) => starter.label)).toEqual(['Plan before building', 'Debug an issue', 'Review my changes', 'Build a landing page'])
    for (const starter of STARTERS) {
      expect(starter.line.length).toBeGreaterThan(10)
      expect(starter.prompt.length).toBeGreaterThan(20)
    }
  })

  it('suit their mode: a plan changes nothing yet, and a review only reads', () => {
    const plan = STARTERS.find((starter) => starter.id === 'plan')!
    expect(plan.mode).toBe('plan')
    expect(plan.compareChanges).toBe(false)
    const review = STARTERS.find((starter) => starter.id === 'review')!
    expect(review.mode).toBe('ask')
    expect(review.prompt).toMatch(/Change nothing\.$/)
    expect(review.compareChanges).toBe(false)
    // A fix and a page are compared as work, each model in its own copy.
    expect(STARTERS.filter((starter) => starter.compareChanges).map((starter) => starter.id)).toEqual(['debug', 'page'])
  })

  it('leave the words for the person to finish where the ask needs them', () => {
    for (const id of ['plan', 'debug']) expect(STARTERS.find((starter) => starter.id === id)!.prompt).toMatch(/: $/)
  })

  it('draw a Compare beside every row, and fill the box rather than send', () => {
    const list = readFileSync(join(import.meta.dirname, 'components', 'StarterList.tsx'), 'utf8')
    expect(list).toMatch(/className="lc-homestart__start"[\s\S]*onClick=\{\(\) => onStart\(starter\)\}/)
    expect(list).toMatch(/className="lc-homestart__compare"[\s\S]*onClick=\{\(\) => onCompareStart\(starter\)\}/)
    const app = readFileSync(join(import.meta.dirname, 'App.tsx'), 'utf8')
    const wiring = app.slice(app.indexOf('onStarter={(starter) => {'), app.indexOf('onCheckAgain={'))
    expect(wiring).toMatch(/setComposerFill\(/)
    expect(wiring).toMatch(/setCompareChanges\(starter\.compareChanges\)/)
    expect(wiring).not.toMatch(/send\(|startMission\(|submit\(/i)
  })
})
