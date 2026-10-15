import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileMissionLedger, type MissionLedgerMetadata } from '@teammate/mission-store'
import { afterEach, describe, expect, it } from 'vitest'

import { readOneMission } from './mission-history.js'

import { carryOnOffer, carryOnPrompt, parsedPlanRunsOut, planRanOut } from '../shared/carry-on.js'
import type { CarryOnResponse, PlanRunsOut } from '../shared/carry-on.js'
import { createCarryOn, endedOnPlanLimit } from './carry-on.js'
import type { CarryOnStart } from './carry-on.js'

/*
 * WHEN A PLAN RUNS OUT (0.774). Settings said the third way on was "Not built. Locust will not move your work to an
 * AI agent you did not choose", and the model picker had promised a fallback chain that never existed. Now the
 * stopped run's card carries the work on with one press, and a person who picked an agent and turned on Without
 * asking gets it with none -- only ever onto the agent they chose, and only for a turn they sent themselves.
 */

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const quota = { type: 'run.failed', sourceAdapter: 'codex', payload: { kind: 'quota-exhausted', message: "You've hit your usage limit." } }
const limit = { type: 'route.limit_detected', sourceAdapter: 'claude', payload: { kind: 'quota-exhausted', message: '5-hour window 100% used' } }
const nearly = { type: 'route.limit_detected', sourceAdapter: 'claude', payload: { kind: 'temporary-rate-limit', message: "You've used 91% of your 5-hour window" } }
const completed = { type: 'run.completed', sourceAdapter: 'codex', payload: {} }

function mission(input: { readonly phase: string; readonly events: readonly unknown[]; readonly runtime?: string; readonly mode?: string; readonly sandbox?: string }) {
  return {
    phase: input.phase,
    events: input.events,
    metadata: { missionId: 'mission_1', runId: 'run_1', runtime: input.runtime ?? 'codex', sandbox: input.sandbox ?? 'workspace-write', ...(input.mode === undefined ? {} : { mode: input.mode }) }
  }
}

function harness(input: {
  readonly phase?: string
  readonly events?: readonly unknown[]
  readonly runtime?: string
  readonly mode?: string
  readonly setting?: PlanRunsOut
  readonly sentByPerson?: boolean
  readonly start?: (input: CarryOnStart) => Promise<CarryOnResponse>
}) {
  const started: CarryOnStart[] = []
  const notes: string[] = []
  const carryOn = createCarryOn({
    ledger: { getMission: async () => mission({ phase: input.phase ?? 'failed', events: input.events ?? [quota], ...(input.runtime === undefined ? {} : { runtime: input.runtime }), ...(input.mode === undefined ? {} : { mode: input.mode }) }) as never },
    setting: async () => input.setting,
    sentByPerson: () => input.sentByPerson ?? true,
    note: (_missionId, message) => notes.push(message),
    start: async (asked) => {
      started.push(asked)
      return input.start === undefined ? { ok: true, missionId: 'mission_2' } : input.start(asked)
    }
  })
  return { carryOn, started, notes }
}

