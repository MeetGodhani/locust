import type { MissionMode } from './ipc.js'

/**
 * A `!` at the start of the chat box, and Markdown files that become slash
 * commands. The window sends command text and identities. The folder and the
 * shell are chosen in the main process, the same way the terminal panel is.
 */

export const OWN_COMMAND_RUN = 'own-commands:run'
export const OWN_COMMAND_STOP = 'own-commands:stop'
export const OWN_COMMAND_DONE = 'own-commands:done'
export const OWN_COMMAND_LIST = 'own-commands:list'
export const OWN_COMMAND_EXPAND = 'own-commands:expand'
export const OWN_COMMAND_ALLOW = 'own-commands:allow'
export const OWN_COMMAND_OPEN = 'own-commands:open'

export const COMMAND_OUTPUT_MAX_LINES = 200
export const COMMAND_OUTPUT_MAX_BYTES = 32 * 1024

export interface CommandContext {
  readonly missionId?: string
  readonly teammateId?: string
}

export interface ListedCommand {
  readonly name: string
  readonly description?: string
  readonly source: 'global' | 'project'
  readonly teammate?: string
  readonly mode?: MissionMode
}

export interface OwnCommandResult {
  readonly id: string
  readonly output: string
  readonly exitCode: number | null
  readonly stopped: boolean
  readonly omitted?: string
}

export interface ConversationCommand {
  readonly id: string
  readonly command: string
  readonly output: string
  readonly exitCode: number | null
  readonly stopped: boolean
  readonly running: boolean
  readonly omitted?: string
}

const MODE_WORDS: Readonly<Record<string, MissionMode>> = {
  ask: 'ask',
  plan: 'plan',
  edit: 'accept-edits',
  'accept-edits': 'accept-edits',
  approve: 'approve-each',
  'approve-each': 'approve-each',
  auto: 'auto'
}

const byteLength = (value: string): number => new TextEncoder().encode(value).length

/** A draft that starts with `!` is a command. The rest is what will run. */
export function bangDraft(text: string): { readonly command: string } | undefined {
  if (!text.startsWith('!')) return undefined
  return { command: text.slice(1).trim() }
}

/** Escape leaves command mode and keeps what was typed after the mark. */
export function leaveCommandMode(text: string): string {
  return text.startsWith('!') ? text.slice(1) : text
}

export function omittedNote(omittedLines: number, omittedBytes: number): string | undefined {
  if (omittedLines <= 0 && omittedBytes <= 0) return undefined
  const parts: string[] = []
  if (omittedLines > 0) parts.push(`${String(omittedLines)} ${omittedLines === 1 ? 'line' : 'lines'}`)
  if (omittedBytes > 0) parts.push(omittedBytes >= 1024 ? `${String(Math.max(1, Math.round(omittedBytes / 1024)))} KB` : `${String(omittedBytes)} bytes`)
  return `Left out ${parts.join(' and ')} from the start.`
}

/**
 * The last 200 lines, and the last 32 KB of those. Anything before that is
 * counted so the conversation can say what was left out.
 */
export function capCommandOutput(raw: string): { readonly text: string; readonly omittedLines: number; readonly omittedBytes: number; readonly note?: string } {
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let omittedLines = 0
  let omittedBytes = 0
  const lines = text.split('\n')
  if (lines.length > COMMAND_OUTPUT_MAX_LINES) {
    const dropped = lines.slice(0, lines.length - COMMAND_OUTPUT_MAX_LINES)
    omittedLines += dropped.length
    omittedBytes += byteLength(dropped.join('\n')) + 1
    text = lines.slice(-COMMAND_OUTPUT_MAX_LINES).join('\n')
  }
  while (byteLength(text) > COMMAND_OUTPUT_MAX_BYTES && text.length > 0) {
    const newline = text.indexOf('\n')
    if (newline === -1) {
      let drop = 1
      const extra = byteLength(text) - COMMAND_OUTPUT_MAX_BYTES
      while (drop < text.length && byteLength(text.slice(0, drop)) < extra) drop += 1
      omittedBytes += byteLength(text.slice(0, drop))
      text = text.slice(drop)
      break
    }
    omittedLines += 1
    omittedBytes += byteLength(text.slice(0, newline)) + 1
    text = text.slice(newline + 1)
  }
  const note = omittedNote(omittedLines, omittedBytes)
  return note === undefined ? { text, omittedLines, omittedBytes } : { text, omittedLines, omittedBytes, note }
}

/** `team/review.md` is the command `/team/review`. */
export function commandNameFromPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/\.md$/i, '')
}

export interface ParsedCommand {
  readonly name: string
  readonly description?: string
  readonly teammate?: string
  readonly mode?: MissionMode
  readonly body: string
}

const fieldOf = (meta: string, key: string): string | undefined => {
  const line = meta.split(/\r?\n/).find((one) => new RegExp(`^${key}\\s*:`).test(one))
  if (line === undefined) return undefined
  const value = line.slice(line.indexOf(':') + 1).trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  return value.length === 0 ? undefined : value
}

/** Frontmatter is optional. Unknown keys are ignored. A mode we do not have is ignored. */
export function parseOwnCommand(markdown: string, name: string): ParsedCommand {
  const wrapped = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown)
  const meta = wrapped?.[1] ?? ''
  const body = (wrapped === null ? markdown : wrapped[2] ?? '').replace(/^\n/, '')
  const modeWord = fieldOf(meta, 'mode')
  const mode = modeWord === undefined ? undefined : MODE_WORDS[modeWord.toLowerCase()]
  const description = fieldOf(meta, 'description')
  const teammate = fieldOf(meta, 'teammate')
  return {
    name,
    body,
    ...(description === undefined ? {} : { description }),
    ...(teammate === undefined ? {} : { teammate }),
    ...(mode === undefined ? {} : { mode })
  }
}

