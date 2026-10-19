import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { MissionLedgerMetadata } from '@teammate/mission-store'
import { createCursorPrintCommand } from '@teammate/runtime-adapters'
import { createOpenCodeSessionReader, cursorExchanges, cursorMessageIds, listCursorSessions, openCodeExchanges, openCodeSessions } from './agent-session-import.js'
import { importSession, listImportableSessions } from './session-import.js'
import { createTerminalImports } from './terminal-catch-up.js'

const ID = '026f3a83-d3a2-4e27-865f-0f4d492f7d0a'
const OC = 'ses_fixture123'
const NOW = Date.parse('2026-10-19T12:00:00Z')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() { const path = await mkdtemp(join(tmpdir(), 'locust-past-chats-')); roots.push(path); return path }
const openCode = (id = OC) => JSON.stringify({ info: { id }, messages: [
  { info: { id: 'u1', sessionID: id, role: 'user', time: { created: NOW - 10000 } }, parts: [{ type: 'text', text: 'Plan the chart' }, { type: 'text', text: 'injected', synthetic: true }] },
  { info: { sessionID: id, parentID: 'u1', role: 'assistant', time: { completed: NOW - 7000 }, finish: 'tool-calls' }, parts: [{ type: 'tool', text: 'secret tool output' }, { type: 'reasoning', text: 'private reasoning' }] },
  { info: { sessionID: id, parentID: 'u1', role: 'assistant', time: { completed: NOW - 5000 }, finish: 'stop', providerID: 'provider', modelID: 'model' }, parts: [{ type: 'text', text: 'The chart is planned.' }] },
  { info: { id: 'u2', sessionID: id, role: 'user', time: { created: NOW - 3000 } }, parts: [{ type: 'text', text: 'Unfinished prompt' }] },
  { info: { sessionID: 'ses_other', parentID: 'u2', role: 'assistant', time: { completed: NOW }, finish: 'stop' }, parts: [{ type: 'text', text: 'Foreign answer' }] }
] })

