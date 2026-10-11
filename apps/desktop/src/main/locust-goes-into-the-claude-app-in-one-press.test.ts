import { readFileSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { CLAUDE_APP_BACKUP_SUFFIX, claudeAppConfigFile, createClaudeAppConnector } from './claude-app-connection.js'

/*
 * LOCUST IN THE CLAUDE APP, IN ONE PRESS (0.740; hardened in 0.741 after Sol's review, its ten findings by
 * number). Against a stand-in for the Claude app's settings file in a scratch folder: Add keeps the original once
 * and adds one entry, changing nothing else; a file it cannot read is left alone; Remove takes Locust's entry out
 * and only Locust's; Claude open when Locust changed its settings says to restart, across a Locust restart too.
 */
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const ENTRY = { command: 'C:\\Locust\\Locust.exe', args: ['C:\\Locust\\resources\\locust-mcp-bridge.mjs', 'C:\\data\\locust-mcp-connection.json'], env: { ELECTRON_RUN_AS_NODE: '1' } }
/** Every path an entry names exists, unless a test says otherwise. */
const present = async (): Promise<boolean> => true

async function claudeFolder(contents?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-claude-app-'))
  roots.push(root)
  await mkdir(join(root, 'Claude'), { recursive: true })
  const file = join(root, 'Claude', 'claude_desktop_config.json')
  if (contents !== undefined) await writeFile(file, contents, 'utf8')
  return file
}
const connector = (file: string, more: Partial<Parameters<typeof createClaudeAppConnector>[0]> = {}) =>
  createClaudeAppConnector({ file, entry: () => ENTRY, exists: async (path) => path.endsWith('Claude') || (await present()), ...more })

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
    const app = connector(file)
    expect(await app.status()).toEqual({ kind: 'not-added' })
    expect(await app.add()).toEqual({ ok: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ coworkUserFilesPath: 'C:\\Users\\a\\Claude', preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' }, locust: ENTRY } })
    expect(await readFile(file + CLAUDE_APP_BACKUP_SUFFIX, 'utf8')).toBe(original)
    expect(await app.status()).toEqual({ kind: 'added' })
    await app.add()
    expect(await readFile(file + CLAUDE_APP_BACKUP_SUFFIX, 'utf8')).toBe(original)
  })

  it('makes the file when Claude has not written one yet', async () => {
    const file = await claudeFolder()
    expect(await connector(file).add()).toEqual({ ok: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ mcpServers: { locust: ENTRY } })
  })

  it('leaves a file it cannot read exactly as it is', async () => {
    const broken = '{ "preferences": { "theme": "dark" }, '
    const file = await claudeFolder(broken)
    const app = connector(file)
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
})

describe('Sol’s review of 0.740', () => {
  it('#2: overlapping presses happen one at a time, and the original copy is never overwritten', async () => {
    const original = JSON.stringify({ preferences: { theme: 'dark' } })
    const file = await claudeFolder(original)
    const app = connector(file)
    const results = await Promise.all([app.add(), app.remove(), app.add()])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ preferences: { theme: 'dark' }, mcpServers: { locust: ENTRY } })
    expect(await readFile(file + CLAUDE_APP_BACKUP_SUFFIX, 'utf8')).toBe(original)
  })

  it('#3: a different add-on the person named “locust” is never changed or removed', async () => {
    const theirs = JSON.stringify({ mcpServers: { locust: { command: 'my-locust-tool.exe', args: ['--serve'] } } })
    const file = await claudeFolder(theirs)
    const app = connector(file)
    expect(await app.status()).toEqual({ kind: 'taken', message: 'The Claude app already has a different add-on named “locust”, so Locust left it alone.' })
    expect((await app.add()).ok).toBe(false)
    expect((await app.remove()).ok).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(theirs)
  })

  it('#4: the file keeps its permissions', async () => {
    if (process.platform === 'win32') return
    const file = await claudeFolder('{}')
    await chmod(file, 0o600)
    await connector(file).add()
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('#5: a settings file that is a link is written at its target, and stays a link', async () => {
    const real = await claudeFolder('{}')
    const linkRoot = await mkdtemp(join(tmpdir(), 'locust-claude-link-'))
    roots.push(linkRoot)
    await mkdir(join(linkRoot, 'Claude'))
    const link = join(linkRoot, 'Claude', 'claude_desktop_config.json')
    try {
      await symlink(real, link, 'file')
    } catch {
      return // No permission to make links here (Windows without developer mode): nothing to test.
    }
    await connector(link).add()
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(real, 'utf8'))).toEqual({ mcpServers: { locust: ENTRY } })
  })

  it('#6: Restart closes only processes under the Claude app’s own folder, matched as a prefix', () => {
    const source = readFileSync(fileURLToPath(new URL('./claude-app-connection.ts', import.meta.url)), 'utf8')
    expect(source).toContain("$_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)")
    expect(source).not.toContain("-like '*\\\\AnthropicClaude\\\\*'")
  })

  it('#7: an entry for a Locust that is not this one, or whose files are gone, says so', async () => {
    const elsewhere = { ...ENTRY, command: 'D:\\Old\\Locust.exe', args: ['D:\\Old\\resources\\locust-mcp-bridge.mjs', 'C:\\data\\locust-mcp-connection.json'] }
    const file = await claudeFolder(JSON.stringify({ mcpServers: { locust: elsewhere } }))
    expect(await connector(file).status()).toEqual({ kind: 'added', stale: true })
    // Update is Add: the entry points here again.
    await connector(file).add()
    expect(await connector(file).status()).toEqual({ kind: 'added' })
    // This copy's own entry, with its files gone.
    const gone = createClaudeAppConnector({ file, entry: () => ENTRY, exists: async (path) => path.endsWith('Claude') })
    expect(await gone.status()).toEqual({ kind: 'added', stale: true })
  })

  it('#8: Claude still has to restart after Locust restarts, and not after Claude restarted', async () => {
    const file = await claudeFolder('{}')
    let marks: { changedAt?: number; restartedAt?: number } = {}
    const kept = { read: async () => marks, write: async (next: typeof marks) => { marks = { ...next } } }
    let clock = 1_000
    const startedAt = { value: 500 as number | null }
    const make = () => connector(file, { marks: kept, now: () => clock, startedAt: async () => startedAt.value, relaunch: async () => { startedAt.value = clock + 1 } })
    await make().add()
    // A fresh Locust (a new connector) reading the same marks: Claude, started before the change, has not read it.
    expect(await make().status()).toEqual({ kind: 'added', restart: true })
    clock = 2_000
    await make().restart()
    expect(await make().status()).toEqual({ kind: 'added' })
    // Claude closed by hand since: nothing left to do either.
    await make().add()
    startedAt.value = null
    expect(await make().status()).toEqual({ kind: 'added' })
  })

  it('#9: Remove while Claude is open says Claude keeps Locust until it restarts', async () => {
    const file = await claudeFolder('{}')
    const app = connector(file, { now: () => 1_000, startedAt: async () => 500 })
    await app.add()
    await app.remove()
    expect(await app.status()).toEqual({ kind: 'not-added', restart: true })
  })

  it('#10: settings with a number JavaScript cannot keep exactly are left alone', async () => {
    const exact = '{ "telemetryId": 9007199254740993, "preferences": {} }'
    const file = await claudeFolder(exact)
    const app = connector(file)
    expect((await app.status()).kind).toBe('unreadable')
    expect(await app.add()).toEqual({ ok: false, message: 'The Claude app’s settings hold a number Locust cannot keep exactly, so Locust left them as they are.' })
    expect(await readFile(file, 'utf8')).toBe(exact)
  })
})

describe('Remove', () => {
  it('takes out Locust’s entry and leaves the rest', async () => {
    const file = await claudeFolder(JSON.stringify({ preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' } } }))
    const app = connector(file)
    await app.add()
    expect(await app.remove()).toEqual({ ok: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' } } })
    expect(await app.status()).toEqual({ kind: 'not-added' })
  })

  it('drops an emptied list rather than leave {} behind', async () => {
    const file = await claudeFolder(JSON.stringify({ preferences: {} }))
    const app = connector(file)
    await app.add()
    await app.remove()
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ preferences: {} })
  })
})
