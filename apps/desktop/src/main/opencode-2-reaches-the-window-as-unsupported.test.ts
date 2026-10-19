import { describe, expect, it } from 'vitest'

import { publicStatus } from './runtime-discovery.js'

/*
 * OPENCODE 2 REACHES THE WINDOW AS UNSUPPORTED (0.805), with why and what to do -- not as a check that did not
 * answer, which the window would offer to ask again. (The window's half:
 * renderer/src/opencode-2-reads-as-not-supported-yet.test.ts.)
 */
const NOTE = 'OpenCode 2.0.32 is installed, and Locust runs OpenCode 1 for now: OpenCode 2 changed how other apps talk to it. Support for it is on its way.'

describe('an OpenCode version Locust does not run yet', () => {
  it('reaches the window as unsupported, with why and what to do', () => {
    const shown = publicStatus({
      id: 'opencode',
      displayName: 'OpenCode',
      availability: 'available',
      readiness: 'unsupported',
      version: { raw: 'opencode v2.0.32', version: '2.0.32', major: 2, minor: 0, patch: 32 },
      diagnostics: [{ code: 'version-unsupported', severity: 'error', message: NOTE, resolution: 'To use OpenCode teammates today, use OpenCode 1 (npm install -g opencode-ai) as the opencode command.' }]
    } as never)
    expect(shown).toMatchObject({ status: 'unsupported', ready: false })
    expect(shown.unsupportedNote).toContain(NOTE)
    expect(shown.unsupportedNote).toContain('npm install -g opencode-ai')
  })

  it('leaves every other runtime as it was (control)', () => {
    const shown = publicStatus({ id: 'opencode', displayName: 'OpenCode', availability: 'available', readiness: 'ready', diagnostics: [] } as never)
    expect(shown.status).toBe('ready')
    expect(shown).not.toHaveProperty('unsupportedNote')
  })
})
