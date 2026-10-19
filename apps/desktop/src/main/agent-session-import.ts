import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommandRunner, ExecutableLocator } from '@teammate/runtime-adapters'
import type { ImportableSession } from './session-import.js'
import type { TerminalExchange } from './terminal-catch-up.js'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const json = (text: string): unknown => JSON.parse(text)
const iso = (value: unknown): string | undefined => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 8.64e15 ? new Date(value).toISOString() : undefined
const words = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.flatMap(p => record(p) && p.type === 'text' && typeof p.text === 'string' ? [p.text] : []).join('\n') : ''
const title = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 90)
const MAX_BLOB = 16 * 1024 * 1024
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** Only chat metadata and store.db are opened. Never Cursor's config or sign-in. */
async function cursorMeta(folder: string): Promise<Record<string, unknown>> {
  const file = await open(join(folder, 'meta.json'), 'r')
  try {
    const bytes = Buffer.alloc(64 * 1024)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead === bytes.length) throw new Error('Cursor chat metadata is too large.')
    const value = json(bytes.subarray(0, bytesRead).toString('utf8'))
    if (!record(value) || value.schemaVersion !== 1) throw new Error('Unknown Cursor chat format.')
    return value
  } finally { await file.close() }
}

async function cursorStore(folder: string) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(folder, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = '0' AND length(value) < 131072").get()
    const meta: unknown = typeof row?.value === 'string' ? json(Buffer.from(row.value, 'hex').toString('utf8')) : undefined
    if (!record(meta)) throw new Error('Unknown Cursor session format.')
    return { db, meta }
  } catch (error) { db.close(); throw error }
}

/** Field 1 in Cursor's root protobuf is the ordered message blob hashes.
 * Measured against its chat store; other fields are skipped by wire type.
 * Blobs absent/encrypted/changed in a future format fail closed on import.
 */
export function cursorMessageIds(bytes: Uint8Array): string[] {
  let at = 0
  const integer = (): number => {
    let value = 0
    for (let shift = 0; shift < 49 && at < bytes.length; shift += 7) {
      const byte = bytes[at++]!
      value += (byte & 127) * 2 ** shift
      if ((byte & 128) === 0) return value
    }
    throw new Error('Invalid Cursor message index.')
  }
  const ids: string[] = []
  while (at < bytes.length) {
    const tag = integer()
    if ((tag >>> 3) === 0) throw new Error('Invalid Cursor message index.')
    const wire = tag & 7
    if (wire === 0) { integer(); continue }
    if (wire === 1 || wire === 5) { at += wire === 1 ? 8 : 4 }
    else if (wire === 2) {
      const length = integer()
      const end = at + length
      if (end > bytes.length) throw new Error('Truncated Cursor message index.')
      if ((tag >>> 3) === 1) {
        if (length !== 32) throw new Error('Unknown Cursor message reference.')
        ids.push(Buffer.from(bytes.subarray(at, end)).toString('hex'))
      }
      at = end
    } else throw new Error('Unknown Cursor message index.')
    if (at > bytes.length) throw new Error('Truncated Cursor message index.')
  }
  return ids
}

export async function listCursorSessions(home: string): Promise<readonly ImportableSession[]> {
  const sessions: ImportableSession[] = []
  const chats = join(home, 'chats')
  for (const project of await readdir(chats).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{32}$/i.test(project)) continue
    for (const id of await readdir(join(chats, project)).catch(() => [] as string[])) {
      if (!uuid.test(id)) continue
      const folder = join(chats, project, id)
      try {
        const info = await cursorMeta(folder)
        if (info.hasConversation !== true || typeof info.cwd !== 'string') continue
        const updatedAt = iso(info.updatedAtMs)
        if (updatedAt === undefined) continue
        const { db, meta } = await cursorStore(folder)
        try {
          if (meta.agentId !== id || typeof meta.latestRootBlobId !== 'string') continue
          sessions.push({ runtime: 'cursor', sessionId: id, title: title(typeof meta.name === 'string' ? meta.name : 'A Cursor Agent session'), cwd: info.cwd, updatedAt, bytes: (await stat(join(folder, 'store.db'))).size, openNow: Date.now() - Date.parse(updatedAt) < 120_000 })
        } finally { db.close() }
      } catch { /* An incomplete or unsupported chat is not offered. */ }
    }
  }
  return sessions
}

