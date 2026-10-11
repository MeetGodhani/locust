import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CLAUDE_APP_BACKUP_SUFFIX, claudeAppConfigFile, createClaudeAppConnector } from './claude-app-connection.js'

/*
 * LOCUST IN THE CLAUDE APP, IN ONE PRESS (0.740). Colin: "can you handle this? cause this is a bit ridiculous to
 * expect a new user to do". Against a stand-in for the Claude app's settings file in a scratch folder: Add keeps
 * the original once and adds one entry, changing nothing else; a file it cannot read is left alone; Remove takes
 * the entry out; Claude open when Locust was added says to restart, and the restart is the person's press.
 */
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const ENTRY = { command: 'C:\\Locust\\Locust.exe', args: ['C:\\Locust\\resources\\locust-mcp-bridge.mjs', 'C:\\data\\locust-mcp-connection.json'], env: { ELECTRON_RUN_AS_NODE: '1' } }

async function claudeFolder(contents?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-claude-app-'))
  roots.push(root)
  await mkdir(join(root, 'Claude'), { recursive: true })
  const file = join(root, 'Claude', 'claude_desktop_config.json')
  if (contents !== undefined) await writeFile(file, contents, 'utf8')
  return file
}

describe('the Claude app’s settings file', () => {
  it('is where the Claude app keeps it, on Windows and on a Mac', () => {
    expect(claudeAppConfigFile('win32', 'C:\\Users\\a\\AppData\\Roaming', 'C:\\Users\\a')).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'))
    expect(claudeAppConfigFile('darwin', undefined, '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'))
    expect(claudeAppConfigFile('linux', undefined, '/home/a')).toBeUndefined()
  })
})

describe('Add to the Claude app', () => {
  it('adds one entry beside the person’s own settings, and keeps the original once', async () => {
    const original = JSON.stringify({ coworkUserFilesPath: 'C:\\Users\\a\\Claude', preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' } } })
    const file = await claudeFolder(original)
    const app = createClaudeAppConnector({ file, entry: () => ENTRY })
    expect(await app.status()).toEqual({ kind: 'not-added' })
    expect(await app.add()).toEqual({ ok: true })
    const now = JSON.parse(await readFile(file, 'utf8'))
    expect(now).toEqual({ coworkUserFilesPath: 'C:\\Users\\a\\Claude', preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' }, locust: ENTRY } })
    expect(await readFile(file + CLAUDE_APP_BACKUP_SUFFIX, 'utf8')).toBe(original)
    expect(await app.status()).toEqual({ kind: 'added' })
    // A second Add never overwrites the copy of what the person had.
    await app.add()
    expect(await readFile(file + CLAUDE_APP_BACKUP_SUFFIX, 'utf8')).toBe(original)
  })

  it('makes the file when Claude has not written one yet', async () => {
    const file = await claudeFolder()
    const app = createClaudeAppConnector({ file, entry: () => ENTRY })
    expect(await app.add()).toEqual({ ok: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ mcpServers: { locust: ENTRY } })
  })

  it('leaves a file it cannot read exactly as it is', async () => {
    const broken = '{ "preferences": { "theme": "dark" }, '
    const file = await claudeFolder(broken)
    const app = createClaudeAppConnector({ file, entry: () => ENTRY })
    expect((await app.status()).kind).toBe('unreadable')
    expect(await app.add()).toEqual({ ok: false, message: 'The Claude app’s settings file could not be read, so Locust left it as it is.' })
    expect(await readFile(file, 'utf8')).toBe(broken)
  })

  it('is not offered where the Claude app is not installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-no-claude-'))
    roots.push(root)
    const app = createClaudeAppConnector({ file: join(root, 'Claude', 'claude_desktop_config.json'), entry: () => ENTRY })
    expect(await app.status()).toEqual({ kind: 'no-app' })
    expect((await app.add()).ok).toBe(false)
  })

  it('asks for a restart only when Claude was open, and the restart is the person’s press', async () => {
    const file = await claudeFolder('{}')
    let open = true
    const restarts: number[] = []
    const app = createClaudeAppConnector({ file, entry: () => ENTRY, running: async () => open, relaunch: async () => { restarts.push(1) } })
    await app.add()
    expect(await app.status()).toEqual({ kind: 'added', restart: true })
    expect(restarts).toHaveLength(0)
    expect(await app.restart()).toEqual({ ok: true })
    expect(restarts).toHaveLength(1)
    expect(await app.status()).toEqual({ kind: 'added' })
    // Added while Claude was closed: it reads the entry when it starts, so nothing is asked.
    const closed = createClaudeAppConnector({ file: await claudeFolder('{}'), entry: () => ENTRY, running: async () => false })
    await closed.add()
    expect(await closed.status()).toEqual({ kind: 'added' })
    // Quit by hand after Add: nothing left to ask either.
    const quitLater = createClaudeAppConnector({ file: await claudeFolder('{}'), entry: () => ENTRY, running: async () => open })
    await quitLater.add()
    open = false
    expect(await quitLater.status()).toEqual({ kind: 'added' })
  })
})

describe('Remove', () => {
  it('takes out Locust’s entry and leaves the rest', async () => {
    const file = await claudeFolder(JSON.stringify({ preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' } } }))
    const app = createClaudeAppConnector({ file, entry: () => ENTRY })
    await app.add()
    expect(await app.remove()).toEqual({ ok: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' } } })
    expect(await app.status()).toEqual({ kind: 'not-added' })
  })

  it('drops an emptied list rather than leave {} behind', async () => {
    const file = await claudeFolder(JSON.stringify({ preferences: {} }))
    const app = createClaudeAppConnector({ file, entry: () => ENTRY })
    await app.add()
    await app.remove()
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ preferences: {} })
  })
})
