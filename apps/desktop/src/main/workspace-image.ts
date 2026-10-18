import { isAbsolute, resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'

import { imageMediaType, MAX_PREVIEW_BYTES } from '../shared/image-files.js'
import type { WorkspaceImageResponse } from '../shared/ipc.js'
import { decideReveal, decideTeammateFile, insideOnDisk, readRoots } from './reveal-file.js'

/**
 * Read only inside the selected, host-known conversation or comparison folder
 * -- or, given `named`, a picture outside it that a teammate's own record
 * names (0.787, named-files.ts).
 */
export async function readWorkspaceImage(
  requested: unknown,
  folder: unknown,
  roots: readonly string[],
  named?: (path: string) => Promise<boolean>
): Promise<WorkspaceImageResponse> {
  if (typeof requested !== 'string' || requested.length === 0) return { ok: false, message: 'No path.' }
  if (typeof folder !== 'string' || !isAbsolute(folder) || !decideReveal(folder, roots).ok) return { ok: false, message: 'No workspace.' }
  const mediaType = imageMediaType(requested)
  if (mediaType === undefined) return { ok: false, message: 'Not an image this app draws.' }
  // Schemes (including data:) and network paths never become disk requests.
  if (/^(?![a-z]:[\\/])[a-z][a-z\d+.-]*:|^[\\/]{2}/i.test(requested)) return { ok: false, message: 'Not a local image.' }
  const decision = named === undefined ? decideReveal(resolve(folder, requested), [folder]) : await decideTeammateFile(resolve(folder, requested), [folder], named)
  if (!decision.ok) return { ok: false, message: 'Outside the workspace.' }
  try {
    if (!(await insideOnDisk(folder, roots)) || !(await insideOnDisk(decision.path, readRoots(decision, [folder])))) return { ok: false, message: 'Outside the workspace.' }
    const measured = await stat(decision.path)
    if (!measured.isFile()) return { ok: false, message: 'Not a file.' }
    if (measured.size > MAX_PREVIEW_BYTES) return { ok: false, message: 'Too large to preview.' }
    const bytes = await readFile(decision.path)
    return { ok: true, path: decision.path, dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` }
  } catch {
    return { ok: false, message: 'Could not be read.' }
  }
}
