import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'

import { BrowserToggle } from './components/BrowserToggle.js'
import { TerminalToggle } from './components/TerminalToggle.js'

/**
 * THE HEADER IS CLAUDE CODE'S ROW OF ICONS (0.797).
 *
 * Colin, 2026-10-19, with Claude Code's header beside it: "lets lean into something closer to what claude code has,
 * buttons are getting a little too much". The drive (_tools/drive-the-header-is-a-row-of-icons.mjs) reads the whole
 * row in a conversation; these keep the two shared toggles to an icon with its name for hover and screen readers.
 */

const words = (html: string): string => html.replace(/<[^>]*>/g, '').trim()

it('the browser is an icon, named for hover and screen readers', () => {
  const html = renderToStaticMarkup(<BrowserToggle open={false} onToggle={() => undefined} />)
  expect(html).toContain('class="lc-headicon"')
  expect(html).toContain('aria-label="Browser"')
  expect(html).toContain('title="Browser"')
  expect(words(html)).toBe('')
})

it('open, it reads as on', () => {
  const html = renderToStaticMarkup(<BrowserToggle open onToggle={() => undefined} />)
  expect(html).toContain('class="lc-headicon is-active"')
  expect(html).toContain('aria-pressed="true"')
})

it('the terminal is an icon too, with its shortcut on hover', () => {
  const html = renderToStaticMarkup(<TerminalToggle open={false} onToggle={() => undefined} />)
  expect(html).toContain('class="lc-headicon"')
  expect(html).toContain('title="Terminal (Ctrl+`)"')
  expect(words(html)).toBe('')
})

it('turned off by the organization, each says so where the word used to be', () => {
  const browser = renderToStaticMarkup(<BrowserToggle open={false} refusal="The browser panel is off." onToggle={() => undefined} />)
  expect(browser).toContain('aria-label="Browser, set by your organization"')
  expect(browser).toContain('title="The browser panel is off."')
  expect(browser).toContain('disabled=""')
})
