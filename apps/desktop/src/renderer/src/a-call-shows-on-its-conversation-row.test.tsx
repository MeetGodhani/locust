import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { liveCallPlace, setLiveCall, type LiveCall } from './liveCall.js'

/*
 * ON A CALL, SAID ON ITS ROW (0.750). The canvas's sidebar read "Fix the doubled cart total · On a call": the
 * conversation a call with a teammate is in says so in the list, where its age would be, for as long as the call is
 * on -- found by any of the turns the row stands for.
 */
const wren = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-11T05:00:00.000Z', avatar: seedAvatar('tm_wren') } as PublicTeammate
const row = (missionId: string, extra: Partial<SidebarMission> = {}): SidebarMission =>
  ({ missionId, title: `Conversation ${missionId}`, phase: 'completed', integrityIssueCount: 0, lastAt: '2026-10-11T05:00:00.000Z', ...extra }) as SidebarMission
const noop = (): void => undefined

function sidebar(missions: readonly SidebarMission[]): string {
  return renderToStaticMarkup(
    <Sidebar
      runtimes={[]} missions={missions} teammates={[wren]} viewByTeammate={{}} routineStepByTeammate={{}}
      missionOwners={Object.fromEntries(missions.map((mission) => [mission.missionId, 'tm_wren']))}
      selectedMissionId={undefined} selectedTeammateId={undefined} onSelectMission={noop} onMissionMenu={noop}
      onTeammateMenu={noop} pendingApprovals={{}} liveActivity={{}} starting={[]} recentlyDone={[]} recentlyReceived={[]}
      onSelectTeammate={noop} onNewConversationWith={noop} onOpenHub={noop} onAddMenu={noop} composerShown={false}
      onOpenSettings={noop} onOpenMissions={noop} onOpenTeammates={noop} rooms={[]} routines={[]} currentRoomId={undefined}
      onOpenRoom={noop} onOpenRooms={noop} onOpenAutomations={noop} onHome={noop} groups={[]}
    />
  )
}

const call = (overrides: Partial<LiveCall> = {}): LiveCall => ({
  callId: 'call_1', teammateId: 'tm_wren', name: 'Wren', startedAt: 1_000, afterMissionId: 'm_typed',
  lines: [], turns: [{ missionId: 'm_asked', at: 2_000 }], phase: 'live', partial: { you: '', voice: '' }, ...overrides
})

describe('a call on its conversation row', () => {
  afterEach(() => { setLiveCall(undefined) })

  it('says "on a call" on the row whose turns the call is among, and on no other', () => {
    setLiveCall(call())
    const html = sidebar([row('m_asked', { memberIds: ['m_typed', 'm_asked'] }), row('m_other')])
    expect(html.match(/>on a call<\/span>/g)).toHaveLength(1)
    expect(html.indexOf('on a call')).toBeLessThan(html.indexOf('Conversation m_other'))
  })

  it('is gone once the call has ended, and was never there without one', () => {
    expect(sidebar([row('m_asked', { memberIds: ['m_typed', 'm_asked'] })])).not.toContain('on a call')
    setLiveCall(call({ phase: 'ended' }))
    expect(sidebar([row('m_asked', { memberIds: ['m_typed', 'm_asked'] })])).not.toContain('on a call')
  })

  it('keys the call by where it is, not by what is being said', () => {
    setLiveCall(call())
    const before = liveCallPlace()
    setLiveCall(call({ partial: { you: 'and one more thing', voice: '' }, lines: [{ role: 'you', text: 'Hi', at: 3_000 }] }))
    expect(liveCallPlace()).toBe(before)
    expect(before).toBe('m_typed m_asked')
  })
})
