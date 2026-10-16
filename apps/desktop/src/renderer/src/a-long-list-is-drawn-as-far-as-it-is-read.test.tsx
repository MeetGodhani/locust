import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { LIST_PAGE } from './components/ListWindow.js'

/*
 * A LONG LIST IS DRAWN AS FAR AS IT IS READ (review 2026-10-15, P1 and P2). Every row used to be mounted: a reply
 * streamed at 7.5 fps with 667 conversations listed, and clearing a search froze the window for 6.9 s. The list now
 * draws a page and the rest as it is scrolled, says how many it has not drawn, and always draws the one open.
 */
const row = (index: number): SidebarMission =>
  ({ missionId: `m_${String(index)}`, title: `Conversation ${String(index)}`, phase: 'completed', integrityIssueCount: 0, lastAt: new Date(Date.UTC(2026, 9, 15) - index * 60_000).toISOString() }) as SidebarMission
const noop = (): void => undefined
const sidebar = (missions: readonly SidebarMission[], selectedMissionId?: string): string =>
  renderToStaticMarkup(
    <Sidebar
      runtimes={[]}
      missions={missions}
      teammates={[]}
      viewByTeammate={{}}
      routineStepByTeammate={{}}
      missionOwners={{}}
      selectedMissionId={selectedMissionId}
      selectedTeammateId={undefined}
      onSelectMission={noop}
      onMissionMenu={noop}
      onTeammateMenu={noop}
      pendingApprovals={{}}
      liveActivity={{}}
      starting={[]}
      recentlyDone={[]}
      recentlyReceived={[]}
      onSelectTeammate={noop}
      onNewConversationWith={noop}
      onOpenHub={noop}
      onAddMenu={noop}
      composerShown={false}
      onOpenSettings={noop}
      onOpenMissions={noop}
      onOpenTeammates={noop}
      rooms={[]}
      routines={[]}
      currentRoomId={undefined}
      onOpenRoom={noop}
      onOpenRooms={noop}
      onOpenAutomations={noop}
      onHome={noop}
      groups={[]}
    />
  )
const rowsIn = (html: string): number => html.split('class="lc-convrow"').length - 1

describe('a long list', () => {
  const many = Array.from({ length: 300 }, (_, index) => row(index))

  it('draws one page, newest first, and says how many more there are', () => {
    const html = sidebar(many)
    expect(rowsIn(html)).toBe(LIST_PAGE)
    expect(html).toContain('>Conversation 0<')
    expect(html).not.toContain(`>Conversation ${String(LIST_PAGE)}<`)
    expect(html).toContain(`${String(300 - LIST_PAGE)} more conversations`)
  })

  it('always draws far enough to hold the one open', () => {
    const html = sidebar(many, 'm_200')
    expect(rowsIn(html)).toBe(201)
    expect(html).toContain('>Conversation 200<')
    expect(html).toContain('99 more conversations')
  })

  it('is drawn whole when it fits in a page, with nothing more to say', () => {
    const html = sidebar(many.slice(0, 12))
    expect(rowsIn(html)).toBe(12)
    expect(html).not.toContain('more conversation')
  })
})
