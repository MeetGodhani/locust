import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

import { CLOUD_MACHINE_WORDS, type CloudSetupStep } from '../../../shared/cloud-computer.js'
import { Icon } from './Icon.js'

/**
 * YOUR CLOUD COMPUTER, THE FIRST TIME (0.761). Asked when Cloud is first picked for a teammate whose maker has no
 * cloud of its own, in a repository that has no cloud computer yet: what it is, what it costs, and -- once the
 * person says yes -- each step of making it as it happens. MEASURED 2026-10-12: made in 3.5 s, configured about 30 s
 * later, OpenCode installed in 21 s.
 */
export type CloudSetupState =
  | { readonly phase: 'ask'; readonly repo: string }
  | { readonly phase: 'working'; readonly repo: string; readonly step: CloudSetupStep }
  | { readonly phase: 'ready'; readonly repo: string }
  | { readonly phase: 'permission'; readonly message: string; readonly allowed?: boolean }
  | { readonly phase: 'not-on-github'; readonly message: string }
  | { readonly phase: 'failed'; readonly message: string; readonly repo?: string }

const STEPS: readonly { readonly step: Exclude<CloudSetupStep, 'ready'>; readonly now: string; readonly done: string; readonly takes: string }[] = [
  { step: 'making', now: 'Making the computer', done: 'Computer made', takes: 'a few seconds' },
  { step: 'readying', now: 'Letting it set itself up', done: 'Set up', takes: 'about 30 s' },
  { step: 'installing', now: 'Installing OpenCode', done: 'OpenCode installed', takes: 'about 20 s' }
]

export function CloudSetupDialog({
  state,
  teammateName,
  onSetUp,
  onAllow,
  onCheckAgain,
  onClose
}: {
  readonly state: CloudSetupState
  readonly teammateName: string | undefined
  readonly onSetUp: () => void
  readonly onAllow: () => void
  readonly onCheckAgain: () => void
  readonly onClose: () => void
}): ReactElement {
  // Focus goes into the dialog, not onto a button: a ring drawn round Set it up read as already chosen.
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    box.current?.focus()
  }, [state.phase])
  const who = teammateName ?? 'Your teammate'
  const repoName = 'repo' in state && state.repo !== undefined ? (state.repo.split('/').pop() ?? state.repo) : undefined
  const at = state.phase === 'working' ? STEPS.findIndex((entry) => entry.step === state.step) : state.phase === 'ready' ? STEPS.length : -1

  return (
    <div className="lc-scrim">
      <section ref={box} tabIndex={-1} className="lc-dialog lc-cloudsetup" role="dialog" aria-modal="true" aria-label="Your cloud computer">
        <div className="lc-dialog__head">
          <Icon name="cloud" size={15} />
          <span className="lc-dialog__title">Your cloud computer</span>
          {repoName !== undefined && <span className="lc-dialog__sub">{repoName}</span>}
          <button type="button" className="lc-dialog__close" aria-label="Close" title="Close" disabled={state.phase === 'working'} onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="lc-dialog__body">

        {(state.phase === 'ask' || state.phase === 'working' || state.phase === 'ready') && (
          <>
            <p className="lc-cloudsetup__lead">
              {`${who} will work on a computer GitHub runs for you, with ${repoName ?? 'this repository'} on it, instead of on this PC. It keeps going when this PC sleeps, and nothing changes here until you apply it.`}
            </p>
            <div className="lc-cloudsetup__facts">
              <div className="lc-cloudsetup__fact"><span className="lc-cloudsetup__label">Size</span><span>{CLOUD_MACHINE_WORDS.replace(', ', ' · ')} memory</span></div>
              <div className="lc-cloudsetup__fact"><span className="lc-cloudsetup__label">Free each month</span><span>60 hours, from GitHub</span></div>
              <div className="lc-cloudsetup__fact"><span className="lc-cloudsetup__label">After that</span><span>$0.18 an hour</span></div>
            </div>
            <p className="lc-cloudsetup__note">
              It stops itself after 10 minutes with nothing to do. GitHub keeps the count and the bill: with no payment method on GitHub, it stops at the free hours instead of charging you.
            </p>
          </>
        )}

        {(state.phase === 'working' || state.phase === 'ready') && (
          <ol className="lc-cloudsetup__steps" aria-label="Setting up">
            {STEPS.map((entry, index) => {
              const done = index < at
              const now = index === at && state.phase === 'working'
              return (
                <li key={entry.step} className={`lc-cloudsetup__step${done ? ' is-done' : now ? ' is-now' : ''}`} {...(now ? { 'aria-current': 'step' as const } : {})}>
                  <span className="lc-cloudsetup__mark" aria-hidden="true">{done ? <Icon name="check" size={12} /> : <span className="lc-cloudsetup__dot" />}</span>
                  <span className="lc-cloudsetup__what">{done ? entry.done : entry.now}</span>
                  <span className="lc-cloudsetup__takes lc-mono">{done ? 'done' : now ? entry.takes : ''}</span>
                </li>
              )
            })}
          </ol>
        )}

        {state.phase === 'permission' && (
          <>
            <p className="lc-cloudsetup__lead">{state.message}</p>
            <p className="lc-cloudsetup__note">
              Allow it opens a terminal with a one-time code and GitHub's page in your browser. Enter the code there, then come back and check again. Locust never sees your GitHub sign-in.
            </p>
          </>
        )}
        {(state.phase === 'not-on-github' || state.phase === 'failed') && <p className="lc-cloudsetup__lead" role="alert">{state.message}</p>}
        </div>

        <div className="lc-dialog__foot">
          {state.phase === 'ask' && (
            <>
              <span className="lc-cloudsetup__note">About a minute, only the first time.</span>
              <button type="button" className="lc-primarybutton" onClick={onSetUp}>Set it up</button>
              <button type="button" className="lc-button" onClick={onClose}>Not now</button>
            </>
          )}
          {state.phase === 'working' && <span className="lc-cloudsetup__note">Setting up. About a minute, only the first time.</span>}
          {state.phase === 'ready' && (
            <>
              <span className="lc-cloudsetup__note">{`Ready. Send ${who} a task and it runs there.`}</span>
              <button type="button" className="lc-primarybutton" onClick={onClose}>Done</button>
            </>
          )}
          {state.phase === 'permission' && (
            <>
              <button type="button" className="lc-primarybutton" onClick={onAllow}>Allow it in GitHub</button>
              <button type="button" className="lc-button" onClick={onCheckAgain}>Check again</button>
              <button type="button" className="lc-button" onClick={onClose}>Not now</button>
            </>
          )}
          {state.phase === 'not-on-github' && <button type="button" className="lc-button" onClick={onClose}>OK</button>}
          {state.phase === 'failed' && (
            <>
              {state.repo !== undefined && <button type="button" className="lc-primarybutton" onClick={onSetUp}>Try again</button>}
              <button type="button" className="lc-button" onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
