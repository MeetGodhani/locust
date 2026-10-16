import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HandoffDivider } from './components/HandoffDivider.js'

/*
 * A HANDOFF NAMES THE MODELS EITHER SIDE (0.779). Colin, 2026-10-16, over another app's line -- "Context handoff,
 * GPT-6.1-Sol -> Claude Opus 5.5", each with its maker's mark: "would be cool to have our ui do something similar to
 * this w/ the logos when handoffs happen". Locust's divider said "Codex -> Claude Code".
 */
describe('a handoff names the models either side', () => {
  const html = renderToStaticMarkup(
    <HandoffDivider from="codex" to="claude" fromModel="gpt-6.1-sol" toModel="claude-opus-5-5" at="14:05" unsettledCount={0} omittedBriefing={[]} />
  )

  it('draws each side’s mark beside the model it ran, the receiving side in its brand', () => {
    expect(html).toContain('Handed off')
    expect(html.match(/lc-runtimemark/g)?.length).toBe(2)
    expect(html).toMatch(/lc-handoff__from[^>]*>.*GPT-6\.1.Sol/)
    expect(html).toMatch(/lc-handoff__to" data-runtime="claude"[^>]*>.*Opus 5\.5/)
  })

  it('says it whole to a screen reader: the model, and the runtime it ran on', () => {
    expect(html).toMatch(/aria-label="Handed off from GPT-6\.1.Sol on Codex to [^"]*Opus 5\.5 on Claude Code"/)
  })

  it('a side with no model recorded, or on the account default, is the runtime’s name, as before', () => {
    const plain = renderToStaticMarkup(<HandoffDivider from="codex" to="opencode" toModel="account-default" at={undefined} unsettledCount={0} omittedBriefing={[]} />)
    expect(plain).toContain('aria-label="Handed off from Codex to OpenCode"')
  })
})
