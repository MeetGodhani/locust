import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createReferenceStore, referenceBytes, referenceRepository, REFERENCE_REFRESH_MS, type ReferenceStoreOptions } from './conversation-references.js'
import { referenceAccess } from '../shared/references.js'
import { referencesSection } from './workroom-briefing.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture(extra: Partial<ReferenceStoreOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'locust-reference-test-'))
  roots.push(root)
  const picked = join(root, 'picked'); await mkdir(picked)
  const parents: Record<string, string> = { mission_second: 'mission_first', mission_third: 'mission_second' }
  const options: ReferenceStoreOptions = { root, parent: async (id) => parents[id], pickFolder: async () => picked, ...extra }
  return { root, picked, options, store: createReferenceStore(options) }
}

describe('a reference stays with its conversation', () => {
  it('survives a restart and later turns, but not another conversation of the same teammate', async () => {
    const { store, options, picked } = await fixture()
    const item = (await store.folder())!
    await store.bind('mission_first', undefined, [item.id], '/actual-working-folder')
    const restarted = createReferenceStore(options)
    expect(await restarted.cwd('mission_first')).toBe('/actual-working-folder')
    expect((await restarted.select('mission_second')).map((ref) => ref.path)).toEqual([picked])
    await restarted.bind('mission_third', 'mission_second', [item.id])
    expect(await restarted.select('mission_third')).toEqual([item])
    expect(await restarted.select('mission_other')).toEqual([])
  })
  it('removal affects the conversation, not the chosen folder or another conversation', async () => {
    const { store, picked } = await fixture()
    const item = (await store.folder())!
    await store.bind('mission_first', undefined, [item.id])
    await store.bind('mission_other', undefined, [item.id])
    await store.set('mission_second', [])
    expect(await store.select('mission_first')).toEqual([])
    expect(await store.select('mission_other')).toEqual([item])
    expect((await stat(picked)).isDirectory()).toBe(true)
  })
  it('refuses paths or invented identities from the window, duplicate IDs, and a sixth reference', async () => {
    const { store, picked } = await fixture()
    const items = await Promise.all(Array.from({ length: 6 }, () => store.folder()))
    await expect(store.bind('mission_first', undefined, [picked])).rejects.toThrow('using Add a reference')
    await expect(store.select(undefined, ['__proto__'])).rejects.toThrow('using Add a reference')
    await expect(store.bind('mission_first', undefined, items.map((item) => item!.id))).rejects.toThrow('five')
    await expect(store.bind('mission_first', undefined, [items[0]!.id, items[0]!.id])).rejects.toThrow('five')
    expect(await store.select('mission_first')).toEqual([])
  })
  it('a cancelled picker creates no reference', async () => {
    const { store } = await fixture({ pickFolder: async () => undefined })
    expect(await store.folder()).toBeUndefined()
  })
})

