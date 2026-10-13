import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * THE RUNS WHOSE ANSWER BELONGS TO A PANEL (0.771, shared/panel-runs.ts): a commit message written from the changes
 * (shared/commit-draft.ts), a walk through a change (shared/walkthrough.ts). Each is in the record like any run, and
 * kept here so the window never lists one among the conversations, as a judge's run belongs to its comparison.
 * Thousands fit in a few hundred kilobytes; past that the oldest go first.
 */
export interface PanelRuns {
  list(): Promise<readonly string[]>
  add(missionId: string): Promise<void>
}

export function createPanelRuns(file: string, keep = 5_000): PanelRuns {
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
