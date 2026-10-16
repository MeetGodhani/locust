import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MAX_KEPT_FILE_BYTES, PLAIN_STATE_ID, createCheckpoints, createTurnRecords } from './checkpoints.js'
import { createPlainCheckpoints, plainStoreFor } from './checkpoints-plain.js'

/*
 * UNDO WITHOUT GIT (0.780). A machine with no `git` kept no copy of any turn, so no turn could be undone and nothing
 * said so (clean-machine drive, packaged 0.779). The same store, without git: real files, and a runner that fails
 * the test if git is ever asked.
 */
const made: string[] = []
afterEach(async () => {
  for (const folder of made.splice(0)) await rm(folder, { recursive: true, force: true })
})
const temp = async (prefix: string): Promise<string> => {
  const folder = await mkdtemp(join(process.env.LOCUST_GATE_TMP ?? tmpdir(), prefix))
  made.push(folder)
  return folder
}
const noGit = async (): Promise<string> => {
  throw new Error('git was asked on a machine without it')
}
const setUp = async () => {
  const workspace = await temp('locust-plain-ws-')
  const root = await temp('locust-plain-store-')
  await writeFile(join(workspace, 'notes.txt'), 'one\r\ntwo\r\n')
  await mkdir(join(workspace, 'sub'))
  await writeFile(join(workspace, 'sub', 'keep.md'), 'keep\n')
  await writeFile(join(workspace, 'gone.md'), 'here before\n')
  await mkdir(join(workspace, '.locust'))
  await writeFile(join(workspace, '.locust', 'memory.md'), 'remembered\n')
  await mkdir(join(workspace, 'node_modules'))
  await writeFile(join(workspace, 'node_modules', 'big.js'), 'skipped\n')
  const checkpoints = createCheckpoints({ root, runGit: noGit, withoutGit: createPlainCheckpoints({ root }), gitAvailable: async () => false })
  return { workspace, root, checkpoints }
}
// The turn: one edit, one new file, one removal -- and a write to Locust's own folder, which is not the turn's to undo.
const turn = async (workspace: string) => {
  await writeFile(join(workspace, 'notes.txt'), 'one\r\nTWO\r\n')
  await writeFile(join(workspace, 'made.md'), 'new\n')
  await rm(join(workspace, 'gone.md'))
  await writeFile(join(workspace, '.locust', 'memory.md'), 'remembered more\n')
}

describe('a turn on a machine without git', () => {
  it('is kept and undone, byte for byte, without git', async () => {
    const { workspace, root, checkpoints } = await setUp()
    const before = await checkpoints.take(workspace)
    expect(before).toMatchObject({ ok: true, notKept: [] })
    if (!before.ok) return
    expect(before.commit).toMatch(PLAIN_STATE_ID)
    await turn(workspace)
    const after = await checkpoints.take(workspace)
    if (!after.ok) throw new Error(after.why)
    expect(await checkpoints.changed(workspace, before.commit, after.commit)).toEqual(['gone.md', 'made.md', 'notes.txt'])
    expect(await checkpoints.fileAt(workspace, before.commit, 'notes.txt')).toBe('one\r\ntwo\r\n')
    const result = await checkpoints.undo(workspace, before.commit, after.commit)
    expect([...result.restored].sort()).toEqual(['gone.md', 'made.md', 'notes.txt'])
    expect(result.leftAlone).toEqual([])
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('one\r\ntwo\r\n')
    expect(await readFile(join(workspace, 'gone.md'), 'utf8')).toBe('here before\n')
    expect(existsSync(join(workspace, 'made.md'))).toBe(false)
    // Locust's own folder and node_modules were never the turn's to put back.
    expect(await readFile(join(workspace, '.locust', 'memory.md'), 'utf8')).toBe('remembered more\n')
    // Nothing was made in the git store's place.
    expect((await readdir(root)).some((name) => name.endsWith('.git'))).toBe(false)
    expect(existsSync(plainStoreFor(root, workspace))).toBe(true)
  })

  it('leaves alone a file changed since the turn, and names it', async () => {
    const { workspace, checkpoints } = await setUp()
    const before = await checkpoints.take(workspace)
    await turn(workspace)
    const after = await checkpoints.take(workspace)
    if (!before.ok || !after.ok) throw new Error('not kept')
    await writeFile(join(workspace, 'notes.txt'), 'the person wrote this\n')
    const result = await checkpoints.undo(workspace, before.commit, after.commit)
    expect(result.leftAlone).toEqual([{ path: 'notes.txt', why: 'changed since the turn' }])
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('the person wrote this\n')
  })

  it('names a file too large to keep, and keeps the rest', async () => {
    const { workspace, checkpoints } = await setUp()
    await writeFile(join(workspace, 'video.bin'), Buffer.alloc(MAX_KEPT_FILE_BYTES + 1))
    const kept = await checkpoints.take(workspace)
    expect(kept).toMatchObject({ ok: true, notKept: ['video.bin'] })
  })

  it('gives the same folder the same name, and reads back no binary as text', async () => {
    const { workspace, checkpoints } = await setUp()
    await writeFile(join(workspace, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]))
    const first = await checkpoints.take(workspace)
    const second = await checkpoints.take(workspace)
    if (!first.ok || !second.ok) throw new Error('not kept')
    expect(second.commit).toBe(first.commit)
    expect(await checkpoints.fileAt(workspace, first.commit, 'image.png')).toBeUndefined()
    expect(await checkpoints.fileAt(workspace, first.commit, 'sub/keep.md')).toBe('keep\n')
  })

  it('is undone through the turn record, as a turn with git is', async () => {
    const { workspace, root, checkpoints } = await setUp()
    const records = createTurnRecords(join(root, 'turns.json'))
    const before = await checkpoints.take(workspace)
    await turn(workspace)
    const after = await checkpoints.take(workspace)
    if (!before.ok || !after.ok) throw new Error('not kept')
    await checkpoints.hold(workspace, 'run_1-before', before.commit)
    await checkpoints.hold(workspace, 'run_1-after', after.commit)
    await records.put('run_1', { workspace, before: before.commit, after: after.commit, at: '2026-10-16T05:00:00.000Z', notKept: [] })
    expect(await records.state('run_1', checkpoints)).toMatchObject({ kind: 'ready', files: 3 })
    expect(await records.undo('run_1', checkpoints, () => new Date('2026-10-16T05:01:00.000Z'))).toMatchObject({ kind: 'undone' })
    expect(await readFile(join(workspace, 'gone.md'), 'utf8')).toBe('here before\n')
  })
})

describe('which store a take uses', () => {
  it('is git wherever git runs, exactly as before', async () => {
    const asked: string[][] = []
    const checkpoints = createCheckpoints({
      root: 'C:/profile/checkpoints',
      runGit: async (args) => {
        asked.push([...args])
        return ''
      },
      withoutGit: createPlainCheckpoints({ root: 'C:/profile/checkpoints' }),
      gitAvailable: async () => true
    })
    await checkpoints.take('C:/work/project')
    expect(asked.some((args) => args.includes('ls-files'))).toBe(true)
  })
})
