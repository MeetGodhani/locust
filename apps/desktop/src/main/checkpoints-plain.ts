import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import {
  KEPT_TURNS_PER_FOLDER,
  MAX_KEPT_BYTES,
  MAX_KEPT_FILE_BYTES,
  MAX_KEPT_FILES,
  MAX_READ_BACK_BYTES,
  PLAIN_STATE_ID,
  TOO_BIG_REMEMBERED_MS,
  storeFor,
  type Checkpoint,
  type Checkpoints,
  type UndoResult
} from './checkpoints.js'
import { SKIPPED_FILE, SKIPPED_FOLDER } from './disk-observation.js'

/**
 * UNDO WITHOUT GIT (0.780).
 *
 * The store Undo keeps is made by the `git` program (checkpoints.ts), and a machine that has never had a coder on it
 * has none: every turn's copy failed, and every turn offered no Undo and said nothing (clean-machine drive, packaged
 * 0.779, 2026-10-16) -- the safety net gone for exactly the person least able to put a folder back by hand.
 *
 * This keeps the same thing without it, under the same profile folder: each file's bytes once, by their SHA-256, and
 * each kept state as the list of which bytes stood at which path. The rest is the git store's own rules -- the same
 * bounds, a file over MAX_KEPT_FILE_BYTES named and not kept, and Undo only where a file is still as the turn left
 * it. What it does not read is a `.gitignore`: it skips what the disk watch skips (disk-observation.ts), dot-folders
 * like `.locust` and `.git`, `node_modules` and the Python environments -- the folders of a person with no git.
 *
 * A state's name is `p` and the hash of its list, so the git store's 40-digit names and these never meet
 * (PLAIN_STATE_ID); checkpoints.ts sends each call to the store that made the names in it.
 */

/** Deeper than this and the folder is not kept, rather than kept in part. */
export const PLAIN_MAX_DEPTH = 32
/** A state not held by any turn, older than this, is let go when a turn is held. */
const UNHELD_KEPT_MS = 60 * 60_000
/** A file kept within this of its last change is read again next time: its time may not show a second write. */
const RACY_MS = 2_000

interface KnownFile {
  readonly size: number
  readonly mtimeMs: number
  readonly hash: string
  readonly keptAt: number
}

interface KeptState {
  readonly files: Readonly<Record<string, string>>
}