async function cursorFixture(home: string, cwd: string) {
  const folder = join(home, 'chats', '0'.repeat(32), ID)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'meta.json'), JSON.stringify({ schemaVersion: 1, hasConversation: true, cwd, createdAtMs: NOW - 10000, updatedAtMs: NOW }))
  const db = new DatabaseSync(join(folder, 'store.db'))
  db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)')
  const messages = [
    { role: 'system', content: 'system instructions' },
    { role: 'user', content: '<user_info>injected environment</user_info>' },
    { role: 'user', content: [{ type: 'text', text: '<timestamp>today</timestamp>\n<user_query>Plan the chart</user_query>' }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'tool-call', toolName: 'Read' }] },
    { role: 'tool', content: [{ type: 'tool-result', text: 'secret tool output' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'The chart is planned.' }] },
    { role: 'user', content: [{ type: 'text', text: '<user_query>Unfinished prompt</user_query>' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Still working' }, { type: 'tool-call' }] }
  ]
  const put = (bytes: Buffer) => { const hash = createHash('sha256').update(bytes).digest(); db.prepare('INSERT INTO blobs VALUES (?, ?)').run(hash.toString('hex'), bytes); return hash }
  const ids = messages.map(m => put(Buffer.from(JSON.stringify(m))))
  const index = put(Buffer.concat(ids.map(id => Buffer.concat([Buffer.from([10, 32]), id]))))
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('0', Buffer.from(JSON.stringify({ agentId: ID, name: 'Chart planning', latestRootBlobId: index.toString('hex') })).toString('hex'))
  db.close()
  return folder
}

describe('past OpenCode and Cursor chats', () => {
  it('reads OpenCode list and export output without tools, reasoning, foreign replies or unfinished exchanges', () => {
    expect(openCodeSessions(JSON.stringify([{ id: OC, title: 'Chart planning', directory: 'C:/chart', updated: NOW }, { id: 'ses_child', parentID: OC, title: 'Child', directory: 'C:/chart', updated: NOW }]))).toMatchObject([{ runtime: 'opencode', sessionId: OC, cwd: 'C:/chart', title: 'Chart planning' }])
    expect(openCodeExchanges(openCode(), OC)).toEqual([{ prompt: 'Plan the chart', answer: 'The chart is planned.', startedAt: new Date(NOW - 10000).toISOString(), finishedAt: new Date(NOW - 5000).toISOString(), lines: 0, model: 'provider/model' }])
    expect(() => openCodeExchanges(openCode('ses_foreign'), OC)).toThrow('different')
    expect(() => openCodeSessions('{}')).toThrow('session list')
  })

  it('uses only documented OpenCode read commands and refuses failures and invalid IDs', async () => {
    const calls: string[][] = []
    const seen = calls
    const reader = createOpenCodeSessionReader({ find: async () => ({ executablePath: 'opencode', prefixArgs: [], commandName: 'opencode', source: 'path' } as never) }, { run: async command => { seen.push([...command.args]); return { exitCode: 0, stdout: command.args[0] === 'export' ? openCode() : '[]', stderr: '' } } })
    expect(await reader.list()).toEqual([])
    expect(await reader.exchanges(OC)).toHaveLength(1)
    expect(calls).toEqual([['session', 'list', '--format', 'json'], ['export', OC]])
    await expect(reader.exchanges('../bad')).rejects.toThrow('Invalid')
    const failed = createOpenCodeSessionReader({ find: async () => ({ executablePath: 'opencode', prefixArgs: [] } as never) }, { run: async () => ({ exitCode: 1, stdout: '[]', stderr: '' }) })
    await expect(failed.list()).rejects.toThrow('Nothing was imported')
    expect(await createOpenCodeSessionReader({ find: async () => undefined }, {} as never).list()).toEqual([])
  })

  it('reads Cursor chat metadata and ordered messages without changing the chat store or opening configuration', async () => {
    const home = await root()
    const folder = await cursorFixture(home, home)
    // A directory here makes any attempt to read the config as a file fail.
    await mkdir(join(home, 'cli-config.json'))
    const files = ['meta.json', 'store.db']
    const before = await Promise.all(files.map(async file => ({ bytes: await readFile(join(folder, file)), mtime: (await stat(join(folder, file))).mtimeMs })))
    const sessions = await listCursorSessions(home)
    expect(sessions).toMatchObject([{ runtime: 'cursor', sessionId: ID, cwd: home, title: 'Chart planning' }])
    expect(await cursorExchanges(home, sessions[0]!)).toEqual([{ prompt: 'Plan the chart', answer: 'The chart is planned.', startedAt: new Date(NOW - 10000).toISOString(), finishedAt: new Date(NOW).toISOString(), lines: 0 }])
    expect(await Promise.all(files.map(async file => ({ bytes: await readFile(join(folder, file)), mtime: (await stat(join(folder, file))).mtimeMs })))).toEqual(before)
    await expect(cursorExchanges(home, { sessionId: ID, cwd: 'another folder' })).rejects.toThrow('could not be found')
    expect(() => cursorMessageIds(Buffer.from([10, 32, 1]))).toThrow('Truncated')
    expect(() => cursorMessageIds(Buffer.from([10, 1, 1]))).toThrow('Unknown')
  })

  it('lists huge Cursor stores from metadata and keeps missing folders visible while excluding old and held sessions', async () => {
    const home = await root()
    const folder = await cursorFixture(home, join(home, 'gone'))
    // Huge tool data need not be loaded just to list the chat.
    const db = new DatabaseSync(join(folder, 'store.db'))
    db.prepare('INSERT INTO blobs VALUES (?, zeroblob(?))').run('unused-tool-output', 32 * 1024 * 1024)
    db.close()
    const sessions = await listCursorSessions(home)
    expect(sessions[0]!.bytes).toBeGreaterThan(32 * 1024 * 1024)
    const places = { claudeHome: join(home, 'claude'), codexHome: join(home, 'codex') }
    const listed = await listImportableSessions(places, { now: new Date(NOW), otherSessions: sessions })
    expect(listed).toMatchObject([{ runtime: 'cursor', folderMissing: true }])
    expect(await listImportableSessions(places, { now: new Date(NOW), skip: new Set([ID]), otherSessions: sessions })).toEqual([])
    expect(await listImportableSessions(places, { now: new Date(NOW + 31 * 86400000), otherSessions: sessions })).toEqual([])
  })

  it.each(['cursor', 'opencode'] as const)('imports %s as a resumable conversation on account default and refuses duplicate or missing-folder imports', async runtime => {
    const home = await root()
    const folder = await cursorFixture(home, home)
    expect(folder).toContain('chats')
    const session = runtime === 'cursor' ? (await listCursorSessions(home))[0]! : openCodeSessions(JSON.stringify([{ id: OC, title: 'Chart planning', directory: home, updated: NOW }]))[0]!
    const made: MissionLedgerMetadata[] = []
    const events: unknown[] = []
    const facts = { ledger: { createMission: async (metadata: MissionLedgerMetadata) => { made.push(metadata) }, appendEvents: async (_id: string, batch: readonly unknown[]) => { events.push(...batch) } } as never, imports: createTerminalImports(join(home, 'imports.json')), workspaceIdFor: () => 'ws_fixture', learnFolder: async () => {}, nameConversation: async () => {}, pathOf: async () => undefined, readExchanges: async () => runtime === 'cursor' ? cursorExchanges(home, session) : openCodeExchanges(openCode(), OC) }
    expect(await importSession({ ...session, folderMissing: true }, facts)).toMatchObject({ ok: false, message: expect.stringContaining('folder') })
    expect(made).toHaveLength(0)
    expect(await importSession(session, facts)).toMatchObject({ ok: true, turns: 1 })
    expect(made[0]).toMatchObject({ runtime, model: 'account-default', requestedRouteId: runtime, resolvedRouteId: `${runtime}-account:default`, prompt: 'Plan the chart' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'run.completed', runtimeThreadId: session.sessionId }))
    expect(JSON.stringify(events)).toContain('The chart is planned.')
    expect(await importSession(session, facts)).toMatchObject({ ok: false, message: expect.stringContaining('already') })
    if (runtime === 'cursor') {
      const command = createCursorPrintCommand({ executablePath: 'cursor-agent', prefixArgs: [] } as never, { workspacePath: home, prompt: 'Continue', sandbox: 'read-only', resumeThreadId: ID })
      expect(command.args).toContain('--resume')
      expect(command.args).toContain(ID)
      expect(command.args).not.toContain('--model')
    }
  })
})
