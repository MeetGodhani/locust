import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MissionLedger } from '@teammate/mission-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodexMissionService } from './codex-mission.js'
import { createAntigravityMissionService } from './antigravity-mission.js'
import { createVoiceCalls } from './voice-call.js'
import { createLocustMcpHost, MCP_CONNECTION_FILE, MCP_SETTINGS_FILE, mcpText } from './locust-mcp-host.js'
import { createPhoneHost, PHONE_FILE } from './phone-host.js'
import { policyFeatureRefusal, type OrganizationPolicy, type OrganizationPolicyState } from '../shared/organization-policy.js'

// A folder the services are handed; nothing runs in it. From this file, never the working directory (tests-assert-something).
const WORKSPACE = fileURLToPath(new URL('.', import.meta.url))

const state = (policy: OrganizationPolicy = {}): OrganizationPolicyState => ({ path: '/admin/policy.json', present: true, policy })
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'locust-managed-start-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('the guard before a runtime starts', () => {
  it('refuses agents, models, modes, cloud turns and broken policies before discovery or recording', async () => {
    const cases = [
      { policy: state({ allowedAgents: ['claude'] }), mode: 'ask' as const, model: 'safe', cloud: undefined },
      { policy: state({ allowedModels: { codex: ['safe'] } }), mode: 'ask' as const, model: 'blocked', cloud: undefined },
      { policy: state({ highestMode: 'plan' }), mode: 'accept-edits' as const, model: 'safe', cloud: undefined },
      { policy: state({ cloud: false }), mode: 'ask' as const, model: 'safe', cloud: {} },
      { policy: { ...state(), error: 'Fix /admin/policy.json. Nothing can start.' }, mode: 'ask' as const, model: 'safe', cloud: undefined }
    ]
    for (const entry of cases) {
      const discover = vi.fn(async () => [])
      const createMission = vi.fn()
      const start = vi.fn(() => { throw new Error('must not run') })
      const service = createCodexMissionService({ workspacePath: WORKSPACE, organizationPolicy: entry.policy, discover, ledger: { createMission } as unknown as MissionLedger, runner: { start }, autoModeAllowed: async () => true })
      const result = await service.start('Do work', 'codex', entry.mode, { model: entry.model }, () => undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, entry.cloud)
      expect(result).toMatchObject({ ok: false, error: { code: 'POLICY_REFUSED' } })
      expect(discover).not.toHaveBeenCalled()
      expect(createMission).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
      await service.dispose()
    }
  })

  it('gates Antigravity before probing its app', async () => {
    const probe = vi.fn(async () => undefined)
    const service = createAntigravityMissionService({ workspacePath: WORKSPACE, organizationPolicy: state({ highestMode: 'approve-each' }), probe, ledger: {} as MissionLedger, emitEvent: () => undefined })
    await expect(service.start('Work', undefined, { model: 'flash' })).rejects.toThrow('highestMode')
    expect(probe).not.toHaveBeenCalled()
  })

  it('checks the monthly cap even when a turn has no teammate owner', async () => {
    const spendRefusal = vi.fn(async () => 'Set by your organization (monthlyLimitUsd). Nothing was started.')
    const discover = vi.fn(async () => [])
    const service = createCodexMissionService({ workspacePath: WORKSPACE, organizationPolicy: state({ monthlyLimitUsd: 10 }), spendRefusal, discover, ledger: {} as MissionLedger, runner: { start: () => { throw new Error('must not start') } } })
    expect(await service.start('Work', 'codex', 'ask', {}, () => undefined)).toMatchObject({ ok: false, error: { code: 'SPEND_LIMIT_REACHED' } })
    expect(spendRefusal).toHaveBeenCalledWith('')
    expect(discover).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('gates voice calls and voice previews before discovering or spawning Codex', async () => {
    const codex = vi.fn(async () => undefined)
    const spawn = vi.fn(() => { throw new Error('must not spawn') })
    const voice = createVoiceCalls({ policyRefusal: async () => 'Set by your organization (allowedAgents). Nothing was started.', codex, spawn, folder: () => WORKSPACE, send: () => undefined, version: 'test' })
    expect(await voice.start('offer')).toMatchObject({ ok: false, message: expect.stringContaining('allowedAgents') })
    expect(await voice.start('offer', undefined, 'cove')).toMatchObject({ ok: false })
    expect(await voice.available()).toMatchObject({ available: false })
    expect(codex).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    voice.dispose()
  })

  it('cancels a voice start still waiting for its policy check', async () => {
    let finish!: (value: undefined) => void
    const checking = new Promise<undefined>((resolve) => { finish = resolve })
    const codex = vi.fn(async () => undefined)
    const voice = createVoiceCalls({ policyRefusal: () => checking, codex, spawn: () => { throw new Error('must not spawn') }, folder: () => WORKSPACE, send: () => undefined, version: 'test' })
    const pending = voice.start('offer')
    await voice.stop()
    finish(undefined)
    expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('ended') })
    expect(codex).not.toHaveBeenCalled()
    voice.dispose()
  })
})

describe('a managed connection stays off', () => {
  it('ignores a saved MCP opt-in, removes the old connection, and refuses forged enabling', async () => {
    const root = await directory()
    const saved = JSON.stringify({ enabled: true, ownMode: true })
    await writeFile(join(root, MCP_SETTINGS_FILE), saved)
    await writeFile(join(root, MCP_CONNECTION_FILE), '{}')
    const protectFile = vi.fn(async () => undefined)
    const host = createLocustMcpHost({ directory: root, node: 'node', bridge: 'bridge.mjs', call: async () => mcpText('unused'), protectFile, refusal: () => policyFeatureRefusal(state({ otherApps: false }), 'otherApps') })
    cleanups.push(() => host.dispose())
    expect(await host.load()).toMatchObject({ enabled: false, ownMode: false, message: expect.stringContaining('otherApps') })
    expect(await host.setEnabled(true)).toMatchObject({ enabled: false, message: expect.stringContaining('/admin/policy.json') })
    expect(protectFile).not.toHaveBeenCalled()
    await expect(readFile(join(root, MCP_CONNECTION_FILE))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(root, MCP_SETTINGS_FILE), 'utf8')).toBe(saved)
  })

  it('ignores a saved phone opt-in and refuses forged pairing without a listener or key', async () => {
    const root = await directory()
    const saved = JSON.stringify({ enabled: true, key: 'a'.repeat(32) })
    await writeFile(join(root, PHONE_FILE), saved)
    const protectFile = vi.fn(async () => undefined)
    const host = createPhoneHost({ directory: root, page: () => '', calls: { state: async () => ({ waiting: [], conversations: [] }), turns: async () => undefined, decide: async () => false, send: async () => ({ ok: true }) }, port: 0, protectFile, refusal: () => policyFeatureRefusal(state({ phone: false }), 'phone') })
    cleanups.push(() => host.dispose())
    expect(await host.load()).toMatchObject({ enabled: false, addresses: [], message: expect.stringContaining('phone') })
    expect(await host.setEnabled(true)).toMatchObject({ enabled: false })
    expect((await host.settings()).url).toBeUndefined()
    expect(protectFile).not.toHaveBeenCalled()
    expect(await readFile(join(root, PHONE_FILE), 'utf8')).toBe(saved)
  })
})
