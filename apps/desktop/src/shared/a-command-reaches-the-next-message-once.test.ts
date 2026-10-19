import { expect, it } from 'vitest'
import { commandsStillToCarry, promptWithCommands, type CarryCommand } from './own-commands.js'

const ran = (extra: Partial<CarryCommand> = {}): CarryCommand => ({
  command: 'echo hello',
  output: 'hello',
  exitCode: 0,
  stopped: false,
  carried: false,
  running: false,
  ...extra
})

it('carries a finished command into the next message, marked as the person\'s, and not again', () => {
  const entries = [ran()]
  const first = promptWithCommands('Look at this.', entries)
  expect(first).toContain("The person's command and its output (exit 0):")
  expect(first).toContain('!echo hello')
  expect(first).toContain('hello')
  expect(first.endsWith('Look at this.')).toBe(true)
  const after = entries.map((entry) => ({ ...entry, carried: true }))
  expect(commandsStillToCarry(after)).toEqual([])
  expect(promptWithCommands('Next.', after)).toBe('Next.')
})

it('waits out a command that is still running, and says when one was stopped', () => {
  expect(promptWithCommands('Wait.', [ran({ running: true, output: '' })])).toBe('Wait.')
  const stopped = promptWithCommands('After.', [ran({ stopped: true, exitCode: null, output: 'partial', omitted: 'Left out 3 lines from the start.' })])
  expect(stopped).toContain('stopped before it finished')
  expect(stopped).toContain('partial')
  expect(stopped).toContain('Left out 3 lines from the start.')
})

it('leaves a message alone when there is nothing to carry', () => {
  expect(promptWithCommands('Only this.', [])).toBe('Only this.')
})
