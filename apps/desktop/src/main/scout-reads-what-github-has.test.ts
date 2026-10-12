import { describe, expect, it } from 'vitest'

import { readScoutGithub } from './scout-github.js'

/*
 * What Scout asks GitHub, through the person's own CLI in the folder (0.756), and since 0.758 when each pull request
 * last moved (for "ready and waiting") and the repository's open issues -- read against Colin's own repositories on
 * 2026-10-12, Scout had nothing to say about a pull request that had waited six weeks, or about what people file.
 */
const answers: Record<string, string> = {
  'pr list --author': JSON.stringify([{ number: 2, title: 'Stop claiming empty results', url: 'https://github.com/acme/hearth/pull/2', state: 'OPEN', isDraft: false, statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }], reviewDecision: '', mergeable: 'MERGEABLE', updatedAt: '2026-08-28T05:03:26Z' }]),
  'pr list --search': '[]',
  'repo view': 'main\n',
  'run list': '[]',
  'issue list': JSON.stringify([{ number: 5, title: 'Crashes on start', url: 'https://github.com/acme/hearth/issues/5', createdAt: '2026-10-12T09:00:00Z', author: { login: 'dana' } }])
}

describe('what Scout reads from GitHub', () => {
  it('asks for when each pull request last moved and for the open issues, with the CLI in the folder', async () => {
    const calls: string[][] = []
    const gh = async (args: readonly string[], cwd: string): Promise<string> => {
      calls.push([cwd, ...args])
      const key = Object.keys(answers).find((one) => args.join(' ').startsWith(one))
      return key === undefined ? '' : answers[key]!
    }
    const read = await readScoutGithub('C:/work/hearth', gh)
    expect(calls.every((call) => call[0] === 'C:/work/hearth')).toBe(true)
    expect(calls.find((call) => call[1] === 'pr' && call[3] === '--author')?.at(-1)).toBe('number,title,url,state,isDraft,statusCheckRollup,reviewDecision,mergeable,updatedAt')
    expect(calls.find((call) => call[1] === 'issue')).toEqual(['C:/work/hearth', 'issue', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,url,createdAt,author'])
    expect(read?.prs[0]).toMatchObject({ number: 2, checks: 'passing', updatedAt: '2026-08-28T05:03:26Z' })
    expect(read?.issues).toEqual([{ number: 5, title: 'Crashes on start', url: 'https://github.com/acme/hearth/issues/5', createdAt: '2026-10-12T09:00:00Z', author: 'dana' }])
  })

  it('asks nothing more when the first read fails: no GitHub here is no news', async () => {
    const calls: string[][] = []
    const read = await readScoutGithub('C:/work/plain', async (args) => { calls.push([...args]); throw new Error('not a git repository') })
    expect(read).toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})
