import { useState } from 'react'
import type { ReactElement } from 'react'

import { cloudChangeWords, CLOUD_MACHINE_WORDS, type PublicCloudTurn } from '../../../shared/cloud-computer.js'
import { fileCounts, parseUnifiedDiff } from '../diff.js'
import { agoLabel } from '../teammateWork.js'
import { DiffView } from './DiffView.js'
import { Icon } from './Icon.js'

/**
 * A TURN ON YOUR CLOUD COMPUTER, IN THE THREAD (0.761). The turn's work streams in like any turn's; these two say
 * what is different about it: where it ran -- a line between the person's words and the work -- and, once it has
 * ended, what became of its change, which stays on the cloud computer until the person brings it home.
 */
export function CloudMarker({ turn }: { readonly turn: PublicCloudTurn }): ReactElement {
  return (
    <div className="lc-cloudmarker" role="note">
      <span className="lc-cloudmarker__rule" aria-hidden="true" />
      <Icon name="cloud" size={14} />
      <span className="lc-cloudmarker__words">On your cloud computer</span>
      <span className="lc-cloudmarker__where lc-mono">{`${turn.repo.split('/').pop() ?? turn.repo}${turn.branch === undefined ? '' : ` · ${turn.branch}`} · ${CLOUD_MACHINE_WORDS}`}</span>
      <span className="lc-cloudmarker__rule" aria-hidden="true" />
    </div>
  )
}

/** How many files the card lists before it says how many more. */
const FILES_LISTED = 6

export function CloudChangeCard({
  turn,
  onPatch,
  onApply,
  onDiscard
}: {
  readonly turn: PublicCloudTurn
  readonly onPatch: (missionId: string) => Promise<string | undefined>
  readonly onApply: (missionId: string) => Promise<string | undefined>
  readonly onDiscard: (missionId: string) => Promise<string | undefined>
}): ReactElement | null {
  const [shown, setShown] = useState<{ readonly loading: boolean; readonly patch: string | undefined }>()
  const [busy, setBusy] = useState<'apply' | 'discard'>()
  const [problem, setProblem] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const files = turn.files ?? []

  if (turn.state === 'carried') return null
  // The turn has ended (the thread draws this only then), and what it changed there is being read: a few seconds.
  if (turn.state === 'working') return <div className="lc-thread__note" role="status">Reading what it changed on your cloud computer…</div>
  if (turn.state === 'none') return <div className="lc-thread__note">No files changed on your cloud computer</div>
  if (turn.state === 'discarded') return <div className="lc-thread__note">Its change was put back on your cloud computer</div>
  if (turn.state === 'failed') {
    return <div className="lc-thread__note">{`What it changed on your cloud computer could not be read. ${turn.problem ?? ''}`.trim()}</div>
  }
  if (turn.state === 'home') {
    const when = turn.appliedAt === undefined ? undefined : agoLabel(turn.appliedAt)
    return (
      <div className="lc-cloudchange is-home" role="status">
        <Icon name="check" size={13} />
        <span>{`Brought into this folder${when === undefined ? '' : ` ${when}`}`}</span>
        {files.length > 0 && <span className="lc-cloudchange__counts lc-mono">{cloudChangeWords(files)}</span>}
      </div>
    )
  }

  const show = (): void => {
    if (shown !== undefined) {
      setShown(undefined)
      return
    }
    setShown({ loading: true, patch: undefined })
    void onPatch(turn.missionId).then((patch) => setShown({ loading: false, patch }))
  }
  const act = (which: 'apply' | 'discard'): void => {
    setBusy(which)
    setProblem(undefined)
    void (which === 'apply' ? onApply(turn.missionId) : onDiscard(turn.missionId))
      .then((said) => {
        if (said !== undefined) setProblem(said)
      })
      .finally(() => {
        setBusy(undefined)
        setConfirming(false)
      })
  }
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  const parsed = shown?.patch === undefined ? [] : parseUnifiedDiff(shown.patch)

  return (
    <section className="lc-cloudchange" aria-label="The change on your cloud computer">
      <div className="lc-cloudchange__head">
        <Icon name="cloud" size={15} />
        <h3 className="lc-cloudchange__title">The change is on your cloud computer</h3>
        <span className="lc-cloudchange__counts lc-mono">
          {`${String(files.length)} ${files.length === 1 ? 'file' : 'files'} · `}
          <span className="lc-diff__addmark">{`+${String(added)}`}</span> <span className="lc-diff__delmark">{`−${String(removed)}`}</span>
          {' · not here yet'}
        </span>
      </div>
      <ul className="lc-cloudchange__files lc-mono">
        {files.slice(0, FILES_LISTED).map((file) => (
          <li key={file.path}>
            <span className="lc-cloudchange__path">{file.path}</span>
            {file.binary === true ? <span className="lc-cloudchange__binary">binary</span> : (
              <>
                <span className="lc-diff__addmark">{`+${String(file.added)}`}</span>
                <span className="lc-diff__delmark">{`−${String(file.removed)}`}</span>
              </>
            )}
          </li>
        ))}
        {files.length > FILES_LISTED && <li className="lc-cloudchange__more">{`and ${String(files.length - FILES_LISTED)} more`}</li>}
      </ul>
      {problem !== undefined && <p className="lc-cloudchange__problem" role="alert">{problem}</p>}
      {confirming ? (
        <div className="lc-cloudchange__actions" role="group" aria-label="Discard the change">
          <span className="lc-cloudchange__ask">Put the cloud copy back to where this conversation began there?</span>
          <button type="button" className="lc-button lc-button--danger" disabled={busy !== undefined} onClick={() => act('discard')}>
            {busy === 'discard' ? 'Discarding…' : 'Discard'}
          </button>
          <button type="button" className="lc-button" disabled={busy !== undefined} onClick={() => setConfirming(false)}>Keep it</button>
        </div>
      ) : (
        <div className="lc-cloudchange__actions">
          <button type="button" className="lc-button" aria-expanded={shown !== undefined} onClick={show}>
            <Icon name="diff" size={13} /> {shown === undefined ? 'Show the change' : 'Hide the change'}
          </button>
          <button
            type="button"
            className="lc-primarybutton"
            disabled={busy !== undefined}
            title="Its change comes into this folder, not committed, so you can look before you keep it"
            onClick={() => act('apply')}
          >
            {busy === 'apply' ? 'Applying…' : 'Apply to this folder'}
          </button>
          <button type="button" className="lc-button" disabled={busy !== undefined} onClick={() => setConfirming(true)}>Discard…</button>
        </div>
      )}
      <p className="lc-cloudchange__note">
        Apply brings it into this folder, not committed, so you can look before you keep it. Or reply below: the next turn carries on from it there.
      </p>
      {shown !== undefined && (
        <div className="lc-review__files">
          {shown.loading && <p className="lc-cloudchange__note">Reading the change…</p>}
          {!shown.loading && shown.patch === undefined && <p className="lc-cloudchange__note">Your cloud computer did not answer. Try again in a moment.</p>}
          {parsed.map((file) => {
            const counts = fileCounts(file)
            return (
              <section key={`${turn.missionId}:${file.path}`} aria-label={file.path}>
                <div className="lc-review__path lc-mono">
                  <span className="lc-review__name">{file.path}</span>
                  {file.status !== 'MODIFIED' && <span className="lc-review__status">{file.status.toLowerCase()}</span>}
                  <span className="lc-diff__addmark">+{counts.added}</span> <span className="lc-diff__delmark">−{counts.removed}</span>
                </div>
                <DiffView file={file} truncated={false} reported={undefined} />
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
