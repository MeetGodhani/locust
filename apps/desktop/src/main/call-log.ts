import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'

import { MAX_KEPT_CALLS, callsOf, isSavedCall, type SavedCall } from '../shared/calls.js'

/**
 * THE CALLS KEPT WITH THEIR CONVERSATIONS (0.747): what was said on each call with a teammate, in the profile's
 * `calls.json`, so the thread can put the words back among the turns the call started after a restart. The newest
 * MAX_KEPT_CALLS are kept; a call the window sends again (it ends after it was first saved) replaces its old copy.
 */
export function createCallLog(file: string) {
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }
  const read = async (): Promise<SavedCall[]> => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { calls?: unknown }
      return Array.isArray(parsed.calls) ? parsed.calls.filter(isSavedCall) : []
    } catch {
      return []
    }
  }
  return {
    save(call: unknown): Promise<boolean> {
      if (!isSavedCall(call)) return Promise.resolve(false)
      return serial(async () => {
        const kept = (await read()).filter((one) => one.callId !== call.callId)
        const calls = [...kept, call].sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_KEPT_CALLS)
        // Written whole beside the file, then moved over it: a crash leaves the old file or the new one, never half.
        const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
        try {
          await writeFile(temporary, `${JSON.stringify({ calls })}\n`, { encoding: 'utf8', flag: 'wx' })
          await rename(temporary, file)
          return true
        } catch {
          await rm(temporary, { force: true }).catch(() => undefined)
          return false
        }
      })
    },
    async list(missionIds: unknown): Promise<readonly SavedCall[]> {
      if (!Array.isArray(missionIds) || missionIds.length > 1_000 || !missionIds.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) return []
      return callsOf(await read(), missionIds as string[])
    }
  }
}