describe('a GitHub reference is a bounded, recoverable host copy', () => {
  it('accepts only repository identities, not arbitrary git URLs, paths, options or shell fragments', () => {
    expect(referenceRepository('owner/repo')).toBe('owner/repo')
    expect(referenceRepository('https://github.com/owner/repo.git/')).toBe('owner/repo')
    for (const value of ['../repo', '--upload-pack=evil/repo', 'https://user:secret@github.com/owner/repo', 'file:///repo', 'https://evil.test/owner/repo', 'owner/..', 'owner/repo;evil', 'owner/repo/tree/main']) expect(referenceRepository(value)).toBeUndefined()
  })
  it('uses gh first, shallow-clones into its cache, refreshes after an hour, and keeps the old copy in trash', async () => {
    const calls: { program: string; args: readonly string[] }[] = []
    let time = 1000
    const run: ReferenceStoreOptions['run'] = async (program, args) => {
      calls.push({ program, args })
      const path = args[3]!; await mkdir(path, { recursive: true }); await writeFile(join(path, 'source.txt'), `copy ${calls.length}`)
    }
    const { store, root } = await fixture({ run, now: () => time })
    const item = await store.github('owner/private')
    expect(calls[0]!.program).toBe('gh')
    expect(calls[0]!.args.slice(0, 3)).toEqual(['repo', 'clone', 'owner/private'])
    expect(calls[0]!.args).toContain('--depth')
    expect(item.path.startsWith(join(root, 'reference-repositories'))).toBe(true)
    await store.bind('mission_first', undefined, [item.id])
    await store.list('mission_first')
    expect(calls).toHaveLength(1)
    time += REFERENCE_REFRESH_MS + 1
    store.hold('run_live', [item.id])
    await store.list('mission_first')
    expect(calls).toHaveLength(1)
    await store.release('run_live')
    const refreshed = (await store.list('mission_first'))[0]!
    expect(refreshed.path).not.toBe(item.path)
    expect(await readFile(join(refreshed.path, 'source.txt'), 'utf8')).toBe('copy 2')
    expect(await readdir(join(root, 'reference-trash'))).toHaveLength(1)
  })
  it('falls back to an HTTPS public clone without shell interpretation', async () => {
    const calls: { program: string; args: readonly string[] }[] = []
    const { store } = await fixture({ run: async (program, args) => {
      calls.push({ program, args })
      if (program === 'gh') throw new Error('not installed')
      const path = args[args.length - 1]!; await mkdir(path); await writeFile(join(path, 'README.md'), 'public')
    } })
    await store.github('owner/public')
    expect(calls.map((call) => call.program)).toEqual(['gh', 'git'])
    expect(calls[1]!.args.slice(-3, -1)).toEqual(['--', 'https://github.com/owner/public.git'])
  })
  it('refuses an oversized clone and recycles it, never the local folder', async () => {
    const { store, root, picked } = await fixture({ maxBytes: 5, run: async (_program, args) => {
      const path = args[3]!; await mkdir(path); await writeFile(join(path, 'large'), 'too large')
    } })
    await expect(store.github('owner/large')).rejects.toThrow('larger than 500 MB')
    expect(await readdir(join(root, 'reference-repositories'))).toEqual([])
    expect(await readdir(join(root, 'reference-trash'))).toHaveLength(1)
    expect((await stat(picked)).isDirectory()).toBe(true)
  })
  it('only recycles a clone when its last conversation and live run release it', async () => {
    const { store, root } = await fixture({ run: async (_program, args) => { await mkdir(args[3]!); await writeFile(join(args[3]!, 'README.md'), 'reference') } })
    const item = await store.github('owner/shared')
    await store.bind('mission_first', undefined, [item.id]); await store.bind('mission_other', undefined, [item.id])
    await store.set('mission_first', [])
    expect((await stat(item.path)).isDirectory()).toBe(true)
    store.hold('run_live', [item.id]); await store.set('mission_other', [])
    expect((await stat(item.path)).isDirectory()).toBe(true)
    await store.release('run_live')
    await expect(stat(item.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(root, 'reference-trash'))).toHaveLength(1)
  })
  it('keeps an unsent reference after a failed start releases its lease, until the person removes it', async () => {
    const { store } = await fixture({ run: async (_program, args) => { await mkdir(args[3]!); await writeFile(join(args[3]!, 'README.md'), 'reference') } })
    const item = await store.github('owner/draft')
    store.hold('run_failed_before_binding', [item.id])
    await store.release('run_failed_before_binding')
    expect(await store.select(undefined, [item.id])).toEqual([item])
    expect((await stat(item.path)).isDirectory()).toBe(true)
    await store.discard(item.id)
    await expect(stat(item.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not follow a repository junction while counting bytes', async () => {
    const { root, picked } = await fixture()
    const clone = join(root, 'clone'); await mkdir(clone); await writeFile(join(picked, 'large'), 'large outside')
    await symlink(picked, join(clone, 'link'), 'junction')
    expect(await referenceBytes(clone, 1)).toBe(0)
  })
})

describe('a reference never changes the selected mode', () => {
  it('full-access modes keep the reference with a plain write warning', () => {
    for (const runtime of ['codex', 'claude', 'opencode', 'copilot', 'antigravity', 'cursor', 'muse']) expect(referenceAccess(runtime, 'auto', '/reference')).toEqual({ include: true, note: 'This mode can change it. The brief asks for reading, not changing.' })
  })
  it('Codex reads outside its workspace without granting add-dir write access', () => {
    expect(referenceAccess('codex', 'accept-edits', '/reference', '/project').include).toBe(true)
    expect(referenceAccess('codex', 'accept-edits', '/reference', '/project').note).toContain('No extra writable folder')
  })
  it('names references without changing an unextended runtime or inventing a write-access reason to omit them', () => {
    for (const runtime of ['cursor', 'muse', 'another-runtime']) for (const mode of ['ask', 'plan', 'accept-edits', 'approve-each']) {
      expect(referenceAccess(runtime, mode, '/reference', '/project')).toEqual({ include: true, note: 'Named in the brief; this runtime\'s existing permissions still apply.' })
    }
  })
  it('a restricted runtime omits a grant that would make the reference writable and says why', () => {
    for (const runtime of ['claude', 'opencode', 'copilot', 'antigravity']) {
      expect(referenceAccess(runtime, 'ask', '/reference').include).toBe(true)
      expect(referenceAccess(runtime, 'accept-edits', '/reference').include).toBe(false)
      expect(referenceAccess(runtime, 'accept-edits', '/reference').note).toContain('also grant write access')
    }
  })
  it('does not pretend a folder already writable in the workspace is read-only', () => {
    expect(referenceAccess('claude', 'accept-edits', 'C:\\project\\design', 'C:/project').note).toContain('This mode can change it')
    expect(referenceAccess('claude', 'accept-edits', '/Project/design', '/project').include).toBe(false)
    expect(referenceAccess('claude', 'accept-edits', '/project-other', '/project').include).toBe(false)
    expect(referenceAccess('codex', 'auto', '/reference', '/project', true).include).toBe(false)
  })
  it('the every-turn brief names only attached folders and explicitly withdraws old references', () => {
    expect(referencesSection(['/reference one', '/reference two'])).toContain('for reading, not changing: "/reference one", "/reference two"')
    expect(referencesSection([])).toContain('earlier references are not attached now')
  })
})
