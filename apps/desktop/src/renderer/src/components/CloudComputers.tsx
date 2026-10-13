import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { CLOUD_AGENT_ACCOUNTS, CLOUD_AGENT_MAKERS, CLOUD_AGENT_NAMES, CLOUD_MACHINE_WORDS, type CloudAgent, type CloudSignInStep, type PublicCloudComputer } from '../../../shared/cloud-computer.js'
import { agoLabel } from '../teammateWork.js'
import { Icon } from './Icon.js'

/**
 * SETTINGS > CLOUD COMPUTERS (0.761). The person's cloud computers -- one for each repository a teammate has worked
 * on in the cloud -- with what each is doing, a terminal onto it, and Stop and Delete. GitHub is asked each time the
 * page opens: a codespace stops, starts and is deleted on GitHub's side too.
 *
 * THE AGENTS ON EACH (0.768): Claude Code and Codex, each signed in there or not, as last known -- said without
 * waking the computer -- with Sign in (its maker's page in the person's browser, one Authorize) and Sign out.
 */
type Listing =
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly computers: readonly PublicCloudComputer[] }
  | { readonly phase: 'refused'; readonly message: string; readonly permission: boolean }

const AGENTS: readonly CloudAgent[] = ['claude', 'codex']

/** What a sign-in under way is doing, in the row's words. */
function signInWords(agent: CloudAgent, step: CloudSignInStep): string {
  if (step === 'waking') return 'Waking the computer, about a minute and a half…'
  if (step === 'installing') return `Getting ${CLOUD_AGENT_NAMES[agent]} ready there…`
  if (step === 'opening') return `Opening ${CLOUD_AGENT_MAKERS[agent]}'s sign-in in your browser…`
  return `Click Authorize on ${CLOUD_AGENT_MAKERS[agent]}'s page in your browser`
}

const STATE_WORDS: Readonly<Record<PublicCloudComputer['state'], string>> = {
  available: 'On',
  starting: 'Starting',
  stopped: 'Stopped',
  other: 'Busy on GitHub'
}

