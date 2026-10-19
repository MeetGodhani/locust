import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { stepConversation } from './conversationSteps.js'

/**
 * ALT AND AN ARROW MOVE BETWEEN CONVERSATIONS (2026-10-19, from OpenCode 2's "Option+Up/Down to move between session
 * tabs, or add Shift to jump between unread tabs", and Slack's channels). Locust had no key for the next
 * conversation: the sidebar was the only way to move.
 */
describe('Alt and an arrow', () => {
  const drawn = ['a', 'b', 'c', 'd']

  it('open the next and the previous conversation as the sidebar draws them, round from the end', () => {
    expect(stepConversation(drawn, 'b', 1)).toBe('c')
    expect(stepConversation(drawn, 'b', -1)).toBe('a')
    expect(stepConversation(drawn, 'd', 1)).toBe('a')
    expect(stepConversation(drawn, 'a', -1)).toBe('d')
  })

  it('start at the top, or the bottom, when none of them is on screen', () => {
    expect(stepConversation(drawn, undefined, 1)).toBe('a')
    expect(stepConversation(drawn, undefined, -1)).toBe('d')
    expect(stepConversation(drawn, 'not-drawn', 1)).toBe('a')
  })

  it('with Shift, pass over every conversation that is not waiting for you', () => {
    const waiting = new Set(['a', 'd'])
    expect(stepConversation(drawn, 'b', 1, (id) => waiting.has(id))).toBe('d')
    expect(stepConversation(drawn, 'd', 1, (id) => waiting.has(id))).toBe('a')
    expect(stepConversation(drawn, 'b', -1, (id) => waiting.has(id))).toBe('a')
  })

  it('move nowhere when there is nowhere to go', () => {
    expect(stepConversation([], undefined, 1)).toBeUndefined()
    expect(stepConversation(['a'], 'a', 1)).toBeUndefined()
    expect(stepConversation(drawn, 'b', 1, () => false)).toBeUndefined()
    expect(stepConversation(drawn, 'b', 1, (id) => id === 'b')).toBeUndefined()
  })

  it('are wired: each sidebar row carries its id, and the window opens the step it finds', () => {
    const sidebar = readFileSync(join(import.meta.dirname, 'components', 'Sidebar.tsx'), 'utf8')
    expect(sidebar).toMatch(/className=\{`lc-conv[\s\S]{0,400}data-mission-id=\{mission\.missionId\}/)
    const app = readFileSync(join(import.meta.dirname, 'App.tsx'), 'utf8')
    expect(app).toMatch(/event\.altKey && !accel && \(event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'\)/)
    expect(app).toMatch(/openMissionRef\.current\(next\)/)
  })
})
