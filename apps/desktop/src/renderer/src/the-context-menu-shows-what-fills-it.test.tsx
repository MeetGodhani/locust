import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ContextRingMenu } from './components/ContextRing.js'

/*
 * THE CONTEXT MENU SHOWS WHAT FILLS IT (0.806), for Claude Code: its own /context estimate, read after the turn
 * ends, as a few quiet rows above Compact now. Without one (another runtime, a turn running, a failed read) the menu
 * is what it was. (The host's half: main/the-context-menu-reads-claudes-own-estimate.test.ts.)
 */
const reading = { usedTokens: 45_200, windowTokens: 200_000, percent: 23 }
const breakdown = { used: 45_200, window: 200_000, categories: [
  { name: 'Messages', tokens: 24_500 }, { name: 'Skills', tokens: 10_000 }, { name: 'MCP tools (deferred)', tokens: 120_400 },
  { name: 'System prompt', tokens: 3_500 }, { name: 'Free space', tokens: 121_800 }
] }
const menu = (withBreakdown: boolean): string => renderToStaticMarkup(
  <ContextRingMenu reading={reading} offer={{ kind: 'ready' }} runtimeName="Claude Code" {...(withBreakdown ? { breakdown } : {})} onCompact={() => undefined} />
)

describe('the context menu', () => {
  it("lists Claude Code's estimate by category, said to be its estimate, above Compact now", () => {
    const html = menu(true)
    expect(html).toContain('Estimated by Claude Code')
    expect(html).toContain('Messages')
    expect(html).toContain('24.5k')
    expect(html).toContain('Free space')
    expect(html).not.toContain('deferred')
    expect(html).toContain('Messages take 24.5k')
    expect(html.indexOf('Estimated by Claude Code')).toBeLessThan(html.indexOf('Compact now'))
  })

  it('is unchanged without one', () => {
    const html = menu(false)
    expect(html).not.toContain('lc-contextbreakdown')
    expect(html).toContain('Compact now')
  })
})
