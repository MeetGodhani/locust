import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate } from '../shared/ipc.js'
import { createRelay } from './relay.js'
import type { RelayOptions, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/*
 * From the bug hunt of 2026-10-12 (round 2, on 0.750), its proof test for RL2, kept as a test of the fix in 0.753.
 *
 * RL2: last round's RL1 fix (heldAlso) tells a second thread waiting on one held reply how that reply ENDED, and when
 * the switch or the cap refuses it. When the held reply cannot START -- the start throws, or answers with any refusal
 * but RUN_ALREADY_ACTIVE (a spend limit, a missing runtime) -- startFor tells the first thread only, and heldAlso is
 * dropped: the second thread hears nothing, ever.
 */
const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const JUNO = { teammateId: 'tm_juno', name: 'Juno', role: 'Research & Briefs' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', role: 'Custom' }
const BOOTY_ROUTE = { runtime: 'claude' as const, model: 'sonnet', mode: 'ask' as const }
const wrenPeer: MissionPeerContext = { self: WREN, others: [BOOTY, JUNO] }
const junoPeer: MissionPeerContext = { self: JUNO, others: [BOOTY, WREN] }
const bootyPeer: MissionPeerContext = { self: { ...BOOTY, route: BOOTY_ROUTE }, others: [WREN, JUNO] }

const BUSY: CodexMissionStartResponse = { ok: false, error: { code: 'RUN_ALREADY_ACTIVE', message: 'Booty already has a mission running.' } }
const OVER_LIMIT: CodexMissionStartResponse = { ok: false, error: { code: 'SPEND_LIMIT_REACHED', message: 'Booty has reached the monthly limit.' } }

function message(from: { teammateId: string; name: string }, missionId: string, text: string): WorkroomMessage {
  return { messageId: `msg_${missionId}`, from: { ...from, missionId }, to: BOOTY, text, postedAt: '2026-10-12T10:00:00.000Z', sequence: 1 } as WorkroomMessage
}
const sharing = (peer: MissionPeerContext, missionId: string, runId: string): SharingMission =>
  ({ runId, missionId, runtime: 'cursor', sandbox: 'workspace-write', model: 'composer-2.5', peer, relay: undefined })

function harness(startResults: readonly (CodexMissionStartResponse | 'throw')[]) {
  const starts: Parameters<RelayOptions['start']>[0][] = []
  const notices: CodexMissionUpdate[] = []
  const relay = createRelay({
    enabled: async () => true,
    peerContextFor: async (id) => (id === BOOTY.teammateId ? bootyPeer : id === WREN.teammateId ? wrenPeer : id === JUNO.teammateId ? junoPeer : undefined),
    start: async (input) => {
      starts.push(input)
      const result = startResults[starts.length - 1]
      if (result === 'throw') throw new Error('spawn failed')
      return result ?? {
        ok: true,
        data: { runId: `run_${String(starts.length)}`, missionId: `mission_${String(starts.length)}`, runtime: input.runtime, model: input.model ?? 'account-default', resolvedRouteId: 'claude-account:default', cliVersion: null, sandbox: 'read-only', peerMessages: [], peerDeliveryFailed: false }
      }
    },
    assignOwner: async () => undefined,
    notify: (update) => notices.push(update)
  })
  return { relay, notices }
}
const saidTo = (notices: readonly CodexMissionUpdate[], runId: string): string[] =>
  notices.flatMap((update) => (update.kind === 'relay-notice' && update.runId === runId ? [update.message] : []))

describe('RL2: two teammates wrote to one who was mid-run, and the held reply cannot start', () => {
  it.each([['refused', OVER_LIMIT], ['throws', 'throw']] as const)('the second thread is told too, when the start is %s', async (_how, third) => {
    const { relay, notices } = harness([BUSY, BUSY, third])
    await relay.onShared(sharing(wrenPeer, 'mission_wren1', 'run_wren1'), [message(WREN, 'mission_wren1', 'What is the build command?')])
    await relay.onShared(sharing(junoPeer, 'mission_juno1', 'run_juno1'), [message(JUNO, 'mission_juno1', 'Which sources did you use?')])
    await relay.onRunEnded({ missionId: 'mission_booty', peer: bootyPeer, relay: undefined })
    // The first thread hears why (control):
    expect(saidTo(notices, 'run_wren1').some((line) => line.includes('could not reply'))).toBe(true)
    // ...and so must the second.
    expect(saidTo(notices, 'run_juno1').some((line) => line.includes('could not reply'))).toBe(true)
  })
})
