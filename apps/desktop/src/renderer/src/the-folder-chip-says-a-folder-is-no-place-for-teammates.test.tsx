import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Composer, type ComposerProps } from './components/Composer.js'

/*
 * THE FOLDER CHIP SAYS A FOLDER IS NO PLACE FOR TEAMMATES, AND THE BOX ASKS BEFORE THE FIRST CONVERSATION (0.790).
 * Asked once per folder, the question is gone by the second conversation; the chip keeps saying why in its hover --
 * on 2026-10-18 three handoffs started in `.claude` with nobody noticing. The question is the box's own card, not a
 * Windows dialog (Colin: "maybe make it part of the app?"). The chip itself stays the chip's own grey (0.803): it was
 * amber, and a person who keeps old conversations there met the warning on every one (Colin: "having the .claude
 * folder in yellow is triggering me a bit ... please make it the normal color").
 */

const props = { runtimes: [], limitedRuntimes: new Map(), discoveryPhase: 'ready', models: [], resolvedModels: new Map(), route: { runtime: 'opencode', model: 'free' }, mode: 'ask', onModeChange: () => undefined, onRouteChange: () => undefined, running: false, platform: 'win32', onChooseFolder: () => undefined } as unknown as ComposerProps
const WHY = '.claude, where the agents keep their own settings'

describe('the folder chip', () => {
  it('says why in its hover for a folder like .claude, in the chip\'s own colour', () => {
    const html = renderToStaticMarkup(<Composer {...props} workspaceName=".claude" workspacePath="C:\Users\person\.claude" workspaceCaution={WHY} />)
    expect(html).toMatch(/class="lc-control lc-control--folder"/)
    expect(html).not.toContain('is-caution')
    expect(html).toContain('This is .claude, where the agents keep their own settings: a teammate here reads it as its project, sign-in files included.')
    // No question until a send asks it.
    expect(html).not.toContain('lc-folderask')
  })

  it('stays as it was for a project folder (control)', () => {
    const html = renderToStaticMarkup(<Composer {...props} workspaceName="shop" workspacePath="C:\Users\person\Documents\shop" />)
    expect(html).toMatch(/class="lc-control lc-control--folder"/)
    expect(html).toContain('title="New conversations work in C:\\Users\\person\\Documents\\shop"')
  })
})

describe('the question over the box', () => {
  it('names the folder and why, with Choose another folder first and Start here', () => {
    const html = renderToStaticMarkup(<Composer {...props} workspaceName=".claude" workspacePath="C:\Users\person\.claude" workspaceCaution={WHY} folderQuestion={{ name: '.claude', why: WHY }} onConfirmFolder={async () => true} />)
    expect(html).toContain('aria-label="Start this conversation in .claude?"')
    // The question in the text's own colour, then why.
    expect(html).toContain('<span class="lc-folderask__question">Start this conversation in .claude?</span> This is .claude, where the agents keep their own settings, and a teammate here reads it as its project, sign-in files included.')
    const card = html.slice(html.indexOf('lc-folderask'))
    expect(card.indexOf('Choose another folder')).toBeGreaterThan(-1)
    expect(card.indexOf('Choose another folder')).toBeLessThan(card.indexOf('Start here'))
  })
})
