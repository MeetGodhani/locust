import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocustMcpSettings } from './components/LocustMcpSettings.js'
import type { LocustMcpApi, LocustMcpState } from '../../shared/locust-mcp.js'
import { turnPromptLine } from './missionView.js'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, mounted: false, cleanups: [] as (() => void)[] }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const at = hooks.index++
    if (at >= hooks.values.length) hooks.values[at] = initial
    return [hooks.values[at], (value: unknown) => { hooks.values[at] = value }]
  },
  useEffect: (effect: () => (() => void) | undefined) => { if (!hooks.mounted) { hooks.mounted = true; const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup) } }
}))
beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.mounted = false })
afterEach(() => { for (const cleanup of hooks.cleanups.splice(0)) cleanup(); vi.clearAllMocks() })
const surface = (api: LocustMcpApi) => { hooks.index = 0; return LocustMcpSettings({ api, heading: <h2>Let your other AI apps use Locust</h2> }) }
const button = (element: ReactElement, at = 0): { onClick(): void; disabled: boolean } => {
  const children = element.props as { children: ReactElement[] }
  const line = children.children[at]!.props as { children: ReactElement[] }
  return line.children[1]!.props as { onClick(): void; disabled: boolean }
}
const api = (first: LocustMcpState) => ({ settings: vi.fn(async () => first), setEnabled: vi.fn(async () => enabled), setOwnMode: vi.fn(async (ownMode: boolean) => ({ ...first, ownMode })) })
const enabled: LocustMcpState = { enabled: true, ownMode: false, claudeCommand: 'claude mcp add example', codexConfig: '[mcp_servers.locust]\ncommand = "example"', openclawCommand: 'openclaw mcp add locust --command example' }
describe('other-app access is an explicit setting', () => {
  it('loads the actual setting, makes no enable request on mount, and shows no setup while off', async () => {
    const api = { settings: vi.fn(async () => ({ enabled: false, ownMode: false })), setEnabled: vi.fn(async () => enabled), setOwnMode: vi.fn(async () => enabled) }
    expect(button(surface(api)).disabled).toBe(true)
    await Promise.resolve()
    const html = renderToStaticMarkup(surface(api))
    expect(html).toContain('Off. No local server is listening.')
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toContain('mcp_servers')
    expect(api.setEnabled).not.toHaveBeenCalled()
  })
  it('enables only after a press, then shows the exact host-owned command/config and tradeoff', async () => {
    const api = { settings: vi.fn(async () => ({ enabled: false, ownMode: false })), setEnabled: vi.fn(async () => enabled), setOwnMode: vi.fn(async () => enabled) }
    surface(api); await Promise.resolve()
    button(surface(api)).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual(enabled))
    expect(api.setEnabled).toHaveBeenCalledWith(true)
    const html = renderToStaticMarkup(surface(api))
    expect(html).toContain('claude mcp add example')
    expect(html).toContain('[mcp_servers.locust]')
    // OpenClaw's line too (0.754), with its own Copy, and what decides where it is used.
    expect(html).toContain('openclaw mcp add locust --command example')
    expect(html).toContain('aria-label="Copy the OpenClaw command"')
    expect(html).toContain('its tool policy decides which of its chats can use it')
    expect(html).toContain('Add Locust to Claude Code, Codex or OpenClaw by hand')
    expect(html).toContain('New turns are Ask mode (read only)')
    // Since 0.704 they can run routines too, and the line says so.
    expect(html).toContain('can ask teammates, run your routines and read replies')
    expect(html).toContain('with no automatic teammate handoffs')
    expect(html).toContain('Locust must be running')
    expect(html).toContain('monthly limits still apply')
    // Since 0.740 it changes one app's settings, the Claude app's, and only on Add (claude-app-connection.ts).
    expect(html).toContain('Locust changes another app’s settings only when you press Add to the Claude app')
  })
  it('turns the server off and removes the setup text when the host confirms it', async () => {
    const api = { settings: vi.fn(async () => enabled), setEnabled: vi.fn(async () => ({ enabled: false, ownMode: false })), setOwnMode: vi.fn(async () => enabled) }
    surface(api); await Promise.resolve()
    button(surface(api)).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual({ enabled: false, ownMode: false }))
    expect(api.setEnabled).toHaveBeenCalledWith(false)
    expect(renderToStaticMarkup(surface(api))).not.toContain('[mcp_servers.locust]')
  })
  it('keeps the actual off state and says why if the listener could not be enabled', async () => {
    const api = { settings: vi.fn(async () => ({ enabled: false, ownMode: false })), setEnabled: vi.fn(async () => ({ enabled: false, ownMode: false, message: 'The server is still off.' })), setOwnMode: vi.fn(async () => enabled) }
    surface(api); await Promise.resolve(); button(surface(api)).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual({ enabled: false, ownMode: false, message: 'The server is still off.' }))
    const html = renderToStaticMarkup(surface(api))
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('The server is still off.')
  })
  it("offers each teammate's own mode only while the server is on, off by default and said so", async () => {
    const off = api({ enabled: false, ownMode: false })
    surface(off); await Promise.resolve()
    expect(renderToStaticMarkup(surface(off))).not.toContain('own mode')
    // A fresh mount: the settings read runs once per mount.
    hooks.values = []; hooks.mounted = false
    const on = api(enabled)
    surface(on); await Promise.resolve()
    const html = renderToStaticMarkup(surface(on))
    expect(html).toContain('aria-label="Use each teammate&#x27;s own mode" aria-checked="false"')
    expect(html).toContain('Every turn another app starts is Ask mode (read only)')
    expect(on.setOwnMode).not.toHaveBeenCalled()
  })
  it('turns own mode on only after a press, and says who answers approvals', async () => {
    const on = api(enabled)
    surface(on); await Promise.resolve()
    button(surface(on), 1).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual({ ...enabled, ownMode: true }))
    expect(on.setOwnMode).toHaveBeenCalledWith(true)
    expect(on.setEnabled).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(surface(on))
    expect(html).toContain('New turns use each teammate&#x27;s own mode')
    expect(html).toContain('only you can answer them')
    expect(html).toContain('Auto runs only if Auto is on in Settings')
  })
  it('shows the editor switch only once an editor has connected, off until a press, and says who answers', async () => {
    const plain = api({ ...enabled, ownMode: true })
    surface(plain); await Promise.resolve()
    expect(renderToStaticMarkup(surface(plain))).not.toContain('Let editors answer cards')
    hooks.values = []; hooks.mounted = false
    const first: LocustMcpState = { ...enabled, ownMode: true, editorSeen: true }
    const seen = { ...api(first), setEditorAnswers: vi.fn(async (editorAnswers: boolean) => ({ ...first, editorAnswers })) }
    surface(seen); await Promise.resolve()
    let html = renderToStaticMarkup(surface(seen))
    expect(html).toContain('aria-label="Let editors answer cards for their own turns" aria-checked="false"')
    expect(html).toContain('Cards for a turn an editor starts wait in this window, and only you answer them.')
    expect(html).toContain('only you can answer them')
    button(surface(seen), 2).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual({ ...first, editorAnswers: true }))
    expect(seen.setEditorAnswers).toHaveBeenCalledWith(true)
    expect(seen.setOwnMode).not.toHaveBeenCalled()
    html = renderToStaticMarkup(surface(seen))
    expect(html).toContain('An editor that starts a turn can approve or deny that turn’s cards there.')
    expect(html).toContain('an editor can answer the ones for turns it started')
  })
  it('keeps an externally sent message visible without turning it into relay instructions', () => {
    expect(turnPromptLine({ prompt: 'Review this.', startedBy: { kind: 'mcp' } })).toBe('Review this.')
  })
})
