import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { replaceFile } from './replace-file.js'

/*
 * A SAVE WINDOWS HOLDS FOR A MOMENT IS TRIED AGAIN (0.754). Moving a freshly written file over its target fails with
 * EPERM, EACCES or EBUSY while another program -- the antivirus, most often -- holds one of them; the background runs'
 * store dropped such a save without a word, and a run stayed unmarked as brought back. Any other failure is not
 * Windows being busy, and is not hidden behind retries.
 */
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

describe('moving a new file over the old one', () => {
  it('tries again while Windows holds a file, then moves it', async () => {
    const real = (await import('node:fs/promises')).rename
    let failures = 2
    const move = vi.fn(async (from: string, to: string) => {
      if (failures > 0) { failures -= 1; throw busy(failures === 1 ? 'EPERM' : 'EBUSY') }
      await real(from, to)
    })
    const root = await mkdtemp(join(tmpdir(), 'locust-replace-'))
    roots.push(root)
    await writeFile(join(root, 'runs.json'), 'old', 'utf8')
    await writeFile(join(root, 'runs.json.tmp'), 'new', 'utf8')
    await replaceFile(join(root, 'runs.json.tmp'), join(root, 'runs.json'), { move, waitMs: 1 })
    expect(move).toHaveBeenCalledTimes(3)
    expect(await readFile(join(root, 'runs.json'), 'utf8')).toBe('new')
  })

  it('gives up after its tries, and never retries a failure that is not Windows being busy', async () => {
    const always = vi.fn(async () => { throw busy('EACCES') })
    await expect(replaceFile('a', 'b', { move: always, tries: 4, waitMs: 1 })).rejects.toThrow('EACCES')
    expect(always).toHaveBeenCalledTimes(4)
    const missing = vi.fn(async () => { throw busy('ENOENT') })
    await expect(replaceFile('a', 'b', { move: missing, waitMs: 1 })).rejects.toThrow('ENOENT')
    expect(missing).toHaveBeenCalledTimes(1)
  })
})
