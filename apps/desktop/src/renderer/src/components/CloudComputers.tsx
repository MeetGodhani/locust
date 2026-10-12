import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { CLOUD_MACHINE_WORDS, type PublicCloudComputer } from '../../../shared/cloud-computer.js'
import { agoLabel } from '../teammateWork.js'
import { Icon } from './Icon.js'

/**
 * SETTINGS > CLOUD COMPUTERS (0.761). The person's cloud computers -- one for each repository a teammate has worked
 * on in the cloud -- with what each is doing, a terminal onto it, and Stop and Delete. GitHub is asked each time the
 * page opens: a codespace stops, starts and is deleted on GitHub's side too.
 */
type Listing =
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly computers: readonly PublicCloudComputer[] }
  | { readonly phase: 'refused'; readonly message: string; readonly permission: boolean }

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
        None yet. Pick Cloud in the chat-type menu for an OpenCode teammate, and Locust sets one up for that repository.
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
