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
import { basename, dirname, join } from 'node:path'

import type { AppServerRunProcess } from '@teammate/runtime-adapters'

import type { StartPhase } from '../shared/ipc.js'
import { CLOUD_AGENT_NAMES, cloudStateOf, cloudTaskDir, CLOUD_TASK_ID, type CloudAgent, type CloudAgentState, type CloudChangeFile, type CloudFolderState, type CloudPullRequest, type CloudSetupStep, type CloudSignInStep, type PublicCloudComputer, type PublicCloudTurn } from '../shared/cloud-computer.js'
import { applyHere, carriedPath, cloudServeSpawn, CloudComputerError, freePort, runGit, SAFE_BRANCH_NAME, type CloudComputers, type GitRun } from './cloud-computer.js'
import { folderOnGitHub, type Runner } from './cloud-tasks.js'
import { branchFromSubject } from './folder-commit.js'

export type ServeSpawn = (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>, cwd?: string) => AppServerRunProcess

/** What the person is asked before a repository's first cloud computer is made, or GitHub's permission is given. */
export interface CloudSetup {
  readonly repo: string
  readonly branch?: string
  /** GitHub's sign-in on this computer may not make codespaces yet. */
  readonly permission?: true
}

/** An agent there that is not signed in yet (0.768): which computer, so the person can sign it in with one click. */
export interface CloudSignIn {
  readonly computer: string
  readonly repo: string
  readonly agent: CloudAgent
}

export type CloudPrepared =
  /**
   * `dir`: the conversation's copy there, where the agent stands -- never this folder, which the brief must not name.
   * `spawn` is OpenCode's server there; Claude Code and Codex are started there from `codespace`, `dir` and `bin`,
   * the agent's whole path there.
   */
  | { readonly ok: true; readonly spawn?: ServeSpawn; readonly dir: string; readonly codespace: string; readonly bin?: string }
  | { readonly ok: false; readonly message: string; readonly setup?: CloudSetup; readonly signIn?: CloudSignIn }

interface CloudTask {
  readonly taskId: string
  readonly codespace: string
  readonly repo: string
  readonly branch?: string
  readonly folder: string
  readonly base: string
  readonly createdAt: string
  /** The pull request the conversation's changes go to (0.762): its branch, and the branch it is for. */
  readonly pullRequest?: CloudPullRequest & { readonly branch: string; readonly into: string }
}

interface CloudTurn {
  readonly missionId: string
  readonly taskId: string
  readonly state: PublicCloudTurn['state']
  readonly files?: readonly CloudChangeFile[]
  readonly appliedAt?: string
  readonly problem?: string
  readonly pullRequest?: CloudPullRequest
  readonly outcome?: PublicCloudTurn['outcome']
  readonly at: string
}

