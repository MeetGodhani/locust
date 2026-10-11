import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
 * The entry is the one Settings already showed for Claude Code and Codex: Locust's own binary run as Node,
 * its bridge, and the connection file the local server writes when it is on.
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
 * Whether the Claude app is open, and closing and opening it -- only when the person presses Restart.
 *
 * On Windows the app is `claude.exe` under %LOCALAPPDATA%\AnthropicClaude (Squirrel: a launcher there, the app in
 * an `app-<version>` folder beside it). Claude Code's own command-line `claude.exe` lives elsewhere, so the path
 * tells them apart: a restart never touches a terminal's Claude Code. On a Mac, the app named Claude.
 */
const WINDOWS_CLAUDE_APP = "Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\\AnthropicClaude\\*' }"

function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true, timeout: 20_000 }, (error, stdout) => (error === null ? resolve(String(stdout)) : reject(error)))
  })
}

export async function claudeAppRunning(platform: NodeJS.Platform): Promise<boolean> {
  if (platform === 'win32') return Number((await run('powershell.exe', ['-NoProfile', '-Command', `@(${WINDOWS_CLAUDE_APP}).Count`])).trim() || '0') > 0
  if (platform === 'darwin') return (await run('osascript', ['-e', 'application "Claude" is running'])).trim() === 'true'
  return false
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

const ENTRY = 'locust'
type Settings = Record<string, unknown>
const isRecord = (value: unknown): value is Settings => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface ClaudeAppConnector {
  status(): Promise<ClaudeAppConnection>
  add(): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
  remove(): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
  restart(): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
}

export function createClaudeAppConnector(options: {
  readonly file: string | undefined
  readonly entry: () => ClaudeAppEntry
  /** Whether the Claude app is open now. */
  readonly running?: () => Promise<boolean>
  /** Close the Claude app and open it again. */
  readonly relaunch?: () => Promise<void>
}): ClaudeAppConnector {
  /** Added while Claude was open: it has not read the entry yet. */
  let unread = false
  const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

  /** The settings as they stand: none yet, read, or unreadable (and then left alone). */
  const read = async (file: string): Promise<{ readonly kind: 'none' } | { readonly kind: 'read'; readonly settings: Settings } | { readonly kind: 'unreadable' }> => {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'none' } : { kind: 'unreadable' }
    }
    if (text.trim().length === 0) return { kind: 'read', settings: {} }
    try {
      const parsed = JSON.parse(text.replace(/^﻿/, '')) as unknown
      return isRecord(parsed) ? { kind: 'read', settings: parsed } : { kind: 'unreadable' }
    } catch {
      return { kind: 'unreadable' }
    }
  }

  const write = async (file: string, settings: Settings): Promise<void> => {
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.locust-tmp`
    await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  }

  const UNREADABLE = 'The Claude app’s settings file could not be read, so Locust left it as it is.'

  return {
    async status() {
      const file = options.file
      // No folder of Claude's: the app is not installed here.
      if (file === undefined || !(await exists(dirname(file)))) return { kind: 'no-app' }
      const now = await read(file)
      if (now.kind === 'unreadable') return { kind: 'unreadable', message: UNREADABLE }
      const servers = now.kind === 'read' && isRecord(now.settings.mcpServers) ? now.settings.mcpServers : undefined
      if (servers === undefined || !(ENTRY in servers)) return { kind: 'not-added' }
      // Claude closed since: it reads the entry when it next starts, so nothing is left to do.
      if (unread && options.running !== undefined && !(await options.running().catch(() => true))) unread = false
      return unread ? { kind: 'added', restart: true } : { kind: 'added' }
    },

    async add() {
      const file = options.file
      if (file === undefined || !(await exists(dirname(file)))) return { ok: false, message: 'The Claude app is not installed on this computer.' }
      const now = await read(file)
      if (now.kind === 'unreadable') return { ok: false, message: UNREADABLE }
      const settings: Settings = now.kind === 'read' ? { ...now.settings } : {}
      if (settings.mcpServers !== undefined && !isRecord(settings.mcpServers)) return { ok: false, message: UNREADABLE }
      try {
        // The original is kept once: a second Add never overwrites the copy of what the person had.
        if (now.kind === 'read' && !(await exists(file + CLAUDE_APP_BACKUP_SUFFIX))) await copyFile(file, file + CLAUDE_APP_BACKUP_SUFFIX)
        const entry = options.entry()
        settings.mcpServers = { ...(isRecord(settings.mcpServers) ? settings.mcpServers : {}), [ENTRY]: { command: entry.command, args: [...entry.args], env: { ...entry.env } } }
        await write(file, settings)
        unread = options.running === undefined ? false : await options.running().catch(() => false)
        return { ok: true }
      } catch {
        return { ok: false, message: 'Locust could not save the Claude app’s settings. Nothing was changed.' }
      }
    },

    async restart() {
      if (options.relaunch === undefined) return { ok: false, message: 'Quit the Claude app and open it again.' }
      try {
        await options.relaunch()
        unread = false
        return { ok: true }
      } catch {
        return { ok: false, message: 'Locust could not restart the Claude app. Quit it from its icon by the clock and open it again.' }
      }
    },

    async remove() {
      const file = options.file
      if (file === undefined) return { ok: true }
      const now = await read(file)
      if (now.kind === 'none') return { ok: true }
      if (now.kind === 'unreadable') return { ok: false, message: UNREADABLE }
      const servers = isRecord(now.settings.mcpServers) ? { ...now.settings.mcpServers } : undefined
      if (servers === undefined || !(ENTRY in servers)) return { ok: true }
      delete servers[ENTRY]
      const settings: Settings = { ...now.settings }
      if (Object.keys(servers).length === 0) delete settings.mcpServers
      else settings.mcpServers = servers
      try {
        await write(file, settings)
        return { ok: true }
      } catch {
        return { ok: false, message: 'Locust could not save the Claude app’s settings. Nothing was changed.' }
      }
    }
  }
}
