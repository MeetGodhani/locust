import { describe, expect, it } from 'vitest'

import { STARTERS } from './components/StarterList.js'

/**
 * BUILD AND COMPARE STARTERS ASK FOR ONE PAGE (0.448).
 *
 * A column shows what it built by running it (0.446): a NEW .html file opens
 * as a page in its column. So a starter that builds a page must ask for exactly
 * that -- one named .html file, everything inside it -- or the columns would
 * show code and the whole point, seeing the builds side by side, is gone.
 * Since 2026-10-19 the starters are rows (StarterList.tsx), and the one that
 * builds a page is the landing page.
 */
describe('the Home starter that builds a page', () => {
  it('asks for one named .html file with everything inside it', () => {
    const pages = STARTERS.filter((starter) => starter.icon === 'page')
    expect(pages.map((starter) => starter.label)).toEqual(['Build a landing page'])
    for (const starter of pages) {
      expect(starter.compareChanges).toBe(true)
      expect(starter.prompt).toMatch(/^Make [a-z]+\.html: /)
      expect(starter.prompt).toMatch(/One file/)
    }
  })
})
