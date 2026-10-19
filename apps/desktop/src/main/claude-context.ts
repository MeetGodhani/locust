import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { createClaudeContextCommand, createNodeRuntimeProcessRunner, type RuntimeCommandSpec } from '@teammate/runtime-adapters'
import type { PreparedSkills } from './claude-skills.js'
import type { ClaudeContextBreakdown } from '../shared/context-breakdown.js'
import { replaceFile } from './replace-file.js'

export interface ClaudeContextLaunch {
  readonly cwd: string
  readonly executablePath: string
  readonly args: readonly string[]
  readonly sandbox: 'read-only' | 'workspace-write' | 'full-access'
  readonly permission?: string
  readonly browser?: string
  readonly plugins: readonly { readonly name: string; readonly dir: string }[]
}
export interface ClaudeContextTurn {
  readonly missionId: string
  readonly sessionId: string
  readonly busy: boolean
  readonly account?: string
  readonly fallback?: ClaudeContextLaunch
}

/** Older ledgers already hold the actual argv. Recognize only resources Locust itself made. */
export function recordedClaudeContextLaunch(command: { readonly executablePath: string; readonly args: readonly string[] } | undefined, cwd: string | undefined, sandbox: ClaudeContextLaunch['sandbox']): ClaudeContextLaunch | undefined {
  if (command === undefined || cwd === undefined) return undefined
  let permission: string | undefined, browser: string | undefined
  const plugins: { name: string; dir: string }[] = []
  for (let index = 0; index < command.args.length; index++) {
    const arg = command.args[index]
    if (arg === '--mcp-config') {
      while (command.args[index + 1] !== undefined && !command.args[index + 1]!.startsWith('--')) {
        const path = command.args[++index]!, parent = basename(dirname(path))
        if (parent.startsWith('locust-permission-')) permission = path
        else if (parent.startsWith('locust-browser-')) browser = path
        else return undefined
      }
    } else if (arg === '--plugin-dir') {
      const dir = command.args[++index]
      if (dir === undefined || !['project', 'personal', 'library'].includes(basename(dir))) return undefined
      plugins.push({ name: basename(dir), dir })
    }
  }
  return { ...command, cwd, sandbox, plugins, ...(permission === undefined ? {} : { permission }), ...(browser === undefined ? {} : { browser }) }
}
interface PreparedContext {
  readonly command: RuntimeCommandSpec
  readonly dispose: () => Promise<void>
}

/** Recreate expired host resources, but never re-decide the turn's tools, connector choice or mode. */
export async function prepareClaudeContextLaunch(launch: ClaudeContextLaunch, turn: ClaudeContextTurn, resources: {
  readonly env?: Readonly<Record<string, string>>
  readonly permission: (runId: string, missionId: string, cwd: string) => Promise<string>
  readonly browser: (runId: string, missionId: string, cwd: string) => Promise<string>
  readonly skills: (profile: { readonly ownSkills: boolean; readonly auto: boolean }) => Promise<PreparedSkills>
  readonly release: (runId: string) => Promise<void>
}): Promise<PreparedContext> {
  const runId = `context_${randomUUID()}`
  let skills: PreparedSkills | undefined
  const dispose = async (): Promise<void> => { await Promise.all([resources.release(runId), skills?.dispose()]) }
  try {
    const replacements = new Map<string, string>()
    if (launch.permission !== undefined) replacements.set(launch.permission, await resources.permission(runId, turn.missionId, launch.cwd))
    if (launch.browser !== undefined) replacements.set(launch.browser, await resources.browser(runId, turn.missionId, launch.cwd))
    if (launch.plugins.length > 0) {
      skills = await resources.skills({ ownSkills: launch.plugins.some((plugin) => plugin.name === 'personal'), auto: launch.sandbox === 'full-access' })
      for (const plugin of launch.plugins) {
        const copy = skills.plugins.find((candidate) => candidate.name === plugin.name)
        if (copy === undefined) throw new Error('The turn\'s skills are unavailable.')
        replacements.set(plugin.dir, copy.dir)
      }
    }
    const command = createClaudeContextCommand({ runtime: 'claude', executablePath: launch.executablePath,
      args: launch.args.map((arg) => replacements.get(arg) ?? arg), cwd: launch.cwd, sandbox: launch.sandbox,
      stdin: 'stream-json', stdout: 'jsonl', ...(resources.env === undefined ? {} : { env: resources.env })
    }, turn.sessionId)
    return { command, dispose }
  } catch (error) { await dispose(); throw error }
}

