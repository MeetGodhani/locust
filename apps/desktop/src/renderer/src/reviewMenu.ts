import type { ContextMenuItem } from './components/ContextMenu.js'

/**
 * ASK FOR A REVIEW, in a conversation's More actions (0.799). One row that
 * opens the reviewers beside it, and the pair on two different agents below a
 * hairline. Colin, 2026-10-19: "ask for a review should prob be folded into a
 * dropdown" -- five teammates and a pair were six rows burying the rest of the
 * menu. A lone reviewer with no pair stays one row that says who.
 */
export function reviewMenuItem<T extends { readonly name: string }, P extends { readonly name: string }>(
  reviewers: readonly T[],
  pair: readonly [P, P] | undefined,
  agentOf: (teammate: P) => string,
  ask: (reviewer: T) => void,
  askTwo: (pair: readonly [P, P]) => void
): ContextMenuItem | undefined {
  const lone = reviewers.length === 1 && pair === undefined ? reviewers[0] : undefined
  if (lone !== undefined) return { label: `Ask ${lone.name} for a review`, onSelect: () => ask(lone) }
  const asks: ContextMenuItem[] = reviewers.map((reviewer) => ({ label: reviewer.name, onSelect: () => ask(reviewer) }))
  if (pair !== undefined) {
    asks.push({
      label: `${pair[0].name} (${agentOf(pair[0])}) and ${pair[1].name} (${agentOf(pair[1])})`,
      dividerAbove: asks.length > 0,
      onSelect: () => askTwo(pair)
    })
  }
  return asks.length === 0 ? undefined : { label: 'Ask for a review', submenu: asks }
}
