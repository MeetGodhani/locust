import { describe, expect, it } from 'vitest'

import { modelUnavailable } from './missionView.js'

/*
 * 0.711. A free model whose provider is down fails again on the same model:
 * Ling 3.0 answered "Upstream request failed: Model is unavailable." on
 * 2026-10-09 (and "Endpoint is unavailable" all of 2026-09-30) while Ling 3.1
 * answered. The card offers the next free model, as a limit's card does.
 */
describe('a free model that is down', () => {
  it("reads OpenCode's words for a model or endpoint that is unavailable", () => {
    expect(modelUnavailable({ message: 'OpenCode stopped: Upstream request failed: Model is unavailable.' })).toBe(true)
    expect(modelUnavailable({ message: 'OpenCode stopped: Endpoint is unavailable.' })).toBe(true)
  })

  it('and a free model OpenCode’s service refused outright (2026-10-12, "Invalid credential" on every free model)', () => {
    expect(modelUnavailable({ message: "OpenCode's service refused the free model, so OpenCode stopped: Upstream request failed: Invalid credential. Free models need no sign-in, so this is on OpenCode's side: pick another model, or try this one again later." })).toBe(true)
    // A paid route's refusal is the person's sign-in, not a model that is down.
    expect(modelUnavailable({ message: 'OpenCode was refused by the provider and stopped: Unauthorized.. Its sign-in may have expired -- `opencode auth login` in a terminal.' })).toBe(false)
  })

  it('and nothing else: a retirement, a busy server or a plain failure is not it', () => {
    expect(modelUnavailable({ message: 'OpenCode stopped: Model exo-free has been deprecated.' })).toBe(false)
    expect(modelUnavailable({ message: 'Selected model is at capacity. Please try a different model.' })).toBe(false)
    expect(modelUnavailable({ message: 'The file is unavailable offline' })).toBe(false)
    expect(modelUnavailable({})).toBe(false)
  })
})
