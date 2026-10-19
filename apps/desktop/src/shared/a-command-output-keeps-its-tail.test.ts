import { expect, it } from 'vitest'
import { COMMAND_OUTPUT_MAX_BYTES, COMMAND_OUTPUT_MAX_LINES, capCommandOutput } from './own-commands.js'

it('keeps the last 200 lines and says how many were left out', () => {
  const raw = Array.from({ length: 250 }, (_, index) => `line ${String(index + 1)}`).join('\n')
  const capped = capCommandOutput(raw)
  expect(capped.text.startsWith('line 51')).toBe(true)
  expect(capped.text.endsWith('line 250')).toBe(true)
  expect(capped.text.split('\n')).toHaveLength(COMMAND_OUTPUT_MAX_LINES)
  expect(capped.omittedLines).toBe(50)
  expect(capped.note).toContain('50 lines')
  expect(capped.note).toContain('from the start')
})

it('keeps the last 32 KB when one line is longer than that', () => {
  const capped = capCommandOutput('x'.repeat(COMMAND_OUTPUT_MAX_BYTES + 4096))
  expect(new TextEncoder().encode(capped.text).length).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES)
  expect(capped.omittedBytes).toBeGreaterThan(0)
  expect(capped.note).toContain('KB')
  expect(capped.note).toContain('from the start')
})

it('leaves a short command untouched', () => {
  const capped = capCommandOutput('hello\n')
  expect(capped.text).toBe('hello\n')
  expect(capped.note).toBeUndefined()
})
