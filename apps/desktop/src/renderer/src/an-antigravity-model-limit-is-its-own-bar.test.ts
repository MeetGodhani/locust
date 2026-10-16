import { describe, expect, it } from 'vitest'

import { usageWindowsOf } from './missionView.js'

/*
 * The reading main sends for Antigravity 1.4.0 names a model's own limit
 * ("Gemini 4 Argon", weekly only) beside Gemini's windows (2026-10-16). Each
 * window is one bar in the agent's hover card, so the Argon line has to read
 * as a window of its own.
 */
describe("an Antigravity model's own limit is a bar of its own", () => {
  it("reads each group's windows from the reading, the model's own limit last", () => {
    const said = 'Gemini: 5-hour window 100% left · Gemini: weekly window 100% left · Gemini 4 Argon: weekly window 84% left · resets 2099-10-23T02:27:29.000Z · as of 2099-10-16T13:54:47.000Z'
    const windows = usageWindowsOf(said, new Date('2099-10-16T14:00:00Z'))
    expect(windows.map((window) => [window.name, window.remaining])).toEqual([
      ['Gemini: 5-hour window', 100],
      ['Gemini: weekly window', 100],
      ['Gemini 4 Argon: weekly window', 84]
    ])
    expect(windows[2]?.resets).toBeDefined()
    expect(windows.some((window) => window.expired === true)).toBe(false)
  })
})
