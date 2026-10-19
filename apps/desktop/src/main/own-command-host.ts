import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { releaseProcessTree } from '@teammate/runtime-adapters'
import {
  bangBlocks,
  capCommandOutput,
  commandNameFromPath,
  omittedNote,
  expandTemplate,
  oneShot,
  parseOwnCommand,
  type CommandContext,
  type ListedCommand,
  type OwnCommandResult,
  type ParsedCommand
} from '../shared/own-commands.js'
import { terminalShells } from './terminal-host.js'

interface ShellChoice { readonly id: string; readonly name: string; readonly file: string; readonly args: readonly string[] }

export interface CommandProcess {
  readonly pid?: number
  stdin: { write(data: string): void; end(): void }
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): void }
  on(event: string, listener: (value?: unknown) => void): void
  kill(): void
}

interface StoredCommand extends ParsedCommand { readonly source: 'global' | 'project' }

const MAX_COMMAND = 16_000
const MAX_FILE = 100_000
const MAX_COMMANDS = 200

const chunkText = (chunk: Buffer | string): string => typeof chunk === 'string' ? chunk : chunk.toString('utf8')

async function readTree(root: string, source: 'global' | 'project'): Promise<StoredCommand[]> {
  const found: StoredCommand[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (found.length >= MAX_COMMANDS) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= MAX_COMMANDS || entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (relative.split('/').length <= 8) await walk(join(dir, entry.name), relative)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        let text = ''
        try { text = await readFile(join(dir, entry.name), 'utf8') } catch { continue }
        if (text.length > MAX_FILE) continue
        found.push({ ...parseOwnCommand(text, commandNameFromPath(relative)), source })
      }
    }
  }
  await walk(root, '')
  return found
}

/**
 * The person's own `!` command, and the Markdown files that become slash commands.
 * The caller names a conversation, never a folder or a shell.
 */