interface CloudStore {
  readonly tasks: Readonly<Record<string, CloudTask>>
  readonly turns: Readonly<Record<string, CloudTurn>>
  /** Each agent's sign-in on each cloud computer, by its name, as last known (0.768). */
  readonly agents: Readonly<Record<string, Readonly<Partial<Record<CloudAgent, CloudAgentState>>>>>
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
  /**
   * The repository's cloud computer made (when there is none) and readied, OpenCode on it: each step said. For a
   * Claude Code or Codex teammate (0.768), that agent instead -- and signed in there, in the person's own browser,
   * unless it already is; `waiting` once its page is open and the rest is the person's.
   */
  setUp(input: {
    readonly folder: string
    readonly openCodeVersion: string | undefined
    readonly agent?: { readonly runtime: CloudAgent; readonly version: string | undefined }
    readonly open?: (url: string) => Promise<void> | void
    readonly signal?: AbortSignal
    readonly step: (step: CloudSetupStep, waiting?: true) => void
  }): Promise<CloudFolderState>
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
    /** A Claude Code or Codex turn (0.768): that agent there, at this computer's version, and signed in. */
    readonly agent?: { readonly runtime: CloudAgent; readonly version: string | undefined }
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
  /**
   * The change waiting there, sent to a pull request on GitHub (0.762): a new one from a branch of its own, or added
   * to the conversation's pull request while that is open. `message` is the commit's, its first line the title.
   */
  pullRequest(missionId: string, message: string): Promise<{ readonly ok: true; readonly turn: PublicCloudTurn; readonly added: boolean } | { readonly ok: false; readonly message: string }>
  /** A message's own files (`.locust/attachments`), sent to the turn's copy there before its agent starts. */
  carry(missionId: string, folder: string, files: readonly string[]): Promise<void>
  computers(): Promise<{ readonly ok: true; readonly computers: readonly PublicCloudComputer[] } | { readonly ok: false; readonly message: string; readonly permission?: true }>
  stop(name: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
  remove(name: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
  /**
   * An agent signed in on a cloud computer (0.768), by the person, in their own browser: the computer woken, the agent
   * put on it at this computer's version, then its own sign-in -- each step said. One already signed in there is
   * not signed in again.
   */
  signIn(input: {
    readonly name: string
    readonly agent: CloudAgent
    readonly version: string | undefined
    readonly open: (url: string) => Promise<void> | void
    readonly step: (step: CloudSignInStep) => void
    readonly signal?: AbortSignal
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string; readonly permission?: true }>
  signOut(name: string, agent: CloudAgent): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
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
  const ready = new Map<string, { readonly version: string; readonly at: number; readonly bin?: string }>()
  let queue: Promise<unknown> = Promise.resolve()

  const read = async (): Promise<CloudStore> => {
    try {
      const parsed = JSON.parse(await readFile(options.file, 'utf8')) as Partial<CloudStore>
      return { tasks: parsed.tasks ?? {}, turns: parsed.turns ?? {}, agents: parsed.agents ?? {} }
    } catch {
      return { tasks: {}, turns: {}, agents: {} }
    }
  }
  const write = async (store: CloudStore): Promise<void> => {
    const turns = Object.values(store.turns).sort((left, right) => left.at.localeCompare(right.at)).slice(-MAX_TURNS)
    const kept = new Set(turns.map((turn) => turn.taskId))
    const tasks = Object.fromEntries(Object.entries(store.tasks).filter(([taskId]) => kept.has(taskId)))
    await mkdir(dirname(options.file), { recursive: true })
    const scratch = `${options.file}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(scratch, JSON.stringify({ tasks, turns: Object.fromEntries(turns.map((turn) => [turn.missionId, turn])), agents: store.agents }, null, 2), 'utf8')
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
      ...(turn.problem === undefined ? {} : { problem: turn.problem }),
      ...(turn.pullRequest === undefined ? {} : { pullRequest: turn.pullRequest }),
      ...(turn.state === 'there' && task.pullRequest !== undefined ? { openPullRequest: { number: task.pullRequest.number, url: task.pullRequest.url } } : {}),
      ...(turn.outcome === undefined ? {} : { outcome: turn.outcome })
    }
  }
  /**
   * The turns a resolved change held (0.762): carried into it, they went where it went. Their cards stay quiet; their
   * files are here only if it came home (shared/cloud-computer.ts, `cloudFilesHere`).
   */
  const resolveCarried = (store: CloudStore, taskId: string, outcome: NonNullable<PublicCloudTurn['outcome']>): { readonly store: CloudStore; readonly told: readonly string[] } => {
    let next = store
    const told: string[] = []
    for (const other of Object.values(store.turns)) {
      if (other.taskId !== taskId || other.state !== 'carried' || other.outcome !== undefined) continue
      next = putTurn(next, { ...other, outcome })
      told.push(other.missionId)
    }
    return { store: next, told }
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
  const shownComputer = (space: { readonly name: string; readonly repository: string; readonly state: string; readonly lastUsedAt?: string }, known?: CloudStore['agents']): PublicCloudComputer => {
    const agents = known?.[space.name]
    return {
      name: space.name,
      repo: space.repository,
      state: cloudStateOf(space.state),
      ...(space.lastUsedAt === undefined ? {} : { lastUsedAt: space.lastUsedAt }),
      ...(agents === undefined || Object.keys(agents).length === 0 ? {} : { agents })
    }
  }
  /** What an agent there was last seen to be (0.768): kept, so Settings says it without waking the computer. */
  const remember = (name: string, agent: CloudAgent, state: CloudAgentState): Promise<void> =>
    change((store) => ({ store: { ...store, agents: { ...store.agents, [name]: { ...store.agents[name], [agent]: state } } }, value: undefined }))
  /** OpenCode's readiness is the computer's; an agent's is its own there, installed and signed in. */
  const readyKey = (name: string, agent?: CloudAgent): string => (agent === undefined ? name : `${name}/${agent}`)
  const forget = (name: string): void => {
    for (const key of [...ready.keys()]) if (key === name || key.startsWith(`${name}/`)) ready.delete(key)
  }
  const unknownVersion = (agent: CloudAgent | undefined): string =>
    `Locust could not tell which ${agent === undefined ? 'OpenCode' : CLOUD_AGENT_NAMES[agent]} is installed here, so it cannot put the same one on your cloud computer.`

  return {
    forFolder: async (folder) => {
      const where = await folderOnGitHub(folder, options.git)
      if (where.repo === undefined) return notOnGitHub(folder)
      try {
        const space = await computers.find(where.repo)
        const known = space === undefined ? undefined : (await read()).agents
        return { ok: true, repo: where.repo, ...(where.branch === undefined ? {} : { branch: where.branch }), ...(space === undefined ? {} : { computer: shownComputer(space, known) }) }
      } catch (error) {
        return failed(error, 'GitHub did not say whether this repository has a cloud computer.')
      }
    },

    setUp: async ({ folder, openCodeVersion, agent, open, signal, step }) => {
      const version = agent === undefined ? openCodeVersion : agent.version
      if (version === undefined || !VERSION.test(version)) return { ok: false, message: unknownVersion(agent?.runtime) }
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
        if (agent === undefined) {
          await computers.ensureOpenCode(space.name, version)
        } else {
          const who = CLOUD_AGENT_NAMES[agent.runtime]
          const { bin } = await computers.ensureAgent(space.name, agent.runtime, version)
          ready.set(readyKey(space.name, agent.runtime), { version, at: Date.now(), bin })
          // Signed in already -- by an earlier setup, or in its terminal -- is not signed in again.
          if (!(await computers.agentSignedIn(space.name, agent.runtime))) {
            if (open === undefined) throw new CloudComputerError(`${who} cannot be signed in from here.`)
            step('signing-in')
            await computers.signIn(space.name, agent.runtime, { open, waiting: () => step('signing-in', true), ...(signal === undefined ? {} : { signal }) })
            if (!(await computers.agentSignedIn(space.name, agent.runtime))) throw new CloudComputerError(`${who} finished, but does not say it is signed in. Try again.`)
          }
          await remember(space.name, agent.runtime, 'signed-in')
        }
        if (agent === undefined) ready.set(space.name, { version, at: Date.now() })
        step('ready')
        return { ok: true, repo: where.repo, ...(where.branch === undefined ? {} : { branch: where.branch }), computer: shownComputer({ ...space, state: 'Available' }, (await read()).agents) }
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

    prepare: async ({ missionId, folder, follows, openCodeVersion, agent, setUp, say }) => {
      const version = agent === undefined ? openCodeVersion : agent.version
      if (version === undefined || !VERSION.test(version)) return { ok: false, message: unknownVersion(agent?.runtime) }
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
        const key = readyKey(space.name, agent?.runtime)
        let checked = ready.get(key)
        if (checked === undefined || checked.version !== version || Date.now() - checked.at > READY_FOR_MS || cloudStateOf(space.state) !== 'available' || (agent !== undefined && checked.bin === undefined)) {
          await computers.whenReady(space.name)
          say('cloud-installing')
          let bin: string | undefined
          if (agent === undefined) {
            await computers.ensureOpenCode(space.name, version)
          } else {
            bin = (await computers.ensureAgent(space.name, agent.runtime, version)).bin
            const signedIn = await computers.agentSignedIn(space.name, agent.runtime)
            await remember(space.name, agent.runtime, signedIn ? 'signed-in' : 'signed-out')
            // Nothing is brought over or recorded: the person signs it in with one click, then sends again.
            if (!signedIn) {
              return { ok: false, message: `${CLOUD_AGENT_NAMES[agent.runtime]} is not signed in on your cloud computer yet.`, signIn: { computer: space.name, repo, agent: agent.runtime } }
            }
          }
          checked = { version, at: Date.now(), ...(bin === undefined ? {} : { bin }) }
          ready.set(key, checked)
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
        const dir = cloudTaskDir(made.taskId)
        if (agent !== undefined) return { ok: true, dir, codespace: space.name, ...(checked.bin === undefined ? {} : { bin: checked.bin }) }
        const port = await freePort()
        return { ok: true, spawn: cloudServeSpawn({ codespace: space.name, dir, port }), dir, codespace: space.name }
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
          const resolved = resolveCarried(current, task.taskId, 'home')
          const next = putTurn({ ...resolved.store, tasks: { ...resolved.store.tasks, [task.taskId]: { ...(resolved.store.tasks[task.taskId] ?? task), base } } }, { ...turn, state: 'home', files: found.files, appliedAt: now().toISOString(), at: now().toISOString() })
          for (const other of resolved.told) tell(next, other)
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
          const resolved = resolveCarried(current, task.taskId, 'discarded')
          const next = putTurn(resolved.store, { ...turn, state: 'discarded', at: now().toISOString() })
          for (const other of resolved.told) tell(next, other)
          tell(next, missionId)
          return { store: next, value: { ok: true as const, turn: publicTurn(next, next.turns[missionId]!)! } }
        })
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'The change could not be put back.') }
      }
    },

    pullRequest: async (missionId, message) => {
      const store = await read()
      const turn = store.turns[missionId]
      const task = turn === undefined ? undefined : store.tasks[turn.taskId]
      if (turn === undefined || task === undefined || turn.state !== 'there') return { ok: false, message: 'That change is not waiting on your cloud computer any more.' }
      const text = message.trim()
      const [subject = '', ...rest] = text.split('\n')
      if (subject.trim().length === 0) return { ok: false, message: 'A pull request needs a title: the message\'s first line.' }
      const body = rest.join('\n').trim()
      try {
        // Added to the conversation's pull request while it is open; a merged or closed one gets a new one after it.
        const open = task.pullRequest !== undefined && (await computers.pullRequestOpen(task.repo, task.pullRequest.number)) ? task.pullRequest : undefined
        const from = task.branch !== undefined && SAFE_BRANCH_NAME.test(task.branch) ? task.branch : undefined
        const pushed = await computers.pushChange(
          task.codespace, task.repo, task.taskId, task.base,
          open === undefined ? { kind: 'new', from, wanted: branchFromSubject(subject) } : { kind: 'add', branch: open.branch },
          text
        )
        // Added to an open one, the push went onto its branch; the branch it merges into is the one it was opened for.
        let request: CloudPullRequest & { readonly branch: string; readonly into: string }
        if (open !== undefined) {
          request = open
        } else {
          try {
            const opened = await computers.openPullRequest(task.repo, { head: pushed.branch, base: pushed.into, title: subject.trim(), body: body.length > 0 ? body : subject.trim() })
            request = { ...opened, branch: pushed.branch, into: pushed.into }
          } catch (error) {
            // A branch with no pull request is not left on GitHub for the person to find and wonder about.
            await computers.dropBranch(task.repo, pushed.branch)
            throw error
          }
        }
        // The copy there moves on, as after Apply: the next change is only what is new, and goes onto this branch.
        const base = await computers.settle(task.codespace, task.taskId, 'pull-request')
        return await change((current) => {
          const resolved = resolveCarried(current, task.taskId, 'pr')
          const kept = resolved.store.tasks[task.taskId] ?? task
          const next = putTurn(
            { ...resolved.store, tasks: { ...resolved.store.tasks, [task.taskId]: { ...kept, base, pullRequest: request } } },
            { ...turn, state: 'pr', pullRequest: { number: request.number, url: request.url, into: request.into }, at: now().toISOString() }
          )
          for (const other of resolved.told) tell(next, other)
          tell(next, missionId)
          return { store: next, value: { ok: true as const, turn: publicTurn(next, next.turns[missionId]!)!, added: open !== undefined } }
        })
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'The pull request could not be opened.') }
      }
    },

    carry: async (missionId, folder, files) => {
      const wanted = files.filter(carriedPath)
      if (wanted.length === 0) return
      const store = await read()
      const turn = store.turns[missionId]
      const task = turn === undefined ? undefined : store.tasks[turn.taskId]
      if (task === undefined) return
      // A file that will not read is left as the message names it: the agent's own read then says it is missing.
      const loaded = await Promise.all(wanted.map(async (path) => {
        const bytes = await readFile(join(folder, ...path.split('/'))).catch(() => undefined)
        return bytes === undefined ? [] : [{ path, bytes }]
      }))
      await computers.carry(task.codespace, task.taskId, loaded.flat())
    },

    computers: async () => {
      try {
        const listed = await computers.list()
        const known = (await read()).agents
        return { ok: true, computers: listed.map((space) => shownComputer(space, known)) }
      } catch (error) {
        if (error instanceof CloudComputerError && error.kind === 'permission') return { ok: false, message: error.message, permission: true }
        return { ok: false, message: sayWhy(error, 'GitHub did not list your cloud computers.') }
      }
    },

    stop: async (name) => {
      try {
        await computers.stop(name)
        forget(name)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'Your cloud computer did not stop.') }
      }
    },

    remove: async (name) => {
      try {
        await computers.remove(name)
        forget(name)
        // Its sign-ins went with it.
        await change((store) => {
          const { [name]: _gone, ...agents } = store.agents
          return { store: { ...store, agents }, value: undefined }
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, message: sayWhy(error, 'Your cloud computer was not deleted.') }
      }
    },

    signIn: async ({ name, agent, version, open, step, signal }) => {
      const who = CLOUD_AGENT_NAMES[agent]
      if (version === undefined || !VERSION.test(version)) return { ok: false, message: unknownVersion(agent) }
      try {
        const space = (await computers.list()).find((one) => one.name === name)
        if (space === undefined) return { ok: false, message: 'That cloud computer is not on GitHub any more.' }
        if (cloudStateOf(space.state) !== 'available') step('waking')
        await computers.whenReady(name)
        step('installing')
        const { bin } = await computers.ensureAgent(name, agent, version)
        if (!(await computers.agentSignedIn(name, agent))) {
          step('opening')
          await computers.signIn(name, agent, { open, waiting: () => step('waiting'), ...(signal === undefined ? {} : { signal }) })
          if (!(await computers.agentSignedIn(name, agent))) {
            await remember(name, agent, 'signed-out')
            return { ok: false, message: `${who} finished, but does not say it is signed in. Try again.` }
          }
        }
        await remember(name, agent, 'signed-in')
        ready.set(readyKey(name, agent), { version, at: Date.now(), bin })
        return { ok: true }
      } catch (error) {
        if (error instanceof CloudComputerError && error.kind === 'permission') return { ok: false, message: error.message, permission: true }
        return { ok: false, message: sayWhy(error, `${who} could not be signed in on your cloud computer.`) }
      }
    },

    signOut: async (name, agent) => {
      try {
        await computers.signOut(name, agent)
        ready.delete(readyKey(name, agent))
        await remember(name, agent, 'signed-out')
        return { ok: true }
      } catch (error) {
        return { ok: false, message: sayWhy(error, `${CLOUD_AGENT_NAMES[agent]} could not be signed out on your cloud computer.`) }
      }
    }
  }
}

/** A task id is checked wherever one arrives from outside. */
export function validTaskId(taskId: unknown): taskId is string {
  return typeof taskId === 'string' && CLOUD_TASK_ID.test(taskId)
}
