/**
 * A CONVERSATION'S TURNS ON THE CLOUD COMPUTER (0.761, cloud-computer.ts says how it works). Which copy of the
 * repository each turn ran in there, and what became of its change: still there, brought home, put back.
 *
 * A conversation keeps one copy for all its turns there -- the next turn picks up where the last one left off, as a
 * turn here does in the folder -- and the copy starts from this folder exactly as it was when the conversation went
 * to the cloud: commits not pushed, edits not committed, files not added. A change comes home only on Apply, and
 * the copy then counts it as its new starting point, so the next change is only what is new.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import type { AppServerRunProcess } from '@teammate/runtime-adapters'

import type { StartPhase } from '../shared/ipc.js'
import { cloudStateOf, cloudTaskDir, CLOUD_TASK_ID, type CloudChangeFile, type CloudFolderState, type CloudSetupStep, type PublicCloudComputer, type PublicCloudTurn } from '../shared/cloud-computer.js'
import { applyHere, cloudServeSpawn, CloudComputerError, freePort, runGit, type CloudComputers, type GitRun } from './cloud-computer.js'
import { folderOnGitHub, type Runner } from './cloud-tasks.js'

export type ServeSpawn = (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>, cwd?: string) => AppServerRunProcess

/** What the person is asked before a repository's first cloud computer is made, or GitHub's permission is given. */
export interface CloudSetup {
  readonly repo: string
  readonly branch?: string
  /** GitHub's sign-in on this computer may not make codespaces yet. */
  readonly permission?: true
}

export type CloudPrepared =
  | { readonly ok: true; readonly spawn: ServeSpawn }
  | { readonly ok: false; readonly message: string; readonly setup?: CloudSetup }

interface CloudTask {
  readonly taskId: string
  readonly codespace: string
  readonly repo: string
  readonly branch?: string
  readonly folder: string
  readonly base: string
  readonly createdAt: string
}

interface CloudTurn {
  readonly missionId: string
  readonly taskId: string
  readonly state: PublicCloudTurn['state']
  readonly files?: readonly CloudChangeFile[]
  readonly appliedAt?: string
  readonly problem?: string
  readonly at: string
}

interface CloudStore {
  readonly tasks: Readonly<Record<string, CloudTask>>
  readonly turns: Readonly<Record<string, CloudTurn>>
}

/** How many turns the store keeps; the oldest go first. */
const MAX_TURNS = 500
/** A cloud computer checked and found ready is not checked again for this long, while it stays awake. */
const READY_FOR_MS = 10 * 60_000
/** The OpenCode version a cloud computer gets: the one installed here, which Locust reads its runs from. */
const VERSION = /^\d+\.\d+\.\d+$/

