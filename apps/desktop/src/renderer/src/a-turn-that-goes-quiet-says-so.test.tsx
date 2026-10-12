import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { Thread } from './components/Thread.js'
import { quietMinutes } from './quiet.js'

/*
 * 0.758. The 0.755 sweep's drive-queue-after-a-turn: Wren answered "ONE", then the free model opened Notepad on the
 * file it had written, and the turn waited on it. The line said "Working… 6m 8s", and the same for forty minutes,
 * with nothing to tell a hung turn from one at work (Colin, 2026-10-12: "do we do a good job at keeping the user in
 * the loop as work is done?"). Five quiet minutes now say so, with Stop beside them.
 */
const NOW = Date.now()
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()
let sequence = 0
const event = (type: string, minutesAgo: number, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`,
    runId: 'r',
    missionId: 'm',
    sequence,
    occurredAt: ago(minutesAgo),
    sourceAdapter: 'opencode',
    type,
    payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

const live = (events: readonly NormalizedRuntimeEvent[], onStopRun?: () => void): string =>
  renderToStaticMarkup(
    <Thread
      prompt="Create notes/a.txt containing the word ALPHA. Then say ONE."
      onOpenPeerRun={() => undefined}
      earlierTurns={[]}
      events={events}
      running
      startedAtIso={ago(10)}
      restoredMission={undefined}
      error={undefined}
      errorIsPersistence={false}
      startedAt={undefined}
      approvals={[]}
      onDecide={() => undefined}
      onAnswerQuestion={() => undefined}
      decidingIds={[]}
      cancelled={false}
      handoff={undefined}
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
      {...(onStopRun === undefined ? {} : { onStopRun })}
    />
  )

describe('a turn that goes quiet', () => {
  it('says so after five minutes without a word, with Stop beside it', () => {
    const markup = live([
      event('run.started', 10, {}),
      event('message.delta', 7, { itemId: 'm1', text: 'ONE', final: true })
    ], () => undefined)
    expect(markup).toContain('no word for 7 min')
    expect(markup).toMatch(/<button type="button" class="lc-linkbutton lc-livestep__stop">Stop<\/button>/)
  })

  it('says nothing while the turn is heard from, or while a command it named runs', () => {
    expect(live([event('run.started', 10, {}), event('message.delta', 1, { itemId: 'm1', text: 'Working on it', final: true })], () => undefined)).not.toContain('no word for')
    // A command running for seven minutes: its line names what runs, and a test suite may take ten.
    expect(live([event('run.started', 10, {}), event('tool.started', 7, { itemId: 'c1', toolKind: 'tool_use', name: 'Bash', phase: 'started' })], () => undefined)).not.toContain('no word for')
  })

  it('counts whole minutes from when it was last heard, and only once there are five', () => {
    expect(quietMinutes(ago(4.9), NOW)).toBeUndefined()
    expect(quietMinutes(ago(5), NOW)).toBe(5)
    expect(quietMinutes(ago(42.5), NOW)).toBe(42)
    expect(quietMinutes(undefined, NOW)).toBeUndefined()
    expect(quietMinutes('not a time', NOW)).toBeUndefined()
  })
})
