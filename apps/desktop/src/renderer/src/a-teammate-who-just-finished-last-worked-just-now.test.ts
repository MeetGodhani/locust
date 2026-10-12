import { describe, expect, it } from 'vitest'

import { liveRunLastAt } from './conversationList.js'
import { lastWorkedPhrase } from './homeTeamState.js'

/*
 * The 0.755 sweep's drive-the-team-cards-say-their-state, read by the overnight polish (2026-10-12): Wren finished a
 * run of about two minutes, and her card's hover said "last worked 1 minute ago" -- her conversation in the window
 * was dated by when it was sent, until the window read the ledger back. A person who watched her finish and hovered
 * her card was told she had stopped a while ago.
 */
const SENT = '2026-10-12T15:00:00.000Z'
const ENDED = '2026-10-12T15:02:10.000Z'
const event = (occurredAt: string) => ({ occurredAt })

describe('a teammate who just finished', () => {
  it('last worked just now: her conversation is dated by its newest event, not by when it was sent', () => {
    const run = { startedAtIso: SENT, events: [event('2026-10-12T15:00:02.000Z'), event('2026-10-12T15:01:30.000Z'), event(ENDED)] }
    expect(liveRunLastAt(run)).toBe(ENDED)
    expect(lastWorkedPhrase(liveRunLastAt(run), new Date('2026-10-12T15:02:20.000Z'))).toBe('last worked just now')
    // What it said before: dated by the send.
    expect(lastWorkedPhrase(SENT, new Date('2026-10-12T15:02:20.000Z'))).toBe('last worked 2 minutes ago')
  })

  it('is dated by when it was sent before anything has happened, and by the ledger for a run it restored', () => {
    expect(liveRunLastAt({ startedAtIso: SENT, events: [] })).toBe(SENT)
    expect(liveRunLastAt({ events: [], restoredMission: { lastUpdatedAt: ENDED } })).toBe(ENDED)
    expect(liveRunLastAt({ events: [] })).toBeUndefined()
  })
})
