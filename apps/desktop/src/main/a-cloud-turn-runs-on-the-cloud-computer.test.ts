import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import type { MissionLedger, Workroom } from '@teammate/mission-store'
import { createNodeRuntimeProcessRunner } from '@teammate/runtime-adapters'
import type { AppServerRunProcess, RuntimeDiscovery, RuntimeSpawnOptions, SpawnedRuntimeProcess } from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StartPhase } from '../shared/ipc.js'
import { createBriefSessions } from './brief-sessions.js'
import { createCodexMissionService } from './codex-mission.js'
import type { CloudPrepared } from './cloud-turns.js'
import type { ConversationHint, MemoryBriefing } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/*
 * A TURN SENT WITH CLOUD (0.761) runs on the repository's GitHub Codespace: OpenCode's own server started there, the
 * turn otherwise the same as one here. The cloud computer is readied before anything is recorded, so a refusal hands
 * the person's words back; what the turn changed is read once it has ended.
 */
const NOW = '2026-10-12T19:00:00.000Z'
/** The conversation's copy on the cloud computer, as prepare names it. */
const CLOUD_DIR = '/workspaces/.locust/t_abc123def456'
const PEER: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' },
  others: []
}

describe('a turn sent with Cloud', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-cloud-turn-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  type Runtime = 'opencode' | 'codex' | 'claude' | 'cursor'
  const NAMES: Readonly<Record<Runtime, string>> = { opencode: 'OpenCode', codex: 'Codex CLI', claude: 'Claude Code', cursor: 'Cursor Agent' }
  const discovered = (id: Runtime): RuntimeDiscovery => ({
    id,
    kind: 'agent-runtime',
    displayName: NAMES[id],
    optional: false,
    availability: 'available',
    readiness: 'ready',
    executable: {
      commandName: id,
      discoveredPath: process.platform === 'win32' ? `C:\\tools\\${id}.exe` : `/tools/${id}`,
      executablePath: process.platform === 'win32' ? `C:\\tools\\${id}.exe` : `/tools/${id}`,
      prefixArgs: [],
      kind: 'native'
    },
    version: { raw: `${id} 1.18.27`, version: '1.18.27', major: 1, minor: 18, patch: 27 },
    supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    requiredFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    diagnostics: []
  })
  const workroom: Workroom = {
    post: async () => {
      throw new Error('not used')
    },
    unread: async () => ({ messages: [], remaining: 0 }),
    markDelivered: async () => undefined,
    read: async () => ({ messages: [], deliveries: [], issues: [] }),
    flush: async () => undefined
  }
  const exitingAtOnce = (): AppServerRunProcess => {
    const exits: (() => void)[] = []
    setImmediate(() => exits.forEach((exit) => exit()))
    return { write: () => undefined, kill: () => undefined, onData: () => undefined, onExit: (listener) => exits.push(listener) }
  }

  /** The ssh process a Claude Code turn there is, as the runner sees it: what it was started with, and its end. */
  const spawned: { readonly path: string; readonly args: readonly string[]; readonly cwd: string | undefined }[] = []
  const sshProcess = (path: string, args: readonly string[], options: RuntimeSpawnOptions): SpawnedRuntimeProcess => {
    spawned.push({ path, args, cwd: options.cwd })
    const events = new EventEmitter()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    setImmediate(() => {
      stdout.end()
      stderr.end()
      setImmediate(() => events.emit('close', 0, null))
    })
    return { stdin: new PassThrough(), stdout, stderr, once: (event: string, listener: (...args: unknown[]) => void) => events.once(event, listener) } as unknown as SpawnedRuntimeProcess
  }
  beforeEach(() => {
    spawned.length = 0
  })

  const setUp = (runtime: Runtime, prepared: CloudPrepared | 'cloud-spawn') => {
    const recorded: string[] = []
    const ledger = {
      createMission: async (metadata: { prompt: string }) => {
        recorded.push(metadata.prompt)
      },
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => {
        throw new Error('not used')
      },
      appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined, appendApproval: async () => undefined,
      deleteMission: async () => true,
      listTrashedMissions: async () => [],
      restoreMission: async () => true,
      emptyTrash: async () => 0,
      storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
      pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async () => undefined,
      listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    } as unknown as MissionLedger
    const localServe = vi.fn((): AppServerRunProcess => exitingAtOnce())
    const cloudServe = vi.fn((_path: string, _args: readonly string[]): AppServerRunProcess => exitingAtOnce())
    const guard = vi.fn(async () => 'C:\\guard\\opencode-guard.js')
    const phases: StartPhase[] = []
    const localAppServer = vi.fn((): AppServerRunProcess => exitingAtOnce())
    const cloudAppServer = vi.fn((_path: string, _args: readonly string[]): AppServerRunProcess => exitingAtOnce())
    const cloudTargets: unknown[] = []
    const claudeGuard = vi.fn(async () => 'C:\\guard\\claude-guard.json')
    const codexGuard = vi.fn(async () => undefined)
    const prepare = vi.fn(async (input: { readonly folder: string; readonly openCodeVersion: string | undefined; readonly say: (phase: StartPhase) => void }): Promise<CloudPrepared> => {
      input.say('cloud-bringing')
      return prepared === 'cloud-spawn' ? { ok: true, spawn: cloudServe, dir: CLOUD_DIR, codespace: 'locust-hearth-x7q9' } : prepared
    })
    const settled = vi.fn(async () => undefined)
    const carry = vi.fn(async (_missionId: string, _folder: string, _files: readonly string[]) => undefined)
    // What the brief was told about where the run stands (0.762): the folder sentence is built from this hint.
    const hints: (ConversationHint | undefined)[] = []
    const memory: MemoryBriefing = {
      section: async (_peer, conversation) => {
        hints.push(conversation)
        return undefined
      }
    }
    const service = createCodexMissionService({
      workspacePath: process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace',
      discover: async () => [discovered(runtime)],
      runner: { start: () => { throw new Error('not used') } },
      ledger,
      workroom,
      briefSessions: createBriefSessions({ rootDirectory: folder }),
      opencodeServeSpawn: localServe,
      openCodeCommandGuard: guard,
      appServerSpawn: localAppServer,
      // This computer's own guards, which a turn there must not be given: they name files on this computer.
      commandGuard: claudeGuard,
      codexCommandGuard: codexGuard,
      cloud: { of: async () => undefined, prepare, settled, carry },
      cloudProcessRunner: (target) => {
        cloudTargets.push(target)
        return createNodeRuntimeProcessRunner({ spawnProcess: sshProcess })
      },
      cloudAppServerSpawn: (target) => {
        cloudTargets.push(target)
        return cloudAppServer
      },
      memory,
      createId: (() => {
        let next = 0
        return () => String(++next)
      })(),
      now: () => new Date(NOW),
      schedule: () => undefined
    })
    const emit = (update: { readonly kind: string; readonly phase?: StartPhase }): void => {
      if (update.kind === 'start-phase' && update.phase !== undefined) phases.push(update.phase)
    }
    const start = (model = 'opencode/space-bunny-free', prompt = 'Add a greeting file.') =>
      service.start(prompt, runtime, 'accept-edits', { model }, emit as never, undefined, PEER, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { setUp: false })
    return { start, recorded, localServe, cloudServe, guard, prepare, settled, phases, hints, carry, localAppServer, cloudAppServer, cloudTargets, claudeGuard, codexGuard }
  }

  it('is refused in words on a runtime it does not run there, before anything', async () => {
    const { start, prepare, recorded } = setUp('cursor', 'cloud-spawn')
    const answer = await start('composer-2')
    expect(answer).toMatchObject({ ok: false, error: { code: 'RUNTIME_START_FAILED' } })
    expect(answer.ok ? '' : answer.error.message).toMatch(/runs OpenCode, Claude Code and Codex teammates for now/)
    expect(prepare).not.toHaveBeenCalled()
    expect(recorded).toEqual([])
  })

  /*
   * CLAUDE CODE AND CODEX THERE (0.768): each the copy Locust put there, in the conversation's copy there, signed in
   * there by the person -- and given nothing that only this computer has: its guards and its connector bridge name
   * files here, and the person's connectors are this computer's.
   */
  it('runs a Claude Code turn there: its own copy, in the copy there, with nothing of this computer\'s', async () => {
    const { start, prepare, settled, cloudTargets, recorded, claudeGuard } = setUp('claude', { ok: true, dir: CLOUD_DIR, codespace: 'locust-hearth-x7q9', bin: '/home/codespace/.locust/npm/bin/claude' })
    const answer = await start('claude-haiku-4-5')
    expect(answer.ok, JSON.stringify(answer)).toBe(true)
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ agent: { runtime: 'claude', version: '1.18.27' } }))
    expect(cloudTargets).toEqual([{ codespace: 'locust-hearth-x7q9', dir: CLOUD_DIR }])
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toMatchObject({ path: '/home/codespace/.locust/npm/bin/claude', cwd: CLOUD_DIR })
    expect(spawned[0]!.args).toEqual(expect.arrayContaining(['--print', '--model', 'claude-haiku-4-5']))
    for (const local of ['--settings', '--mcp-config', '--permission-prompt-tool', '--plugin-dir', '--allowedTools']) expect(spawned[0]!.args).not.toContain(local)
    expect(claudeGuard).not.toHaveBeenCalled()
    expect(recorded).toEqual(['Add a greeting file.'])
    // What it changed there is read once it ends.
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
  })

  it('runs a Codex turn there on its app server, over the connection, never the one here', async () => {
    const { start, prepare, localAppServer, cloudAppServer, cloudTargets, settled, codexGuard } = setUp('codex', { ok: true, dir: CLOUD_DIR, codespace: 'locust-hearth-x7q9', bin: '/home/codespace/.locust/npm/bin/codex' })
    const answer = await start('gpt-6-sol')
    expect(answer.ok, JSON.stringify(answer)).toBe(true)
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ agent: { runtime: 'codex', version: '1.18.27' } }))
    expect(cloudTargets).toEqual([{ codespace: 'locust-hearth-x7q9', dir: CLOUD_DIR }])
    expect(cloudAppServer).toHaveBeenCalledTimes(1)
    expect(cloudAppServer.mock.calls[0]?.[0]).toBe('/home/codespace/.locust/npm/bin/codex')
    expect(cloudAppServer.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['app-server']))
    expect(localAppServer).not.toHaveBeenCalled()
    expect(codexGuard).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
  })

  it('hands the words back and offers the sign-in when the agent is not signed in there', async () => {
    const signIn = { computer: 'locust-hearth-x7q9', repo: 'acme/hearth', agent: 'claude' as const }
    const { start, recorded, cloudTargets } = setUp('claude', { ok: false, message: 'Claude Code is not signed in on your cloud computer yet.', signIn })
    const answer = await start('claude-haiku-4-5')
    expect(answer).toEqual({ ok: false, error: { code: 'CLOUD_SIGN_IN_NEEDED', message: 'Claude Code is not signed in on your cloud computer yet.', cloudSignIn: signIn } })
    expect(recorded).toEqual([])
    expect(cloudTargets).toEqual([])
  })

  it("runs OpenCode's server on the cloud computer, readied first and said on the live line", async () => {
    const { start, localServe, cloudServe, guard, prepare, settled, phases } = setUp('opencode', 'cloud-spawn')
    const answer = await start()
    expect(answer.ok, JSON.stringify(answer)).toBe(true)
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ openCodeVersion: '1.18.27' }))
    expect(phases).toContain('cloud-bringing')
    expect(cloudServe).toHaveBeenCalledTimes(1)
    expect(cloudServe.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['serve', '--port', '0']))
    expect(localServe).not.toHaveBeenCalled()
    // This computer's command guard is a file here; the cloud computer's guard is that nothing there reaches GitHub.
    expect(guard).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
  })

  /*
   * 0.762: told "You are working in the folder C:\Users\...", the agent on Linux went looking for that path, failed
   * a read, and said in its reply that "the Windows path you gave maps to the workspace root here". It stands in its
   * own copy there, and the brief says so, as it does for a teammate's worktree.
   */
  it('tells the brief the turn stands in its own copy there, never this folder', async () => {
    const { start, hints } = setUp('opencode', 'cloud-spawn')
    const answer = await start()
    expect(answer.ok, JSON.stringify(answer)).toBe(true)
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.at(-1)?.ownFolder).toBe(CLOUD_DIR)
  })

  it("sends the message's own files to the copy there before the agent starts", async () => {
    const { start, carry, cloudServe } = setUp('opencode', 'cloud-spawn')
    const answer = await start(undefined, 'Read this file in the workspace before you answer:\n- .locust/attachments/shot.png\n\nWhat is wrong in this picture?')
    expect(answer.ok, JSON.stringify(answer)).toBe(true)
    expect(carry).toHaveBeenCalledTimes(1)
    expect(carry.mock.calls[0]?.[2]).toEqual(['.locust/attachments/shot.png'])
    expect(cloudServe).toHaveBeenCalledTimes(1)
  })

  it('sends nothing over for a message with no files of its own', async () => {
    const { start, carry } = setUp('opencode', 'cloud-spawn')
    await start()
    expect(carry).not.toHaveBeenCalled()
  })

  it('hands the words back and asks first when the repository has no cloud computer, recording nothing', async () => {
    const { start, recorded, cloudServe } = setUp('opencode', { ok: false, message: 'Your cloud computer for this repository is not set up yet.', setup: { repo: 'acme/hearth', branch: 'main' } })
    const answer = await start()
    expect(answer).toMatchObject({ ok: false, error: { code: 'CLOUD_SETUP_NEEDED', cloudSetup: { repo: 'acme/hearth', branch: 'main' } } })
    expect(recorded).toEqual([])
    expect(cloudServe).not.toHaveBeenCalled()
  })

  it("is refused for a model of the person's own, which answers from this computer", async () => {
    const { start, prepare } = setUp('opencode', 'cloud-spawn')
    const answer = await start('own-a1b2c3d4/llama')
    expect(answer.ok ? '' : answer.error.message).toMatch(/A model of your own answers from this computer/)
    expect(prepare).not.toHaveBeenCalled()
  })
})
