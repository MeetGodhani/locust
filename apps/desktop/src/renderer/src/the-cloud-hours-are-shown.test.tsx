import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CloudHours } from './components/CloudComputers.js'

/*
 * LOCUST'S HOURS ON ITS CLOUD COMPUTERS, IN SETTINGS (0.769): about how many this month, against the 60 GitHub
 * includes, what Locust counts and what only GitHub can, and GitHub's exact count a click away.
 */
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
// The day as this computer writes it, as Settings does: "Oct 13" in en-US, "13 Oct" in en-IN, where a written-out
// "Oct 13" failed (2026-10-18).
const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

describe('the hours, in Settings', () => {
  it('says about how many this month against what GitHub includes, with a meter and GitHub a click away', () => {
    const html = renderToStaticMarkup(<CloudHours use={{ hours: 2.46 }} />)
    // Locust cannot see the person's plan, so it says both; the meter runs to the smaller.
    expect(text(html)).toContain('About 2.5 hours of the 60 GitHub includes free, or 90 with Pro')
    expect(html).toContain('aria-valuemax="60"')
    expect(html).toContain('role="meter"')
    expect(html).toContain('aria-valuenow="2.5"')
    expect(html).toContain('width:4.1')
    expect(html).toContain('>Exact hours on GitHub</button>')
    expect(text(html)).toContain('Your own terminal there and your other codespaces count only on GitHub.')
    expect(text(html)).not.toContain('Counted since')
  })

  it('says when the first month is counted from', () => {
    const shown = text(renderToStaticMarkup(<CloudHours use={{ hours: 0.05, since: '2026-10-13T15:00:00.000Z' }} />))
    expect(shown).toContain('About a few minutes of the 60 GitHub includes')
    expect(shown).toContain(`Counted since ${day('2026-10-13T15:00:00.000Z')}.`)
  })
})
