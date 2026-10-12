import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicTeammate } from '../../shared/ipc.js'
import type { AwaySummary } from '../../shared/away.js'
import { AwayList } from './components/AwayList.js'
import { lastSaid } from './finishedToast.js'

/*
 * 0.758. Colin, 2026-10-12, of the overnight polish that fixed six checks and found a bug while he was out: "how does
 * the user see this, i had no idea this even happened". Home's "Since you were away" said only that a routine had run
 * and when; what it came to was a press away. Each row now says it in a line: the answer's first line, or why it
 * failed.
 */
const NOW = new Date('2026-10-12T13:00:00.000Z')
const teammates = [{ teammateId: 'tm_polish', name: 'Polish' }] as unknown as PublicTeammate[]
const summary: AwaySummary = {
  since: '2026-10-12T03:00:00.000Z',
  ran: [{ missionId: 'm_polish', title: 'Polish overnight', at: '2026-10-12T06:12:00.000Z', ownerId: 'tm_polish', routineId: 'rt_polish' }],
  failed: [{ missionId: 'm_tests', title: 'Run the nightly tests', at: '2026-10-12T04:00:00.000Z' }],
  missed: [],
  waiting: 0
}
const SAID: Record<string, string> = {
  m_polish: 'Fixed 6 checks that had gone stale and found one real bug; the fixes wait in a copy for you to keep.',
  m_tests: "OpenCode's service refused the free model, so OpenCode stopped."
}
const draw = (saidOf?: (missionId: string) => string | undefined): string =>
  renderToStaticMarkup(<AwayList summary={summary} teammates={teammates} onOpen={() => undefined} onSeen={() => undefined} now={NOW} {...(saidOf === undefined ? {} : { saidOf })} />)

describe('a row on Home for a run that ended while you were away', () => {
  it('says what the run came to under its title: what it did, or why it failed', () => {
    const html = draw((missionId) => SAID[missionId])
    expect(html).toContain('<span class="lc-away__said">Fixed 6 checks that had gone stale and found one real bug; the fixes wait in a copy for you to keep.</span>')
    expect(html).toContain(`<span class="lc-away__said">OpenCode&#x27;s service refused the free model, so OpenCode stopped.</span>`)
    expect(html.indexOf('Polish overnight')).toBeLessThan(html.indexOf('Fixed 6 checks'))
  })

  it('and says nothing more when there is nothing to say', () => {
    expect(draw()).not.toContain('lc-away__said')
    expect(draw(() => undefined)).not.toContain('lc-away__said')
  })

  it("takes the answer's first line from the run's final reply", () => {
    const events = [
      { type: 'message.delta', occurredAt: '2026-10-12T06:11:00.000Z', payload: { itemId: 'a', text: 'Looking at the sweep.', final: true } },
      { type: 'message.delta', occurredAt: '2026-10-12T06:12:00.000Z', payload: { itemId: 'b', text: '\nFixed 6 checks that had gone stale.\nThe report is in POLISH-REPORT.md.', final: true } }
    ] as unknown as NormalizedRuntimeEvent[]
    expect(lastSaid(events)).toBe('Fixed 6 checks that had gone stale.')
  })
})