export function plainStoreFor(root: string, workspace: string): string {
  return storeFor(root, workspace).replace(/\.git$/, '.plain')
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

/** A path the state names, inside the folder or not at all. */
function inside(workspace: string, relative: string): string | undefined {
  const root = resolve(workspace)
  const full = resolve(root, relative)
  return full === root || !full.startsWith(root + sep) ? undefined : full
}

/** Written beside, then moved into place: a reader never sees half a file. */
async function writeWhole(path: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const partial = `${path}.${String(process.pid)}-${String(Date.now())}.part`
  await writeFile(partial, bytes)
  await rename(partial, path)
}

export function createPlainCheckpoints(options: { readonly root: string; readonly now?: () => number }): Checkpoints {
  const now = options.now ?? Date.now
  const tooBig = new Map<string, { readonly until: number; readonly why: string }>()
  const refuse = (store: string, why: string): { readonly ok: false; readonly why: string } => {
    tooBig.set(store, { until: now() + TOO_BIG_REMEMBERED_MS, why })
    return { ok: false, why }
  }
  const blobPath = (store: string, hash: string): string => join(store, 'blobs', hash.slice(0, 2), hash)
  const statePath = (store: string, id: string): string => join(store, 'states', `${id}.json`)
  const readState = async (store: string, id: string): Promise<KeptState> => {
    if (!PLAIN_STATE_ID.test(id)) throw new Error(`not a kept state: ${id}`)
    return JSON.parse(await readFile(statePath(store, id), 'utf8')) as KeptState
  }
  const knownFiles = new Map<string, Promise<Map<string, KnownFile>>>()
  const known = (store: string): Promise<Map<string, KnownFile>> => {
    let cache = knownFiles.get(store)
    if (cache === undefined) {
      cache = readFile(join(store, 'kept.json'), 'utf8')
        .then((text) => new Map(Object.entries(JSON.parse(text) as Record<string, KnownFile>)))
        .catch(() => new Map<string, KnownFile>())
      knownFiles.set(store, cache)
    }
    return cache
  }

  /** Every file a turn could change, as the disk watch walks a plain folder; undefined past PLAIN_MAX_DEPTH. */
  const listFiles = async (workspace: string): Promise<readonly string[] | undefined> => {
    const found: string[] = []
    const queue: { readonly directory: string; readonly relative: string; readonly depth: number }[] = [{ directory: resolve(workspace), relative: '', depth: 0 }]
    while (queue.length > 0) {
      const { directory, relative, depth } = queue.shift()!
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const path = relative === '' ? entry.name : `${relative}/${entry.name}`
        if (entry.isDirectory()) {
          if (SKIPPED_FOLDER.test(entry.name)) continue
          if (depth + 1 > PLAIN_MAX_DEPTH) return undefined
          queue.push({ directory: join(directory, entry.name), relative: path, depth: depth + 1 })
        } else if (entry.isFile() && !SKIPPED_FILE.test(entry.name)) {
          found.push(path)
          if (found.length > MAX_KEPT_FILES) return found
        }
      }
    }
    return found
  }

  const hashNow = async (full: string): Promise<string | undefined> => {
    const info = await lstat(full).catch(() => undefined)
    if (info?.isFile() !== true) return undefined
    return sha256(await readFile(full))
  }

  const checkpoints: Checkpoints = {
    async take(workspace): Promise<Checkpoint> {
      const store = plainStoreFor(options.root, workspace)
      const remembered = tooBig.get(store)
      if (remembered !== undefined && now() < remembered.until) return { ok: false, why: remembered.why }
      try {
        const listed = await listFiles(workspace)
        if (listed === undefined) return refuse(store, `This folder is nested more than ${String(PLAIN_MAX_DEPTH)} folders deep, too deep to keep a copy of before each turn.`)
        if (listed.length > MAX_KEPT_FILES) return refuse(store, `This folder has more than ${MAX_KEPT_FILES.toLocaleString('en-US')} files, too many to keep a copy of before each turn.`)
        const cache = await known(store)
        const files: Record<string, string> = {}
        const notKept: string[] = []
        let bytes = 0
        const keptAt = Date.now()
        let learned = false
        for (const path of listed) {
          const full = inside(workspace, path)
          const info = full === undefined ? undefined : await lstat(full).catch(() => undefined)
          if (full === undefined || info?.isFile() !== true) continue
          if (info.size > MAX_KEPT_FILE_BYTES) {
            notKept.push(path)
            continue
          }
          bytes += info.size
          if (bytes > MAX_KEPT_BYTES) return refuse(store, `This folder holds more than ${String(MAX_KEPT_BYTES / 1024 / 1024)} MB of files, too much to keep a copy of before each turn.`)
          // Only what changed is read again, as the git store does: same size and time is the same file.
          const was = cache.get(path)
          if (was !== undefined && was.size === info.size && was.mtimeMs === info.mtimeMs && was.keptAt - info.mtimeMs >= RACY_MS) {
            files[path] = was.hash
            continue
          }
          const content = await readFile(full)
          const hash = sha256(content)
          const blob = blobPath(store, hash)
          if ((await stat(blob).catch(() => undefined)) === undefined) await writeWhole(blob, content)
          cache.set(path, { size: info.size, mtimeMs: info.mtimeMs, hash, keptAt })
          learned = true
          files[path] = hash
        }
        const sorted = Object.fromEntries(Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
        const listing = JSON.stringify({ files: sorted })
        const id = `p${sha256(listing)}`
        if ((await stat(statePath(store, id)).catch(() => undefined)) === undefined) await writeWhole(statePath(store, id), listing)
        if (learned) {
          const present = new Set(Object.keys(files))
          for (const path of [...cache.keys()]) if (!present.has(path)) cache.delete(path)
          await writeWhole(join(store, 'kept.json'), JSON.stringify(Object.fromEntries(cache))).catch(() => undefined)
        }
        return { ok: true, commit: id, notKept }
      } catch (error) {
        if (process.env.LOCUST_DEBUG_CHECKPOINTS === '1') console.error('plain checkpoint failed', error)
        return { ok: false, why: 'Locust could not keep a copy of this folder.' }
      }
    },

    async changed(workspace, before, after) {
      const store = plainStoreFor(options.root, workspace)
      const [was, is] = await Promise.all([readState(store, before), readState(store, after)])
      const paths = new Set([...Object.keys(was.files), ...Object.keys(is.files)])
      return [...paths].filter((path) => was.files[path] !== is.files[path]).sort()
    },

    async fileAt(workspace, commit, path) {
      if (!PLAIN_STATE_ID.test(commit) || inside(workspace, path) === undefined) return undefined
      const store = plainStoreFor(options.root, workspace)
      try {
        const hash = (await readState(store, commit)).files[path.replace(/\\/g, '/')]
        if (hash === undefined) return undefined
        const blob = blobPath(store, hash)
        if ((await stat(blob)).size > MAX_READ_BACK_BYTES) return undefined
        const text = await readFile(blob, 'utf8')
        return text.includes('\0') ? undefined : text
      } catch {
        return undefined
      }
    },

    async undo(workspace, before, after): Promise<UndoResult> {
      const store = plainStoreFor(options.root, workspace)
      const [was, is] = await Promise.all([readState(store, before), readState(store, after)])
      const paths = await checkpoints.changed(workspace, before, after)
      const restored: string[] = []
      const leftAlone: { path: string; why: string }[] = []
      for (const path of paths) {
        const full = inside(workspace, path)
        if (full === undefined) {
          leftAlone.push({ path, why: 'outside this folder' })
          continue
        }
        const turnLeft = is.files[path]
        const wasBefore = was.files[path]
        const current = await hashNow(full)
        if (current !== turnLeft) {
          leftAlone.push({ path, why: current === undefined ? 'removed since the turn' : 'changed since the turn' })
          continue
        }
        if (wasBefore === undefined) {
          await rm(full, { force: true })
        } else {
          const bytes = await readFile(blobPath(store, wasBefore))
          await mkdir(dirname(full), { recursive: true })
          await writeFile(full, bytes)
        }
        restored.push(path)
      }
      return { restored, leftAlone }
    },

    async hold(workspace, name, commit) {
      if (!PLAIN_STATE_ID.test(commit)) throw new Error(`not a kept state: ${commit}`)
      const store = plainStoreFor(options.root, workspace)
      const heldFile = join(store, 'held.json')
      const held = await readFile(heldFile, 'utf8')
        .then((text) => JSON.parse(text) as Record<string, { readonly id: string; readonly at: number }>)
        .catch(() => ({}) as Record<string, { readonly id: string; readonly at: number }>)
      held[name.replace(/[^A-Za-z0-9_-]/g, '_')] = { id: commit, at: now() }
      const names = Object.keys(held).sort((left, right) => held[left]!.at - held[right]!.at)
      const over = names.length - KEPT_TURNS_PER_FOLDER * 2
      for (const old of over > 0 ? names.slice(0, over) : []) delete held[old]
      await writeWhole(heldFile, JSON.stringify(held))
      if (over <= 0) return
      // Let go of what no held turn names: states first, then the bytes only those states named.
      const keep = new Set(Object.values(held).map((entry) => entry.id))
      const stateNames = await readdir(join(store, 'states')).catch(() => [] as string[])
      const remaining: KeptState[] = []
      for (const file of stateNames) {
        const id = file.replace(/\.json$/, '')
        const path = join(store, 'states', file)
        // File times are the real clock's, so they are read against it, not the test seam's.
        const young = Date.now() - ((await stat(path).catch(() => undefined))?.mtimeMs ?? 0) < UNHELD_KEPT_MS
        if (keep.has(id) || young) {
          const state = await readState(store, id).catch(() => undefined)
          if (state !== undefined) remaining.push(state)
          continue
        }
        await rm(path, { force: true }).catch(() => undefined)
      }
      const named = new Set(remaining.flatMap((state) => Object.values(state.files)))
      for (const fan of await readdir(join(store, 'blobs')).catch(() => [] as string[])) {
        for (const hash of await readdir(join(store, 'blobs', fan)).catch(() => [] as string[])) {
          if (named.has(hash) || hash.endsWith('.part')) continue
          // Bytes a take is keeping right now, before its state is written, are young: they stay.
          const path = join(store, 'blobs', fan, hash)
          if (Date.now() - ((await stat(path).catch(() => undefined))?.mtimeMs ?? 0) < UNHELD_KEPT_MS) continue
          await rm(path, { force: true }).catch(() => undefined)
        }
      }
    }
  }
  return checkpoints
}
