import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SavedCall } from '../../shared/calls.js'
import { seedAvatar } from '../../shared/avatar.js'
import { CallWords } from './components/CallWords.js'

/*
 * WHAT WAS SAID ON A CALL, IN THE THREAD (0.747): live, it opens with its divider and grows; ended, it folds to one
 * line that says how long and how much, and opens to every word.
 */
const call = (overrides: Partial<SavedCall> = {}): SavedCall => ({
  callId: 'call_1', teammateId: 'tm_ada', name: 'Ada', afterMissionId: 'm_typed', startedAt: 1_000, endedAt: 104_000,
  lines: [
    { role: 'you', text: 'Ada, check the readme for the secret ingredient.', at: 10_000 },
    { role: 'voice', text: 'Let me check.', at: 12_000 },
    { role: 'you', text: 'So what did you find?', at: 60_000 },
    { role: 'voice', text: 'It is cardamom.', at: 62_000 }
  ],
  turns: [{ missionId: 'm_asked', at: 20_000 }],
  ...overrides
})

describe('the call in the thread', () => {
  const ada = { teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', avatar: seedAvatar('tm_ada'), createdAt: '2026-10-11' } as const
  const piece = (live: boolean) => ({ call: call(), lines: call().lines.slice(0, 2), first: true, last: true, live })

  it('live: opens with its divider and your words and theirs, each marked as said', () => {
    const html = renderToStaticMarkup(createElement(CallWords, { piece: piece(true), teammate: ada, open: false, onToggle: () => undefined }))
    expect(html).toContain('Call with Ada')
    expect(html).toContain('Ada, check the readme for the secret ingredient.')
    expect(html).toContain('Let me check.')
    expect(html.match(/Said</g)).toHaveLength(2)
    expect(html).not.toContain('Call ended')
  })

  it('ended: folds to one line that says how long and how much, and opens to every word', () => {
    const shut = renderToStaticMarkup(createElement(CallWords, { piece: piece(false), teammate: ada, open: false, onToggle: () => undefined }))
    expect(shut).toContain('Call with Ada · 1:43')
    expect(shut).toContain('4 lines said · asked Ada 1 time')
    expect(shut).toContain('Show what was said')
    expect(shut).not.toContain('Let me check.')
    const opened = renderToStaticMarkup(createElement(CallWords, { piece: piece(false), teammate: ada, open: true, onToggle: () => undefined }))
    expect(opened).toContain('Let me check.')
    expect(opened).toContain('Call ended · 1:43')
    expect(opened).toContain('Hide')
  })
})
