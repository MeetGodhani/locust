import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

import { MAX_REFERENCES, type ConversationReference } from '../shared/references.js'
import { replaceFile } from './replace-file.js'

export const REFERENCE_SIZE_CAP = 500 * 1024 * 1024
export const REFERENCE_REFRESH_MS = 60 * 60 * 1000
class ReferenceSizeError extends Error {}
type State = { version: 1; items: Record<string, ConversationReference>; turns: Record<string, string>; conversations: Record<string, readonly string[]>; folders?: Record<string, string> }
export interface ReferenceStoreOptions {
  readonly root: string
  readonly parent: (id: string) => Promise<string | undefined>
  readonly pickFolder: () => Promise<string | undefined>
  readonly run?: (program: 'git' | 'gh', args: readonly string[], cwd: string, checkSize: () => Promise<void>) => Promise<void>
  readonly now?: () => number
  readonly maxBytes?: number
  readonly note?: (message: string) => void
}

/** GitHub only; no local path, protocol, credentials, options, revision or shell fragment gets to git. */
export function referenceRepository(value: string): string | undefined {
  const match = /^(?:https:\/\/github\.com\/|github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/i.exec(value.trim())
  if (match === null) return undefined
  const repo = match[2]!.replace(/\.git$/i, '')
  return repo === '' || repo === '.' || repo === '..' ? undefined : `${match[1]!}/${repo}`
}

/** lstat, not stat: a repository cannot charge an unrelated directory (or make us walk a link cycle). */
export async function referenceBytes(folder: string, limit: number): Promise<number> {
  let bytes = 0
  let files = 0
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (++files > 200_000) throw new ReferenceSizeError('This repository has too many files. Nothing was added to the conversation.')
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) {
        bytes += (await lstat(child)).size
        if (bytes > limit) throw new ReferenceSizeError('This repository is larger than 500 MB. Nothing was added to the conversation.')
      }
    }
  }
  await walk(folder)
  return bytes
}

/** No shell, prompts, hooks, LFS smudge or changes to the person's Git config. Only their gh handles sign-in. */
function runClone(program: 'git' | 'gh', args: readonly string[], cwd: string, checkSize: () => Promise<void>): Promise<void> {
  return new Promise((done, fail) => {
    let sizeError: Error | undefined
    let checking = false
    const child = execFile(program, [...args], { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GIT_LFS_SKIP_SMUDGE: '1' } }, (error) => {
      clearInterval(timer)
      if (sizeError !== undefined) fail(sizeError)
      else if (error !== null) fail(new Error('The repository could not be downloaded. Check its name and your gh sign-in; nothing was added to the conversation.'))
      else done()
    })
    const timer = setInterval(() => {
      if (checking) return
      checking = true
      void checkSize().catch((error: unknown) => {
        sizeError = error instanceof Error ? error : new Error('The repository is too large.')
        // Only our own clone process tree: never another git or agent on this machine.
        if (process.platform === 'win32' && child.pid !== undefined) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
        else child.kill('SIGTERM')
      }).finally(() => { checking = false })
    }, 500)
    timer.unref()
  })
}

