import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import { issueAge, type ListedIssue } from '../../../shared/github-issue.js'

/**
 * The folder's open issues, in the chat box. Arrows, Enter and Escape.
 * Choosing fills the box. Nothing here sends.
 */
export function IssueList({ issues, onChoose, onClose, empty }: {
  readonly issues: readonly ListedIssue[]
  readonly onChoose: (number: number) => void
  readonly onClose: () => void
  /** Said when the folder has no open issues, or the list could not be read. */
  readonly empty?: string
}): ReactElement {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  const shown = needle.length === 0 ? issues : issues.filter((issue) =>
    `${String(issue.number)} ${issue.title} ${issue.author ?? ''} ${issue.labels.join(' ')}`.toLowerCase().includes(needle)
  )
  const now = Date.now()
  useEffect(() => { search.current?.focus() }, [])
  useEffect(() => { setAt(0) }, [needle])

  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (shown.length === 0) return
      setAt((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1
        return (next + shown.length) % shown.length
      })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const issue = shown[Math.min(at, shown.length - 1)]
      if (issue !== undefined) onChoose(issue.number)
    }
  }

  return (
    <div className="lc-issuelist" aria-label="Start from an issue">
      <input
        ref={search}
        className="lc-issuelist__search"
        aria-label="Search issues"
        placeholder="Search issues"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={keyDown}
      />
      {empty !== undefined && issues.length > 0 && <p className="lc-issuelist__empty">{empty}</p>}
      {shown.length === 0 ? (
        <p className="lc-issuelist__empty">{issues.length === 0 ? (empty ?? 'No open issues.') : 'No issue matches that.'}</p>
      ) : (
        <div className="lc-issuelist__rows" role="listbox" aria-label="Open issues">
          {shown.map((issue, index) => {
            const age = issueAge(issue.createdAt, now)
            const meta = [issue.author, age, ...issue.labels].filter((part) => part !== undefined && part.length > 0).join(' · ')
            return (
              <button
                key={issue.number}
                type="button"
                role="option"
                aria-selected={index === Math.min(at, shown.length - 1)}
                className={`lc-issuelist__row${index === Math.min(at, shown.length - 1) ? ' is-active' : ''}`}
                onMouseEnter={() => setAt(index)}
                onClick={() => onChoose(issue.number)}
              >
                <span className="lc-issuelist__title"><span className="lc-mono">#{issue.number}</span> {issue.title}</span>
                {meta.length > 0 && <span className="lc-issuelist__meta">{meta}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
