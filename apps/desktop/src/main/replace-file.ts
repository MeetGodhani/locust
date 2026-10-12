import { rename } from 'node:fs/promises'

/**
 * MOVES A FRESHLY WRITTEN FILE OVER ITS TARGET, AS WINDOWS ALLOWS IT (0.754).
 *
 * Locust's stores write a whole new file beside the old one and move it over, so a crash leaves one or the other,
 * never half. On Windows the move can fail for a moment -- EPERM, EACCES or EBUSY -- while another program holds
 * either file open: most often the antivirus, scanning the file just written. npm's graceful-fs retries a rename on
 * Windows for that reason. Locust did not: a background run's save that failed so was dropped without a word, and the
 * run stayed unmarked as brought back into its conversation (the 0.754 gate failed on it, 2026-10-12, under the whole
 * suite's load; 24 runs of the test alone under load did not reproduce it). Tried again for about two seconds.
 */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

export async function replaceFile(from: string, to: string, options: { readonly tries?: number; readonly waitMs?: number; readonly move?: (from: string, to: string) => Promise<void> } = {}): Promise<void> {
  const tries = options.tries ?? 20
  const move = options.move ?? rename
  for (let attempt = 1; ; attempt += 1) {
    try {
      await move(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= tries || code === undefined || !BUSY.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, options.waitMs ?? 100))
    }
  }
}
