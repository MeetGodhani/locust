import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DecisionCard } from './components/DecisionCard.js'

/*
 * A DECISION IS ANSWERED BY NUMBER (0.801). The decision card is how every runtime asks -- Antigravity's own question
 * tool is skipped by its CLI before anyone sees it (agy 1.4.2: "Headless -p runs skip these questions") -- so the keys
 * the question card learned belong here too: 1 to 9, each option wearing its number.
 */
const html = renderToStaticMarkup(
  <DecisionCard
    request={{ question: 'Which file is right?', options: [{ label: 'Keep notes.md', note: 'the newer one' }, { label: 'Keep NOTES.txt', note: undefined }] }}
    teammateName="Wren"
    standing="stopped here · nothing changed"
    onChoose={() => undefined}
    busy={false}
  />
)

describe('a decision card', () => {
  it('numbers its options with the keys that choose them', () => {
    expect(html).toContain('aria-keyshortcuts="1"')
    expect(html).toContain('aria-keyshortcuts="2"')
    expect(html.match(/lc-decision__key/g)).toHaveLength(2)
    expect(html.indexOf('lc-decision__key')).toBeLessThan(html.indexOf('Keep notes.md'))
  })

  it('takes number keys only off a text field, and hands a typed letter to the chat box', () => {
    const source = readFileSync(new URL('./components/DecisionCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('numberKeyAnswer(')
    expect(source).toContain("document.querySelector('.lc-questions') !== null")
    expect(source).toContain("document.querySelector<HTMLTextAreaElement>('form.command-dock textarea')?.focus()")
  })
})
