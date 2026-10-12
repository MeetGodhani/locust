import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PublishedCards } from './components/PublishedCards.js'
import { publishedIn, publishedOf } from './publishedLinks.js'

/*
 * WHAT A TEAMMATE PUBLISHED, AS A CARD (0.727). The plan's look-and-feel table: Claude's app shows a published
 * page or doc beside the chat; Locust showed a Claude artifact or doc only as a link, and a bare address as text.
 */
describe('what a reply says a teammate published', () => {
  it('knows each kind by its address, and names it', () => {
    expect(publishedOf('https://claude.ai/code/artifact/q3-launch-plan-d01575a2-edd2-452f-b23d-8ca08658f374')).toEqual({
      url: 'https://claude.ai/code/artifact/q3-launch-plan-d01575a2-edd2-452f-b23d-8ca08658f374',
      kind: 'Claude artifact',
      title: 'Q3 launch plan',
      host: 'claude.ai'
    })
    expect(publishedOf('https://docs.google.com/document/d/1abc/edit')?.kind).toBe('Google Doc')
    expect(publishedOf('https://docs.google.com/spreadsheets/d/1abc/edit')?.kind).toBe('Google Sheet')
    expect(publishedOf('https://docs.google.com/presentation/d/1abc/edit')?.kind).toBe('Google Slides')
    expect(publishedOf('https://www.notion.so/acme/Launch-checklist-0123456789abcdef0123456789abcdef')).toMatchObject({ kind: 'Notion page', title: 'Launch checklist' })
    expect(publishedOf('https://www.figma.com/design/AbC123/Checkout-flow?node-id=1-2')).toMatchObject({ kind: 'Figma file', title: 'Checkout flow' })
    expect(publishedOf('https://gist.github.com/octo-cat/0123456789abcdef')?.kind).toBe('Gist')
  })

  it('takes the reply’s own words for a link’s name, and vouches for nothing it does not know', () => {
    expect(publishedOf('https://docs.google.com/document/d/1abc/edit', 'The brand guide')?.title).toBe('The brand guide')
    expect(publishedOf('https://example.com/document/d/1abc')).toBeUndefined()
    expect(publishedOf('http://docs.google.com/document/d/1abc')).toBeUndefined()
    expect(publishedOf('https://docs.google.com/forms/d/1abc')).toBeUndefined()
    expect(publishedOf('not an address')).toBeUndefined()
  })

  it('finds them as links and as bare addresses, in order, each once, and none inside code', () => {
    const reply = [
      'Done. The plan is up: [Q3 plan](https://docs.google.com/document/d/1plan/edit),',
      'and the tracker is https://docs.google.com/spreadsheets/d/1track/edit.',
      'Same plan again: https://docs.google.com/document/d/1plan/edit',
      '```',
      'curl https://docs.google.com/document/d/1code/edit',
      '```',
      'Docs on https://example.com/help too.'
    ].join('\n')
    expect(publishedIn(reply).map((item) => [item.kind, item.title])).toEqual([
      ['Google Doc', 'Q3 plan'],
      ['Google Sheet', 'Google Sheet']
    ])
  })

  it('draws a card each, with Open, and nothing for a reply that names none', () => {
    const html = renderToStaticMarkup(<PublishedCards text="The page: https://claude.ai/artifact/pricing-page-AbCdEfGhIjKlMnOpQrStUv" />)
    expect(html).toContain('class="lc-published__card"')
    expect(html).toContain('Pricing page')
    expect(html).toContain('Claude artifact · claude.ai')
    expect(html).toContain('>Open<')
    expect(renderToStaticMarkup(<PublishedCards text="Nothing to see at https://example.com" />)).toBe('')
  })
})

/*
 * A STRAY % IN A LINK (0.753, bug hunt 2026-10-12, LK1): a page called "Launch plan 100% done" made the title's decode
 * throw while the reply was drawn, and the whole window fell to its fallback. The words stay as they are written.
 */
describe('a published link whose address holds a % that is not an escape', () => {
  it('is still a card, named as written, and drawing it throws nothing', () => {
    expect(publishedOf('https://www.notion.so/Launch-plan-100%-done')).toMatchObject({ kind: 'Notion page', title: 'Launch plan 100% done' })
    expect(publishedOf('https://www.figma.com/design/AbC123/Cart-%C3')).toMatchObject({ kind: 'Figma file', title: 'Cart %C3' })
    const reply = 'Done: https://www.notion.so/Launch-plan-100%-done'
    expect(() => publishedIn(reply)).not.toThrow()
    expect(renderToStaticMarkup(<PublishedCards text={reply} />)).toContain('Launch plan 100% done')
  })
})

