import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'
import type { ActivityDetail } from './missionView.js'

/**
 * COMMANDS AND PATHS SHARE ONE LEFT EDGE.
 *
 * A command row used to start with its result (`exit 0`), so the command
 * began about a badge's width to the right of the file names under it. The
 * badge now ends the row, where a read already says done. Its colour,
 * wording and hover are unchanged.
 */

const shell = (name: string, over: Partial<ActivityDetail> = {}): ActivityDetail =>
  ({ kind: 'shell', name, settled: true, exitCode: 0, output: 'src/webhook.ts:1', ...over })

const html = renderToStaticMarkup(
  <ActivityCard
    variant="steps"
    summary="ran 1 command"
    details={[
      { kind: 'edit', name: 'src/webhook.ts', tool: 'file_change', settled: true },
      shell('rg handleLegacyWebhook src/')
    ]}
    runtimeName="Codex CLI"
    workspacePath="C:/work"
    openByDefault
  />
)

describe('commands and paths share one left edge', () => {
  it('puts the command before its badge, and the path before done', () => {
    const shellAt = html.indexOf('is-shell')
    const shellRow = html.slice(shellAt)
    expect(shellRow.indexOf('lc-filerow__path')).toBeLessThan(shellRow.indexOf('lc-shellbadge'))
    expect(shellRow.indexOf('rg handleLegacyWebhook src/')).toBeLessThan(shellRow.indexOf('lc-shellbadge'))
    expect(shellRow).toContain('exit 0')
    expect(shellRow).toContain('is-ok')
    const fileRow = html.slice(html.indexOf('lc-filerow'), shellAt)
    expect(fileRow.indexOf('lc-filerow__path')).toBeLessThan(fileRow.indexOf('src/webhook.ts'))
    expect(fileRow.indexOf('src/webhook.ts')).toBeLessThan(fileRow.indexOf('lc-filerow__result'))
  })

  it('keeps a failure\'s wording where the row ends', () => {
    const failed = renderToStaticMarkup(
      <ActivityCard
        variant="steps"
        summary="ran 1 command"
        details={[shell('pnpm test', { output: 'FAIL', exitCode: 1, failed: true })]}
        runtimeName="Codex CLI"
        workspacePath="C:/work"
        openByDefault
      />
    )
    const row = failed.slice(failed.indexOf('is-shell'))
    expect(row.indexOf('pnpm test')).toBeLessThan(row.indexOf('lc-shellbadge'))
    expect(row).toContain('is-failed')
    expect(row).toMatch(/failed · exit 1/)
  })
})
