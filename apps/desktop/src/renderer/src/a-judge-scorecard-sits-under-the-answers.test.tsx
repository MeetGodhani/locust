import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { blindName } from '../../shared/compare.js'
import type { PublicCompare } from '../../shared/compare.js'
import type { Scorecard } from '../../shared/compare-score.js'
import { CompareView } from './components/CompareView.js'
import type { CompareColumnView } from './components/CompareView.js'

/*
 * THE JUDGE'S SCORECARD, UNDER THE ANSWERS (0.759), after Artificial Analysis's Optima: every answer on every point,
 * met or not and why, then each one's score, time and what it spent -- the summary first, the judge's words under it.
 */
const compare = (blind: boolean): PublicCompare => ({
  compareId: 'cmp_1',
  prompt: 'Write a four-line poem about a locust swarm at dusk.',
  createdAt: '2026-10-12T18:00:00.000Z',
  ...(blind ? { blind: true as const } : {}),
  slots: [
    { slot: 'a', route: { runtime: 'codex', model: 'gpt-6-sol', label: 'GPT-6 Sol' }, missionIds: ['m_a'] },
    { slot: 'b', route: { runtime: 'claude', model: 'sonnet', label: 'Sonnet 5.5' }, missionIds: ['m_b'] }
  ],
  judge: { route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free' }, missionIds: ['m_j'], criteria: 'Exactly four lines\nEach pair rhymes' }
})
const column = (slot: 'a' | 'b', name: string, span: string, cost: string): CompareColumnView => ({
  slot, name, runtime: slot === 'a' ? 'codex' : 'claude', runtimeName: slot === 'a' ? 'Codex CLI' : 'Claude Code',
  turns: [{ missionId: `m_${slot}`, items: [], running: false }], running: false, keepable: true, retryable: false, answer: 'A poem.', state: 'done', span, cost
})
const scorecard: Scorecard = {
  points: ['Exactly four lines', 'Each pair rhymes'],
  byJudge: false,
  verdicts: {
    a: [{ met: true, why: 'Four lines exactly.' }, { met: true, why: 'Every pair rhymes.' }],
    b: [{ met: true, why: 'Four lines.' }, { met: false, why: 'Lines 1 and 3 do not rhyme.' }]
  }
}
const render = (blind: boolean, card: Scorecard = scorecard): string => renderToStaticMarkup(
  <CompareView
    compare={compare(blind)}
    changeLines={{}}
    prompts={[compare(blind).prompt]}
    columns={[column('a', blind ? blindName('a') : 'GPT-6 Sol', '16s', '$0.02'), column('b', blind ? blindName('b') : 'Sonnet 5.5', '5s', 'in your plan')]}
    owner={undefined}
    workspacePath={undefined}
    keeping={false}
    retrying={undefined}
    onKeep={() => undefined}
    onRetry={() => undefined}
    onBack={undefined}
    judge={{ name: 'Nemotron 3 Ultra Free', running: false, answer: 'Answer A keeps the form. I would keep Answer A.', items: [], pick: 'a', scorecard: card }}
  />
)

describe("the judge's scorecard", () => {
  it('scores every answer on every point under its own column, met or not and why, then score, time and what it spent', () => {
    const html = render(false)
    expect(html).toContain('lc-compare__scorecard')
    expect(html).toMatch(/<th scope="col">What a good answer does<\/th><th scope="col">GPT-6 Sol<\/th><th scope="col">Sonnet 5.5<\/th>/)
    expect(html).toContain('<th scope="row" class="lc-compare__point">Each pair rhymes</th>')
    expect(html).toContain('<span class="lc-compare__verdict is-missed">not met</span><span class="lc-compare__why">Lines 1 and 3 do not rhyme.</span>')
    // The best score is marked when one answer has it alone.
    expect(html).toContain('<td class="lc-compare__recordnum lc-compare__score is-best">2 of 2</td><td class="lc-compare__recordnum lc-compare__score">1 of 2</td>')
    expect(html).toMatch(/<th scope="row">Time<\/th><td class="lc-compare__recordnum">16s<\/td><td class="lc-compare__recordnum">5s<\/td>/)
    expect(html).toMatch(/<th scope="row">Spent<\/th><td class="lc-compare__recordnum">\$0\.02<\/td><td class="lc-compare__recordnum">in your plan<\/td>/)
    // The summary comes before the judge's words.
    expect(html.indexOf('lc-compare__scorecard')).toBeLessThan(html.indexOf('It read the answers as Answer A'))
  })

  it('in a blind comparison, scores Model A and Model B and keeps what they spent out until one is kept', () => {
    const html = render(true)
    expect(html).toMatch(/<th scope="col">Model A<\/th><th scope="col">Model B<\/th>/)
    expect(html).not.toContain('<th scope="row">Spent</th>')
    expect(html).not.toContain('in your plan')
  })

  it('leaves out a row no answer has a figure for, rather than a line of dashes', () => {
    const html = renderToStaticMarkup(
      <CompareView
        compare={compare(false)}
        changeLines={{}}
        prompts={[compare(false).prompt]}
        columns={[{ ...column('a', 'GPT-6 Sol', '16s', '$0.02'), span: undefined, cost: undefined }, { ...column('b', 'Sonnet 5.5', '5s', 'x'), span: undefined, cost: undefined }]}
        owner={undefined}
        workspacePath={undefined}
        keeping={false}
        retrying={undefined}
        onKeep={() => undefined}
        onRetry={() => undefined}
        onBack={undefined}
        judge={{ name: 'Judge', running: false, answer: 'x', items: [], scorecard }}
      />
    )
    expect(html).toContain('<th scope="row">Score</th>')
    expect(html).not.toContain('<th scope="row">Time</th>')
    expect(html).not.toContain('<th scope="row">Spent</th>')
  })

  it("names the judge's own points as its own, and marks no winner in a tie", () => {
    const own: Scorecard = { ...scorecard, byJudge: true, verdicts: { a: [{ met: true, why: '' }, { met: false, why: '' }], b: [{ met: false, why: '' }, { met: true, why: '' }] } }
    const html = render(false, own)
    expect(html).toContain('<th scope="col">The judge’s points</th>')
    expect(html).toContain('No points were written, so the judge set these from your request.')
    expect(html).not.toContain('is-best')
  })
})
