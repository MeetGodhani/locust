import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

import type { DecisionOption, DecisionRequest } from '../../../shared/decision.js'
import { Icon } from './Icon.js'
import { numberKeyAnswer } from '../questionKeys.js'

/**
 * A teammate asking which way to go.
 *
 * Deliberately not the approval card, and it must not be mistaken for one.
 * An approval asks *may I do this thing I am about to do* and wears amber,
 * because something is pending against the workspace. This asks *which of
 * these should I do* -- the run has ENDED, nothing is pending, nothing is
 * being held. So it is neutral, and it never wears the colour that means
 * "stopped" or the colour that means "waiting to act".
 *
 * What each choice costs comes from the runtime and is shown as its words,
 * never as a recommendation. The card does not mark one option as preferred:
 * the whole reason it exists is that the model reached a fork it should not
 * resolve on its own, and quietly nominating a favourite would resolve it.
 */
export function DecisionCard({
  request,
  teammateName,
  standing,
  onChoose,
  busy
}: {
  readonly request: DecisionRequest
  /** Whose question it is. Undefined when the mission has no teammate. */
  readonly teammateName: string | undefined
  /**
   * What may honestly be said about the workspace, derived by
   * `decisionStanding` rather than written here. The design's "nothing
   * changed" is a claim, and only a read-only run can make it.
   */
  readonly standing: string
  readonly onChoose: (option: DecisionOption) => void
  readonly busy: boolean
}): ReactElement {
  // With no teammate there is nobody to name (0.780): "The runtime needs a decision" was the first card a new person
  // met, on their first conversation, in a word the rest of the app stopped using on 2026-10-01.
  const title = teammateName === undefined ? 'A decision is needed to continue' : `${teammateName} needs a decision to continue`
  const box = useRef<HTMLDivElement>(null)
  /*
   * NUMBER KEYS (0.801), as Claude Code's own question does: 1 to 9 choose that option, and choosing is answering.
   * Every runtime asks with this card; Antigravity's own question tool is skipped by its CLI before anyone sees it.
   * Never from a text field -- "2" typed into the chat box is a 2 -- and never while a question card waits, which is
   * answered first. The card takes the focus only from an empty chat box or from nothing, and a letter typed while it
   * holds the focus goes to the chat box: the reply below is still one keystroke away.
   */
  useEffect(() => {
    const element = box.current
    if (element === null || busy) return undefined
    const active = document.activeElement
    const idle = active === null || active === document.body || (active instanceof HTMLTextAreaElement && active.value.trim().length === 0 && active.closest('form.command-dock') !== null)
    if (idle && document.querySelector('.lc-decision') === element) element.querySelector<HTMLButtonElement>('.lc-decision__option')?.focus({ preventScroll: true })
    return undefined
  }, [busy])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const element = box.current
      if (element === null || busy || document.querySelector('.lc-decision') !== element || document.querySelector('.lc-questions') !== null) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const modified = event.ctrlKey || event.metaKey || event.altKey
      const picked = numberKeyAnswer({
        key: event.key,
        modified,
        typing: target !== null && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement),
        questions: [{ id: 'decision', options: request.options.map((option) => option.label) }],
        chosen: {}
      })
      const option = picked === undefined ? undefined : request.options.find((one) => one.label === picked.label)
      if (option !== undefined) {
        event.preventDefault()
        onChoose(option)
        return
      }
      if (!modified && event.key.length === 1 && event.key !== ' ' && target !== null && element.contains(target)) {
        document.querySelector<HTMLTextAreaElement>('form.command-dock textarea')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onChoose, request.options])
  return (
    <div className="lc-decision" role="group" aria-label="A decision is needed to continue" ref={box}>
      <div className="lc-decision__head">
        <span className="lc-decision__title">
          <Icon name="diff" size={13} /> {title}
        </span>
        <span className="lc-rail__meta">{standing}</span>
      </div>
      <p className="lc-decision__question">{request.question}</p>
      {/*
        * SAID ONCE, UNDER THE OPTIONS.
        *
        * It was said twice: "Or answer in the composer -- free-form replies
        * are fine" between the question and the buttons, and "Or reply below
        * -- you are not limited to these" under them. Two answers to one
        * worry, added months apart for the same reason, and the first one
        * sat between the question and the options it belongs after -- seen
        * on the first frame anybody ever took of this card (2026-09-19,
        * `decision-card-drive.mjs`). The one under the buttons is the one
        * that reads: options first, then that you are not bound by them.
        */}
      <div className="lc-decision__options">
        {request.options.map((option, index) => (
          <button
            key={option.label}
            type="button"
            className="lc-decision__option"
            disabled={busy}
            {...(index < 9 ? { 'aria-keyshortcuts': String(index + 1) } : {})}
            onClick={() => onChoose(option)}
          >
            {index < 9 && <span className="lc-decision__key lc-mono" aria-hidden="true">{String(index + 1)}</span>}
            <span className="lc-decision__body">
              <span className="lc-decision__label">{option.label}</span>
              {option.note !== undefined && <span className="lc-decision__note">{option.note}</span>}
            </span>
          </button>
        ))}
      </div>
      {/*
        Said plainly, because a card with buttons reads as though those are the
        only ways forward. They are not: the composer is right there, and an
        answer nobody offered is often the right one.
      */}
      <div className="lc-decision__foot lc-mono">
        Or reply below — you are not limited to these
      </div>
    </div>
  )
}
