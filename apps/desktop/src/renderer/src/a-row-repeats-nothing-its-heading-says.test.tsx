import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RoutePicker, rowDetailRepeatsHeading } from './components/RoutePicker.js'
import type { ComparePicking } from './components/RoutePicker.js'
import type { PublicModel, PublicRuntimeStatus } from '../../shared/ipc.js'

/**
 * A ROW REPEATS NOTHING ITS HEADING SAYS.
 *
 * Each group is already named — Antigravity · your account — and every row
 * under it was saying "Through Antigravity CLI" again, plus a READY tag the
 * status dot already carries. A line that says something of its own stays:
 * a limit, a reset, an endpoint, a comparison's record.
 */

const runtime = (over: Partial<PublicRuntimeStatus> & Pick<PublicRuntimeStatus, 'id' | 'displayName'>): PublicRuntimeStatus => ({
  installed: true,
  version: '1.0.0',
  auth: 'authenticated',
  ready: true,
  status: 'ready',
  ...over
})

const model = (over: Partial<PublicModel> & Pick<PublicModel, 'id' | 'runtime' | 'displayName' | 'description'>): PublicModel => ({
  supportedEfforts: [],
  ...over
})

const draw = (over: Partial<Parameters<typeof RoutePicker>[0]> = {}): string =>
  renderToStaticMarkup(
    <RoutePicker
      runtimes={[runtime({ id: 'antigravity', displayName: 'Antigravity' }), runtime({ id: 'opencode', displayName: 'OpenCode' })]}
      limitedRuntimes={new Map()}
      models={[
        model({ id: 'flash', runtime: 'antigravity', displayName: 'Flash', description: 'Through Antigravity CLI' }),
        model({ id: 'pro', runtime: 'antigravity', displayName: 'Pro', description: 'Antigravity model tier' }),
        model({ id: 'opencode/ling-free', runtime: 'opencode', displayName: 'Ling Free', description: 'Free · no sign-in' }),
        model({ id: 'own-a1b2c3d0/acme-70b', runtime: 'opencode', displayName: 'Acme Chat', description: 'Your model · llm.acme.example', own: true })
      ]}
      resolvedModels={new Map()}
      recentRoutes={[]}
      active={{ runtime: 'antigravity', model: 'flash' }}
      onSelect={() => undefined}
      onClose={() => undefined}
      {...over}
    />
  )

/** The markup of the row whose label is `label`. */
const rowOf = (html: string, label: string): string => {
  const at = html.indexOf(`>${label}<`)
  const start = html.lastIndexOf('<button', at)
  const end = html.indexOf('</button>', at)
  return html.slice(start, end)
}

describe('a row repeats nothing its heading says', () => {
  it('leaves out a line that only names the group, and the READY tag', () => {
    const html = draw()
    const flash = rowOf(html, 'Flash')
    const pro = rowOf(html, 'Pro')
    expect(flash).not.toContain('lc-picker__detail')
    expect(flash).not.toContain('>READY<')
    expect(flash).toContain('is-plain')
    expect(flash).toContain('>ACTIVE<')
    expect(pro).not.toContain('Through')
    expect(pro).not.toContain('>READY<')
    expect(pro).toContain('is-plain')
    // The heading already said it; the hover still has the whole line.
    expect(flash).toContain('title="Flash · Through Antigravity CLI')
    expect(html).not.toMatch(/lc-picker__tag[^>]*>READY</)
  })

  it('keeps a line that says something of its own', () => {
    const html = draw()
    expect(rowOf(html, 'Ling Free')).toContain('Free · no sign-in')
    expect(rowOf(html, 'Acme Chat')).toContain('llm.acme.example')
    const limited = draw({
      runtimes: [runtime({ id: 'codex', displayName: 'Codex CLI' })],
      models: [],
      limitedRuntimes: new Map([['codex', 'resets in 2 hours']]),
      active: { runtime: 'codex', model: 'account-default' }
    })
    expect(limited).toContain('>AT LIMIT<')
    expect(limited).toContain('resets in 2 hours')
    const signedOut = draw({
      runtimes: [runtime({ id: 'claude', displayName: 'Claude Code', auth: 'unauthenticated', ready: false, status: 'auth-required' })],
      models: [model({ id: 'sonnet', runtime: 'claude', displayName: 'Sonnet', description: 'Through Claude Code' })],
      active: { runtime: 'claude', model: 'sonnet' }
    })
    expect(signedOut).toContain('>SIGN IN<')
    expect(signedOut).not.toMatch(/lc-picker__detail[^>]*>Through Claude Code/)
  })

  it('keeps the record of a comparison, which the heading does not say', () => {
    const compare: ComparePicking = {
      on: true,
      picks: [],
      onMode: () => undefined,
      onToggle: () => undefined,
      refusal: () => undefined,
      record: new Map([['antigravity:pro', { kept: 2, compared: 5 }]])
    }
    const pro = rowOf(draw({ compare }), 'Pro')
    expect(pro).toContain('kept 2 of 5')
    expect(pro).not.toContain('is-plain')
  })

  it('draws a row with nothing extra at least 32px tall', () => {
    const css = readFileSync(fileURLToPath(new URL('./shell.css', import.meta.url)), 'utf8')
    const start = css.indexOf('.lc-picker__row.is-plain {')
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('min-height: 32px')
  })

  it('treats a repeated runtime name as the heading, and a limit or an endpoint as news', () => {
    expect(rowDetailRepeatsHeading('Through Antigravity CLI', 'Antigravity · your account')).toBe(true)
    expect(rowDetailRepeatsHeading('Antigravity model tier', 'Antigravity · your account')).toBe(true)
    expect(rowDetailRepeatsHeading('Through OpenCode', 'OpenCode')).toBe(true)
    expect(rowDetailRepeatsHeading('Free · no sign-in', 'OpenCode')).toBe(false)
    expect(rowDetailRepeatsHeading('Your model · llm.acme.example', 'Your models')).toBe(false)
    expect(rowDetailRepeatsHeading('Signed in, but the last run on it ended on your account\'s usage limit: resets Thursday', 'Codex CLI · your account')).toBe(false)
  })
})
