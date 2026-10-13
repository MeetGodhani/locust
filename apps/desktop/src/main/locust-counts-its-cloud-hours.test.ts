import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CLOUD_IDLE_MS, cloudHours, cloudHoursWords, cloudMonth } from '../shared/cloud-computer.js'
import type { CloudComputers, Codespace } from './cloud-computer.js'
import { createCloudTurns } from './cloud-turns.js'

/*
 * LOCUST'S HOURS ON ITS CLOUD COMPUTERS (0.769). GitHub tells the exact count only with one more permission -- a code
 * to type, which Colin would not have -- so Locust counts its own time: each stretch it spent on a computer, with the
 * 10 idle minutes the computer stays on after, overlaps once. Settings shows it against what GitHub includes.
 */
const at = (minute: number): string => new Date(Date.UTC(2026, 9, 13, 15, 0) + minute * 60_000).toISOString()

describe('the hours a computer was kept on', () => {
  it('counts each stretch with the idle minutes after it, and an overlap once', () => {
    // 15:00-15:20, then 15:25-15:30: the first one's idle tail runs into the second.
    const hours = cloudHours([[at(0), at(20)], [at(25), at(30)]], new Date(at(240)))
    expect(hours).toBeCloseTo(40 / 60, 5)
    // Apart by more than the idle minutes: two stretches, each with its tail.
    expect(cloudHours([[at(0), at(20)], [at(60), at(65)]], new Date(at(240)))).toBeCloseTo((30 + 15) / 60, 5)
  })

  it('counts a computer still on only up to now, and takes the stretches in any order', () => {
    expect(cloudHours([[at(0), at(20)]], new Date(at(24)))).toBeCloseTo(24 / 60, 5)
    expect(cloudHours([[at(60), at(65)], [at(0), at(20)]], new Date(at(240)))).toBeCloseTo((30 + 15) / 60, 5)
    expect(cloudHours([], new Date(at(240)))).toBe(0)
    expect(cloudHours([['not a time', at(5)]], new Date(at(240)))).toBe(0)
    expect(CLOUD_IDLE_MS).toBe(600_000)
  })

  it('reads as a person says it, and keeps a month as GitHub does', () => {
    expect(cloudHoursWords(0.05)).toBe('a few minutes')
    expect(cloudHoursWords(0.4)).toBe('24 minutes')
    expect(cloudHoursWords(2.46)).toBe('2.5 hours')
    expect(cloudHoursWords(31.6)).toBe('32 hours')
    expect(cloudMonth(new Date(at(0)))).toBe('2026-10')
  })
})

describe('as Locust keeps them', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-cloud-hours-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  const NAME = 'locust-hearth-x7q9'
  const SPACE: Codespace = { name: NAME, displayName: 'locust-hearth', state: 'Available', repository: 'acme/hearth' }

  it("counts a turn from its readying to its end, and every step on the computer, for Settings' total", async () => {
    let clock = Date.parse(at(0))
    const tick = (minutes: number): void => { clock += minutes * 60_000 }
    const computers: CloudComputers = {
      find: async () => SPACE,
      list: async () => [SPACE],
      make: async () => NAME,
      whenReady: async () => { tick(1) },
      ensureOpenCode: async (_name, version) => version,
      ensureAgent: async (_name, agent, version) => ({ version, bin: `/home/codespace/.locust/npm/bin/${agent}` }),
      agentSignedIn: async () => true,
      signIn: async () => undefined,
      signOut: async () => undefined,
      bring: async () => 'a'.repeat(40),
      counts: async () => { tick(1); return [] },
      change: async () => ({ patch: '', files: [] }),
      settle: async () => 'b'.repeat(40),
      discard: async () => undefined,
      carry: async () => undefined,
      pushChange: async () => ({ branch: 'locust/x', into: 'main' }),
      openPullRequest: async () => ({ number: 1, url: 'https://github.com/acme/hearth/pull/1' }),
      pullRequestOpen: async () => true,
      dropBranch: async () => undefined,
      stop: async () => undefined,
      remove: async () => undefined
    }
    const cloud = createCloudTurns({
      file: join(folder, 'cloud-turns.json'),
      computers,
      git: async (args) => (args[0] === 'remote' ? { code: 0, stdout: 'https://github.com/acme/hearth.git\n', stderr: '' } : { code: 1, stdout: '', stderr: '' }),
      now: () => new Date(clock)
    })
    // Nothing spent yet: Settings says nothing of hours.
    const before = await cloud.computers()
    expect(before.ok && before.use).toBeUndefined()

    const prepared = await cloud.prepare({ missionId: 'mission_a', folder, openCodeVersion: '1.18.27', say: () => undefined })
    expect(prepared.ok).toBe(true)
    // The turn works for 20 minutes, then its change is read (a minute) as it ends.
    tick(20)
    await cloud.settled('mission_a')
    tick(60)

    const listed = await cloud.computers()
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    // From its readying (15:00) to its end (15:22), and the 10 idle minutes after: 32 minutes.
    expect(listed.use?.hours).toBeCloseTo(32 / 60, 5)
    expect(listed.computers[0]?.hoursThisMonth).toBeCloseTo(32 / 60, 5)
    // The first month is counted only from when Locust began.
    expect(listed.use?.since).toBe(at(0))
  })
})
