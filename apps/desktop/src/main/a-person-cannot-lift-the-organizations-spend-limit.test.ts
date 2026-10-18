import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileMissionLedger, type MissionLedger } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { afterEach, describe, expect, it } from 'vitest'
import { createTeammateStore } from './teammate-store.js'
import { createSpendRefusal } from './organization-spend.js'
import type { OrganizationPolicyState } from '../shared/organization-policy.js'

const policy: OrganizationPolicyState = { present: true, path: '/admin/policy.json', policy: { monthlyLimitUsd: 10, highestMode: 'plan' } }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'locust-managed-spend-'))
  roots.push(root)
  const personal = createTeammateStore({ rootDirectory: root })
  const managed = createTeammateStore({ rootDirectory: root, organizationPolicy: policy })
  const ledger = createFileMissionLedger({ rootDirectory: join(root, 'ledger') })
  const now = () => new Date('2026-10-18T12:00:00Z')
  return { root, personal, managed, ledger, refusal: createSpendRefusal({ policy, ledger, teammates: () => managed, now }) }
}
const base = { name: 'Wren', hue: 'lime', role: 'Code & Migrations' } as const
async function receipt(ledger: MissionLedger, id: string, usd: number, at = '2026-10-17T12:00:00Z', plan = false) {
  await ledger.createMission({ missionId: id, runId: `run_${id}`, prompt: 'Work', runtime: 'opencode', model: 'provider/model', requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: 'test', workspaceId: 'ws_test', sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at })
  await ledger.appendEvents(id, [{ id: `event_${id}`, runId: `run_${id}`, missionId: id, sequence: 1, occurredAt: at, sourceAdapter: 'opencode', type: 'run.completed', payload: { usage: { usd, ...(plan ? { billing: 'subscription' } : {}) }, process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 1, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: at, finishedAt: at }, evidence: { redacted: true } } } as NormalizedRuntimeEvent])
}

describe('the organization monthly cap', () => {
  it('overlays existing unlimited and higher limits, keeps lower ones, and leaves personal preferences alone', async () => {
    const f = await fixture()
    await f.personal.create(base)
    await f.personal.create({ ...base, name: 'Higher', monthlyLimitUsd: 20 })
    await f.personal.create({ ...base, name: 'Lower', monthlyLimitUsd: 5 })
    const before = await readFile(join(f.root, 'teammates.json'), 'utf8')
    expect((await f.managed.list()).map((entry) => entry.monthlyLimitUsd)).toEqual([10, 10, 5])
    expect(await readFile(join(f.root, 'teammates.json'), 'utf8')).toBe(before)
  })

  it('refuses a higher limit or no limit and permits a lower personal amount', async () => {
    const f = await fixture()
    await expect(f.managed.create({ ...base, monthlyLimitUsd: 11 })).rejects.toThrow('monthlyLimitUsd')
    const teammate = await f.managed.create(base)
    expect(teammate.monthlyLimitUsd).toBe(10)
    const update = { ...base, teammateId: teammate.teammateId, avatar: teammate.avatar }
    await expect(f.managed.update({ ...update, monthlyLimitUsd: null })).rejects.toThrow('monthlyLimitUsd')
    await expect(f.managed.update({ ...update, monthlyLimitUsd: 50 })).rejects.toThrow('monthlyLimitUsd')
    expect((await f.managed.update({ ...update, monthlyLimitUsd: 3 })).monthlyLimitUsd).toBe(3)
  })

  it('keeps Auto off for old preferences and forged writes without changing other switches', async () => {
    const f = await fixture()
    await f.personal.writeSettings({ autoMode: true, relay: false })
    expect(await f.managed.readSettings()).toMatchObject({ autoMode: false, relay: false })
    expect(await f.managed.writeSettings({ autoMode: true })).toMatchObject({ autoMode: false, relay: false })
    expect(await f.personal.readSettings()).toMatchObject({ autoMode: false, relay: false })
  })

  it('refuses a saved route that exceeds the organizations ceiling', async () => {
    const f = await fixture()
    const teammate = await f.managed.create(base)
    await expect(f.managed.rememberRoute(teammate.teammateId, { runtime: 'codex', model: 'gpt-6', mode: 'auto' })).rejects.toThrow('highestMode')
    expect((await f.managed.list())[0]?.route).toBeUndefined()
  })

  it('uses receipts for the current month and refuses at the effective cap', async () => {
    const f = await fixture()
    const teammate = await f.personal.create({ ...base, monthlyLimitUsd: 50 })
    await receipt(f.ledger, 'mission_old', 100, '2026-09-17T12:00:00Z')
    await f.personal.assignMission(teammate.teammateId, 'mission_old')
    await receipt(f.ledger, 'mission_plan', 100, undefined, true)
    await f.personal.assignMission(teammate.teammateId, 'mission_plan')
    expect(await f.refusal(teammate.teammateId)).toBeUndefined()
    await receipt(f.ledger, 'mission_priced', 10)
    await f.personal.assignMission(teammate.teammateId, 'mission_priced')
    expect(await f.refusal(teammate.teammateId)).toContain('monthlyLimitUsd')
    expect(await f.refusal(teammate.teammateId)).toContain('10.00 USD')
  })

  it('also caps unowned turns and cannot escape by naming a missing teammate', async () => {
    const f = await fixture()
    await receipt(f.ledger, 'mission_unowned', 10)
    expect(await f.refusal()).toContain('monthlyLimitUsd')
    expect(await f.refusal('tm_missing')).toContain('monthlyLimitUsd')
  })

  it('fails closed when a managed spending record cannot be checked', async () => {
    const f = await fixture()
    const broken = { missionFiles: async () => { throw new Error('unreadable') }, readMission: async () => { throw new Error('unreadable') } } as unknown as MissionLedger
    const refusal = createSpendRefusal({ policy, ledger: broken, teammates: () => f.managed })
    expect(await refusal()).toContain('could not be checked')
    expect(await refusal()).toContain('/admin/policy.json')
  })

  it('fails closed if even one saved receipt has become unreadable', async () => {
    const f = await fixture()
    await receipt(f.ledger, 'mission_damaged', 10)
    await writeFile(join(f.root, 'ledger', 'mission_damaged.jsonl'), '{broken')
    expect(await f.refusal()).toContain('could not be checked')
  })
})
