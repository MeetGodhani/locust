import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { StartPhase } from '../shared/ipc.js'
import type { PublicCloudTurn } from '../shared/cloud-computer.js'
import type { CloudComputers, Codespace } from './cloud-computer.js'
import type { Ran, Runner } from './cloud-tasks.js'
import { createCloudTurns } from './cloud-turns.js'

/*
 * A TURN ON YOUR CLOUD COMPUTER (0.761). A conversation's turns there share one copy of the repository, made from
 * this folder as it was; what a turn changed stays there until the person applies it, and the copy then starts again
 * from what was brought home, so the next change is only what is new.
 */
const BASE = 'a'.repeat(40)
const SETTLED = 'b'.repeat(40)

describe('a turn on the cloud computer', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-cloud-turns-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  const setUp = (options: { readonly onGitHub?: boolean; readonly existing?: Codespace } = {}) => {
    const calls: string[] = []
    let space: Codespace | undefined = options.existing
    const computers: CloudComputers = {
      find: async () => space,
      list: async () => (space === undefined ? [] : [space]),
      make: async () => {
        calls.push('make')
        space = { name: 'locust-hearth-x7q9', displayName: 'locust-hearth', state: 'Available', repository: 'acme/hearth' }
        return space.name
      },
      whenReady: async () => {
        calls.push('ready')
      },
      ensureOpenCode: async (_name, version) => {
        calls.push(`opencode@${version}`)
        return version
      },
      bring: async (_name, _repo, _folder, taskId) => {
        calls.push(`bring:${taskId}`)
        return BASE
      },
      counts: async (_name, _taskId, base) => {
        calls.push(`change:${base.slice(0, 1)}`)
        return [{ path: 'greeting.txt', added: 1, removed: 0 }]
      },
      change: async (_name, _taskId, base) => {
        calls.push(`change:${base.slice(0, 1)}`)
        return { patch: 'diff --git a/greeting.txt b/greeting.txt\n', files: [{ path: 'greeting.txt', added: 1, removed: 0 }] }
      },
      settle: async () => {
        calls.push('settle')
        return SETTLED
      },
      discard: async () => {
        calls.push('discard')
      },
      stop: async () => undefined,
      remove: async () => undefined
    }
    const git: Runner = async (args): Promise<Ran> => {
      if (args[0] === 'remote') return options.onGitHub === false ? { code: 2, stdout: '', stderr: 'no such remote' } : { code: 0, stdout: 'https://github.com/acme/hearth.git\n', stderr: '' }
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'main\n', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const told: PublicCloudTurn[] = []
    const applied: string[] = []
    const turns = createCloudTurns({
      file: join(folder, 'cloud-turns.json'),
      computers,
      git,
      gitRun: async (args) => {
        applied.push(args.join(' '))
        return { code: 0, stdout: Buffer.alloc(0), stderr: '' }
      },
      onChange: (turn) => told.push(turn),
      now: () => new Date('2026-10-12T19:00:00.000Z')
    })
    return { turns, calls, told, applied }
  }
  const said = (): { readonly phases: StartPhase[]; readonly say: (phase: StartPhase) => void } => {
    const phases: StartPhase[] = []
    return { phases, say: (phase) => phases.push(phase) }
  }

  it('is refused in words for a folder that is not on GitHub', async () => {
    const { turns } = setUp({ onGitHub: false })
    const ready = await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', say: () => undefined })
    expect(ready).toMatchObject({ ok: false })
    expect(ready.ok ? '' : ready.message).toMatch(/is not on GitHub/)
  })

  it('asks first when the repository has no cloud computer, and makes nothing until it is told to', async () => {
    const { turns, calls } = setUp()
    const ready = await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', say: () => undefined })
    expect(ready).toMatchObject({ ok: false, setup: { repo: 'acme/hearth', branch: 'main' } })
    expect(calls).toEqual([])
  })

  it('makes one when told to, says each step as it begins, and starts the turn in a copy of its own', async () => {
    const { turns, calls, told } = setUp()
    const { phases, say } = said()
    const ready = await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', setUp: true, say })
    expect(ready.ok).toBe(true)
    expect(phases).toEqual(['cloud-making', 'cloud-installing', 'cloud-bringing'])
    expect(calls.slice(0, 3)).toEqual(['make', 'ready', 'opencode@1.18.27'])
    expect(calls[3]).toMatch(/^bring:t_[a-f0-9]{12}$/)
    expect(told.at(-1)).toMatchObject({ missionId: 'mission_1', state: 'working', repo: 'acme/hearth', branch: 'main', codespace: 'locust-hearth-x7q9' })
  })

  it("carries on in the conversation's own copy on the next turn, without bringing the folder again", async () => {
    const { turns, calls } = setUp({ existing: { name: 'locust-hearth-x7q9', displayName: 'locust-hearth', state: 'Available', repository: 'acme/hearth' } })
    await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', say: () => undefined })
    const { phases, say } = said()
    await turns.prepare({ missionId: 'mission_2', folder, follows: 'mission_1', openCodeVersion: '1.18.27', say })
    expect(calls.filter((call) => call.startsWith('bring:'))).toHaveLength(1)
    // Checked a moment ago and still awake: not checked again.
    expect(phases).toEqual([])
    expect((await turns.of('mission_2'))?.taskId).toBe((await turns.of('mission_1'))?.taskId)
  })

  it('wakes a stopped one first, and says so', async () => {
    const { turns } = setUp({ existing: { name: 'locust-hearth-x7q9', displayName: 'locust-hearth', state: 'Shutdown', repository: 'acme/hearth' } })
    const { phases, say } = said()
    await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', say })
    expect(phases[0]).toBe('cloud-waking')
  })

  it('keeps its change there once it ends, and only the newest turn offers it', async () => {
    const { turns, told } = setUp({ existing: { name: 'locust-hearth-x7q9', displayName: 'locust-hearth', state: 'Available', repository: 'acme/hearth' } })
    await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', say: () => undefined })
    await turns.settled('mission_1')
    expect(told.at(-1)).toMatchObject({ missionId: 'mission_1', state: 'there', files: [{ path: 'greeting.txt', added: 1, removed: 0 }] })
    await turns.prepare({ missionId: 'mission_2', folder, follows: 'mission_1', openCodeVersion: '1.18.27', say: () => undefined })
    await turns.settled('mission_2')
    const [first, second] = await turns.turns(['mission_1', 'mission_2'])
    expect(first?.state).toBe('carried')
    expect(second?.state).toBe('there')
  })

  it('brings it home on Apply, and the copy starts again from what was brought', async () => {
    const { turns, calls, applied } = setUp({ existing: { name: 'locust-hearth-x7q9', displayName: 'locust-hearth', state: 'Available', repository: 'acme/hearth' } })
    await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', say: () => undefined })
    await turns.settled('mission_1')
    const done = await turns.apply('mission_1')
    expect(done).toMatchObject({ ok: true, turn: { state: 'home', appliedAt: '2026-10-12T19:00:00.000Z' } })
    expect(applied.some((call) => call.startsWith('apply --check --binary'))).toBe(true)
    expect(calls).toContain('settle')
    // The next turn's change is read from where the last one was brought home.
    await turns.prepare({ missionId: 'mission_2', folder, follows: 'mission_1', openCodeVersion: '1.18.27', say: () => undefined })
    await turns.settled('mission_2')
    expect(calls.filter((call) => call.startsWith('change:')).at(-1)).toBe('change:b')
    // Applied once: a second Apply on the same turn is refused.
    expect(await turns.apply('mission_1')).toMatchObject({ ok: false })
  })

  it('puts the copy back on Discard', async () => {
    const { turns, calls } = setUp({ existing: { name: 'locust-hearth-x7q9', displayName: 'locust-hearth', state: 'Available', repository: 'acme/hearth' } })
    await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: '1.18.27', say: () => undefined })
    await turns.settled('mission_1')
    expect(await turns.discard('mission_1')).toMatchObject({ ok: true, turn: { state: 'discarded' } })
    expect(calls).toContain('discard')
  })

  it('cannot put a different OpenCode there than the one it reads here', async () => {
    const { turns } = setUp()
    const ready = await turns.prepare({ missionId: 'mission_1', folder, openCodeVersion: undefined, setUp: true, say: () => undefined })
    expect(ready.ok ? '' : ready.message).toMatch(/which OpenCode/)
  })
})
