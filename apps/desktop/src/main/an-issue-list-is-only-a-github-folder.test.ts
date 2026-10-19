import { expect, it } from 'vitest'

import { createGithubIssues } from './github-issues.js'

const LIST = JSON.stringify([
  { number: 5, title: 'Crashes on start', url: 'https://github.com/acme/hearth/issues/5', createdAt: '2026-10-12T09:00:00Z', author: { login: 'dana' }, labels: [{ name: 'bug' }] }
])

it('asks for issues only when the folder is one gh can read', async () => {
  const calls: string[][] = []
  const github = createGithubIssues({
    folder: () => 'C:/work/plain',
    gh: async (args) => { calls.push([...args]); throw new Error('not a git repository') }
  })
  expect(await github.ready()).toBe(false)
  expect(await github.list()).toEqual([])
  expect(calls.every((call) => call[0] === 'repo')).toBe(true)
  expect(calls.some((call) => call[0] === 'issue')).toBe(false)
})

it('lists the open issues through gh in the folder', async () => {
  const calls: string[][] = []
  const github = createGithubIssues({
    folder: () => 'C:/work/hearth',
    gh: async (args, cwd) => {
      calls.push([cwd, ...args])
      if (args[0] === 'repo') return '{"nameWithOwner":"acme/hearth"}'
      if (args[0] === 'issue' && args[1] === 'list') return LIST
      return ''
    }
  })
  expect(await github.ready()).toBe(true)
  const listed = await github.list()
  expect(listed).toEqual([{ number: 5, title: 'Crashes on start', url: 'https://github.com/acme/hearth/issues/5', author: 'dana', createdAt: '2026-10-12T09:00:00Z', labels: ['bug'] }])
  expect(calls.every((call) => call[0] === 'C:/work/hearth')).toBe(true)
  expect(calls.find((call) => call[2] === 'list')?.slice(1)).toEqual(['issue', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,author,createdAt,labels,url'])
})
