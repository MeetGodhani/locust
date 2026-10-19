import { expect, it } from 'vitest'

import { checkoutIssueBranch } from './github-issues.js'

it('checks out a branch named after the issue in the teammate\'s copy', async () => {
  const calls: string[][] = []
  const branch = await checkoutIssueBranch(async (args, cwd) => {
    calls.push([cwd, ...args])
    if (args[0] === 'symbolic-ref') return 'locust/wren\n'
    if (args[0] === 'rev-parse') throw new Error('missing')
    if (args[0] === 'checkout') return ''
    throw new Error(args.join(' '))
  }, 'C:/work/hearth/.locust/worktrees/tm_wren', 123, 'Crashes on start')
  expect(branch).toBe('fix/123-crashes-on-start')
  expect(calls[0]?.[0]).toBe('C:/work/hearth/.locust/worktrees/tm_wren')
  expect(calls.at(-1)?.slice(1)).toEqual(['checkout', '-q', '-b', 'fix/123-crashes-on-start'])
})

it('uses the branch when it already exists, and leaves a checkout git refuses', async () => {
  const existing = await checkoutIssueBranch(async (args) => {
    if (args[0] === 'symbolic-ref') return 'locust/wren\n'
    if (args[0] === 'rev-parse') return 'abc\n'
    if (args[0] === 'checkout' && args.at(-1) === 'fix/8-older') return ''
    throw new Error(args.join(' '))
  }, 'C:/work/hearth', 8, 'Older')
  expect(existing).toBe('fix/8-older')
  const refused = await checkoutIssueBranch(async (args) => {
    if (args[0] === 'symbolic-ref') return 'locust/wren\n'
    throw new Error('local changes')
  }, 'C:/work/hearth', 8, 'Older')
  expect(refused).toBeUndefined()
})
