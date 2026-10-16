import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import { createFolderCommits } from './folder-commit.js'

/*
 * A FOLDER WITHOUT GIT OFFERS NO CHANGES PANEL (2026-10-16). The panel is a
 * branch's changes against its base; on a folder that is not a repository its
 * button only ever opened "This folder is not a git repository", found by the
 * clean-machine drive, where no folder is one. The window asks this and hides
 * the button only on a plain no.
 */
const git = promisify(execFile)
const made: string[] = []
const folder = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'locust-repository-'))
  made.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('whether a folder is a git repository, for the Changes button', () => {
  it('says no for a plain folder and yes for a repository', async () => {
    const plain = await folder()
    const repository = await folder()
    await git('git', ['init', '-q'], { cwd: repository })
    const commits = createFolderCommits()
    expect(await commits.repository(plain)).toBe(false)
    expect(await commits.repository(repository)).toBe(true)
  })

  it('says no for a folder inside a repository that is not its top, as the panel itself does', async () => {
    const repository = await folder()
    await git('git', ['init', '-q'], { cwd: repository })
    const inner = join(repository, 'src')
    await mkdir(inner)
    expect(await createFolderCommits().repository(inner)).toBe(false)
  })

  it('says no on a computer with no git at all', async () => {
    const none = createFolderCommits({ runGit: () => Promise.reject(new Error('git rev-parse: spawn git ENOENT')) })
    expect(await none.repository('C:/work/shop')).toBe(false)
  })

  it('cannot say when git fails another way, so the button stays', async () => {
    const slow = createFolderCommits({ runGit: () => Promise.reject(new Error('git rev-parse: took longer than 30 s and was stopped.')) })
    expect(await slow.repository('C:/work/shop')).toBeUndefined()
  })
})
