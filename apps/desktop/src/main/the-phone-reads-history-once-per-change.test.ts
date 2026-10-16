import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger } from '@teammate/mission-store'

import { countingLedgerWrites, keyedOnce } from './ledger-writes.js'

/*
 * THE PHONE READS THE HISTORY ONCE PER CHANGE (review 2026-10-15, P4). An open phone page asks for its list every
 * 3 s, and each ask read the whole history: 131 ms at 2,000 missions. Keyed on the ledger's write count, a quiet
 * ledger is read once.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('the phone reads history once per change', () => {
  it('counts a write once it is asked for and again once it has landed, and never a read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-writes-'))
    roots.push(root)
    const { ledger, writes } = countingLedgerWrites(createFileMissionLedger({ rootDirectory: root }))
    expect(writes()).toBe(0)
    await ledger.listMissions()
    expect(writes()).toBe(0)
    const creating = ledger.createMission({
      missionId: 'mission_1', runId: 'run_1', prompt: 'hi', runtime: 'codex', model: 'account-default', requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default', cliVersion: '1.0.0', workspaceId: 'ws', sandbox: 'read-only', mode: 'ask',
      executionPolicyVersion: 1, createdAt: '2026-10-15T20:00:00.000Z'
    })
    const asked = writes()
    expect(asked).toBe(1)
    await creating
    await Promise.resolve()
    expect(writes()).toBe(2)
    // The control: the counted ledger is still the ledger.
    expect((await ledger.listMissions()).missions.map((mission) => mission.metadata.missionId)).toEqual(['mission_1'])
  })

  it('builds once per key, shares a build in flight, and tries again after a failure', async () => {
    let builds = 0
    let fail = false
    const once = keyedOnce(async () => {
      builds += 1
      if (fail) throw new Error('no')
      return builds
    })
    expect(await Promise.all([once('a'), once('a')])).toEqual([1, 1])
    expect(await once('a')).toBe(1)
    expect(await once('b')).toBe(2)
    fail = true
    await expect(once('c')).rejects.toThrow('no')
    fail = false
    expect(await once('c')).toBe(4)
    expect(builds).toBe(4)
  })
})
