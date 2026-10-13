import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * THE RUNS THAT WROTE COMMIT MESSAGES (0.771, shared/commit-draft.ts). Each is in the record like any run, and kept
 * here so the window never lists one among the conversations: a draft belongs to the Commit dialog, as a judge's run
 * belongs to its comparison. Thousands fit in a few hundred kilobytes; past that the oldest go first.
 */
export interface CommitDraftRuns {
  list(): Promise<readonly string[]>
  add(missionId: string): Promise<void>
}

export function createCommitDraftRuns(file: string, keep = 5_000): CommitDraftRuns {
  let held: readonly string[] | undefined
  let writing: Promise<void> = Promise.resolve()
  const read = async (): Promise<readonly string[]> => {
    if (held !== undefined) return held
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { readonly missionIds?: unknown }
      held = Array.isArray(parsed.missionIds) ? parsed.missionIds.filter((id): id is string => typeof id === 'string' && id.length <= 200).slice(-keep) : []
    } catch {
      held = []
    }
    return held
  }
  return {
    list: async () => [...(await read())],
    add: (missionId) => {
      // One write at a time, and one that failed does not stop the next.
      writing = writing.catch(() => undefined).then(async () => {
        const ids = [...(await read()).filter((id) => id !== missionId), missionId].slice(-keep)
        held = ids
        await mkdir(dirname(file), { recursive: true })
        const scratch = `${file}.${String(process.pid)}.tmp`
        await writeFile(scratch, JSON.stringify({ missionIds: ids }), 'utf8')
        await rename(scratch, file)
      })
      return writing
    }
  }
}