export function CloudComputers(): ReactElement {
  const [listing, setListing] = useState<Listing>({ phase: 'loading' })
  const [busy, setBusy] = useState<string>()
  const [confirming, setConfirming] = useState<string>()
  const [said, setSaid] = useState<string>()
  /** The sign-in under way here, and its step as main says it. */
  const [signing, setSigning] = useState<{ readonly name: string; readonly agent: CloudAgent; readonly step: CloudSignInStep }>()
  useEffect(() => window.desktop?.onCodexMissionUpdate((update) => {
    if (update.kind !== 'cloud-sign-in') return
    setSigning((current) => (current !== undefined && current.name === update.name && current.agent === update.agent ? { ...current, step: update.step } : current))
  }), [])

  const load = (): void => {
    void window.desktop?.cloudComputers()
      .then((answer) => setListing(answer.ok ? { phase: 'listed', computers: answer.computers } : { phase: 'refused', message: answer.message, permission: answer.permission === true }))
      .catch(() => setListing({ phase: 'refused', message: 'GitHub could not be reached. Try again in a moment.', permission: false }))
  }
  useEffect(load, [])

  const act = (name: string, what: 'stop' | 'remove' | 'terminal'): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setBusy(`${what}:${name}`)
    setSaid(undefined)
    const done = what === 'stop' ? bridge.stopCloudComputer(name) : what === 'remove' ? bridge.removeCloudComputer(name) : bridge.openCloudComputerTerminal(name)
    void done
      .then((answer) => {
        if (!answer.ok) setSaid(answer.message)
        if (what !== 'terminal') load()
      })
      .catch(() => setSaid('GitHub could not be reached. Try again in a moment.'))
      .finally(() => {
        setBusy(undefined)
        setConfirming(undefined)
      })
  }

  const signIn = (name: string, agent: CloudAgent): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setSaid(undefined)
    setSigning({ name, agent, step: 'installing' })
    void bridge.signInCloudAgent(name, agent)
      .then((answer) => {
        if (!answer.ok) setSaid(answer.message)
        load()
      })
      .catch(() => setSaid('Your cloud computer could not be reached. Try again in a moment.'))
      .finally(() => setSigning(undefined))
  }
  const signOut = (name: string, agent: CloudAgent): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setBusy(`sign-out:${agent}:${name}`)
    setSaid(undefined)
    void bridge.signOutCloudAgent(name, agent)
      .then((answer) => {
        if (!answer.ok) setSaid(answer.message)
        load()
      })
      .catch(() => setSaid('Your cloud computer could not be reached. Try again in a moment.'))
      .finally(() => setBusy(undefined))
  }

  if (listing.phase === 'loading') return <p className="lc-settings__note">Asking GitHub…</p>
  if (listing.phase === 'refused') {
    return (
      <div className="lc-cloudcomputers">
        <p className="lc-settings__note" role="alert">{listing.message}</p>
        <div className="lc-cloudcomputers__actions">
          {listing.permission && (
            <button type="button" className="lc-button" onClick={() => void window.desktop?.allowCloudComputers().catch(() => undefined)}>Allow it in GitHub</button>
          )}
          <button type="button" className="lc-button" onClick={() => { setListing({ phase: 'loading' }); load() }}>Check again</button>
        </div>
      </div>
    )
  }
  if (listing.computers.length === 0) {
    return (
      <p className="lc-settings__note">
        None yet. Pick Cloud for an OpenCode teammate, or Cloud computer for a Claude Code or Codex teammate, in the chat-type menu, and Locust sets one up for that repository.
      </p>
    )
  }
  return (
    <div className="lc-cloudcomputers">
      {said !== undefined && <p className="lc-cloudcomputers__said" role="alert">{said}</p>}
      {listing.computers.map((computer) => {
        const name = computer.repo.split('/').pop() ?? computer.repo
        const used = computer.lastUsedAt === undefined ? undefined : agoLabel(computer.lastUsedAt)
        return (
          <article key={computer.name} className="lc-cloudcomputer" aria-label={name}>
            <div className="lc-cloudcomputer__head">
              <span className="lc-cloudcomputer__who">
                <span className="lc-cloudcomputer__name">{name}</span>
                <span className="lc-cloudcomputer__repo lc-mono">{`${computer.repo} · ${CLOUD_MACHINE_WORDS}`}</span>
              </span>
              <span className={`lc-cloudcomputer__state is-${computer.state}`}>
                <span className="lc-cloudcomputer__dot" aria-hidden="true" />
                {STATE_WORDS[computer.state]}
              </span>
            </div>
            <p className="lc-cloudcomputer__line">
              {computer.state === 'stopped'
                ? `Stopped${used === undefined ? '' : `, last used ${used}`}. It wakes when a teammate needs it, in about a minute and a half; its files stay.`
                : `${used === undefined ? 'On' : `Last used ${used}`}. It stops itself after 10 minutes with nothing to do.`}
            </p>
            <ul className="lc-cloudcomputer__agents" aria-label={`The agents on ${name}'s cloud computer`}>
              {AGENTS.map((agent) => {
                const here = signing !== undefined && signing.name === computer.name && signing.agent === agent ? signing : undefined
                const signedIn = computer.agents?.[agent] === 'signed-in'
                return (
                  <li key={agent} className="lc-cloudcomputer__agent">
                    <span className="lc-cloudcomputer__agentname">{CLOUD_AGENT_NAMES[agent]}</span>
                    <span className={`lc-cloudcomputer__agentstate${signedIn && here === undefined ? ' is-in' : ''}`}>
                      {here !== undefined ? signInWords(agent, here.step) : signedIn ? 'Signed in' : 'Not signed in'}
                    </span>
                    {here !== undefined ? (
                      <button type="button" className="lc-button" onClick={() => void window.desktop?.stopCloudSignIn().catch(() => undefined)}>Stop</button>
                    ) : signedIn ? (
                      <button type="button" className="lc-button" disabled={busy !== undefined || signing !== undefined} onClick={() => signOut(computer.name, agent)}>
                        {busy === `sign-out:${agent}:${computer.name}` ? 'Signing out…' : 'Sign out'}
                      </button>
                    ) : (
                      <button type="button" className="lc-button" disabled={busy !== undefined || signing !== undefined} onClick={() => signIn(computer.name, agent)}>
                        {`Sign in with ${CLOUD_AGENT_ACCOUNTS[agent]}`}
                      </button>
                    )}
                  </li>
                )
              })}
              <li className="lc-cloudcomputer__agent">
                <span className="lc-cloudcomputer__agentname">OpenCode</span>
                <span className="lc-cloudcomputer__agentstate">Free models, nothing to sign in</span>
              </li>
            </ul>
            {confirming === computer.name ? (
              <div className="lc-cloudcomputers__actions" role="group" aria-label={`Delete ${name}'s cloud computer`}>
                <span className="lc-cloudcomputer__ask">{`Delete ${name}'s cloud computer? Its files go with it, and any change not brought home. The repository on GitHub is not touched.`}</span>
                <button type="button" className="lc-button lc-button--danger" disabled={busy !== undefined} onClick={() => act(computer.name, 'remove')}>
                  {busy === `remove:${computer.name}` ? 'Deleting…' : 'Delete'}
                </button>
                <button type="button" className="lc-button" disabled={busy !== undefined} onClick={() => setConfirming(undefined)}>Keep it</button>
              </div>
            ) : (
              <div className="lc-cloudcomputers__actions">
                <button type="button" className="lc-button" disabled={busy !== undefined} onClick={() => act(computer.name, 'terminal')}>
                  <Icon name="terminal" size={13} /> Open a terminal there
                </button>
                {computer.state === 'available' && (
                  <button type="button" className="lc-button" disabled={busy !== undefined} onClick={() => act(computer.name, 'stop')}>
                    {busy === `stop:${computer.name}` ? 'Stopping…' : 'Stop now'}
                  </button>
                )}
                <button type="button" className="lc-button" disabled={busy !== undefined} onClick={() => setConfirming(computer.name)}>Delete…</button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
