import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DecisionCard } from './components/DecisionCard.js'

/*
 * A DECISION WITHOUT A TEAMMATE NAMES NOBODY (0.780). A new person's first conversation has no teammate, and the
 * first card they met there said "The runtime needs a decision to continue" (clean-machine drive, packaged 0.779).
 */
const card = (teammateName: string | undefined): string =>
  renderToStaticMarkup(
    <DecisionCard
      request={{ question: 'What would you like to start with?', options: [{ label: 'A specific task', note: undefined }, { label: 'Just a tour', note: undefined }] }}
      teammateName={teammateName}
      standing="stopped here · this run could edit files"
      onChoose={() => undefined}
      busy={false}
    />
  )

describe('a decision card', () => {
  it('says a decision is needed, and no word for the machinery, when nobody asked by name', () => {
    const html = card(undefined)
    expect(html).toContain('A decision is needed to continue')
    expect(html).not.toContain('runtime')
  })

  it('names the teammate who asked', () => {
    expect(card('Wren')).toContain('Wren needs a decision to continue')
  })
})