function tokenCount(value: string): number | undefined {
  const match = /^(\d[\d,]*(?:\.\d+)?)([km])?$/i.exec(value.trim())
  if (match === null) return undefined
  const count = Number(match[1]!.replace(/,/g, '')) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1)
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : undefined
}

/** Only the category table, never the per-tool tables that follow it. A missing row is not a zero estimate. */
export function parseClaudeContext(json: string): ClaudeContextBreakdown | undefined {
  try {
    // Free means no turn and no model call. Not total_cost_usd: on a resumed session it is that session's earlier
    // spend (MEASURED 2026-10-19: 0.00107 with num_turns 0 and duration_api_ms 0).
    const reply = JSON.parse(json) as { num_turns?: unknown; is_error?: unknown; result?: unknown; duration_api_ms?: unknown }
    if (reply.num_turns !== 0 || reply.is_error === true || typeof reply.result !== 'string' || (typeof reply.duration_api_ms === 'number' && reply.duration_api_ms > 0)) return undefined
    const markdown = reply.result.replace(/\r/g, '')
    const total = /\*\*Tokens:\*\*\s*([\d.,]+[km]?)\s*\/\s*([\d.,]+[km]?)/i.exec(markdown)
    const used = total === null ? undefined : tokenCount(total[1]!), window = total === null ? undefined : tokenCount(total[2]!)
    if (used === undefined || window === undefined || window <= 0) return undefined
    const after = markdown.split(/Estimated usage by category/i)[1]
    if (after === undefined) return undefined
    const categories: { name: string; tokens: number }[] = []
    let table = false
    for (const line of after.split('\n')) {
      if (!line.trim().startsWith('|')) { if (table && line.trim() !== '') break; continue }
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/\*\*/g, ''))
      if (!table) { if (cells[0]?.toLowerCase() !== 'category') return undefined; table = true; continue }
      const name = cells[0], tokens = cells[1] === undefined ? undefined : tokenCount(cells[1])
      if (name === undefined || name === '' || name.length > 80 || tokens === undefined) continue
      if (categories.length >= 32 || categories.some((row) => row.name.toLowerCase() === name.toLowerCase())) return undefined
      categories.push({ name, tokens })
    }
    return categories.length === 0 ? undefined : { used, window, categories }
  } catch { return undefined }
}

/**
 * The ordinary runner already owns cancellation and process-tree teardown, including on Windows, with its own grace.
 * (A grace of 0 is refused by the runner: the first build of this never ran /context at all.)
 */
export async function runClaudeContext(command: RuntimeCommandSpec, signal: AbortSignal): Promise<string> {
  const overflow = new AbortController()
  const process = createNodeRuntimeProcessRunner({ maxRecordBytes: 1_048_576, maxQueuedRecords: 16 }).start(command, '', { signal: AbortSignal.any([signal, overflow.signal]) })
  const records: string[] = []
  let bytes = 0
  for await (const record of process.records) {
    bytes += Buffer.byteLength(record.raw)
    if (bytes > 1_048_576) overflow.abort()
    else records.push(record.raw)
  }
  const done = await process.completion
  if (signal.aborted || overflow.signal.aborted || done.exitCode !== 0 || done.cancelled || done.terminationUnconfirmed || done.oversizedRecordsDropped > 0) throw new Error('Context was not available.')
  return records.join('\n')
}

