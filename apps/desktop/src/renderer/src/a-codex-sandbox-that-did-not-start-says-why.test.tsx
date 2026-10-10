import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CODEX_SANDBOX_DID_NOT_START, codexSandboxDidNotStart } from '../../shared/codex-sandbox.js'
import { ActivityCard } from './components/ActivityCard.js'
import { stepsLine } from './missionView.js'
import type { ActivityDetail } from './missionView.js'

/*
 * CODEX'S WINDOWS SANDBOX DID NOT START (0.736). The saved-rule drive's Codex
 * turn, 2026-10-10: `node --version` failed with "Failed to create unified
 * exec process: helper_unknown_error: setup refresh had errors" -- the Codex
 * desktop app held one of the sandbox's files -- and the row said "failed".
 */
const SAID = 'Failed to create unified exec process: helper_unknown_error: setup refresh had errors'

const fold = (over: Partial<ActivityDetail>): string =>
  renderToStaticMarkup(
    <ActivityCard
      summary="ran 1 command"
      details={[{ kind: 'shell', tool: 'shell', name: 'node --version', settled: true, ...over } as ActivityDetail]}
      runtimeName="Codex CLI"
      workspacePath="C:/work"
      finished
      openByDefault
    />
  )

describe('a command Codex’s sandbox never started', () => {
  it('is known by what Codex said, and nothing else is', () => {
    expect(codexSandboxDidNotStart(SAID)).toBe(true)
    expect(codexSandboxDidNotStart('v22.11.0')).toBe(false)
    expect(codexSandboxDidNotStart('Get-Content : Cannot find path')).toBe(false)
    expect(codexSandboxDidNotStart(undefined)).toBe(false)
  })

  it('says why on its row, and what to do', () => {
    const html = fold({ failed: true, output: SAID })
    expect(html).toContain('sandbox did not start')
    // Closed, the badge carries the sentence; opened, it is drawn above the output (the look drive frames that).
    expect(html).toContain(`title="${CODEX_SANDBOX_DID_NOT_START}">sandbox did not start</span>`)
  })

  it('says nothing of the sort for a command that ran and failed (control)', () => {
    const html = fold({ failed: true, output: 'node : The term node is not recognized', exitCode: 1 })
    expect(html).not.toContain('sandbox did not start')
    expect(html).not.toContain('Quit the Codex app')
  })
})

describe('the folded line over it', () => {
  const shell = (over: Partial<ActivityDetail>): ActivityDetail => ({ kind: 'shell', tool: 'shell', name: 'node --version', settled: true, ...over }) as ActivityDetail
  const said = (details: readonly ActivityDetail[]): string => stepsLine(details, true).segments.map((segment) => segment.text).join(' · ')

  it('says the sandbox did not start, where it read only "1 failed"', () => {
    expect(said([shell({ failed: true, output: SAID })])).toBe('Ran node --version · 1 failed · Codex’s sandbox did not start')
  })

  it('does not, when another failure is among them (control)', () => {
    expect(said([shell({ failed: true, output: SAID }), shell({ name: 'npm test', failed: true, output: '1 test failed', exitCode: 1 })])).not.toContain('sandbox')
  })
})
