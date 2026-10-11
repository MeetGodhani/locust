import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ClaudeAppConnection } from '../shared/locust-mcp.js'

/**
 * LOCUST IN THE CLAUDE APP, IN ONE PRESS (0.740).
 *
 * Colin, 2026-10-11, handed the five-step recipe for adding Locust to the Claude app's tools (open Claude's
 * Settings > Developer > Edit Config, paste a block with three paths and the right commas, quit from the tray,
 * reopen): "can you handle this? cause this is a bit ridiculous to expect a new user to do". So Locust does the
 * edit, and only when the person presses Add: it keeps the file as it was beside it (once, the original), adds
 * one `locust` entry under `mcpServers` and changes nothing else, and Remove takes that entry out again. A file
 * it cannot read is left alone -- never rewritten from a guess.
 *
 * HARDENED (0.741, Sol's review of 0.740, ten findings, each checked here):
 *  1-2. One change at a time, and a change starts again if the file moved under it (Claude saving its own
 *       settings meanwhile); the temporary file is new and exclusive each time; the original is copied only
 *       if no copy exists yet (never overwritten).
 *  3.   Only Locust's own entry -- the one that runs Locust's bridge -- is ever changed or removed; a different
 *       server the person happened to name `locust` is left alone and said to be theirs.
 *  4-5. The file keeps its permissions, and a settings file that is a link is written at its target.
 *  6.   Restart closes only processes under the Claude app's own folder, by prefix, not by a word in the path.
 *  7.   An entry whose program or bridge is gone, or that points at another copy of Locust, says so and offers
 *       Update.
 *  8-9. Whether Claude still has to restart is worked out from the facts, not remembered: a Claude app started
 *       before its settings last changed has not read them. That holds across a Locust restart, and after
 *       Remove as well as Add.
 *  10.  Settings holding a number JavaScript cannot keep exactly are left alone rather than rewritten.
 */
export interface ClaudeAppEntry {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/** Where the Claude app keeps its settings file, or undefined where it has none Locust knows. */
export function claudeAppConfigFile(platform: NodeJS.Platform, appData: string | undefined, home: string): string | undefined {
  if (platform === 'win32') return appData === undefined || appData.length === 0 ? undefined : join(appData, 'Claude', 'claude_desktop_config.json')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  return undefined
}

/**
 * When the Claude app started, and closing and opening it -- only when the person presses Restart.
 *
 * On Windows the app is `claude.exe` under %LOCALAPPDATA%\AnthropicClaude\ (Squirrel: a launcher there, the app in
 * an `app-<version>` folder beside it), matched by that folder as a PREFIX of its path. Claude Code's own
 * command-line `claude.exe` lives elsewhere, so a restart never touches a terminal's Claude Code. On a Mac, the
 * app named Claude.
 */
const WINDOWS_CLAUDE_APP = "$root = Join-Path $env:LOCALAPPDATA 'AnthropicClaude\\'; Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) }"

function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true, timeout: 20_000 }, (error, stdout) => (error === null ? resolve(String(stdout)) : reject(error)))
  })
}

/** When the Claude app started (ms), null when it is not running, undefined when this system cannot say. */
export async function claudeAppStartedAt(platform: NodeJS.Platform): Promise<number | null | undefined> {
  if (platform === 'win32') {
    const said = (await run('powershell.exe', ['-NoProfile', '-Command', `$p = @(${WINDOWS_CLAUDE_APP}); if ($p.Count -eq 0) { 'none' } else { ($p | Sort-Object StartTime | Select-Object -First 1).StartTime.ToUniversalTime().ToString('o') }`])).trim()
    if (said === 'none') return null
    const at = Date.parse(said)
    return Number.isFinite(at) ? at : undefined
  }
  if (platform === 'darwin') {
    const running = (await run('osascript', ['-e', 'application "Claude" is running'])).trim() === 'true'
    return running ? undefined : null
  }
  return null
}

export async function relaunchClaudeApp(platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') {
    await run('powershell.exe', ['-NoProfile', '-Command', `${WINDOWS_CLAUDE_APP} | Stop-Process -Force; Start-Sleep -Milliseconds 1500; Start-Process (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\\claude.exe')`])
    return
  }
  if (platform === 'darwin') {
    await run('osascript', ['-e', 'tell application "Claude" to quit'])
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await run('open', ['-a', 'Claude'])
    return
  }
  throw new Error('No Claude app on this system.')
}

/** The original, kept beside the settings file the first time Locust changes it. */
export const CLAUDE_APP_BACKUP_SUFFIX = '.before-locust'
/** Locust's bridge, by the name its own entry always runs. */
const BRIDGE = 'locust-mcp-bridge.mjs'
const ENTRY = 'locust'
type Settings = Record<string, unknown>
const isRecord = (value: unknown): value is Settings => typeof value === 'object' && value !== null && !Array.isArray(value)
type Done = { readonly ok: true } | { readonly ok: false; readonly message: string }

