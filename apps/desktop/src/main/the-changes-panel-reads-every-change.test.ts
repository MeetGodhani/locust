import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FOLDER_DIFF_MAX_NEW_FILES, FOLDER_DIFF_MAX_NEW_FILE_BYTES } from '../shared/folder-diff.js'
import { createFolderCommits } from './folder-commit.js'

/*
 * WHAT THE CHANGES PANEL IS GIVEN (0.753, bug hunt 2026-10-12, round 2), with real git. The panel parses this text
 * (renderer: a-file-git-shows-without-lines-is-listed.test.ts); here, that the text holds every change:
 *  - CH2: a path with a letter past ASCII, as it is -- git quoted it ("b/caf\303\251.txt") and the panel named it so,
 *    as a rename;
 *  - CH3: a repository with no remote whose default branch is master -- the base was taken to be main, which is not
 *    there, so a branch with commits read "Nothing has changed here";
 *  - CH1: a new file too big to show whole is still listed, by its header, and more new files than are shown says so;
 *  - CH4: a commit no longer on the branch (an amend, a rebase) shows all the changes, not "nothing changed".
 */
const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function repo(defaultBranch: string): { readonly dir: string; readonly git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'locust-changes-'))
  made.push(dir)
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Locust test', '-c', 'user.email=test@locust.test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true }) // public-guard: allow (a test identity for git, not a person)
  git('init', '-q', '-b', defaultBranch)
  writeFileSync(join(dir, 'notes.txt'), 'one\ntwo\n')
  writeFileSync(join(dir, 'café.txt'), 'bonjour\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  return { dir, git }
}

describe('the changes the panel is given', { timeout: 60_000 }, () => {
  it('names a path with an accented letter as it is, as a change, not a rename (CH2)', async () => {
    const { dir } = repo('main')
    writeFileSync(join(dir, 'café.txt'), 'bonjour\nsalut\n')
    const read = await createFolderCommits().diff(dir)
    expect(read.kind).toBe('diff')
    expect(read.kind === 'diff' && read.text).toContain('diff --git a/café.txt b/café.txt')
    expect(read.kind === 'diff' && read.text).not.toContain('\\303')
  })

  it('takes master as the base of a repository with no remote and no main (CH3)', async () => {
    const { dir, git } = repo('master')
    writeFileSync(join(dir, 'notes.txt'), 'one\ntwo\nthree\n')
    git('commit', '-q', '-am', 'a third line')
    const read = await createFolderCommits().diff(dir)
    expect(read.kind).toBe('diff')
    if (read.kind !== 'diff') return
    expect(read.base).toBe('master')
    expect(read.commits.map((commit) => commit.subject)).toEqual(['a third line'])
    expect(read.text).toContain('+three')
  })

  it('lists a new file too big to show whole, and says when there are more new files than it shows (CH1)', async () => {
    const { dir } = repo('main')
    writeFileSync(join(dir, 'big.log'), `${'x'.repeat(100)}\n`.repeat(Math.ceil((FOLDER_DIFF_MAX_NEW_FILE_BYTES + 1_000) / 101)))
    const big = await createFolderCommits().diff(dir)
    expect(big.kind === 'diff' && big.text).toContain('diff --git a/big.log b/big.log\nnew file mode 100644\n')
    expect(big.kind === 'diff' && big.truncated).toBe(false)
    for (let at = 0; at <= FOLDER_DIFF_MAX_NEW_FILES; at += 1) writeFileSync(join(dir, `new-${String(at).padStart(3, '0')}.txt`), 'n\n')
    const many = await createFolderCommits().diff(dir)
    expect(many.kind === 'diff' && many.truncated).toBe(true)
  })

  it('shows all the changes for a commit no longer on the branch, and says it shows all (CH4)', async () => {
    const { dir, git } = repo('main')
    writeFileSync(join(dir, 'notes.txt'), 'one\ntwo\nthree\n')
    git('commit', '-q', '-am', 'first try')
    const gone = git('rev-parse', 'HEAD').trim()
    git('commit', '-q', '--amend', '-m', 'second try')
    const read = await createFolderCommits().diff(dir, gone)
    expect(read.kind).toBe('diff')
    expect(read.kind === 'diff' && read.showing).toBe('all')
    expect(read.kind === 'diff' && read.commits.map((commit) => commit.subject)).toEqual(['second try'])
  })
})
