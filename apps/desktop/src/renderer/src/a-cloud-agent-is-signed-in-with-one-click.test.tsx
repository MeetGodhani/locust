import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CloudSetupDialog, type CloudSetupState } from './components/CloudSetupDialog.js'

/*
 * CLAUDE CODE AND CODEX ON YOUR CLOUD COMPUTER, SIGNED IN WITH ONE CLICK (0.768). Colin, 2026-10-13, of a sign-in
 * that asked for codes: "making them input launch codes?" The dialog says what happens before it does -- the maker's
 * own page, in the person's browser, one Authorize, nothing to copy -- then each step as it happens, and who is
 * waiting on whom.
 */
const dialog = (state: CloudSetupState): string =>
  renderToStaticMarkup(
    <CloudSetupDialog state={state} teammateName="Wren" onSetUp={() => undefined} onSignIn={() => undefined} onStopSignIn={() => undefined} onAllow={() => undefined} onCheckAgain={() => undefined} onClose={() => undefined} />
  )
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

describe('an agent not signed in there', () => {
  it("says it will open its maker's own page, and that there is no code to copy, before anything opens", () => {
    const shown = text(dialog({ phase: 'sign-in', repo: 'acme/hearth', computer: 'locust-hearth-x7q9', agent: 'claude' }))
    expect(shown).toContain("Claude Code is not signed in on your cloud computer yet. Sign in once: Locust opens Claude's own sign-in page in your browser, and you click Authorize, as you would on this PC. There is no code to copy.")
    expect(shown).toContain('The sign-in stays on that computer, and goes when the computer is deleted. Locust never sees it.')
    expect(shown).toContain('Sign in with Claude')
    expect(shown).toContain('Not now')
    // Codex signs in with ChatGPT, on OpenAI's page.
    const codex = text(dialog({ phase: 'sign-in', repo: 'acme/hearth', computer: 'locust-hearth-x7q9', agent: 'codex' }))
    expect(codex).toContain("Locust opens OpenAI's own sign-in page in your browser")
    expect(codex).toContain('Sign in with ChatGPT')
  })

  it("shows each step as it happens, then that the rest is the person's, with Stop", () => {
    const opening = text(dialog({ phase: 'signing-in', repo: 'acme/hearth', computer: 'locust-hearth-x7q9', agent: 'claude', step: 'opening' }))
    expect(opening).toContain('Claude Code ready there')
    expect(opening).toContain("Opening Claude's sign-in in your browser")
    expect(opening).not.toContain('Waking')
    expect(opening).toContain('Stop')
    const waiting = text(dialog({ phase: 'signing-in', repo: 'acme/hearth', computer: 'locust-hearth-x7q9', agent: 'claude', step: 'waiting', woke: true }))
    expect(waiting).toContain("Claude's page opened")
    expect(waiting).toContain("Click Authorize on Claude's page")
    expect(waiting).toContain('waiting for you')
    expect(waiting).toContain('Finish in your browser, then come back here.')
    // A computer that had to be woken says so, as a step done.
    expect(waiting).toContain('Awake')
  })

  it('says when it is signed in, and what happens next', () => {
    const shown = text(dialog({ phase: 'signed-in', repo: 'acme/hearth', agent: 'codex' }))
    expect(shown).toContain('Codex is signed in on your cloud computer. It stays signed in there, and goes when the computer is deleted.')
    expect(shown).toContain('Ready. Send Wren a task and Codex runs it there.')
    expect(shown).toContain('Done')
  })

  it('offers it again after a failure, on the same computer', () => {
    const html = dialog({ phase: 'failed', repo: 'acme/hearth', computer: 'locust-hearth-x7q9', agent: 'claude', message: 'Signing Claude Code in was stopped.' })
    expect(text(html)).toContain('Signing Claude Code in was stopped.')
    expect(html).toContain('>Try again</button>')
  })
})

describe("a Claude Code or Codex teammate's first cloud computer", () => {
  it('says the agent goes on it, signed in with the account, and nothing to copy', () => {
    const shown = text(dialog({ phase: 'ask', repo: 'acme/hearth', agent: 'claude' }))
    expect(shown).toContain('Wren will work on a computer GitHub runs for you, with hearth on it, instead of on this PC.')
    expect(shown).toContain("Claude Code goes on it, signed in with your Claude account: Locust opens Claude's own page in your browser, and you click Authorize. There is no code to copy.")
    expect(shown).toContain('About two minutes, only the first time.')
  })

  it('ends its steps with the sign-in, and waits on the person there with Stop', () => {
    const shown = text(dialog({ phase: 'working', repo: 'acme/hearth', agent: 'codex', step: 'signing-in', waiting: true }))
    for (const step of ['Computer made', 'Set up', 'Codex installed']) expect(shown).toContain(step)
    expect(shown).toContain("Click Authorize on OpenAI's page in your browser")
    expect(shown).toContain('waiting for you')
    expect(shown).toContain('Stop')
    // OpenCode's steps are as they were: no sign-in.
    const openCode = text(dialog({ phase: 'working', repo: 'acme/hearth', step: 'installing' }))
    expect(openCode).toContain('Installing OpenCode')
    expect(openCode).not.toContain('Signing in')
  })
})
