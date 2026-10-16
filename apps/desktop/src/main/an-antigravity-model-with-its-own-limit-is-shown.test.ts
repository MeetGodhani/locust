import { describe, expect, it } from 'vitest'

import { antigravityUsageText } from './antigravity-usage.js'

/*
 * Antigravity 1.4.0 answers `/usage` with a third group, "Gemini 4 Argon",
 * that has only a weekly window (seen on Colin's account 2026-10-16). A group
 * this did not know, or one a window short, threw the whole reading away, so
 * Antigravity's usage disappeared from the app. The numbers here are made up;
 * the shape is the CLI's.
 */
const bucket = (window: string, remaining_fraction: number) => ({ window, remaining_fraction, reset_time: '2099-10-23T02:27:29Z' })
const answer = (groups: unknown[]) => ({ status: 'SUCCESS', num_turns: 0, command: { name: 'usage', data: { groups } } })
const gemini = (remaining = 1) => ({ name: 'Gemini Models', buckets: [bucket('weekly', remaining), bucket('5h', remaining)] })
const claude = (remaining = 1) => ({ name: 'Claude and GPT models', buckets: [bucket('weekly', remaining), bucket('5h', remaining)] })
const argon = (remaining: number) => ({ name: 'Gemini 4 Argon', buckets: [bucket('weekly', remaining)] })
const reset = ' · resets 2099-10-23T02:27:29.000Z'

describe('an Antigravity model with a limit of its own is shown', () => {
  it("reads the 1.4.0 answer: a lower Argon weekly limit joins Gemini's windows", () => {
    expect(antigravityUsageText(answer([gemini(), claude(), argon(0.84)]))).toBe(
      `Gemini: 5-hour window 100% left · Gemini: weekly window 100% left · Gemini 4 Argon: weekly window 84% left${reset}`)
  })

  it('leaves Argon out while it has more left than Gemini, as it does Claude and GPT', () => {
    expect(antigravityUsageText(answer([gemini(0.5), claude(), argon(0.9)]))).toBe(
      `Gemini: 5-hour window 50% left${reset} · Gemini: weekly window 50% left${reset}`)
  })

  it('shows a group with one window, and leaves out a window it has no words for', () => {
    const daily = { name: 'Gemini Models', buckets: [bucket('weekly', 0.6), bucket('daily', 0.1)] }
    expect(antigravityUsageText(answer([daily]))).toBe(`Gemini: weekly window 60% left${reset}`)
  })

  it('reads an answer with no Gemini group from its first group', () => {
    expect(antigravityUsageText(answer([argon(0.3), claude(0.2)]))).toBe(
      `Gemini 4 Argon: weekly window 30% left${reset} · Claude and GPT: 5-hour window 20% left${reset} · Claude and GPT: weekly window 20% left${reset}`)
  })

  it.each([42, '', ' ', 'x'.repeat(41), 'Gemini · Pro', '50% Pro', 'line\nbreak'])('skips a group whose name cannot be shown (%j) and keeps the rest', (name) => {
    expect(antigravityUsageText(answer([gemini(0.9), { name, buckets: [bucket('weekly', 0.1)] }]))).toBe(
      `Gemini: 5-hour window 90% left${reset} · Gemini: weekly window 90% left${reset}`)
  })

  it('still says nothing when no group can be read', () => {
    expect(antigravityUsageText(answer([]))).toBeUndefined()
    expect(antigravityUsageText(answer([{ name: 'Gemini Models', buckets: [bucket('daily', 0.5)] }]))).toBeUndefined()
  })
})