/** No polling. One lazy, silent result per finished turn; a start cancels and awaits any inspection first. */
export function createClaudeContextReader(options: {
  readonly file: string
  readonly resolve: (missionId: string) => Promise<ClaudeContextTurn | undefined>
  readonly prepare: (launch: ClaudeContextLaunch, turn: ClaudeContextTurn) => Promise<PreparedContext>
  readonly run?: (command: RuntimeCommandSpec, signal: AbortSignal) => Promise<string>
  readonly timeoutMs?: number
}) {
  const cache = new Map<string, ClaudeContextBreakdown | undefined>()
  const pending = new Map<string, { controller: AbortController; promise: Promise<ClaudeContextBreakdown | undefined> }>()
  let launches: Record<string, ClaudeContextLaunch> | undefined
  let loading: Promise<Record<string, ClaudeContextLaunch>> | undefined
  let writes = Promise.resolve()
  const load = (): Promise<Record<string, ClaudeContextLaunch>> => loading ??= (async () => {
    if (launches === undefined) {
      try { launches = JSON.parse(await readFile(options.file, 'utf8')) as Record<string, ClaudeContextLaunch> }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; launches = {} }
    }
    return launches
  })()
  const cacheResult = (key: string, result: ClaudeContextBreakdown | undefined): void => {
    cache.delete(key); cache.set(key, result)
    while (cache.size > 64) cache.delete(cache.keys().next().value!)
  }
  return {
    remember(missionId: string, launch: ClaudeContextLaunch): Promise<void> {
      // Paths and flags only: no environment, MCP tokens, connector credentials or transcript contents.
      const next = writes.then(async () => {
        const saved = await load()
        delete saved[missionId]; saved[missionId] = {
          cwd: launch.cwd, executablePath: launch.executablePath, args: [...launch.args], sandbox: launch.sandbox,
          plugins: launch.plugins.map(({ name, dir }) => ({ name, dir })),
          ...(launch.permission === undefined ? {} : { permission: launch.permission }),
          ...(launch.browser === undefined ? {} : { browser: launch.browser })
        }
        while (Object.keys(saved).length > 128) delete saved[Object.keys(saved)[0]!]
        await mkdir(dirname(options.file), { recursive: true })
        const temporary = `${options.file}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 })
        await replaceFile(temporary, options.file)
      })
      writes = next.catch(() => undefined)
      return next
    },
    async read(missionId: string): Promise<ClaudeContextBreakdown | undefined> {
      try {
        const turn = await options.resolve(missionId)
        if (turn === undefined || turn.busy) return undefined
        const key = `${turn.missionId}:${turn.sessionId}`
        if (cache.has(key)) return cache.get(key)
        const held = pending.get(key)
        if (held !== undefined) return held.promise
        const controller = new AbortController()
        const promise = (async () => {
          let prepared: PreparedContext | undefined
          const timer = setTimeout(() => controller.abort('timeout'), options.timeoutMs ?? 10_000)
          try {
            await writes
            const launch = (await load())[turn.missionId] ?? turn.fallback
            if (launch === undefined) return undefined
            prepared = await options.prepare(launch, turn)
            const current = await options.resolve(missionId)
            if (controller.signal.aborted || current?.busy !== false || current.missionId !== turn.missionId) return undefined
            const raw = await (options.run ?? runClaudeContext)(prepared.command, controller.signal)
            const after = await options.resolve(missionId)
            if (controller.signal.aborted || after?.busy !== false || after.missionId !== turn.missionId) return undefined
            const result = parseClaudeContext(raw)
            cacheResult(key, result)
            return result
          } catch {
            if (!controller.signal.aborted || controller.signal.reason === 'timeout') cacheResult(key, undefined)
            return undefined
          } finally {
            clearTimeout(timer)
            if (controller.signal.reason === 'timeout') cacheResult(key, undefined)
            await prepared?.dispose().catch(() => undefined)
            pending.delete(key)
          }
        })()
        pending.set(key, { controller, promise })
        return promise
      } catch { return undefined }
    },
    async beforeStart(): Promise<void> {
      for (const entry of pending.values()) entry.controller.abort()
      await Promise.all([...pending.values()].map((entry) => entry.promise))
    }
  }
}
export type ClaudeContextReader = ReturnType<typeof createClaudeContextReader>
