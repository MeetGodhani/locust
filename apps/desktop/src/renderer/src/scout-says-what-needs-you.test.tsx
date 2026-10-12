import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import { DEFAULT_SCOUT_SETTINGS, type ScoutCard, type ScoutState } from '../../shared/scout.js'
import { ScoutCards, ScoutInvite } from './components/ScoutCards.js'
import { ScoutSetting } from './components/ScoutSetting.js'

/*
 * SCOUT SAYS WHAT NEEDS YOU (0.756). On Home, each card leads with Locust's own sentence, what needs the person now
 * comes first and raised, Scout's take and draft sit under it as Scout's, and every action is a press. Before Scout is
 * on, one invitation says what it reads, with which model, and that it never acts by itself.
 */
const scout = { teammateId: 'tm_scout', name: 'Scout', hue: 'teal', role: 'Custom', roleTitle: 'Keeps watch', avatar: seedAvatar('tm_scout'), createdAt: '2026-10-12' } as const
const card = (change: Partial<ScoutCard>): ScoutCard => ({
  key: 'k', urgency: 'soon', said: 'Someone asked you to review pull request #214, Rename the call log.', cardId: 'card_1', at: '2026-10-12T06:00:00.000Z',
  open: { kind: 'url', url: 'https://github.com/acme/app/pull/214', label: 'Open the pull request' }, ...change
})
const state = (cards: readonly ScoutCard[], change: Partial<ScoutState> = {}): ScoutState => ({ settings: { ...DEFAULT_SCOUT_SETTINGS, on: true, teammateId: 'tm_scout' }, cards, lookIds: [], ...change })
const now = new Date('2026-10-12T06:06:00.000Z')
const draw = (shown: ScoutState): string => renderToStaticMarkup(createElement(ScoutCards, { state: shown, scout, onOpen: vi.fn(), onSend: vi.fn(), onDraftIntoBox: vi.fn(), onDismiss: vi.fn(), now }))

describe('Scout’s cards on Home', () => {
  it('lead with Locust’s sentence, say who noticed it and when, and open what it is about', () => {
    const html = draw(state([card({})]))
    expect(html).toContain('Scout noticed · 1')
    expect(html).toContain('<p class="lc-scoutcard__said">Someone asked you to review pull request #214, Rename the call log.</p>')
    expect(html).toContain('Scout · 6 min ago')
    expect(html).toContain('>Open the pull request<')
    expect(html).toContain('>Dismiss<')
    expect(html).not.toContain('Send to')
  })

  it('raise what needs the person now, first, whenever it was found', () => {
    const html = draw(state([card({ cardId: 'card_old', said: 'Older news.' }), card({ cardId: 'card_now', urgency: 'now', said: 'Atlas has waited 25 minutes for your OK.' })]))
    expect(html.indexOf('Atlas has waited')).toBeLessThan(html.indexOf('Older news.'))
    expect(html).toMatch(/<article class="lc-card lc-scoutcard is-pending is-amber" data-scout-card="card_now">/)
    expect(draw(state([card({ urgency: 'now', said: 'Atlas has waited 25 minutes for your OK.', quote: 'pnpm test --filter desktop' })]))).toContain('<p class="lc-scoutcard__quote lc-mono">pnpm test --filter desktop</p>')
    expect(html).toContain('Needs you')
  })

  it('show Scout’s take and draft as Scout’s, with Send and Change it first, and say while it is still reading', () => {
    const drafted = draw(state([card({ take: 'Ada renamed the file the call log reads.', draft: { teammateId: 'tm_atlas', name: 'Atlas', message: 'Review #214 before I do.' } })]))
    expect(drafted).toContain('<span class="lc-scoutcard__who">Scout:</span> Ada renamed the file the call log reads.')
    expect(drafted).toContain('Drafted for Atlas')
    expect(drafted).toContain('Review #214 before I do.')
    expect(drafted).toContain('>Send to Atlas<')
    expect(drafted).toContain('>Change it first<')
    expect(drafted).toContain('Noticed, and drafted')
    expect(draw(state([card({ reading: true })]))).toContain('Scout is reading it…')
  })

  it('say why its model added nothing, and show three until asked for all', () => {
    const many = draw(state([1, 2, 3, 4].map((index) => card({ cardId: `card_${String(index)}`, said: `News ${String(index)}.` })), { modelSaid: 'Scout’s model did not answer.' }))
    expect(many).toContain('Scout’s model did not answer. The cards below are in Locust’s words.')
    expect(many.match(/data-scout-card=/g)).toHaveLength(3)
    expect(many).toContain('Show all 4')
  })

  it('are not there while Scout is off, or has nothing to say', () => {
    expect(draw(state([card({})], { settings: DEFAULT_SCOUT_SETTINGS }))).toBe('')
    expect(draw(state([]))).toBe('')
  })
})

describe('meeting Scout', () => {
  it('says what it reads, with which model, and that it never acts by itself', () => {
    const html = renderToStaticMarkup(createElement(ScoutInvite, { model: 'Space Bunny Free through OpenCode', onTurnOn: vi.fn(), onNotNow: vi.fn() }))
    expect(html).toContain('Meet Scout, a teammate that keeps watch')
    expect(html).toContain('It never sends, merges or changes anything: you press.')
    expect(html).toContain('That model is Space Bunny Free through OpenCode.')
    expect(html).toContain('>Turn on Scout<')
    expect(html).toContain('>Not now<')
  })
})

describe('Scout in Settings', () => {
  const api = { state: vi.fn(), turnOn: vi.fn(), set: vi.fn(), dismiss: vi.fn(), look: vi.fn(), onChanged: vi.fn(() => () => undefined) }
  it('off, says what turning it on does', () => {
    const html = renderToStaticMarkup(createElement(ScoutSetting, { heading: 'Scout keeps watch', state: state([], { settings: DEFAULT_SCOUT_SETTINGS }), api }))
    expect(html).toContain('Off. Turn it on and Scout joins your team')
    expect(html).not.toContain('Change its model')
  })

  it('on, says what it reads with, offers to change its model, and lists what it watches', () => {
    const html = renderToStaticMarkup(createElement(ScoutSetting, { heading: 'Scout keeps watch', state: state([]), model: 'Space Bunny Free through OpenCode', onChangeModel: vi.fn(), api }))
    expect(html).toContain('It reads with Space Bunny Free through OpenCode.')
    expect(html).toContain('>Change its model<')
    expect(html).toContain('Pull requests and their checks')
    expect(html).toContain('Your teammates’ turns')
    expect(html).toContain('Every 10 minutes')
    expect(html).toContain('Tell me in Windows')
  })
})
