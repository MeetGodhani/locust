import type { ReactElement } from 'react'

import type { MissionMode } from '../../../shared/ipc.js'
import { Icon } from './Icon.js'
import type { IconName } from './Icon.js'

/**
 * What a conversation can begin with, on Home (2026-10-19). Colin, of Claude Code's own starters beside the "Try two
 * models on" chips: "maybe with a compare button or dropdown beside it? so the user can decide whether to start it
 * with a teammate or compare different models". A chip held a noun; a row says what it does. Pressing the row puts
 * the words in the box for the teammate on screen, in the mode they suit; Compare puts the same words in a
 * comparison of two models. Neither sends: Send is the next press.
 */
export interface Starter {
  readonly id: string
  readonly label: string
  readonly line: string
  readonly icon: IconName | 'page'
  /** The words the box is filled with. One ending in ": " is finished by the person. */
  readonly prompt: string
  /** The mode the row sets for a teammate's turn; none keeps the mode on screen. */
  readonly mode?: MissionMode
  /** A comparison of the WORK (each model changes its own copy) rather than of answers. */
  readonly compareChanges: boolean
}

export const STARTERS: readonly Starter[] = [
  { id: 'plan', label: 'Plan before building', line: 'Agree on the approach before anything changes', icon: 'route', mode: 'plan', compareChanges: false, prompt: 'Read the code first, change nothing, and plan how to: ' },
  { id: 'debug', label: 'Debug an issue', line: 'Find the root cause and fix it', icon: 'target', compareChanges: true, prompt: 'Find the root cause of this bug, fix it, and show what you changed: ' },
  { id: 'review', label: 'Review my changes', line: 'Read this branch’s changes like a careful reviewer', icon: 'eye', mode: 'ask', compareChanges: false, prompt: 'Review the changes on this branch as a careful reviewer. List bugs and risks by severity, each with its file and line. Change nothing.' },
  { id: 'page', label: 'Build a landing page', line: 'For a coffee shop, built and running', icon: 'page', compareChanges: true, prompt: 'Make index.html: a one-page landing page for a small coffee shop, with a headline, three menu items with prices, and opening hours. One file, all CSS inside it.' }
]

/** The landing page drawn as itself (the 0.461 drawing): a browser window with a headline. */
function PageIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 8.5h18" />
      <path d="M7 12.5h10" />
      <path d="M7 15.5h6" />
    </svg>
  )
}

export function StarterList({ onStart, onCompareStart, onCompare }: {
  readonly onStart: (starter: Starter) => void
  readonly onCompareStart: (starter: Starter) => void
  /** Compare on words of the person's own, from an empty box. */
  readonly onCompare?: () => void
}): ReactElement {
  return (
    <section className="lc-homestarts" aria-label="Start a conversation">
      {/* One line, as the accounts' "Show all" sits on theirs: Compare on words of your own, at the heading's end. */}
      <div className="lc-homestarts__head">
        <span className="lc-agenthead__label">Start a conversation</span>
        {onCompare !== undefined && (
          // "Compare models", word for word: six drives and the composer say it so (0.610).
          <button type="button" className="lc-buildhead__compare lc-homestarts__anything" title="Ask two or three models anything and see the answers side by side" onClick={onCompare}>
            Compare models
            <Icon name="chevron-right" size={12} />
          </button>
        )}
      </div>
      <ul className="lc-homestarts__list">
        {STARTERS.map((starter) => (
          <li key={starter.id} className="lc-homestart">
            <button type="button" className="lc-homestart__start" title={`Puts the words in the box for your teammate${starter.mode === undefined ? '' : `, in ${starter.mode === 'plan' ? 'Plan' : 'Ask'} mode`}. Nothing is sent until you press Send.`} onClick={() => onStart(starter)}>
              <span className="lc-homestart__icon" aria-hidden="true">{starter.icon === 'page' ? <PageIcon /> : <Icon name={starter.icon} size={16} />}</span>
              <span className="lc-homestart__name">{starter.label}</span>
              <span className="lc-homestart__line">{starter.line}</span>
            </button>
            <button
              type="button"
              className="lc-homestart__compare"
              aria-label={`Compare models on: ${starter.label}`}
              title={starter.compareChanges ? 'Two models do this side by side, each in its own copy; you keep the one you like' : 'Two models answer this side by side'}
              onClick={() => onCompareStart(starter)}
            >
              <Icon name="columns" size={13} />
              Compare
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
