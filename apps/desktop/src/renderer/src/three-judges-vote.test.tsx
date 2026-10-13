import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicCompare } from '../../shared/compare.js'
import { panelPick, panelVote, parseScorecard, type Scorecard } from '../../shared/compare-score.js'
import { CompareView, joinedNames, threeJudges, type CompareColumnView, type ModelChoice } from './components/CompareView.js'

/*
 * THREE JUDGES VOTING (0.765), the canvas "Your Own Benchmark": three judge models check every answer against every
 * point the person wrote, each on its own, and a point counts when two of the three agree. The table shows the vote as
 * a dot a judge; a run again of a benchmark is judged by the same three.
 */
const POINTS = ['Names a price', 'Says which to buy']
const card = (a: readonly boolean[], b: readonly boolean[]): Scorecard => ({
  points: POINTS,
  byJudge: false,
  verdicts: {
    a: a.map((met) => ({ met, why: met ? 'it does' : 'it does not' })),
    b: b.map((met) => ({ met, why: met ? 'it does' : 'it does not' }))
  }
})

describe('three judges, voting', () => {
  it('counts a point met when more of the judges that scored it say met than not', () => {
    const vote = panelVote([card([true, true], [false, true]), card([true, false], [false, true]), card([false, false], [true, true])])!
    expect(vote.verdicts.a?.map((verdict) => verdict?.met)).toEqual([true, false])
    expect(vote.verdicts.a?.map((verdict) => verdict?.votes)).toEqual([{ met: 2, of: 3 }, { met: 1, of: 3 }])
    expect(vote.verdicts.b?.map((verdict) => verdict?.met)).toEqual([false, true])
    expect(vote.verdicts.b?.[1]?.votes).toEqual({ met: 3, of: 3 })
    // The why is an agreeing judge's.
    expect(vote.verdicts.a?.[1]?.why).toBe('it does not')
  })

  it('reads a split of two as not met, and gives no vote to a judge it could not read or that scored other points', () => {
    const other: Scorecard = { ...card([true, true], [true, true]), points: ['Something else', 'And another'] }
    const vote = panelVote([card([true, false], [false, false]), undefined, card([false, false], [false, false]), other])!
    expect(vote.verdicts.a?.[0]).toMatchObject({ met: false, votes: { met: 1, of: 2 } })
    expect(panelVote([undefined, undefined])).toBeUndefined()
  })

  it('reads the judges from their own words, in the scorecard form each was given', () => {
    const said = (a1: string, b1: string): string => [`SCORE A 1: ${a1}. read`, `SCORE B 1: ${b1}. read`, 'SCORE A 2: met. read', 'SCORE B 2: not met. read'].join('\n')
    const cards = [said('met', 'not met'), said('met', 'met'), said('not met', 'not met')].map((text) => parseScorecard(text, ['a', 'b'], POINTS))
    const vote = panelVote(cards)!
    expect(vote.verdicts.a?.[0]).toMatchObject({ met: true, votes: { met: 2, of: 3 } })
    expect(vote.verdicts.b?.[0]).toMatchObject({ met: false, votes: { met: 1, of: 3 } })
  })

  it("names the judges' pick only when most of those that answered agree", () => {
    expect(panelPick(['a', 'a', 'b'], 3)).toBe('a')
    expect(panelPick(['a', 'b', undefined], 3)).toBeUndefined()
    expect(panelPick(['b', 'b'], 2)).toBe('b')
  })

  it('offers each judge a model the others are not, and holds a pick while it is offered', () => {
    const choices: ModelChoice[] = ['x', 'y', 'z', 'w'].map((key) => ({ key, label: key }))
    expect(threeJudges(choices, ['x', undefined, undefined], 3)).toEqual(['x', 'y', 'z'])
    expect(threeJudges(choices, ['x', 'w', undefined], 3)).toEqual(['x', 'w', 'y'])
    // A second judge picked as the first is not asked twice.
    expect(threeJudges(choices, ['x', 'x', undefined], 3)).toEqual(['x', 'y', 'z'])
    expect(threeJudges(choices.slice(0, 2), ['x', undefined, undefined], 3)).toEqual(['x', 'y'])
    // The two beside the first are offered a preferred (free) model first; the first judge stays the one offered.
    const priced: ModelChoice[] = ['codex:sol', 'codex:astra', 'opencode:a-free', 'opencode:b-free'].map((key) => ({ key, label: key }))
    expect(threeJudges(priced, [undefined, undefined, undefined], 3, (key) => key.endsWith('-free'))).toEqual(['codex:sol', 'opencode:a-free', 'opencode:b-free'])
    // With the free models the two compared ones (listed last), the order is kept: they are not made judges first.
    const compared = new Set(['opencode:a-free', 'opencode:b-free'])
    expect(threeJudges(priced, [undefined, undefined, undefined], 3, (key) => key.endsWith('-free') && !compared.has(key))).toEqual(['codex:sol', 'codex:astra', 'opencode:a-free'])
    expect(joinedNames(['Codex', 'Ling 3.1', 'Muse Spark'])).toBe('Codex, Ling 3.1 and Muse Spark')
  })
})

describe('three judges, on screen', () => {
  const compare: PublicCompare = {
    compareId: 'cmp_1',
    prompt: 'Which CRM?',
    createdAt: '2026-10-12T18:00:00.000Z',
    slots: [
      { slot: 'a', route: { runtime: 'opencode', model: 'opencode/space-bunny-free', label: 'Space Bunny' }, missionIds: ['m_a'] },
      { slot: 'b', route: { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', label: 'Muse Spark' }, missionIds: ['m_b'] }
    ],
    judge: { route: { runtime: 'codex', model: 'account-default', label: 'Codex' }, missionIds: ['m_j'], criteria: POINTS.join('\n') }
  }
  const column = (slot: 'a' | 'b', name: string): CompareColumnView => ({
    slot, name, runtime: 'opencode', runtimeName: 'OpenCode',
    turns: [{ missionId: `m_${slot}`, items: [], running: false }], running: false, keepable: true, retryable: false, answer: 'An answer.', state: 'done'
  })
  it('draws each point as the vote, a dot a judge, and names the three', () => {
    const vote = panelVote([card([true, true], [false, true]), card([true, false], [false, true]), card([false, false], [true, true])])!
    const html = renderToStaticMarkup(
      <CompareView
        compare={compare}
        changeLines={{}}
        prompts={[compare.prompt]}
        columns={[column('a', 'Space Bunny'), column('b', 'Muse Spark')]}
        owner={undefined}
        workspacePath={undefined}
        keeping={false}
        retrying={undefined}
        onKeep={() => undefined}
        onRetry={() => undefined}
        onBack={undefined}
        judge={{ name: 'Codex, Ling 3.1 and Nemotron', running: false, answer: 'I would keep Answer A.', items: [], pick: 'a', scorecard: vote, panel: { judges: ['Codex', 'Ling 3.1', 'Nemotron'], wordsOf: 'Codex', silent: [] } }}
      />
    )
    expect(html).toContain("THE JUDGES&#x27; VIEW · Codex, Ling 3.1 and Nemotron")
    expect(html).toContain('aria-label="2 of 3 judges said met"')
    expect(html.match(/class="lc-compare__vote is-met"/g)?.length).toBe(2 + 1 + 1 + 3)
    expect(html).toContain("Judges&#x27; pick")
    expect(html).toContain("The words below are Codex&#x27;s.")
  })
})
