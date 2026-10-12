import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SavedCall } from '../../shared/calls.js'
import { seedAvatar } from '../../shared/avatar.js'
import { CallWords, type CallPieceShown } from './components/CallWords.js'
import { answerLiveCallAsk, keptCall, setLiveCallAnswer, type LiveCall, type LiveCallAsk } from './liveCall.js'

/*
 * ALLOW IS A CARD IN THE THREAD (0.749). Canvas board 2, "Waiting on you": on a call with a teammate, a connector that
 * would send or change something asks on the same card as every other approval in Locust, in the conversation where
 * the call is -- each value it would send on its own row -- and only the card's Allow once allows it.
 */
const ada = { teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', avatar: seedAvatar('tm_ada'), createdAt: '2026-10-11' } as const
const call: SavedCall = {
  callId: 'call_3', teammateId: 'tm_ada', name: 'Ada', startedAt: 1_000,
  lines: [{ role: 'you', text: 'Yes, send it.', at: 5_000 }], turns: []
}
const note: LiveCallAsk = { id: 'ask_1', what: 'locust probe: send note', detail: 'text: hello', fields: [{ name: 'text', value: 'hello' }] }
const piece = (overrides: Partial<CallPieceShown> = {}): CallPieceShown => ({ call, lines: call.lines, first: true, last: true, live: true, asks: [note], ...overrides })
const draw = (shown: CallPieceShown): string => renderToStaticMarkup(createElement(CallWords, { piece: shown, teammate: ada, open: false, onToggle: () => undefined }))

describe('a connector asking on a call with a teammate', () => {
  afterEach(() => { setLiveCallAnswer(undefined) })

  it('is an approval card under what was said: the action, each value, what leaves, and Allow once or Deny', () => {
    const html = draw(piece())
    expect(html).toContain('Approval required — exact action')
    expect(html).toContain('On the call with Ada')
    expect(html).toContain('locust probe: send note')
    // The value it would send, on its own row, named as a person reads it.
    expect(html).toMatch(/<dt>Text<\/dt><dd>hello<\/dd>/)
    expect(html).toContain('The input above, to the service the connector reaches')
    expect(html).toContain('Locust cannot undo what happens there')
    expect(html).toContain('Allow once')
    expect(html).toContain('Deny')
    expect(html).toContain('Saying yes on the call does not allow it')
    expect(html).toContain('data-call-ask="ask_1"')
    expect(html.indexOf('Yes, send it.')).toBeLessThan(html.indexOf('Approval required'))
  })

  it('says what it would do when Codex named no values, and asks nothing once the call has ended', () => {
    expect(draw(piece({ asks: [{ ...note, fields: [] }] }))).toContain('text: hello')
    expect(draw(piece({ live: false }))).not.toContain('Approval required')
    expect(draw(piece({ last: false }))).not.toContain('Approval required')
  })

  it('answers through the call that is on, and only through it', async () => {
    expect(await answerLiveCallAsk('ask_1', true)).toBe(false)
    const answer = vi.fn(async () => undefined)
    setLiveCallAnswer(answer)
    expect(await answerLiveCallAsk('ask_1', false)).toBe(true)
    expect(answer).toHaveBeenCalledWith('ask_1', false)
    setLiveCallAnswer(async () => { throw new Error('the call is gone') })
    expect(await answerLiveCallAsk('ask_1', true)).toBe(false)
  })

  it('is never kept with the call', () => {
    const live: LiveCall = { ...call, phase: 'live', partial: { you: '', voice: '' }, asks: [note] }
    expect(keptCall(live, {}, 9_000)).not.toHaveProperty('asks')
  })
})
