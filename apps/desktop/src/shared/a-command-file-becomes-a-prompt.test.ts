import { expect, it } from 'vitest'
import {
  argumentsOfOwnCommand,
  bangBlocks,
  bangDraft,
  commandNameFromPath,
  expandTemplate,
  leaveCommandMode,
  oneShot,
  ownCommandChoice,
  parseOwnCommand,
  splitCommandWords
} from './own-commands.js'

it('reads a command file, including a nested name, and ignores a mode it does not have', () => {
  const parsed = parseOwnCommand(`---\ndescription: Looks at the diff\nteammate: Wren\nmode: plan\n---\nReview $ARGUMENTS\n`, 'team/review')
  expect(parsed).toEqual({ name: 'team/review', description: 'Looks at the diff', teammate: 'Wren', mode: 'plan', body: 'Review $ARGUMENTS\n' })
  expect(commandNameFromPath('team/review.md')).toBe('team/review')
  expect(commandNameFromPath('notes\\ship.md')).toBe('notes/ship')
  expect(parseOwnCommand('---\nmode: sideways\n---\nGo\n', 'go').mode).toBeUndefined()
  const plain = parseOwnCommand('Just the prompt.\n', 'plain')
  expect(plain.body).toBe('Just the prompt.\n')
  expect(plain.description).toBeUndefined()
  expect(plain.mode).toBeUndefined()
})

it('gives $1 and $2 the words, quotes grouping, and the last the rest', () => {
  expect(splitCommandWords('"hello world" Sam')).toEqual(['hello world', 'Sam'])
  expect(expandTemplate('See $1 then $2', 'one two three')).toBe('See one then two three')
  expect(expandTemplate('Say $1 to $2', '"hello world" Sam')).toBe('Say hello world to Sam')
  expect(expandTemplate('Task: $ARGUMENTS', 'fix the bug')).toBe('Task: fix the bug')
  expect(expandTemplate('Review this.', 'the api')).toBe('Review this.\n\nthe api')
  expect(expandTemplate('Review this.', '')).toBe('Review this.')
  expect(expandTemplate('Keep $1', '')).toBe('Keep ')
})

it('finds a bang block and the arguments typed after a command name', () => {
  expect(bangBlocks('Status:\n\n!`echo hello`\n')).toEqual([{ command: 'echo hello', token: '!`echo hello`' }])
  expect(bangBlocks('No bang here')).toEqual([])
  expect(argumentsOfOwnCommand('/team/review the notes', ['team/review'])).toEqual({ name: 'team/review', args: 'the notes' })
  expect(argumentsOfOwnCommand('/team/review', ['team/review'])).toBeUndefined()
  expect(argumentsOfOwnCommand('/plan the work', ['team/review'])).toBeUndefined()
})

it('treats a leading bang as command mode, and Escape takes the mark off', () => {
  expect(bangDraft('!echo hello')?.command).toBe('echo hello')
  expect(bangDraft('! echo hello')?.command).toBe('echo hello')
  expect(bangDraft('echo hello')).toBeUndefined()
  expect(bangDraft(' !echo')).toBeUndefined()
  expect(leaveCommandMode('!echo hello')).toBe('echo hello')
  expect(leaveCommandMode('!')).toBe('')
})

it('chooses a command by filling the box', () => {
  const choice = ownCommandChoice('team/review', 'project', 'the notes')
  expect(choice.fill).toEqual({ name: 'team/review', source: 'project', args: 'the notes' })
  expect('send' in choice).toBe(false)
})

it('runs one command in the terminal panel shell', () => {
  expect(oneShot({ id: 'powershell', args: ['-NoLogo'] }, 'echo hello')).toEqual({ args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], input: 'echo hello' })
  expect(oneShot({ id: 'pwsh', args: [] }, 'echo hello').input).toBe('echo hello')
  expect(oneShot({ id: 'cmd', args: [] }, 'echo hello')).toEqual({ args: ['/d', '/s', '/c', 'echo hello'] })
  expect(oneShot({ id: 'git-bash', args: ['--login', '-i'] }, 'echo hello')).toEqual({ args: ['-lc', 'echo hello'] })
  expect(oneShot({ id: 'wsl:Ubuntu', args: ['-d', 'Ubuntu'] }, 'echo hello').args).toEqual(['-d', 'Ubuntu', '--', 'bash', '-lc', 'echo hello'])
})
