import type { UndoResult } from './checkpoints.js'

/*
 * A TEAMMATE IS TOLD ITS LAST TURN WAS UNDONE (0.784).
 *
 * Undo is Locust's (0.674): it puts the folder back without the runtime knowing, and the session the next turn
 * resumes still remembers writing the files. Clean-machine drive, packaged 0.783, 2026-10-17: a teammate made
 * laptop-setup.md, the person pressed Undo ("Undone: 1 file put back as it was before this turn."), then asked what
 * it had just undone -- "Nothing — I undid nothing; I only created laptop-setup.md, which is still on disk." The file
 * was gone. A person new to the app reads that as Undo not working.
 *
 * So a follow-up to a turn that was undone starts with what Undo did. Only the turn it follows: that is the case a
 * person meets (undo, then say something), and the next turn follows a new one, so it is said once. An older turn
 * undone further back in the conversation is not said.
 */

/** At most this many paths are named; a turn that touched more is said by count. */
export const UNDONE_NOTE_MAX_PATHS = 12

function listed(paths: readonly string[]): string {
  const named = paths.slice(0, UNDONE_NOTE_MAX_PATHS).join(', ')
  const more = paths.length - UNDONE_NOTE_MAX_PATHS
  return more > 0 ? `${named} and ${String(more)} more` : named
}

/** The note a follow-up starts with, or undefined when Undo put nothing back. */
export function undoneNote(undone: UndoResult): string | undefined {
  if (undone.restored.length === 0 && undone.leftAlone.length === 0) return undefined
  const lines = ['Before this message, the person pressed Undo on your previous turn in Locust.']
  if (undone.restored.length > 0) {
    lines.push(`These files were put back as they were before that turn (a file it created is gone): ${listed(undone.restored)}.`)
  }
  if (undone.leftAlone.length > 0) {
    lines.push(`Left as they are: ${listed(undone.leftAlone.map((file) => `${file.path} (${file.why})`))}.`)
  }
  lines.push('Work from the folder as it is now, not from what that turn wrote.')
  return lines.join(' ')
}
