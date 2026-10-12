import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Thread } from './components/Thread.js'

/*
 * WHERE A CONVERSATION BEGAN, SAID ONCE AT ITS TOP (0.748, made true in 0.750). "Started from a voice call" names the
 * conversation's FIRST turn's origin. A conversation the person typed, that a call joined later, is not marked as
 * started from the call: the call has its own line where it joined. 0.748 read the first turn's origin with `??` and
 * fell through to the newest turn's -- the call's -- when the person had typed the first, so the marker stayed; its
 * test pinned that line of source and passed. This one draws the thread.
 */
type Turn = { readonly missionId: string; readonly prompt: string; readonly events: never; readonly startedBy?: { readonly kind: 'mcp'; readonly via?: 'voice' } }
const voice = { kind: 'mcp', via: 'voice' } as const
const turn = (missionId: string, startedBy?: typeof voice): Turn =>
  ({ missionId, prompt: `Turn ${missionId}.`, events: [] as never, ...(startedBy === undefined ? {} : { startedBy }) })
const thread = (earlierTurns: readonly Turn[], startedBy?: typeof voice): string =>
  renderToStaticMarkup(
    <Thread
      prompt="The turn now."
      onOpenPeerRun={() => undefined}
      earlierTurns={earlierTurns as never}
      events={[{ type: 'message.delta', payload: { itemId: 'now', text: 'The answer now.', final: true } }] as never}
      running={false}
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
      shownMissionId="m_now"
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
      {...(startedBy === undefined ? {} : { startedBy })}
      runMode="accept-edits"
    />
  )

describe('"Started from a voice call", at the top of a conversation', () => {
  it('is not said of a conversation the person typed, that a call joined later', () => {
    expect(thread([turn('m_typed')], voice)).not.toContain('Started from a voice call')
    expect(thread([turn('m_typed'), turn('m_asked', voice)], voice)).not.toContain('Started from a voice call')
  })

  it('is said of one a call began, however many turns follow, and of a call that is its only turn', () => {
    expect(thread([turn('m_called', voice)])).toContain('Started from a voice call')
    expect(thread([turn('m_called', voice), turn('m_typed')], voice)).toContain('Started from a voice call')
    expect(thread([], voice)).toContain('Started from a voice call')
  })

  it('is never said of a conversation with no call in it', () => {
    expect(thread([turn('m_one'), turn('m_two')])).not.toContain('Started from')
    expect(thread([])).not.toContain('Started from')
  })
})
