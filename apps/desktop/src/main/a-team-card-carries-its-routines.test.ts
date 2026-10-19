import { describe, expect, it } from 'vitest'

import type { PublicRoutine, PublicTeammate } from '../shared/ipc.js'
import { seedAvatar } from '../shared/avatar.js'
import { readTeamCard, readTeamCardRoutines, teamCardOf } from '../shared/team-card.js'
import { cardRoutineFile, teamCardRoutines } from './team-card-routines.js'

/**
 * A TEAM CARD CARRIES WHAT THE TEAM KNOWS AND DOES (0.802). A card made the same faces and nothing else; now each
 * teammate's instructions and starters come along, and the team's routines as routine files, read on the way in as
 * an imported routine file is.
 */
const mate = (overrides: Partial<PublicTeammate>): PublicTeammate => ({
  teammateId: 'tm_wren',
  name: 'Wren',
  role: 'Code & Migrations' as PublicTeammate['role'],
  hue: 'lime',
  avatar: seedAvatar('tm_wren'),
  createdAt: '2026-10-19T05:00:00.000Z',
  ...overrides
})
const routine = (overrides: Partial<PublicRoutine>): PublicRoutine => ({
  routineId: 'rt_1',
  name: 'Weekly report',
  teammateId: 'tm_wren',
  route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' },
  steps: ['Read C:\\Users\\someone\\notes\\week.md and write a summary of it.'],
  learnedFrom: ['mission_1'],
  createdAt: '2026-10-19T05:00:00.000Z',
  runs: 4,
  workspaceId: 'ws_here',
  ...overrides
} as PublicRoutine)

describe('a team card', () => {
  it('carries each teammate\'s instructions and starters, and still no id, folder, limit or branch', () => {
    const card = teamCardOf([mate({ instructions: 'Always write tests first.', starters: ['Find the riskiest file.'], monthlyLimitUsd: 20, worktree: true, folder: 'C:\\x' } as Partial<PublicTeammate>)])
    expect(card.teammates[0]).toMatchObject({ instructions: 'Always write tests first.', starters: ['Find the riskiest file.'] })
    expect(JSON.stringify(card)).not.toMatch(/tm_|monthlyLimitUsd|worktree|folder/)
    expect(teamCardOf([mate({ instructions: '   ' })]).teammates[0]).not.toHaveProperty('instructions')
  })

  it('carries the routines its teammates made in this folder, with this machine\'s paths made into inputs', () => {
    const carried = teamCardRoutines(
      [mate({}), mate({ teammateId: 'tm_juno', name: 'Juno' })],
      [
        routine({}),
        routine({ routineId: 'rt_2', name: 'Elsewhere', workspaceId: 'ws_other' }),
        routine({ routineId: 'rt_3', name: 'Not on the card', teammateId: 'tm_gone' }),
        routine({ routineId: 'rt_4', name: 'Tidy', teammateId: 'tm_juno', steps: ['Tidy the README.'], workspaceId: undefined, schedule: { kind: 'daily', at: '09:00' } } as Partial<PublicRoutine>)
      ],
      { workspaceId: 'ws_here', connectorNames: [] }
    )
    expect(carried.map((entry) => [entry.teammate, (entry.routine as { name: string }).name])).toEqual([[0, 'Weekly report'], [1, 'Tidy']])
    const text = JSON.stringify(carried)
    expect(text).not.toMatch(/someone|rt_|tm_|mission_1|schedule|runs|ws_/)
    expect((carried[0]!.routine as { steps: string[] }).steps[0]).toContain('{{path}}')
  })

  it('reads a routine back only when it is a routine file Locust would import', () => {
    const [entry] = teamCardRoutines([mate({})], [routine({ steps: ['Tidy the README.'] })], { workspaceId: 'ws_here', connectorNames: [] })
    expect(cardRoutineFile(entry!)?.steps).toEqual(['Tidy the README.'])
    expect(cardRoutineFile({ teammate: 0, routine: { format: 'locust-routine', version: 1, name: 'x', steps: [], inputs: [], handOffs: [], route: {}, connectors: [] } })).toBeUndefined()
    expect(cardRoutineFile({ teammate: 0, routine: 'run rm -rf' })).toBeUndefined()
  })

  it('takes a routine only for a teammate on the card, and a card from before has none', () => {
    const card = { schema: 1, teammates: [{ name: 'Wren' }], routines: [{ teammate: 0, routine: {} }, { teammate: 3, routine: {} }, { teammate: -1, routine: {} }, { teammate: 0.5, routine: {} }, 'x'] }
    expect(readTeamCardRoutines(card, readTeamCard(card)!.length).map((entry) => entry.teammate)).toEqual([0])
    expect(readTeamCardRoutines({ schema: 1, teammates: [] }, 0)).toEqual([])
  })
})
