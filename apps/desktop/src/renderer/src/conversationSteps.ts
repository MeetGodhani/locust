/**
 * MOVE BETWEEN CONVERSATIONS FROM THE KEYBOARD (2026-10-19). Alt+Down and Alt+Up open the next and the previous
 * conversation in the order the sidebar draws them -- a folded group's are not drawn, so they are passed over -- and
 * with Shift, the next or previous one waiting for you, a card to answer. Slack's keys for channels, and OpenCode 2's
 * for its session tabs. It goes round from the last to the first; with nowhere to go, nothing moves.
 *
 * `drawn` is the rows' conversation ids top to bottom; `shown` the one on screen, if it is among them.
 */
export function stepConversation(
  drawn: readonly string[],
  shown: string | undefined,
  step: 1 | -1,
  eligible: (id: string) => boolean = () => true
): string | undefined {
  const count = drawn.length
  if (count === 0) return undefined
  const at = shown === undefined ? -1 : drawn.indexOf(shown)
  // From nowhere, Down starts at the top and Up at the bottom.
  const from = at === -1 ? (step === 1 ? -1 : count) : at
  for (let moved = 1; moved <= count; moved += 1) {
    const index = (((from + step * moved) % count) + count) % count
    if (index !== at && eligible(drawn[index]!)) return drawn[index]
  }
  return undefined
}