/** Words, with quotes grouping a phrase. A backslash is not an escape. */
export function splitCommandWords(input: string): readonly string[] {
  const words: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) words.push(match[1] ?? match[2] ?? match[3] ?? '')
  return words
}

/**
 * `$ARGUMENTS` is everything after the name. `$1` and `$2` are the words; the
 * highest one takes the rest. With neither, the arguments follow a blank line.
 */
export function expandTemplate(body: string, args: string): string {
  const words = splitCommandWords(args)
  const token = '\u0000'
  const hasArguments = body.includes('$ARGUMENTS')
  let text = hasArguments ? body.replaceAll('$ARGUMENTS', token) : body
  const numbers = [...new Set([...text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1] ?? '0')))].filter((n) => n > 0).sort((a, b) => b - a)
  const last = numbers[0]
  for (const n of numbers) {
    const value = n === last ? words.slice(n - 1).join(' ') : (words[n - 1] ?? '')
    text = text.replaceAll(`$${String(n)}`, value)
  }
  if (hasArguments) text = text.replaceAll(token, args)
  if (!hasArguments && numbers.length === 0 && args.trim().length > 0) text = `${text.replace(/\s+$/, '')}\n\n${args}`
  return text
}

/** `!` followed by a command in backticks. The command is what is inside. */
export function bangBlocks(text: string): readonly { readonly command: string; readonly token: string }[] {
  const found: { readonly command: string; readonly token: string }[] = []
  const pattern = /!`([^`\n]+)`/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const command = (match[1] ?? '').trim()
    if (command.length > 0) found.push({ command, token: match[0] })
  }
  return found
}

/**
 * `/name the rest` when `name` is one of yours. A bare `/name` belongs to the
 * menu, which is still being filtered.
 */
export function argumentsOfOwnCommand(text: string, names: readonly string[]): { readonly name: string; readonly args: string } | undefined {
  const trimmed = text.trim()
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (match === null) return undefined
  const typed = match[1] ?? ''
  if (!trimmed.slice(typed.length + 1).includes(' ')) return undefined
  const name = names.find((one) => one.toLowerCase() === typed.toLowerCase())
  if (name === undefined) return undefined
  return { name, args: (match[2] ?? '').trim() }
}

export interface CarryCommand {
  readonly command: string
  readonly output: string
  readonly exitCode: number | null
  readonly stopped: boolean
  readonly omitted?: string
  readonly carried: boolean
  readonly running: boolean
}

/** Finished commands that have not yet gone out with a message. */
export function commandsStillToCarry<T extends { readonly carried: boolean; readonly running: boolean }>(entries: readonly T[]): readonly T[] {
  return entries.filter((entry) => !entry.carried && !entry.running)
}

/**
 * The next message carries each command and its output once. An empty list
 * leaves the message as it was typed.
 */
export function promptWithCommands(prompt: string, commands: readonly CarryCommand[]): string {
  const pending = commandsStillToCarry(commands)
  if (pending.length === 0) return prompt
  const blocks = pending.map((one) => {
    const how = one.stopped ? 'stopped before it finished' : one.exitCode === null ? 'ended' : `exit ${String(one.exitCode)}`
    const body = one.output.length === 0 ? '(no output)' : one.output
    const note = one.omitted === undefined || one.omitted.length === 0 ? '' : `\n${one.omitted}`
    return `The person's command and its output (${how}):\n!${one.command}\n${body}${note}`
  })
  return `${blocks.join('\n\n')}\n\n${prompt}`
}

/** Choosing a command fills the box. It does not send. */
export function ownCommandChoice(name: string, source: 'global' | 'project', args: string): { readonly fill: { readonly name: string; readonly source: 'global' | 'project'; readonly args: string } } {
  return { fill: { name, source, args } }
}

export interface ShellLaunch {
  readonly id: string
  readonly args: readonly string[]
}

/** One command in the terminal panel's shell. PowerShell reads it from stdin so quoting stays the person's. */
export function oneShot(shell: ShellLaunch, command: string): { readonly args: readonly string[]; readonly input?: string } {
  if (shell.id === 'pwsh' || shell.id === 'powershell') return { args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], input: command }
  if (shell.id === 'cmd') return { args: ['/d', '/s', '/c', command] }
  if (shell.id.startsWith('wsl:')) return { args: [...shell.args, '--', 'bash', '-lc', command] }
  return { args: ['-lc', command] }
}

export interface OwnCommandsApi {
  list(context: CommandContext): Promise<{ readonly ok: true; readonly commands: readonly ListedCommand[] } | { readonly ok: false; readonly message: string }>
  expand(request: CommandContext & { readonly name: string; readonly source: 'global' | 'project'; readonly arguments: string }): Promise<
    { readonly ok: false; readonly message: string } | { readonly ok: true; readonly ask: readonly string[] } | { readonly ok: true; readonly text: string; readonly mode?: MissionMode; readonly teammate?: string }
  >
  allow(context: CommandContext): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
  openFolder(which: 'global' | 'project', context: CommandContext): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
  run(context: CommandContext, command: string): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly message: string }>
  stop(id: string): Promise<void>
  onDone(listener: (result: OwnCommandResult) => void): () => void
}
