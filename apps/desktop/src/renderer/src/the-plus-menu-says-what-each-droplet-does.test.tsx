import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlusMenu } from './components/PlusMenu.js'

/*
 * THE PLUS MENU SAYS WHAT EACH DROPLET DOES (design pass, 2026-10-19). Open, the gooey + was two bare icons, a file and
 * a folder, and their words lived only in a hover. Each droplet keeps its goo and gains its words beside it, outside the
 * liquid so the goo never melts them.
 */
const html = renderToStaticMarkup(<PlusMenu disabled={false} folderMissing={false} onAttach={() => undefined} onChooseFolder={() => undefined} />)
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8')
/** One rule's declarations, by its exact selector at the start of a line. */
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`)
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at))
}

describe('the plus menu', () => {
  it('names each droplet in words, after the liquid and outside it', () => {
    expect(html).toMatch(/class="lc-plusmenu__label" data-satellite="attach" aria-hidden="true"[^>]*>Attach files</)
    expect(html).toMatch(/class="lc-plusmenu__label" data-satellite="folder" aria-hidden="true"[^>]*>Choose a folder</)
    // Not inside a Liquid.Item: the label comes after the + itself.
    expect(html.indexOf('lc-plusmenu__label')).toBeGreaterThan(html.indexOf('lc-plusmenu__main'))
  })

  it('shows the words only while the menu is open, and lets a press through only then', () => {
    const label = rule('.lc-plusmenu__label')
    expect(label).toContain('opacity: 0')
    expect(label).toContain('pointer-events: none')
    const open = rule('.lc-plusmenu__label.is-open')
    expect(open).toContain('opacity: 1')
    expect(open).toContain('pointer-events: auto')
  })

  it('draws the words on the liquid’s own surface, in both themes', () => {
    const label = rule('.lc-plusmenu__label')
    expect(label).toContain('background: var(--lc-plusmenu-fill)')
    expect(label).toContain('box-shadow: var(--lc-plusmenu-shadow)')
  })
})
