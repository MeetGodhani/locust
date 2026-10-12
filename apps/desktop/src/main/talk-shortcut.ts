import { DEFAULT_TALK_SHORTCUT, isTalkShortcut, type TalkShortcutState } from '../shared/talk-shortcut.js'

/**
 * THE KEYS THAT START TALK FROM ANY APP (0.755, shared/talk-shortcut.ts).
 *
 * Windows gives a shortcut to one app at a time, and one Locust takes is no other app's while it runs. So the keys
 * are taken only once Talk could start on this computer -- Codex signed in, a folder open -- and a machine without
 * Talk keeps them; checked at launch, and again each time the window finds Talk ready. Keys the person picks in
 * Settings are taken at once. A window a test drive opened takes none of the person's: the drive names its own.
 */
export interface TalkShortcutDeps {
  /** Windows' registration; true when the keys are Locust's now. */
  readonly register: (keys: string, onPress: () => void) => boolean
  readonly unregister: (keys: string) => void
  /** The keys kept in the profile: keys, false when turned off, undefined when never chosen. */
  readonly read: () => Promise<unknown>
  readonly write: (keys: string | false) => Promise<void>
  readonly pressed: () => void
  /** Why this launch takes no keys from the machine at all; undefined when it may. */
  readonly refusedHere?: string
  /** The keys this launch uses in place of the person's: a drive's own. */
  readonly keysHere?: string
  /** Whether a call could start now. */
  readonly ready: () => Promise<boolean>
}

export interface TalkShortcut {
  /** Takes the keys when they are wanted and a call could start. */
  ensure(): Promise<void>
  read(): Promise<TalkShortcutState>
  set(keys: unknown): Promise<TalkShortcutState>
  dispose(): void
}

export function createTalkShortcut(deps: TalkShortcutDeps): TalkShortcut {
  let held: string | undefined
  /** Keys Windows would not give: another app holds them. Tried again at the next check. */
  let refused: string | undefined
  let writing: Promise<unknown> = Promise.resolve()

  const wanted = async (): Promise<string | false> => {
    if (deps.keysHere !== undefined) return deps.keysHere
    const kept = await deps.read().catch(() => undefined)
    if (kept === false) return false
    return isTalkShortcut(kept) ? kept : DEFAULT_TALK_SHORTCUT
  }
  const release = (): void => {
    if (held !== undefined) {
      try { deps.unregister(held) } catch { /* Windows has already let it go */ }
    }
    held = undefined
    refused = undefined
  }
  const take = (keys: string): void => {
    if (held === keys) return
    release()
    let ok = false
    try { ok = deps.register(keys, deps.pressed) } catch { ok = false }
    if (ok) held = keys
    else refused = keys
  }
  const state = async (): Promise<TalkShortcutState> => {
    const keys = await wanted()
    if (keys === false) return { working: false }
    if (held === keys) return { keys, working: true }
    if (deps.refusedHere !== undefined && deps.keysHere === undefined) return { keys, working: false, why: deps.refusedHere }
    if (refused === keys) return { keys, working: false, why: `Another app is using ${keys}, so Windows will not give it to Locust. Choose other keys.` }
    return { keys, working: false, why: 'It starts working once Talk is ready on this computer: Codex signed in with ChatGPT, and a folder open.' }
  }
  const mayTake = (): boolean => deps.refusedHere === undefined || deps.keysHere !== undefined

  return {
    async ensure() {
      if (!mayTake()) return
      const keys = await wanted()
      if (keys === false || held === keys) return
      if (!(await deps.ready().catch(() => false))) return
      take(keys)
    },
    read: state,
    async set(keys) {
      if (keys !== false && !isTalkShortcut(keys)) return state()
      // One write at a time: two quick changes land in the order they were made.
      const write = writing.then(() => deps.write(keys))
      writing = write.catch(() => undefined)
      await write
      if (keys === false) release()
      // The person's own choice is taken now, ready or not: a press before Talk is ready says why on screen.
      else if (mayTake() && deps.keysHere === undefined) take(keys)
      return state()
    },
    dispose() {
      release()
    }
  }
}
