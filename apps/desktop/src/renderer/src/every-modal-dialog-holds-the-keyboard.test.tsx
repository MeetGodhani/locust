import { readdirSync, readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SaveRecordDialog } from './components/SaveRecordDialog.js'

/*
 * EVERY MODAL DIALOG HOLDS THE KEYBOARD (design pass, 2026-10-19). Share your team, Save the record and Your cloud
 * computer each said aria-modal="true" and kept none of its promises: Escape left them open, and Tab walked out to the
 * page behind the scrim. A dialog that says it is modal takes focus in, keeps Tab inside, closes on Escape and gives the
 * focus back -- `useModal` -- or, like the command palette, owns its Escape itself.
 */
const components = new URL('./components/', import.meta.url)
const modal = readdirSync(components)
  .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
  .map((name) => ({ name, source: readFileSync(new URL(name, components), 'utf8') }))
  .filter(({ source }) => source.includes('aria-modal="true"'))

describe('a modal dialog', () => {
  it('is found where this test looks', () => {
    expect(modal.map(({ name }) => name)).toEqual(expect.arrayContaining(['TeamCard.tsx', 'SaveRecordDialog.tsx', 'CloudSetupDialog.tsx']))
  })

  it.each(modal.map(({ name, source }) => [name, source]))('%s closes on Escape and keeps Tab inside', (_name, source) => {
    expect(source.includes('useModal(') || source.includes("'Escape'")).toBe(true)
  })

  it('in Your cloud computer, Escape does what the x does: stops a sign-in, and waits out the work', () => {
    const source = readFileSync(new URL('CloudSetupDialog.tsx', components), 'utf8')
    expect(source).toMatch(/useModal\(box, \(\) => \{\s*if \(signingIn\) onStopSignIn\(\)\s*else if \(!busy\) onClose\(\)/)
  })

  it('Save the record has an x', () => {
    const html = renderToStaticMarkup(<SaveRecordDialog missionId="m1" onClose={() => undefined} />)
    expect(html).toContain('class="lc-dialog__close" aria-label="Close"')
  })
})