export function createReferenceStore(options: ReferenceStoreOptions) {
  const file = join(options.root, 'conversation-references.json')
  const cache = join(options.root, 'reference-repositories')
  const trash = join(options.root, 'reference-trash')
  const now = options.now ?? Date.now
  const run = options.run ?? runClone
  const limit = options.maxBytes ?? REFERENCE_SIZE_CAP
  let state: State | undefined
  let tail = Promise.resolve()
  const active = new Map<string, readonly string[]>()
  const pendingCollection = new Set<string>()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  const load = async (): Promise<State> => {
    if (state !== undefined) return state
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as State
      if (parsed.version !== 1 || !parsed.items || !parsed.turns || !parsed.conversations) throw new Error('Invalid reference record')
      state = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Saved references could not be read. Nothing was changed.')
      state = { version: 1, items: {}, turns: {}, conversations: {} }
    }
    return state
  }
  const save = async (): Promise<void> => {
    await mkdir(options.root, { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    await replaceFile(temporary, file)
  }
  const rootOf = async (mission: string): Promise<string> => {
    const s = await load()
    let id = mission
    const seen = new Set<string>()
    while (!seen.has(id)) {
      seen.add(id)
      if (s.turns[id] !== undefined) return s.turns[id]!
      const parent = await options.parent(id)
      if (parent === undefined) return id
      id = parent
    }
    throw new Error('This conversation has an invalid history. Its references were not changed.')
  }
  const idsFor = async (mission?: string): Promise<readonly string[]> => mission === undefined ? [] : (await load()).conversations[await rootOf(mission)] ?? []
  const checked = async (ids: readonly string[]): Promise<readonly ConversationReference[]> => {
    const s = await load()
    if (!Array.isArray(ids) || ids.length > MAX_REFERENCES || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !Object.hasOwn(s.items, id))) throw new Error('Choose up to five references using Add a reference. Nothing was sent.')
    return ids.map((id) => s.items[id]!)
  }
  const owned = async (path: string): Promise<boolean> => {
    const rel = relative(resolve(cache), resolve(path))
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || (await lstat(path)).isSymbolicLink()) return false
    return await realpath(path) === resolve(path)
  }
  const recycle = async (path: string): Promise<void> => {
    if (!(await owned(path))) throw new Error('The reference cache moved. Locust left it alone.')
    await mkdir(trash, { recursive: true })
    await rename(path, join(trash, randomUUID()))
  }
  const collect = async (candidates: readonly string[]): Promise<void> => {
    const s = await load()
    const used = new Set(Object.values(s.conversations).flat())
    const held = new Set([...active.values()].flat())
    for (const id of candidates) {
      const item = s.items[id]
      if (item === undefined || used.has(id)) { pendingCollection.delete(id); continue }
      if (held.has(id)) { pendingCollection.add(id); continue }
      if (item.repository !== undefined) {
        try { await recycle(item.path) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { options.note?.('An unused reference copy could not be moved to the cache trash; it was left alone.'); continue }
        }
      }
      delete s.items[id]
      pendingCollection.delete(id)
    }
  }
  const download = async (repository: string): Promise<string> => {
    await mkdir(cache, { recursive: true })
    const path = join(cache, randomUUID())
    const check = async (): Promise<void> => {
      try { await referenceBytes(path, limit) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const configs = ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false', '-c', 'core.longpaths=true']
    try {
      try { await run('gh', ['repo', 'clone', repository, path, '--', '--depth', '1', ...configs], cache, check) }
      catch (error) {
        if (error instanceof ReferenceSizeError) throw error
        if (await stat(path).then(() => true, () => false)) await recycle(path)
        await run('git', [...configs, 'clone', '--depth', '1', '--', `https://github.com/${repository}.git`, path], cache, check)
      }
      await referenceBytes(path, limit)
      return await realpath(path)
    } catch (error) {
      if (await stat(path).then(() => true, () => false)) await recycle(path)
      throw error
    }
  }
  return {
    async folder(): Promise<ConversationReference | undefined> {
      const picked = await options.pickFolder()
      if (picked === undefined) return undefined
      return serial(async () => {
        const path = await realpath(picked)
        if (!(await stat(path)).isDirectory()) throw new Error('Choose a folder. Nothing was added.')
        const item = { id: randomUUID(), name: basename(path) || path, path }
        ;(await load()).items[item.id] = item
        await save()
        return item
      })
    },
    github(repository: string): Promise<ConversationReference> {
      return serial(async () => {
        const source = referenceRepository(repository)
        if (source === undefined) throw new Error('Enter a GitHub repository as owner/repo or its github.com URL. Nothing was downloaded.')
        const path = await download(source)
        const item = { id: randomUUID(), name: source, repository: source, path, refreshedAt: now() }
        ;(await load()).items[item.id] = item
        await save()
        return item
      })
    },
    list(mission?: string): Promise<readonly ConversationReference[]> {
      return serial(async () => {
        const s = await load()
        const items = await checked(await idsFor(mission))
        let changed = false
        for (const item of items) {
          if (item.repository === undefined || now() - (item.refreshedAt ?? 0) < REFERENCE_REFRESH_MS || [...active.values()].some((ids) => ids.includes(item.id))) continue
          try {
            const path = await download(item.repository)
            s.items[item.id] = { ...item, path, refreshedAt: now(), problem: undefined }
            // Publish the new path before moving the old copy; a failed state write leaves the old reference usable.
            try { await save() } catch (error) { s.items[item.id] = item; await recycle(path); throw error }
            // Keep any edits in the old copy recoverable; never reset a person's chosen folder or discard edits.
            await recycle(item.path).catch(() => options.note?.('The old reference copy could not be moved to trash; it was left alone.'))
          } catch { s.items[item.id] = { ...item, problem: 'Could not refresh from GitHub. The previous copy is still here.' } }
          changed = true
        }
        if (changed) await save()
        return items.map((item) => s.items[item.id]!)
      })
    },
    select(mission?: string, ids?: readonly string[]): Promise<readonly ConversationReference[]> {
      return serial(async () => checked(ids ?? await idsFor(mission)))
    },
    bind(mission: string, previous: string | undefined, ids: readonly string[], cwd?: string): Promise<void> {
      return serial(async () => {
        await checked(ids)
        const s = await load()
        const root = previous === undefined ? mission : await rootOf(previous)
        const before = s.conversations[root] ?? []
        s.turns[root] = root
        s.turns[mission] = root
        if (cwd !== undefined) { s.folders ??= {}; s.folders[mission] = cwd }
        s.conversations[root] = [...ids]
        await save()
        await collect(before)
        await save()
      })
    },
    set(mission: string, ids: readonly string[]): Promise<void> {
      return serial(async () => {
        await checked(ids)
        const s = await load(), root = await rootOf(mission), before = s.conversations[root] ?? []
        s.turns[root] = root
        s.turns[mission] = root
        s.conversations[root] = [...ids]
        await save()
        await collect(before)
        await save()
      })
    },
    discard(id: string): Promise<void> {
      return serial(async () => { await collect([id]); await save() })
    },
    cwd(mission: string): Promise<string | undefined> { return serial(async () => (await load()).folders?.[mission]) },
    hold(run: string, ids: readonly string[]): void { active.set(run, ids) },
    release(run: string): Promise<void> {
      // A failed start leaves an unsent draft. Collect only removals deferred by its lease, not that draft's references.
      return serial(async () => { const ids = active.get(run); if (ids === undefined) return; active.delete(run); await collect(ids.filter((id) => pendingCollection.has(id))); await save() })
    },
    forget(missions: readonly string[]): Promise<void> {
      return serial(async () => {
        const s = await load(), before = Object.values(s.conversations).flat()
        for (const id of missions) { delete s.turns[id]; if (s.folders !== undefined) delete s.folders[id] }
        for (const root of Object.keys(s.conversations)) if (!Object.values(s.turns).includes(root)) delete s.conversations[root]
        await save()
        await collect(before)
        await save()
      })
    },
    sweep(): Promise<void> {
      return serial(async () => { const s = await load(); await collect(Object.keys(s.items)); await save() })
    }
  }
}

export type ReferenceStore = ReturnType<typeof createReferenceStore>
