import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { commitDraftPrompt, draftedCommitMessage, MAX_SUBJECT_CHARS, type PendingChanges } from '../shared/commit-draft.js'
import { createCommitDraftRuns } from './commit-draft-runs.js'

/*
 * A COMMIT MESSAGE WRITTEN FROM THE CHANGES (0.771). The teammate that made them is given the diff, the files and
 * how this project writes its messages, and answers in one shape; the message is read from that shape only. The
 * run that wrote it is never listed as a conversation.
 */
const PENDING: PendingChanges = {
  diff: 'diff --git a/src/total.ts b/src/total.ts\n--- a/src/total.ts\n+++ b/src/total.ts\n@@ -1 +1 @@\n-export const total = (a, b) => a - b\n+export const total = (a, b) => a + b\n',
  stat: ' src/total.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)',
  cut: false,
  recent: ['Totals round to the cent', 'Invoices list their lines in order']
}

describe('what the teammate is given', () => {
  it('is the diff, the files, the asks and the recent messages, with the shape to answer in', () => {
    const prompt = commitDraftPrompt(PENDING, ['Fix the total', '   ', 'Then add a test'])
    expect(prompt).toContain('do not read files or run commands')
    expect(prompt).toContain('- Fix the total\n- Then add a test')
    expect(prompt).toContain("This project's recent commit messages:\n- Totals round to the cent\n- Invoices list their lines in order")
    expect(prompt).toContain(`The files changed:\n${PENDING.stat}`)
    expect(prompt).toContain(`The changes:\n${PENDING.diff}`)
    expect(prompt.endsWith('SUBJECT: <the first line>\nBODY:\n<the body, or nothing>\nEND')).toBe(true)
    // A diff cut short says so, and a folder with no history yet has no "recent" section.
    const cut = commitDraftPrompt({ ...PENDING, cut: true, recent: [] }, [])
    expect(cut).toContain('(cut short; the list of files above is whole)')
    expect(cut).not.toContain('recent commit messages')
    expect(cut).not.toContain('What the person asked for')
  })
})

describe('the message in the answer', () => {
  it('is the subject and the body, and nothing said around them', () => {
    expect(draftedCommitMessage('Here is the message:\n\nSUBJECT: Total adds its two amounts\nBODY:\nIt subtracted them, so every invoice\nwas short by twice the second line.\nEND\n\nLet me know!')).toBe('Total adds its two amounts\n\nIt subtracted them, so every invoice\nwas short by twice the second line.')
    expect(draftedCommitMessage('SUBJECT: Total adds its two amounts\nBODY:\nEND')).toBe('Total adds its two amounts')
    expect(draftedCommitMessage('**SUBJECT:** "Total adds its two amounts"\n**BODY:**\n```\n- Fixes the sign\n```\n**END**')).toBe('Total adds its two amounts\n\n- Fixes the sign')
    // No END: the rest is the body.
    expect(draftedCommitMessage('SUBJECT: Fix\nBODY: one line\nand another')).toBe('Fix\n\none line\nand another')
  })

  it('cuts a long subject, and is nothing when the answer is not in the shape asked for', () => {
    const long = draftedCommitMessage(`SUBJECT: ${'word '.repeat(30)}\nBODY:\nEND`)
    expect(long?.length).toBe(MAX_SUBJECT_CHARS)
    expect(long?.endsWith('…')).toBe(true)
    expect(draftedCommitMessage('Total adds its two amounts')).toBeUndefined()
    expect(draftedCommitMessage('SUBJECT:\nBODY:\nsomething\nEND')).toBeUndefined()
  })
})

describe('the runs that wrote drafts', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-commit-drafts-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('are kept across a restart, each once, the oldest going first past the limit', async () => {
    const file = join(folder, 'commit-draft-runs.json')
    const runs = createCommitDraftRuns(file, 3)
    await Promise.all([runs.add('mission_a'), runs.add('mission_b'), runs.add('mission_a')])
    expect(await runs.list()).toEqual(['mission_b', 'mission_a'])
    await runs.add('mission_c')
    await runs.add('mission_d')
    expect(await createCommitDraftRuns(file, 3).list()).toEqual(['mission_a', 'mission_c', 'mission_d'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ missionIds: ['mission_a', 'mission_c', 'mission_d'] })
  })

  it('reads a file it cannot use as none', async () => {
    const file = join(folder, 'commit-draft-runs.json')
    await writeFile(file, 'not json', 'utf8')
    expect(await createCommitDraftRuns(file).list()).toEqual([])
  })
})
