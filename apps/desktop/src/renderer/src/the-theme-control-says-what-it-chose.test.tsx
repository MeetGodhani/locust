import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ThemeSetting, themeLede } from './components/ThemeSetting.js'

/**
 * THE THEME CONTROL SAYS WHAT IT CHOSE (0.789): Dark, Light or Match
 * computer, the one in force marked, and a line that says what it means --
 * for Match computer, what the computer's theme is right now. Before the
 * saved choice has been read, the control says Dark, the default, rather
 * than nothing.
 */
describe('the theme control', () => {
  it('offers the three, and marks Dark until the saved choice is read', () => {
    const html = renderToStaticMarkup(<ThemeSetting />)
    expect(html).toContain('aria-label="Which theme Locust is drawn in"')
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html).toMatch(/aria-checked="true"[^>]*>Dark</)
    expect(html).toMatch(/aria-checked="false"[^>]*>Light</)
    expect(html).toMatch(/aria-checked="false"[^>]*>Match computer</)
    expect(html).toContain('Dark. Locust as it was first drawn.')
  })

  it('says what each choice means, and what the computer is now under Match computer', () => {
    expect(themeLede('dark', 'dark')).toBe('Dark. Locust as it was first drawn.')
    expect(themeLede('light', 'light')).toBe('Light. For a bright room, or a desktop that is light.')
    expect(themeLede('system', 'light')).toBe('Matches your computer, and changes when it does. It is light now.')
    expect(themeLede('system', 'dark')).toBe('Matches your computer, and changes when it does. It is dark now.')
    expect(themeLede('system', undefined)).toBe('Matches your computer, and changes when it does. It is dark now.')
  })
})