export interface CloudTurns {
  /** This folder's repository, and its cloud computer if it has one. */
  forFolder(folder: string): Promise<CloudFolderState>
  /** The repository's cloud computer made (when there is none) and readied, OpenCode on it: each step said. */
  setUp(input: { readonly folder: string; readonly openCodeVersion: string | undefined; readonly step: (step: CloudSetupStep) => void }): Promise<CloudFolderState>
  /** The conversation's copy there, when the turn named ran on the cloud computer. */
  of(missionId: string): Promise<{ readonly taskId: string; readonly codespace: string } | undefined>
  /**
   * Everything a turn there needs before its agent starts: the repository's cloud computer made or woken, the
   * agent installed, this folder brought over -- or, for a later turn, the conversation's own copy again.
   */
  prepare(input: {
    readonly missionId: string
    readonly folder: string
    readonly follows?: string
    readonly openCodeVersion: string | undefined
    /** The person pressed Set it up: a repository's first cloud computer may be made. */
    readonly setUp?: boolean
    readonly say: (phase: StartPhase) => void
  }): Promise<CloudPrepared>
  /** The turn has ended: what it changed is read, for the card under it. */
  settled(missionId: string): Promise<void>
  /**
   * Turns Locust closed on before their change was read: read now. No turn there outlives Locust -- its connection is
   * this computer's -- so at a start, every one still marked working has ended.
   */
  settleLeftover(): Promise<void>
  turns(missionIds: readonly string[]): Promise<readonly PublicCloudTurn[]>
  patch(missionId: string): Promise<string | undefined>
  apply(missionId: string): Promise<{ readonly ok: true; readonly turn: PublicCloudTurn } | { readonly ok: false; readonly message: string }>
  discard(missionId: string): Promise<{ readonly ok: true; readonly turn: PublicCloudTurn } | { readonly ok: false; readonly message: string }>
  computers(): Promise<{ readonly ok: true; readonly computers: readonly PublicCloudComputer[] } | { readonly ok: false; readonly message: string; readonly permission?: true }>
  stop(name: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
  remove(name: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
}

export function createCloudTurns(options: {
  readonly file: string
  readonly computers: CloudComputers
  /** git for reading where a folder stands with GitHub. */
  readonly git: Runner
  /** git for applying a change, in bytes. */
  readonly gitRun?: GitRun
  /** A turn's card changed: the window is told. */
  readonly onChange?: (turn: PublicCloudTurn) => void
  readonly now?: () => Date
}): CloudTurns {
  const now = options.now ?? (() => new Date())
  const computers = options.computers
  const ready = new Map<string, { readonly version: string; readonly at: number }>()
  let queue: Promise<unknown> = Promise.resolve()

  const read = async (): Promise<CloudStore> => {
    try {
      const parsed = JSON.parse(await readFile(options.file, 'utf8')) as Partial<CloudStore>
      return { tasks: parsed.tasks ?? {}, turns: parsed.turns ?? {} }
    } catch {
      return { tasks: {}, turns: {} }
    }
  }
  const write = async (store: CloudStore): Promise<void> => {
    const turns = Object.values(store.turns).sort((left, right) => left.at.localeCompare(right.at)).slice(-MAX_TURNS)
    const kept = new Set(turns.map((turn) => turn.taskId))
    const tasks = Object.fromEntries(Object.entries(store.tasks).filter(([taskId]) => kept.has(taskId)))
    await mkdir(dirname(options.file), { recursive: true })
    const scratch = `${options.file}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(scratch, JSON.stringify({ tasks, turns: Object.fromEntries(turns.map((turn) => [turn.missionId, turn])) }, null, 2), 'utf8')
    await rename(scratch, options.file)
  }
  /** One change to the store at a time. */
  const change = <T>(edit: (store: CloudStore) => Promise<{ readonly store?: CloudStore; readonly value: T }> | { readonly store?: CloudStore; readonly value: T }): Promise<T> => {
    const next = queue.then(async () => {
      const store = await read()
      const result = await edit(store)
      if (result.store !== undefined) await write(result.store)
      return result.value
    })
    queue = next.catch(() => undefined)
    return next
  }
  const publicTurn = (store: CloudStore, turn: CloudTurn): PublicCloudTurn | undefined => {
    const task = store.tasks[turn.taskId]
    if (task === undefined) return undefined
    return {
      missionId: turn.missionId,
      codespace: task.codespace,
      repo: task.repo,
      ...(task.branch === undefined ? {} : { branch: task.branch }),
      taskId: task.taskId,
      state: turn.state,
      ...(turn.files === undefined ? {} : { files: turn.files }),
      ...(turn.appliedAt === undefined ? {} : { appliedAt: turn.appliedAt }),
      ...(turn.problem === undefined ? {} : { problem: turn.problem })
    }
  }
  const tell = (store: CloudStore, missionId: string): void => {
    const turn = store.turns[missionId]
    const shown = turn === undefined ? undefined : publicTurn(store, turn)
    if (shown !== undefined) options.onChange?.(shown)
  }
  const putTurn = (store: CloudStore, turn: CloudTurn): CloudStore => ({ ...store, turns: { ...store.turns, [turn.missionId]: turn } })
  const sayWhy = (error: unknown, fallback: string): string => (error instanceof Error && error.message.length > 0 ? error.message : fallback)

  const notOnGitHub = (folder: string): CloudFolderState => ({
    ok: false,
    notOnGitHub: true,
    message: `${basename(folder)} is not on GitHub. Your cloud computer works on a copy of a GitHub repository: push this folder to GitHub first, or open one that is.`
  })
  const failed = (error: unknown, fallback: string): CloudFolderState =>
    error instanceof CloudComputerError && error.kind === 'permission'
      ? { ok: false, permission: true, message: error.message }
      : { ok: false, message: sayWhy(error, fallback) }
  const shownComputer = (space: { readonly name: string; readonly repository: string; readonly state: string; readonly lastUsedAt?: string }): PublicCloudComputer => ({
    name: space.name,
    repo: space.repository,
    state: cloudStateOf(space.state),
    ...(space.lastUsedAt === undefined ? {} : { lastUsedAt: space.lastUsedAt })
  })

  return {
    forFolder: async (folder) => {
      const where = await folderOnGitHub(folder, options.git)
      if (where.repo === undefined) return notOnGitHub(folder)
      try {
        const space = await computers.find(where.repo)
        return { ok: true, repo: where.repo, ...(where.branch === undefined ? {} : { branch: where.branch }), ...(space === undefined ? {} : { computer: shownComputer(space) }) }
      } catch (error) {
        return failed(error, 'GitHub did not say whether this repository has a cloud computer.')
      }
    },

    setUp: async ({ folder, openCodeVersion, step }) => {
      if (openCodeVersion === undefined || !VERSION.test(openCodeVersion)) {
        return { ok: false, message: 'Locust could not tell which OpenCode is installed here, so it cannot put the same one on your cloud computer.' }
      }
      const where = await folderOnGitHub(folder, options.git)
      if (where.repo === undefined) return notOnGitHub(folder)
      try {
        let space = await computers.find(where.repo)
        if (space === undefined) {
          step('making')
          const name = await computers.make(where.repo, where.branch)
          space = { name, displayName: '', state: 'Starting', repository: where.repo }
        }
        step('readying')
        await computers.whenReady(space.name)
        step('installing')
        await computers.ensureOpenCode(space.name, openCodeVersion)
        ready.set(space.name, { version: openCodeVersion, at: Date.now() })
        step('ready')
        return { ok: true, repo: where.repo, ...(where.branch === undefined ? {} : { branch: where.branch }), computer: shownComputer({ ...space, state: 'Available' }) }
      } catch (error) {
        return failed(error, 'Your cloud computer could not be set up.')
      }
    },

    of: async (missionId) => {
      const store = await read()
      const turn = store.turns[missionId]
      const task = turn === undefined ? undefined : store.tasks[turn.taskId]
      return task === undefined ? undefined : { taskId: task.taskId, codespace: task.codespace }
    },

    prepare: async ({ missionId, folder, follows, openCodeVersion, setUp, say }) => {
      if (openCodeVersion === undefined || !VERSION.test(openCodeVersion)) {
        return { ok: false, message: 'Locust could not tell which OpenCode is installed here, so it cannot put the same one on your cloud computer.' }
      }
      const where = await folderOnGitHub(folder, options.git)
      if (where.repo === undefined) {
        return { ok: false, message: `${basename(folder)} is not on GitHub. Your cloud computer works on a copy of a GitHub repository: push this folder to GitHub first, or open one that is.` }
      }
      const repo = where.repo
      const branch = where.branch
      const store = await read()
      const earlierTurn = follows === undefined ? undefined : store.turns[follows]
      const earlier = earlierTurn === undefined ? undefined : store.tasks[earlierTurn.taskId]
      try {
        let space = await computers.find(repo)
        if (space === undefined) {
          if (setUp !== true) return { ok: false, message: 'Your cloud computer for this repository is not set up yet.', setup: { repo, ...(branch === undefined ? {} : { branch }) } }
          say('cloud-making')
          const name = await computers.make(repo, branch)
          space = { name, displayName: '', state: 'Starting', repository: repo }
        } else if (cloudStateOf(space.state) !== 'available') {
          say('cloud-waking')
        }
        const checked = ready.get(space.name)
        if (checked === undefined || checked.version !== openCodeVersion || Date.now() - checked.at > READY_FOR_MS || cloudStateOf(space.state) !== 'available') {
          await computers.whenReady(space.name)
          say('cloud-installing')
          await computers.ensureOpenCode(space.name, openCodeVersion)
          ready.set(space.name, { version: openCodeVersion, at: Date.now() })
        }
        // The conversation's own copy, when its last turn was there on this computer, from this folder.
        let task = earlier !== undefined && earlier.codespace === space.name && earlier.folder === folder ? earlier : undefined
        if (task === undefined) {
          say('cloud-bringing')
          const taskId = `t_${randomBytes(6).toString('hex')}`
          const base = await computers.bring(space.name, repo, folder, taskId)
          task = { taskId, codespace: space.name, repo, ...(branch === undefined ? {} : { branch }), folder, base, createdAt: now().toISOString() }
        }
        const made = task
        await change((current) => {
          const next = putTurn({ ...current, tasks: { ...current.tasks, [made.taskId]: made } }, { missionId, taskId: made.taskId, state: 'working', at: now().toISOString() })
          tell(next, missionId)
          return { store: next, value: undefined }
        })
        const port = await freePort()
        return { ok: true, spawn: cloudServeSpawn({ codespace: space.name, dir: cloudTaskDir(made.taskId), port }) }
      } catch (error) {
        ready.clear()
        if (error instanceof CloudComputerError && error.kind === 'permission') {
          return { ok: false, message: error.message, setup: { repo, ...(branch === undefined ? {} : { branch }), permission: true } }
        }
        return { ok: false, message: sayWhy(error, 'Your cloud computer could not be readied.') }
      }
    },

    settled: async (missionId) => {
      const store = await read()
      const turn = store.turns[missionId]
      const task = turn === undefined ? undefined : store.tasks[turn.taskId]
      if (turn === undefined || task === undefined) return
      let next: CloudTurn
      try {
        const files = await computers.counts(task.codespace, task.taskId, task.base)
        next = { ...turn, state: files.length > 0 ? 'there' : 'none', files, at: now().toISOString() }
      } catch (error) {
        next = { ...turn, state: 'failed', problem: sayWhy(error, 'What it changed could not be read.'), at: now().toISOString() }
      }
      await change((current) => {
        // The newest turn's change is the copy's whole change: an earlier card stops offering it.
        const carried = Object.values(current.turns)
          .filter((other) => other.taskId === task.taskId && other.missionId !== missionId && other.state === 'there')
          .map((other): CloudTurn => ({ ...other, state: 'carried' }))
        let updated: CloudStore = current
        for (const other of carried) updated = putTurn(updated, other)
        updated = putTurn(updated, next)
        for (const other of carried) tell(updated, other.missionId)
        tell(updated, missionId)
        return { store: updated, value: undefined }
      })
    },

    settleLeftover: async () => {
      const store = await read()
      for (const turn of Object.values(store.turns)) {
        if (turn.state === 'working') await (async () => {
          const task = store.tasks[turn.taskId]
          if (task === undefined) return
          try {
            const files = await computers.counts(task.codespace, task.taskId, task.base)
            await change((current) => {
              const next = putTurn(current, { ...turn, state: files.length > 0 ? 'there' : 'none', files, at: now().toISOString() })
              tell(next, turn.missionId)
              return { store: next, value: undefined }
            })
          } catch {
            // The cloud computer is not reachable now: the next start reads it again.
          }
        })()
      }
    },

    turns: async (missionIds) => {
      const store = await read()
      return missionIds.flatMap((missionId) => {
        const turn = store.turns[missionId]
        const shown = turn === undefined ? undefined : publicTurn(store, turn)
        return shown === undefined ? [] : [shown]
      })
    },

    patch: async (missionId) => {
      const store = await read()
      const turn = store.turns[missionId]
      const task = turn === undefined ? undefined : store.tasks[turn.taskId]
      if (task === undefined) return undefined
      try {
        return (await computers.change(task.codespace, task.taskId, task.base)).patch
      } catch {
        return undefined
      }
    },

    apply: async (missionId) => {
      const store = await read()
      const turn = store.turns[missionId]
      const task = turn === undefined ? undefined : store.tasks[turn.taskId]
      if (turn === undefined || task === undefined || turn.state !== 'there') return { ok: false, message: 'That change is not waiting on your cloud computer any more.' }
      try {
        const found = await computers.change(task.codespace, task.taskId, task.base)
        const applied = await applyHere(task.folder, found.patch, options.gitRun ?? runGit)
        if (!applied.ok) return applied
        const base = await computers.settle(task.codespace, task.taskId)
        return await change((current) => {
          const next = putTurn({ ...current, tasks: { ...current.tasks, [task.taskId]: { ...task, base } } }, { ...turn, state: 'home', files: found.files, appliedAt: now().toISOString(), at: now().toISOString() })
          tell(next, missionId)
          const shown = publicTurn(next, next.turns[missionId]!)!
          return { store: next, value: { ok: true as const, turn: shown } }
        })
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'The change could not be brought here.') }
      }
    },

    discard: async (missionId) => {
      const store = await read()
      const turn = store.turns[missionId]
      const task = turn === undefined ? undefined : store.tasks[turn.taskId]
      if (turn === undefined || task === undefined || turn.state !== 'there') return { ok: false, message: 'That change is not waiting on your cloud computer any more.' }
      try {
        await computers.discard(task.codespace, task.taskId, task.base)
        return await change((current) => {
          const next = putTurn(current, { ...turn, state: 'discarded', at: now().toISOString() })
          tell(next, missionId)
          return { store: next, value: { ok: true as const, turn: publicTurn(next, next.turns[missionId]!)! } }
        })
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'The change could not be put back.') }
      }
    },

    computers: async () => {
      try {
        const listed = await computers.list()
        return { ok: true, computers: listed.map(shownComputer) }
      } catch (error) {
        if (error instanceof CloudComputerError && error.kind === 'permission') return { ok: false, message: error.message, permission: true }
        return { ok: false, message: sayWhy(error, 'GitHub did not list your cloud computers.') }
      }
    },

    stop: async (name) => {
      try {
        await computers.stop(name)
        ready.delete(name)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'Your cloud computer did not stop.') }
      }
    },

    remove: async (name) => {
      try {
        await computers.remove(name)
        ready.delete(name)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'Your cloud computer was not deleted.') }
      }
    }
  }
}

/** A task id is checked wherever one arrives from outside. */
export function validTaskId(taskId: unknown): taskId is string {
  return typeof taskId === 'string' && CLOUD_TASK_ID.test(taskId)
}