describe('a turn whose plan ran out is carried on', () => {
  it('knows a plan ran out from what the agent said, and not from a warning or a run that went on', () => {
    expect(planRanOut([quota])).toBe(true)
    expect(planRanOut([limit])).toBe(true)
    expect(planRanOut([nearly])).toBe(false)
    expect(planRanOut([limit, completed])).toBe(false)
    expect(endedOnPlanLimit(mission({ phase: 'failed', events: [quota] }) as never)).toBe(true)
    // Claude Code's limit ends the run interrupted (attention-reader.test.ts): still ran out.
    expect(endedOnPlanLimit(mission({ phase: 'interrupted', events: [limit] }) as never)).toBe(true)
    // The person pressed Stop: that is not the plan running out, whatever was said before it.
    expect(endedOnPlanLimit(mission({ phase: 'cancelled', events: [limit] }) as never)).toBe(false)
  })

  it('one press starts the turn on the agent offered, as a reply to the turn that ran out, in its mode', async () => {
    const h = harness({ mode: 'accept-edits' })
    expect(await h.carryOn.carry('mission_1', { runtime: 'claude' })).toEqual({ ok: true, missionId: 'mission_2' })
    expect(h.started).toEqual([{ prompt: carryOnPrompt('codex'), runtime: 'claude', model: undefined, mode: 'accept-edits', followUpOf: 'mission_1', from: 'codex' }])
    expect(h.carryOn.carried('mission_1')).toBe(true)
    // The words are Locust's: what happened, then the instruction. The summary of what was done is the host's brief.
    expect(carryOnPrompt('codex')).toBe("Codex CLI ran out of its plan's usage before it finished. Carry on with the task from where it stopped: what it already did is above, so finish what is left, the way the task asks.")
  })

  it('never twice, never onto the agent that ran out, never a turn that did not run out', async () => {
    const twice = harness({})
    await twice.carryOn.carry('mission_1', { runtime: 'claude' })
    expect(await twice.carryOn.carry('mission_1', { runtime: 'claude' })).toEqual({ ok: false, message: 'This turn was already carried on.' })
    expect(twice.started).toHaveLength(1)
    const same = harness({})
    expect(await same.carryOn.carry('mission_1', { runtime: 'codex' })).toEqual({ ok: false, message: 'Codex CLI is the agent whose plan ran out.' })
    const finished = harness({ phase: 'completed', events: [completed] })
    expect((await finished.carryOn.carry('mission_1', { runtime: 'claude' })).ok).toBe(false)
    expect([...same.started, ...finished.started]).toEqual([])
  })

  it('a turn that asked before each action is never carried to an agent that cannot ask', async () => {
    const h = harness({ mode: 'approve-each' })
    expect(await h.carryOn.carry('mission_1', { runtime: 'claude' })).toEqual({ ok: false, message: 'Claude Code cannot ask before each action, so this turn was not carried on there.' })
    expect(await h.carryOn.carry('mission_1', { runtime: 'opencode' })).toEqual({ ok: true, missionId: 'mission_2' })
  })

  it('a start that fails can be pressed again', async () => {
    let first = true
    const h = harness({ start: async () => (first ? ((first = false), { ok: false, message: 'busy' }) : { ok: true, missionId: 'mission_3' }) })
    expect(await h.carryOn.carry('mission_1', { runtime: 'claude' })).toEqual({ ok: false, message: 'busy' })
    expect(h.carryOn.carried('mission_1')).toBe(false)
    expect(await h.carryOn.carry('mission_1', { runtime: 'claude' })).toEqual({ ok: true, missionId: 'mission_3' })
  })

  it('without a press only with an agent picked AND Without asking on, and only for a turn the person sent', async () => {
    const off = harness({ setting: { runtime: 'claude', automatic: false } })
    await off.carryOn.onRunEnded({ missionId: 'mission_1' })
    const none = harness({})
    await none.carryOn.onRunEnded({ missionId: 'mission_1' })
    const relayed = harness({ setting: { runtime: 'claude', automatic: true }, sentByPerson: false })
    await relayed.carryOn.onRunEnded({ missionId: 'mission_1' })
    expect([...off.started, ...none.started, ...relayed.started]).toEqual([])

    const on = harness({ setting: { runtime: 'claude', model: 'sonnet', automatic: true } })
    await on.carryOn.onRunEnded({ missionId: 'mission_1' })
    expect(on.started.map((asked) => [asked.runtime, asked.model, asked.followUpOf])).toEqual([['claude', 'sonnet', 'mission_1']])
    expect(on.notes).toEqual([])
  })

  it('and says why when it could not', async () => {
    const itself = harness({ setting: { runtime: 'codex', automatic: true } })
    await itself.carryOn.onRunEnded({ missionId: 'mission_1' })
    expect(itself.started).toEqual([])
    expect(itself.notes).toEqual(['Codex CLI is the agent picked to carry on when a plan runs out, and its own plan ran out, so nothing was carried on.'])
    const refused = harness({ setting: { runtime: 'claude', automatic: true }, start: async () => ({ ok: false, message: 'Claude Code is not signed in.' }) })
    await refused.carryOn.onRunEnded({ missionId: 'mission_1' })
    expect(refused.notes).toEqual(['Locust could not carry this on with Claude Code: Claude Code is not signed in.'])
  })

  it('the card offers the agent picked, else the first ready that is not the one that ran out', () => {
    const ready = new Set(['claude', 'codex', 'opencode'] as const)
    expect(carryOnOffer('codex', undefined, ready)).toEqual({ runtime: 'claude' })
    expect(carryOnOffer('claude', undefined, ready)).toEqual({ runtime: 'codex' })
    expect(carryOnOffer('codex', { runtime: 'opencode', model: 'opencode/jev-1.13-free', automatic: false }, ready)).toEqual({ runtime: 'opencode', model: 'opencode/jev-1.13-free' })
    // The pick is the agent that ran out, or not ready: the order instead -- a press is still the person's.
    expect(carryOnOffer('opencode', { runtime: 'opencode', automatic: false }, ready)).toEqual({ runtime: 'claude' })
    expect(carryOnOffer('codex', { runtime: 'cursor', automatic: false }, ready)).toEqual({ runtime: 'claude' })
    expect(carryOnOffer('codex', undefined, new Set(['codex'] as const))).toBeUndefined()
  })

  it('the setting holds only an agent a turn can run on', () => {
    expect(parsedPlanRunsOut({ runtime: 'claude', automatic: true })).toEqual({ runtime: 'claude', automatic: true })
    expect(parsedPlanRunsOut({ runtime: 'claude', model: 'account-default', automatic: 'yes' })).toEqual({ runtime: 'claude', automatic: false })
    expect(parsedPlanRunsOut({ runtime: 'gemini', automatic: true })).toBeUndefined()
    expect(parsedPlanRunsOut({ runtime: 'omniroute', automatic: true })).toBeUndefined()
    expect(parsedPlanRunsOut(null)).toBeUndefined()
  })

  it('is recorded as Locust\'s turn (v24), comes back so after a restart, and an older reader refuses it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'locust-carry-on-ledger-'))
    roots.push(directory)
    const metadata: MissionLedgerMetadata = {
      missionId: 'mission_2', runId: 'run_2', prompt: carryOnPrompt('codex'), runtime: 'claude', model: 'account-default', requestedRouteId: 'claude',
      resolvedRouteId: 'claude-account:default', cliVersion: null, workspaceId: 'ws_test', sandbox: 'workspace-write', mode: 'accept-edits',
      executionPolicyVersion: 1, createdAt: '2026-10-15T00:00:00Z', startedBy: { kind: 'carry-on', from: 'codex' }
    }
    const ledger = createFileMissionLedger({ rootDirectory: directory })
    await ledger.createMission(metadata)
    await ledger.flush()
    const answer = await readOneMission(createFileMissionLedger({ rootDirectory: directory }), undefined, 'mission_2')
    expect(answer.ok && answer.data.mission.startedBy).toEqual({ kind: 'carry-on', from: 'codex' })
    const file = join(directory, 'mission_2.jsonl')
    const header = JSON.parse((await readFile(file, 'utf8')).split('\n')[0]!)
    expect(header.schemaVersion).toBe(24)
    header.schemaVersion = 23
    await writeFile(file, JSON.stringify(header) + '\n')
    // A v23 writer never carried a turn on, so a v23 file that says so is not believed.
    expect(await createFileMissionLedger({ rootDirectory: directory }).getMission('mission_2')).toBeUndefined()
    // And a starter that names no agent is refused when it is written.
    await expect(
      createFileMissionLedger({ rootDirectory: directory }).createMission({ ...metadata, missionId: 'mission_3', runId: 'run_3', startedBy: { kind: 'carry-on', from: 'nobody' } } as unknown as MissionLedgerMetadata)
    ).rejects.toThrow()
  })

  it('runs before the limit toast, which says nothing for a turn that was carried on', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const carry = source.indexOf("{ label: 'carry on', step: () => carryOn }")
    const attention = source.indexOf("label: 'attention'")
    expect(carry).toBeGreaterThan(0)
    expect(attention).toBeGreaterThan(carry)
    expect(source).toContain('carryOn?.carried(mission.missionId) === true ? Promise.resolve() : reader.onRunEnded(mission)')
  })
})
