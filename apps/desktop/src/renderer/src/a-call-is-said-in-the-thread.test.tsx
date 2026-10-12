import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SavedCall } from '../../shared/calls.js'
import { MAX_CALL_TURNS, callPlacements, isSavedCall } from '../../shared/calls.js'
import { seedAvatar } from '../../shared/avatar.js'
import { CallWords } from './components/CallWords.js'
import { keptCall, type LiveCall } from './liveCall.js'

/*
 * THE LAST WORDS ARE KEPT (0.748): a call that ends while one of you is still talking keeps those words, placed from
 * when they began -- the voice's answer cut off by End is still what it said.
 */
describe('a call that ends mid-sentence', () => {
  const live: LiveCall = {
    callId: 'call_2', teammateId: 'tm_ada', name: 'Ada', startedAt: 1_000, phase: 'live',
    lines: [{ role: 'you', text: 'What is the secret ingredient?', at: 5_000 }],
    turns: [{ missionId: 'm_asked', at: 6_000 }],
    partial: { you: '  ', voice: ' It is cardamom, and ' }
  }

  it('keeps the words still being said, from when they began, and nothing blank', () => {
    const kept = keptCall(live, { voice: 9_000, you: 9_500 }, 12_000)
    expect(kept.lines).toEqual([...live.lines, { role: 'voice', text: 'It is cardamom, and', at: 9_000 }])
    expect(kept.endedAt).toBe(12_000)
    expect(kept).not.toHaveProperty('phase')
    expect(kept).not.toHaveProperty('partial')
    const [after] = callPlacements([kept], ['m_asked']).get('after:m_asked') ?? []
    expect(after?.lines.map((line) => line.text)).toEqual(['It is cardamom, and'])
  })

  it('stamps cut-off words with the end when nothing says when they began', () => {
    expect(keptCall({ ...live, partial: { you: 'Thanks', voice: '' } }, {}, 12_000).lines.at(-1)).toEqual({ role: 'you', text: 'Thanks', at: 12_000 })
  })
})

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

/*
 * A LONG CALL IS STILL KEPT (0.753, bug hunt 2026-10-12, TK1): a saved call holds at most 40 turns, and a call that asked
 * the teammate a 41st time was refused whole -- every word said on it lost, with nothing said. The first 40 are kept;
 * what was said after the 40th sits under it.
 */
describe('a call that asked more than 40 times', () => {
  it('is kept, with its first 40 turns and every line', () => {
    const turns = Array.from({ length: 41 }, (_, index) => ({ missionId: `m_${String(index)}`, at: 2_000 + index * 1_000 }))
    const live: LiveCall = { callId: 'call_long', teammateId: 'tm_ada', name: 'Ada', startedAt: 1_000, phase: 'live', partial: { you: '', voice: '' },
      lines: [{ role: 'you', text: 'And one more.', at: 60_000 }], turns }
    const kept = keptCall(live, {}, 70_000)
    expect(kept.turns).toHaveLength(MAX_CALL_TURNS)
    expect(isSavedCall(kept)).toBe(true)
    expect(callPlacements([kept], turns.map((turn) => turn.missionId)).get('after:m_39')?.[0]?.lines.map((line) => line.text)).toEqual(['And one more.'])
  })
})