export interface ClaudeAppConnector {
  status(): Promise<ClaudeAppConnection>
  add(): Promise<Done>
  remove(): Promise<Done>
  restart(): Promise<Done>
}

/** Locust's own entry: one that runs Locust's bridge. Anything else named `locust` is the person's. */
function ours(entry: unknown): entry is { readonly command: string; readonly args: readonly string[] } {
  if (!isRecord(entry) || typeof entry.command !== 'string' || !Array.isArray(entry.args)) return false
  const bridge = entry.args[0]
  return typeof bridge === 'string' && (bridge.endsWith(`\\${BRIDGE}`) || bridge.endsWith(`/${BRIDGE}`))
}

/** Every number kept exactly by a JSON round trip; an integer past 2^53 is not (Sol's #10). */
function exact(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isInteger(value) || Number.isSafeInteger(value)
  if (Array.isArray(value)) return value.every(exact)
  if (isRecord(value)) return Object.values(value).every(exact)
  return true
}

export function createClaudeAppConnector(options: {
  readonly file: string | undefined
  readonly entry: () => ClaudeAppEntry
  /** When the Claude app started; null when it is not running; undefined when the system cannot say. */
  readonly startedAt?: () => Promise<number | null | undefined>
  /** Close the Claude app and open it again. */
  readonly relaunch?: () => Promise<void>
  /** Whether a path exists (for an entry's program and bridge); a test may stand in. */
  readonly exists?: (path: string) => Promise<boolean>
  readonly platform?: NodeJS.Platform
  /**
   * When Locust last changed Claude's settings, and last restarted Claude: kept in Locust's own folder, so a
   * Locust restart does not forget that Claude still has to (Sol's #8). Claude rewriting its own settings does
   * not count -- only Locust's change is what Claude has to read.
   */
  readonly marks?: {
    readonly read: () => Promise<{ readonly changedAt?: number; readonly restartedAt?: number }>
    readonly write: (marks: { readonly changedAt?: number; readonly restartedAt?: number }) => Promise<void>
  }
  readonly now?: () => number
}): ClaudeAppConnector {
  const exists = options.exists ?? ((path: string): Promise<boolean> => access(path).then(() => true, () => false))
  const platform = options.platform ?? process.platform
  const clock = options.now ?? Date.now
  let memory: { changedAt?: number; restartedAt?: number } = {}
  const marks = options.marks ?? { read: async () => memory, write: async (next) => { memory = { ...next } } }
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const task = queue.then(work)
    queue = task.catch(() => undefined)
    return task
  }

  /** The file itself: a settings file that is a link is read and written at its target (Sol's #5). */
  const target = async (file: string): Promise<string> => {
    try {
      return (await lstat(file)).isSymbolicLink() ? await realpath(file) : file
    } catch {
      return file
    }
  }

  type Read = { readonly kind: 'none' } | { readonly kind: 'read'; readonly text: string; readonly settings: Settings } | { readonly kind: 'unreadable' } | { readonly kind: 'inexact' }
  const read = async (file: string): Promise<Read> => {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'none' } : { kind: 'unreadable' }
    }
    if (text.trim().length === 0) return { kind: 'read', text, settings: {} }
    try {
      const parsed = JSON.parse(text.replace(/^﻿/, '')) as unknown
      if (!isRecord(parsed)) return { kind: 'unreadable' }
      return exact(parsed) ? { kind: 'read', text, settings: parsed } : { kind: 'inexact' }
    } catch {
      return { kind: 'unreadable' }
    }
  }

  const UNREADABLE = 'The Claude app’s settings file could not be read, so Locust left it as it is.'
  const INEXACT = 'The Claude app’s settings hold a number Locust cannot keep exactly, so Locust left them as they are.'
  const TAKEN = 'The Claude app already has a different add-on named “locust”, so Locust left it alone.'
  const FAILED = 'Locust could not save the Claude app’s settings. Nothing was changed.'

  /**
   * One change, start to end: read, change, write beside it, and swap it in only if the file is still what was
   * read -- otherwise start again from what is there now (Sol's #1). A few tries, then say so.
   */
  const change = async (file: string, edit: (settings: Settings) => { readonly next: Settings } | Done): Promise<Done> => {
    const path = await target(file)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const before = await read(path)
      if (before.kind === 'unreadable') return { ok: false, message: UNREADABLE }
      if (before.kind === 'inexact') return { ok: false, message: INEXACT }
      const asked = edit(before.kind === 'read' ? { ...before.settings } : {})
      if (!('next' in asked)) return asked
      const edited = asked.next
      const temp = `${path}.locust-${randomBytes(6).toString('hex')}`
      try {
        await mkdir(dirname(path), { recursive: true })
        // Exclusive: never into something already there, a link least of all (Sol's #2, #5).
        await writeFile(temp, `${JSON.stringify(edited, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
        // The file keeps its permissions (Sol's #4); Windows keeps the folder's.
        if (platform !== 'win32' && before.kind === 'read') await chmod(temp, (await stat(path)).mode & 0o777)
        const now = await read(path)
        const same = before.kind === 'none' ? now.kind === 'none' : now.kind === 'read' && now.text === before.text
        if (!same) {
          await rm(temp, { force: true })
          continue
        }
        // The original, kept once: never over a copy already there (Sol's #2).
        if (before.kind === 'read') {
          await copyFile(path, path + CLAUDE_APP_BACKUP_SUFFIX, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error
          })
        }
        await rename(temp, path)
        return { ok: true }
      } catch {
        await rm(temp, { force: true }).catch(() => undefined)
        return { ok: false, message: FAILED }
      }
    }
    return { ok: false, message: 'The Claude app kept changing its settings, so Locust stopped. Try again.' }
  }

  /**
   * Whether the Claude app has not yet read Locust's last change (Sol's #8, #9): it started before that change.
   * Where the system cannot say when it started, the last restart Locust made stands in for it.
   */
  const unread = async (): Promise<boolean> => {
    const { changedAt, restartedAt } = await marks.read().catch(() => ({} as { changedAt?: number; restartedAt?: number }))
    if (changedAt === undefined) return false
    const started = await (options.startedAt?.() ?? Promise.resolve(null)).catch(() => undefined)
    if (started === null) return false
    if (started === undefined) return restartedAt === undefined || restartedAt < changedAt
    return started < changedAt
  }

  const status = async (): Promise<ClaudeAppConnection> => {
    const file = options.file
    // No folder of Claude's: the app is not installed here.
    if (file === undefined || !(await exists(dirname(file)))) return { kind: 'no-app' }
    const now = await read(await target(file))
    if (now.kind === 'unreadable') return { kind: 'unreadable', message: UNREADABLE }
    if (now.kind === 'inexact') return { kind: 'unreadable', message: INEXACT }
    const servers = now.kind === 'read' && isRecord(now.settings.mcpServers) ? now.settings.mcpServers : undefined
    const entry = servers?.[ENTRY]
    const restart = await unread()
    if (entry === undefined) return restart ? { kind: 'not-added', restart: true } : { kind: 'not-added' }
    if (!ours(entry)) return { kind: 'taken', message: TAKEN }
    // Pointing at a Locust that is not this one, or at files that are gone (Sol's #7).
    const current = options.entry()
    const stale = entry.command !== current.command || entry.args[0] !== current.args[0] || entry.args[1] !== current.args[1]
      || !(await exists(entry.command)) || !(await exists(String(entry.args[0])))
    return { kind: 'added', ...(restart ? { restart: true } : {}), ...(stale ? { stale: true } : {}) }
  }

  return {
    status: () => serial(status),

    add: () => serial(async () => {
      const file = options.file
      if (file === undefined || !(await exists(dirname(file)))) return { ok: false, message: 'The Claude app is not installed on this computer.' }
      const done = await change(file, (settings) => {
        if (settings.mcpServers !== undefined && !isRecord(settings.mcpServers)) return { ok: false, message: UNREADABLE }
        const servers = isRecord(settings.mcpServers) ? settings.mcpServers : {}
        if (servers[ENTRY] !== undefined && !ours(servers[ENTRY])) return { ok: false, message: TAKEN }
        const entry = options.entry()
        return { next: { ...settings, mcpServers: { ...servers, [ENTRY]: { command: entry.command, args: [...entry.args], env: { ...entry.env } } } } }
      })
      if (done.ok) await marks.write({ ...(await marks.read().catch(() => ({}))), changedAt: clock() }).catch(() => undefined)
      return done
    }),

    remove: () => serial(async () => {
      const file = options.file
      if (file === undefined) return { ok: true }
      const done = await change(file, (settings) => {
        const servers = isRecord(settings.mcpServers) ? { ...settings.mcpServers } : undefined
        if (servers === undefined || servers[ENTRY] === undefined) return { ok: true }
        if (!ours(servers[ENTRY])) return { ok: false, message: TAKEN }
        delete servers[ENTRY]
        const next: Settings = { ...settings }
        if (Object.keys(servers).length === 0) delete next.mcpServers
        else next.mcpServers = servers
        return { next }
      })
      if (done.ok) await marks.write({ ...(await marks.read().catch(() => ({}))), changedAt: clock() }).catch(() => undefined)
      return done
    }),

    restart: () => serial(async () => {
      if (options.relaunch === undefined) return { ok: false, message: 'Quit the Claude app and open it again.' }
      try {
        await options.relaunch()
        await marks.write({ ...(await marks.read().catch(() => ({}))), restartedAt: clock() }).catch(() => undefined)
        return { ok: true }
      } catch {
        return { ok: false, message: 'Locust could not restart the Claude app. Quit it from its icon by the clock and open it again.' }
      }
    })
  }
}
