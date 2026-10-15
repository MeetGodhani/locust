import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { answerOf, phoneConversations, phoneTurns } from '../../shared/phone.js'

/*
 * YOUR PHONE (0.775): the phone lists conversations, not turns -- named by what the person first asked, as the
 * sidebar is -- and never puts the host's words (a carry-on, a handoff brief) in the person's mouth.
 */
let sequence = 0
const said = (missionId: string, text: string, final = true): NormalizedRuntimeEvent => ({
  id: `${missionId}:${String(++sequence)}`, runId: `r-${missionId}`, missionId, sequence, type: 'message.delta',
  occurredAt: '2026-10-15T12:00:00.000Z', sourceAdapter: 'codex',
  payload: { itemId: 'i1', operation: 'append', text, final }
} as unknown as NormalizedRuntimeEvent)

const turn = (missionId: string, at: string, fields: Partial<PublicRecoveredMission> = {}): PublicRecoveredMission => ({
  missionId, runId: `r-${missionId}`, workspaceId: 'w', prompt: `asked in ${missionId}`, runtime: 'codex', model: 'account-default',
  requestedRouteId: 'x', resolvedRouteId: 'x', cliVersion: null, createdAt: at, lastUpdatedAt: at, phase: 'completed',
  events: [said(missionId, `answer of ${missionId}`)], eventCount: 1, eventsTruncated: false, integrityIssueCount: 0,
  sandbox: 'read-only', checkpoints: [], peerMessages: [], ...fields
} as PublicRecoveredMission)

describe('the phone’s conversations', () => {
  const first = turn('a1', '2026-10-15T10:00:00.000Z', { prompt: 'Fix the login bug' })
  const reply = turn('a2', '2026-10-15T10:05:00.000Z', { prompt: 'and add a test', continuesFrom: { missionId: 'a1', checkpointEpoch: 0, reason: 'follow-up' } })
  const carried = turn('a3', '2026-10-15T10:09:00.000Z', {
    runtime: 'opencode', prompt: 'Codex CLI ran out of its plan…', continuesFrom: { missionId: 'a2', checkpointEpoch: 1, reason: 'route-switch' },
    startedBy: { kind: 'carry-on', from: 'codex' }
  })
  const other = turn('b1', '2026-10-15T09:00:00.000Z', { prompt: 'Explain   this\nproject' })
  const side = turn('s1', '2026-10-15T11:00:00.000Z', { startedBy: { kind: 'side', of: 'a1', question: 1 } })

  it('is one row per conversation, newest first, named by the first thing asked', () => {
    const { list } = phoneConversations([other, first, reply, carried, side], ['a3'])
    expect(list.map((row) => [row.missionId, row.title, row.agent, row.phase])).toEqual([
      ['a3', 'Fix the login bug', 'OpenCode', 'running'],
      ['b1', 'Explain this project', 'Codex CLI', 'completed']
    ])
    expect(list[0]!.snippet).toBe('answer of a3')
  })

  it('names the teammate who answered, as the window does', () => {
    const { list, chains } = phoneConversations([first, reply], [], (id) => (id === 'a1' || id === 'a2' ? 'Mira' : undefined))
    expect(list[0]!.agent).toBe('Mira')
    expect(phoneTurns(chains, 'a2', [], () => 'Mira')?.map((row) => row.agent)).toEqual(['Mira', 'Mira'])
  })

  it('shows each turn’s answer, and the person’s words only where the person typed them', () => {
    const { chains } = phoneConversations([first, reply, carried], [])
    expect(phoneTurns(chains, 'a1', [])?.map((row) => [row.asked, row.answer])).toEqual([
      ['Fix the login bug', 'answer of a1'],
      ['and add a test', 'answer of a2'],
      [undefined, 'answer of a3']
    ])
    expect(phoneTurns(chains, 'nobody', [])).toBeUndefined()
  })

  it('reads a streamed answer whole, and one still arriving', () => {
    expect(answerOf([said('m', 'Hel', false), said('m', 'lo.', true)])).toBe('Hello.')
    expect(answerOf([said('m', 'Still writ', false)])).toBe('Still writ')
    expect(answerOf([])).toBeUndefined()
  })
})