export function createOwnCommandHost(options: {
  readonly root: string
  readonly folder: (context: CommandContext) => Promise<string | undefined>
  readonly refusal: () => string | undefined
  readonly shells?: () => readonly ShellChoice[]
  readonly spawn?: (file: string, args: readonly string[], opts: { readonly cwd: string; readonly input?: string }) => CommandProcess
  readonly platform?: NodeJS.Platform
  /** Ends a process and everything it started; the real one only for real processes, never a test's pid. */
  readonly release?: (pid: number) => Promise<boolean>
}) {
  const shells = options.shells ?? terminalShells
  const platform = options.platform ?? process.platform
  const running = new Map<string, CommandProcess>()
  /*
   * STOP ENDS WHAT THE COMMAND STARTED (0.797). Killing the shell alone left anything it started running on Windows --
   * `!npm run dev` kept its server after Stop -- so a real command's whole tree goes, the way Locust stops a run.
   */
  const release = options.release ?? (options.spawn === undefined ? releaseProcessTree : undefined)
  const end = (child: CommandProcess): void => {
    if (release === undefined || child.pid === undefined) { child.kill(); return }
    void release(child.pid).then((released) => { if (!released) child.kill() }, () => child.kill())
  }
  const stoppedIds = new Set<string>()
  const sameFolder = (a: string, b: string): boolean => platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
  const allowsPath = join(options.root, 'command-allows.json')
  const globalDir = join(options.root, 'commands')

  const readAllows = async (): Promise<readonly string[]> => {
    try {
      const value: unknown = JSON.parse(await readFile(allowsPath, 'utf8'))
      return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
    } catch { return [] }
  }
  const allowed = async (folder: string): Promise<boolean> => (await readAllows()).some((one) => sameFolder(one, folder))

  const commandsIn = async (context: CommandContext): Promise<{ readonly folder?: string; readonly commands: readonly StoredCommand[] }> => {
    const folder = await options.folder(context)
    const global = await readTree(globalDir, 'global')
    const project = folder === undefined ? [] : await readTree(join(folder, '.locust', 'commands'), 'project')
    return { ...(folder === undefined ? {} : { folder }), commands: [...global, ...project] }
  }

  const launch = (shell: ShellChoice, command: string, cwd: string): CommandProcess => {
    const shot = oneShot(shell, command)
    if (options.spawn !== undefined) return options.spawn(shell.file, shot.args, { cwd, ...(shot.input === undefined ? {} : { input: shot.input }) })
    const child = spawn(shell.file, [...shot.args], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    if (shot.input !== undefined) { child.stdin?.write(shot.input); child.stdin?.end() }
    return child as unknown as CommandProcess
  }

  const runIn = (shell: ShellChoice, command: string, cwd: string): { readonly id: string; readonly done: Promise<OwnCommandResult> } => {
    const id = randomUUID()
    const child = launch(shell, command, cwd)
    running.set(id, child)
    const done = new Promise<OwnCommandResult>((resolve) => {
      let raw = ''
      let dropped = 0
      let settled = false
      const push = (chunk: Buffer | string): void => {
        raw += chunkText(chunk)
        if (raw.length > 1_000_000) {
          const kept = raw.slice(-500_000)
          dropped += raw.length - kept.length
          raw = kept
        }
      }
      const finish = (code: number | null): void => {
        if (settled) return
        settled = true
        running.delete(id)
        const capped = capCommandOutput(raw)
        const note = omittedNote(capped.omittedLines, capped.omittedBytes + dropped)
        resolve({
          id,
          output: capped.text,
          exitCode: stoppedIds.has(id) ? null : code,
          stopped: stoppedIds.has(id),
          ...(note === undefined ? {} : { omitted: note })
        })
      }
      child.stdout.on('data', push)
      child.stderr.on('data', push)
      child.on('error', (error) => { raw += error instanceof Error ? error.message : 'The command could not start.'; finish(1) })
      child.on('close', (code) => finish(typeof code === 'number' ? code : null))
    })
    return { id, done }
  }

  return {
    list: async (context: CommandContext): Promise<readonly ListedCommand[]> => (await commandsIn(context)).commands.map((command) => ({
      name: command.name,
      source: command.source,
      ...(command.description === undefined ? {} : { description: command.description }),
      ...(command.teammate === undefined ? {} : { teammate: command.teammate }),
      ...(command.mode === undefined ? {} : { mode: command.mode })
    })),
    directory: async (which: 'global' | 'project', context: CommandContext): Promise<string | undefined> => {
      if (which === 'global') return globalDir
      const folder = await options.folder(context)
      return folder === undefined ? undefined : join(folder, '.locust', 'commands')
    },
    allow: async (context: CommandContext): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
      const folder = await options.folder(context)
      if (folder === undefined) return { ok: false, message: 'Choose a folder first. Nothing was allowed.' }
      const current = (await readAllows()).filter((one) => !sameFolder(one, folder))
      await mkdir(options.root, { recursive: true })
      await writeFile(allowsPath, JSON.stringify([...current, resolve(folder)]), 'utf8')
      return { ok: true }
    },
    expand: async (context: CommandContext, name: string, source: 'global' | 'project', args: string): Promise<
      { readonly ok: false; readonly message: string } | { readonly ok: true; readonly ask: readonly string[] } | { readonly ok: true; readonly text: string; readonly mode?: ParsedCommand['mode']; readonly teammate?: string }
    > => {
      const loaded = await commandsIn(context)
      const command = loaded.commands.find((one) => one.source === source && one.name.toLowerCase() === name.toLowerCase())
      if (command === undefined) return { ok: false, message: 'That command is not in this folder. Nothing was changed.' }
      const text = expandTemplate(command.body, args)
      const blocks = bangBlocks(text)
      if (blocks.length === 0) return { ok: true, text, ...(command.mode === undefined ? {} : { mode: command.mode }), ...(command.teammate === undefined ? {} : { teammate: command.teammate }) }
      const refused = options.refusal()
      if (refused !== undefined) return { ok: false, message: refused }
      if (source === 'project') {
        if (loaded.folder === undefined) return { ok: false, message: 'Choose a folder first. Nothing was run.' }
        if (!await allowed(loaded.folder)) return { ok: true, ask: blocks.map((block) => block.command) }
      }
      const shell = shells()[0]
      if (shell === undefined || loaded.folder === undefined) return { ok: false, message: loaded.folder === undefined ? 'Choose a folder first. Nothing was run.' : 'There is no shell to run that in.' }
      let filled = text
      for (const block of blocks) {
        const ran = await runIn(shell, block.command, loaded.folder).done
        const body = ran.output.length === 0 ? '(no output)' : ran.output
        const how = ran.stopped ? 'stopped before it finished' : ran.exitCode === null ? 'ended' : `exit ${String(ran.exitCode)}`
        const note = ran.omitted === undefined ? '' : `\n${ran.omitted}`
        const at = filled.indexOf(block.token)
        const insertion = `output of \`${block.command}\` (${how}):\n${body}${note}`
        if (at >= 0) filled = `${filled.slice(0, at)}${insertion}${filled.slice(at + block.token.length)}`
      }
      return { ok: true, text: filled, ...(command.mode === undefined ? {} : { mode: command.mode }), ...(command.teammate === undefined ? {} : { teammate: command.teammate }) }
    },
    start: async (context: CommandContext, command: string): Promise<{ readonly ok: false; readonly message: string } | { readonly ok: true; readonly id: string; readonly done: Promise<OwnCommandResult> }> => {
      const text = command.trim()
      if (text.length === 0) return { ok: false, message: 'Type a command after !. Nothing was run.' }
      if (text.length > MAX_COMMAND) return { ok: false, message: 'That command is too long. Nothing was run.' }
      const refused = options.refusal()
      if (refused !== undefined) return { ok: false, message: refused }
      const folder = await options.folder(context)
      if (folder === undefined) return { ok: false, message: 'Choose a folder first. Nothing was run.' }
      const shell = shells()[0]
      if (shell === undefined) return { ok: false, message: 'There is no shell to run that in.' }
      const started = runIn(shell, text, folder)
      return { ok: true, id: started.id, done: started.done }
    },
    stop: (id: string): void => {
      stoppedIds.add(id)
      const child = running.get(id)
      if (child !== undefined) end(child)
    },
    stopAll: (): void => { for (const [id, child] of running) { stoppedIds.add(id); end(child) } }
  }
}

export async function ensureCommandDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}
