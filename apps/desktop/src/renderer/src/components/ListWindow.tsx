import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

/*
 * A LONG LIST IS DRAWN AS FAR AS IT IS READ (review 2026-10-15, P1 and P2).
 *
 * The conversation list mounted every row it had. Measured on the built app: a
 * streamed reply drew at 55 fps with 17 conversations listed, 12 fps with 334
 * and 7.5 with 667, the window blocked 9.4 to 10 s of every 10; clearing the
 * search box froze it for 6.9 s; each row cost about 13 ms and 0.6 MB, nearly
 * all of it the teammate's face. Hiding the rows gave back about 85%.
 *
 * So the list draws its first page, and the next as the person scrolls near
 * its end -- every conversation is still listed, as conversationRows says ("no
 * cap"), only not drawn before anyone looks. And a face is drawn when its row
 * comes near the screen, not when the row is mounted.
 */

/** How many rows a page of the list draws. About three screens of rows. */
export const LIST_PAGE = 80

/** How far outside the scrolled view a row starts being drawn, so it is there before it is seen. */
const NEAR = '600px'

/** The sidebar's own scroll box, which is what "near the screen" is measured against. */
function scrollerOf(node: Element): Element | null {
  return node.closest('.lc-sidebar__scroll')
}

/**
 * The end of a list drawn so far: a button saying how many are not drawn yet,
 * pressed by itself when it scrolls near (or by a person, by keyboard or where
 * nothing watches the scroll).
 */
export function ListMore({ remaining, onMore }: { readonly remaining: number; readonly onMore: () => void }): ReactElement {
  const ref = useRef<HTMLButtonElement>(null)
  const more = useRef(onMore)
  more.current = onMore
  useEffect(() => {
    const node = ref.current
    if (node === null || typeof IntersectionObserver === 'undefined') return
    // Watched again each time the list grows: one that is still in view after a page needs a fresh first answer.
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) more.current()
      },
      { root: scrollerOf(node), rootMargin: NEAR }
    )
    watch.observe(node)
    return () => watch.disconnect()
  }, [remaining])
  return (
    <button type="button" ref={ref} className="lc-listmore lc-row__meta" onClick={onMore}>
      {remaining === 1 ? '1 more conversation' : `${String(remaining)} more conversations`}
    </button>
  )
}

/**
 * Its children once it has come near the screen, and an empty box of their
 * size until then. Once drawn they stay: scrolling back is not paid twice.
 * Where nothing can watch (a test's document), it draws at once.
 */
export function WhenNear({ size, children }: { readonly size: number; readonly children: ReactNode }): ReactElement {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = ref.current
    if (near || node === null) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { root: scrollerOf(node), rootMargin: NEAR }
    )
    watch.observe(node)
    return () => watch.disconnect()
  }, [near])
  if (near) return <>{children}</>
  return <span ref={ref} className="lc-face" aria-hidden="true" style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }} />
}