export async function cursorExchanges(home: string, session: Pick<ImportableSession, 'sessionId' | 'cwd'>): Promise<readonly TerminalExchange[]> {
  if (!uuid.test(session.sessionId)) throw new Error('Invalid Cursor chat ID.')
  const chats = join(home, 'chats')
  for (const project of await readdir(chats).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{32}$/i.test(project)) continue
    const folder = join(chats, project, session.sessionId)
    const info = await cursorMeta(folder).catch(() => undefined)
    if (info === undefined || info.cwd !== session.cwd) continue
    const { db, meta } = await cursorStore(folder)
    try {
      if (meta.agentId !== session.sessionId || typeof meta.latestRootBlobId !== 'string') throw new Error('Cursor chat identity changed.')
      const blob = (id: string): Uint8Array => {
        const row = db.prepare('SELECT data FROM blobs WHERE id = ? AND length(data) <= ?').get(id, MAX_BLOB)
        if (!(row?.data instanceof Uint8Array)) throw new Error('A Cursor message is unavailable or too large to import.')
        return row.data
      }
      const messages = cursorMessageIds(blob(meta.latestRootBlobId))
      const exchanges: TerminalExchange[] = []
      let prompt: string | undefined
      let answer = ''
      let finished = false
      const startedAt = iso(info.createdAtMs) ?? iso(meta.createdAt)
      const finishedAt = iso(info.updatedAtMs)
      if (startedAt === undefined || finishedAt === undefined) throw new Error('Cursor chat dates are unavailable.')
      const close = () => {
        if (prompt !== undefined && finished && answer.trim()) exchanges.push({ prompt, answer, startedAt, finishedAt, lines: 0 })
      }
      for (const id of messages) {
        const message = json(Buffer.from(blob(id)).toString('utf8'))
        if (!record(message)) throw new Error('Unknown Cursor message format.')
        if (message.role === 'user') {
          const content = words(message.content).trim()
          const query = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(content)
          const text = query?.[1] ?? content
          // Cursor's injected user_info/environment/rules are not typed prompts.
          if (!text || text.startsWith('<')) continue
          close(); prompt = text.slice(0, 8000); answer = ''; finished = false
        } else if (message.role === 'assistant' && prompt !== undefined) {
          answer = (answer + '\n' + words(message.content)).trim().slice(0, 16000)
          finished = !Array.isArray(message.content) || !message.content.some(p => record(p) && p.type === 'tool-call')
        }
      }
      close()
      return exchanges
    } finally { db.close() }
  }
  throw new Error('The Cursor chat could not be found. Nothing was imported.')
}

export function openCodeSessions(text: string): readonly ImportableSession[] {
  const rows = json(text)
  if (!Array.isArray(rows)) throw new Error('OpenCode did not return a session list.')
  return rows.flatMap(row => {
    if (!record(row) || typeof row.id !== 'string' || !/^ses_[A-Za-z0-9]+$/.test(row.id) || typeof row.title !== 'string' || typeof row.directory !== 'string') return []
    const updatedAt = iso(row.updated)
    if (updatedAt === undefined || row.parentID !== undefined) return []
    return [{ runtime: 'opencode' as const, sessionId: row.id, title: title(row.title), cwd: row.directory, updatedAt, bytes: 0, openNow: Date.now() - Date.parse(updatedAt) < 120_000 }]
  })
}

export function openCodeExchanges(text: string, sessionId: string): readonly TerminalExchange[] {
  const exported = json(text)
  if (!record(exported) || !record(exported.info) || exported.info.id !== sessionId || !Array.isArray(exported.messages)) throw new Error('OpenCode returned a different or unsupported session.')
  const prompts = new Map<string, { text: string; startedAt: string; answer: string; finishedAt?: string; model?: string }>()
  for (const message of exported.messages) {
    if (!record(message) || !record(message.info) || !Array.isArray(message.parts)) continue
    const info = message.info
    if (info.sessionID !== sessionId || !record(info.time)) continue
    const text = words(message.parts.filter(p => record(p) && p.synthetic !== true && p.ignored !== true)).trim()
    if (info.role === 'user' && typeof info.id === 'string') {
      const startedAt = iso(info.time.created)
      if (startedAt !== undefined && text) prompts.set(info.id, { text: text.slice(0, 8000), startedAt, answer: '' })
    } else if (info.role === 'assistant' && typeof info.parentID === 'string') {
      const prompt = prompts.get(info.parentID)
      if (prompt === undefined) continue
      prompt.answer = (prompt.answer + '\n' + text).trim().slice(0, 16000)
      // Completion, not a tool step, establishes a finished exchange.
      if (info.finish === 'stop' && info.error === undefined) prompt.finishedAt = iso(info.time.completed)
      if (typeof info.modelID === 'string' && typeof info.providerID === 'string') prompt.model = `${info.providerID}/${info.modelID}`
    }
  }
  return [...prompts.values()].flatMap(p => p.finishedAt === undefined ? [] : [{ prompt: p.text, answer: p.answer || undefined, startedAt: p.startedAt, finishedAt: p.finishedAt, lines: 0, ...(p.model === undefined ? {} : { model: p.model }) }])
}

/** Commands only: OpenCode's database, settings and sign-in are never opened. */
export function createOpenCodeSessionReader(locator: ExecutableLocator, runner: CommandRunner) {
  const run = async (args: readonly string[]): Promise<string | undefined> => {
    const executable = await locator.find('opencode')
    if (executable === undefined) return undefined
    const result = await runner.run({ purpose: 'readiness', executablePath: executable.executablePath, args: [...executable.prefixArgs, ...args], timeoutMs: 30_000, ...(executable.env === undefined ? {} : { env: executable.env }) })
    if (result.exitCode !== 0 || result.timedOut) throw new Error('OpenCode could not read its sessions. Nothing was imported.')
    return result.stdout
  }
  return {
    list: async () => { const output = await run(['session', 'list', '--format', 'json']); return output === undefined ? [] : openCodeSessions(output) },
    exchanges: async (sessionId: string) => {
      if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) throw new Error('Invalid OpenCode session ID.')
      const output = await run(['export', sessionId])
      if (output === undefined) throw new Error('OpenCode is no longer installed. Nothing was imported.')
      return openCodeExchanges(output, sessionId)
    }
  }
}
