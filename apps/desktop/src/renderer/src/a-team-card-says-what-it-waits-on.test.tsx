import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { HomeTeam } from './components/HomeTeam.js'
import { TeammatesScreen } from './components/Screens.js'
import { Sidebar } from './components/Sidebar.js'
import { waitingLine } from './homeTeamState.js'
import type { NeedsYouItem } from './needsYou.js'

const noop = (): void => undefined
const mate: PublicTeammate = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations', hue: 'lime', avatar: seedAvatar('tm_wren'), createdAt: '2026-10-01T00:00:00.000Z' }
const question: NeedsYouItem = { kind: 'decision', key: 'decision:m_wait', missionId: 'm_wait', teammateId: mate.teammateId, name: mate.name, what: 'How should we handle the two billing paths while we migrate?' }
const approval: NeedsYouItem = { kind: 'approval', key: 'approval:one', missionId: 'm_approval', teammateId: mate.teammateId, name: mate.name, what: 'pnpm test', asking: false, command: true }
const screen = (items: readonly NeedsYouItem[]): string => renderToStaticMarkup(
  <TeammatesScreen teammates={[mate]} missions={[]} missionOwners={{}} spendByTeammate={{}} needsYou={items}
    viewByTeammate={{ tm_wren: { status: 'approval-needed', activity: 'waiting', label: 'Waiting on you', tone: 'amber', pulse: false } }}
    titleOf={() => ''} onOpenMission={noop} onNewTeammate={noop} onEdit={noop} onRemove={noop} onMessage={noop}
    routines={[]} routineStepByTeammate={{}} onRunRoutine={noop} onEditRoutine={noop} onRemoveRoutine={noop} />
)
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8')
const rule = (selector: string): string => css.slice(css.indexOf(`${selector} {`)).split('}')[0]!

describe('a Team card waiting on the person', () => {
  it('uses the same waiting words as Home, for a question, a command and another approval', () => {
    for (const item of [question, approval, { ...approval, command: false, what: 'Read a file' }]) {
      const words = waitingLine(item)!
      const home = renderToStaticMarkup(<HomeTeam team={[{ teammateId: mate.teammateId, name: mate.name, role: mate.role, hue: mate.hue, avatar: mate.avatar, working: false, state: { tone: 'amber', word: 'waiting on you', spoken: 'waiting on you' }, doing: words }]} onMessage={noop} />)
      expect(home).toContain(`title="${words}"`)
      expect(screen([item])).toContain(`class="lc-rostercard__question" title="${words}">${words}</span>`)
    }
  })

  it('keeps Home’s priority, ignores memory and other teammates, and offers one Answer button', () => {
    const html = screen([{ kind: 'memory', key: 'memory', count: 2 }, { ...question, teammateId: 'tm_other' }, approval, question])
    expect(html).toContain('Wants to run pnpm test')
    expect(html).not.toContain(question.what)
    expect(html.match(/class="lc-rostercard__waiting"/g)).toHaveLength(1)
    expect(html).toContain('class="lc-rostercard__answer">Answer ')
    expect(screen([])).not.toContain('lc-rostercard__waiting')
    expect(screen([{ kind: 'memory', key: 'memory', count: 1 }])).not.toContain('lc-rostercard__waiting')
  })

  it('opens the waiting conversation, not whichever conversation was most recent', () => {
    const source = readFileSync(new URL('./components/Screens.tsx', import.meta.url), 'utf8')
    expect(source).toContain('className="lc-rostercard__waiting" onClick={() => onOpenMission(waiting.missionId)}')
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(app.slice(app.indexOf('<TeammatesScreen')).split('/>')[0]).toContain('needsYou={needsYouItems}')
  })

  it('shows up to two lines of the question and leaves the full words available', () => {
    expect(rule('.lc-rostercard__question')).toContain('-webkit-line-clamp: 2')
    expect(rule('.lc-rostercard__question')).toContain('overflow-wrap: anywhere')
    expect(screen([question])).toContain(`title="${question.what}"`)
  })

  it('never cuts off Last run and gives it more space than Runs', () => {
    expect(rule('.lc-rostercard__stats')).toContain('minmax(0, 0.6fr) minmax(0, 1.4fr)')
    const value = rule('.lc-rostercard__stat dd')
    expect(value).not.toMatch(/overflow:\s*hidden|text-overflow:\s*ellipsis|white-space:\s*nowrap/)
    expect(value).toContain('overflow-wrap: anywhere')
  })

  it('leaves the actions visible at rest, and full on hover or keyboard focus', () => {
    expect(rule('.lc-teamboard .lc-rostercard__actions')).toContain('opacity: 0.45')
    expect(css).toContain('.lc-teamboard .lc-rostercard:hover .lc-rostercard__actions,\n.lc-teamboard .lc-rostercard:focus-within .lc-rostercard__actions {\n  opacity: 1;')
  })
})

const sidebar = (screenKey: string): string => renderToStaticMarkup(
  <Sidebar screenKey={screenKey} runtimes={[]} missions={[]} teammates={[mate]} viewByTeammate={{}} routineStepByTeammate={{}}
    missionOwners={{}} selectedMissionId={undefined} selectedTeammateId={undefined} onSelectMission={noop} onMissionMenu={noop}
    onTeammateMenu={noop} pendingApprovals={{}} liveActivity={{}} starting={[]} recentlyDone={[]} recentlyReceived={[]}
    onSelectTeammate={noop} onNewConversationWith={noop} onOpenHub={noop} onAddMenu={noop} composerShown={false}
    onOpenSettings={noop} onOpenMissions={noop} onOpenTeammates={noop} rooms={[]} routines={[]} currentRoomId={undefined}
    onOpenRoom={noop} onOpenRooms={noop} onOpenAutomations={noop} onHome={noop} groups={[]} />
)

describe('the sidebar Team button', () => {
  it('is current only on the Team screen, with the existing selected surface', () => {
    expect(sidebar('teammates')).toContain('class="lc-faces__team" aria-current="page"')
    for (const other of ['workroom', 'missions', 'settings', 'board']) expect(sidebar(other)).not.toContain('aria-current="page"')
    expect(rule(".lc-faces__team[aria-current='page']")).toContain('background: var(--lc-bg-selected)')
    expect(rule(".lc-faces__team[aria-current='page']")).toContain('color: var(--lc-text-primary)')
  })
})
