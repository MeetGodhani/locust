import { describe, expect, it } from 'vitest'

import { claudeConnectorRules, connectorsOn } from './codex-mission.js'

/**
 * ASK ASKS BEFORE A CONNECTOR (0.545).
 *
 * MEASURED 2026-10-03 with a test MCP server (a read-only `peek`, a `poke`
 * that writes a file): Claude Code's own plan mode asked before both; Codex's
 * read-only sandbox ran `peek` and refused `poke`. Locust's Ask pre-approved
 * every connector a teammate was given, so a changing one ran without a word.
 * Colin: "i just want it to work the way the actual models do."
 */
describe('the connectors a Claude run is pre-approved for', () => {
  it('are none in Ask or Plan: every call goes to the card', () => {
    expect(claudeConnectorRules('read-only', false, ['robinhood', 'github'])).toEqual({})
  })

  it('are the named ones in Edit, as before', () => {
    expect(claudeConnectorRules('workspace-write', false, ['github'])).toEqual({ connectors: ['github'] })
  })

  it('are none when the person asked to be asked about every one, or none are named', () => {
    expect(claudeConnectorRules('workspace-write', true, ['github'])).toEqual({})
    expect(claudeConnectorRules('workspace-write', false, [])).toEqual({})
  })
})

describe('a teammate with no connector ticked (0.798)', () => {
  it('runs without the person’s connectors, and with them once one is ticked', () => {
    // Claude Code sends every connector's tools with each call, about 170k tokens a turn on Colin's account.
    expect(connectorsOn(undefined)).toBe(false)
    expect(connectorsOn([])).toBe(false)
    expect(connectorsOn(['claude.ai Gmail'])).toBe(true)
  })
})
