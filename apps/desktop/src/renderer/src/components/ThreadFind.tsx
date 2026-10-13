import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'

import { findCountWords, findIn, stepHit } from '../threadFind.js'
import { Icon } from './Icon.js'

/*
 * FIND IN A CONVERSATION (0.769, threadFind.ts). Ctrl+F opens a small bar at the top of the conversation: what is
 * typed is marked wherever it is in the turns on the page, the one it is on more strongly, and Enter steps through
 * them. Marked with the CSS Highlight API, so the page itself is never changed -- a reply still streaming in is found
 * again as it grows. Esc closes it and gives the cursor back where it was.
 */

/** Text a reader does not search: buttons, form fields, drawings, and what is hidden from them. */
const SKIP = 'button, input, textarea, select, svg, [aria-hidden="true"], [data-find-skip]'

function rangesIn(root: HTMLElement, query: string): Range[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (parent === null || (node.nodeValue ?? '').length === 0) return NodeFilter.FILTER_REJECT
      if (parent.closest(SKIP) !== null) return NodeFilter.FILTER_REJECT
      // Not drawn -- a folded step, a closed panel: nothing there to find.
      if (parent.getClientRects().length === 0) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text)
  return findIn(nodes.map((node) => node.nodeValue ?? ''), query).map((hit) => {
    const range = document.createRange()
    range.setStart(nodes[hit.from[0]]!, hit.from[1])
    range.setEnd(nodes[hit.to[0]]!, hit.to[1])
    return range
  })
}

const registry = (): HighlightRegistry | undefined => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined)

function unmark(): void {
  const marks = registry()
  marks?.delete('lc-find')
  marks?.delete('lc-find-now')
}

export function ThreadFind({ request, root, scroller, earlier }: {
  /** Ctrl+F, counted: each new number opens the bar, or puts the cursor back in it. */
  readonly request: number
  /** The conversation's turns: what is searched. */
  readonly root: RefObject<HTMLElement | null>
  /** What scrolls, to bring a match into view. */
  readonly scroller: RefObject<HTMLElement | null>
  /** Turns not on the page yet -- a long conversation opens on its newest -- found once they are. */
  readonly earlier?: { readonly count: number; readonly onShowAll: () => void }
}): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const ranges = useRef<readonly Range[]>([])
  const at = useRef({ query: '', current: 0 })
  const seen = useRef(request)
  const returnTo = useRef<Element | null>(null)

  const paint = (index: number): void => {
    const marks = registry()
    if (marks === undefined) return
    if (ranges.current.length === 0) { unmark(); return }
    marks.set('lc-find', new Highlight(...ranges.current))
    const now = ranges.current[index]
    if (now === undefined) marks.delete('lc-find-now')
    else marks.set('lc-find-now', new Highlight(now))
  }
  const show = (index: number): void => {
    const range = ranges.current[index]
    const box = scroller.current
    if (range === undefined || box === null) return
    const place = range.getBoundingClientRect()
    const frame = box.getBoundingClientRect()
    // Off the page, or under the bar: brought a third of the way down.
    if (place.top < frame.top + 64 || place.bottom > frame.bottom - 24) box.scrollTop += place.top - frame.top - box.clientHeight / 3
  }
  /** Found again; `fresh` for a new query, which starts at the first match from where the reader is. */
  const search = (fresh: boolean): void => {
    const element = root.current
    const words = at.current.query
    ranges.current = element === null || words.trim().length === 0 ? [] : rangesIn(element, words)
    let next = Math.min(at.current.current, Math.max(0, ranges.current.length - 1))
    if (fresh) {
      const top = scroller.current?.getBoundingClientRect().top ?? 0
      const below = ranges.current.findIndex((range) => range.getBoundingClientRect().top >= top + 64)
      next = below === -1 ? 0 : below
    }
    at.current.current = next
    setCount(ranges.current.length)
    setCurrent(next)
    paint(next)
    if (fresh) show(next)
  }
  const move = (back: boolean): void => {
    if (ranges.current.length === 0) return
    const next = stepHit(at.current.current, ranges.current.length, back)
    at.current.current = next
    setCurrent(next)
    paint(next)
    show(next)
  }
  const close = (): void => {
    unmark()
    ranges.current = []
    setOpen(false)
    const back = returnTo.current
    if (back instanceof HTMLElement) back.focus()
  }

  // Each new press opens it; a press made before this conversation was on screen is not one.
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    if (request === seen.current) return
    seen.current = request
    if (!open) returnTo.current = document.activeElement
    setOpen(true)
    setAsked((count) => count + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])
  // The cursor goes into the box once it is drawn -- not on the next frame, which a window behind others never gets.
  useEffect(() => {
    if (!open || asked === 0) return
    input.current?.focus()
    input.current?.select()
  }, [asked, open])
  // A new query, as it is typed.
  useEffect(() => {
    if (!open) return undefined
    at.current.query = query
    const timer = setTimeout(() => { search(true) }, 90)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open])
  // The conversation grows -- a reply streaming in, earlier turns put on the page -- and is found again.
  useEffect(() => {
    const element = root.current
    if (!open || element === null || typeof MutationObserver === 'undefined') return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const watch = new MutationObserver(() => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => { search(false) }, 300)
    })
    watch.observe(element, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      if (timer !== undefined) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // Nothing stays marked once the conversation goes.
  useEffect(() => unmark, [])

  if (!open) return null
  return <div className="lc-threadfind">
    <div className="lc-threadfind__box">
      <div className="lc-threadfind__bar" role="search">
        <Icon name="search" size={13} />
        <input ref={input} className="lc-threadfind__input" value={query} placeholder="Find in this conversation" aria-label="Find in this conversation" spellCheck={false}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey) }
            if (event.key === 'Escape') { event.preventDefault(); close() }
          }} />
        <span className="lc-threadfind__count lc-mono" aria-live="polite">{findCountWords(count, current, query)}</span>
        <button type="button" className="lc-threadfind__step lc-threadfind__step--up" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={count === 0} onClick={() => { move(true) }}>
          <Icon name="chevron-down" size={13} />
        </button>
        <button type="button" className="lc-threadfind__step" aria-label="Next match" title="Next match (Enter)" disabled={count === 0} onClick={() => { move(false) }}>
          <Icon name="chevron-down" size={13} />
        </button>
        <button type="button" className="lc-threadfind__step" aria-label="Close find" title="Close (Esc)" onClick={close}>
          <Icon name="close" size={12} />
        </button>
      </div>
      {earlier !== undefined && earlier.count > 0 && query.trim().length > 0 && (
        <button type="button" className="lc-threadfind__earlier" onClick={earlier.onShowAll}>
          {`Also search the ${String(earlier.count)} earlier ${earlier.count === 1 ? 'turn' : 'turns'}`}
        </button>
      )}
    </div>
  </div>
}
