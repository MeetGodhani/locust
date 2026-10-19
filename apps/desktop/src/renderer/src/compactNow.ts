import type { RuntimeCommandsResponse } from '../../shared/ipc.js'

/**
 * COMPACT NOW, FROM THE CONTEXT RING (0.797).
 *
 * The OpenCode 2 docs review on 2026-10-19 (gap J): OpenCode offers "Compact
 * session", and Claude Code says "Run /compact to compact & continue" as its
 * context fills. Locust had `/compact` only in the `/` menu, where nobody
 * looking at an amber ring would think to find it. Pressing the ring now
 * opens what it says, with Compact now beneath, and that sends `/compact` as
 * the conversation's next message -- exactly what typing it would send --
 * while whatever is in the box stays there.
 *
 * While a turn runs it waits in line instead, as a message sent then does:
 * Orca's chat does the same ("a /compact you send while the agent is working
 * waits in line instead of being refused", its docs, read the same day).
 *
 * Offered only where the runtime itself lists `compact`, and only for a
 * message that would reach this conversation's runtime: a comparison, a cloud
 * or background turn, or an earlier message being edited sends somewhere that
 * cannot compact it, so the ring then stays a ring. Another model in the
 * route chip, or a message already waiting, keeps the item and says why.
 */
export type CompactOffer =
  | { readonly kind: 'ready' }
  | { readonly kind: 'after-turn' }
  | { readonly kind: 'refused'; readonly reason: string }

export function compactOffer(options: {
  /** The runtime this conversation's last turn ran on. */
  readonly runtime: string | undefined
  /** The runtime the route chip would send the next message to. */
  readonly nextRuntime: string
  readonly runtimeName: string
  readonly commands: RuntimeCommandsResponse | undefined
  readonly running: boolean
  /** A message already waiting for the running turn to end. */
  readonly queued: boolean
  /** A comparison, a cloud or background turn, or an earlier message being edited. */
  readonly elsewhere: boolean
}): CompactOffer | undefined {
  const { runtime } = options
  if (runtime === undefined || options.elsewhere) return undefined
  if (runtime !== 'claude' && runtime !== 'codex' && runtime !== 'opencode') return undefined
  if (!(options.commands?.[runtime] ?? []).some((command) => command.name === 'compact')) return undefined
  if (options.nextRuntime !== runtime) {
    return { kind: 'refused', reason: `Your next message goes to another model. Pick ${options.runtimeName} again to compact this conversation.` }
  }
  if (options.running && options.queued) {
    return { kind: 'refused', reason: 'A message is already waiting for this turn to end. Compact after it goes.' }
  }
  return options.running ? { kind: 'after-turn' } : { kind: 'ready' }
}

/** What Compact now says it does, under its name. */
export function compactConsequence(runtimeName: string): string {
  return `Summarize the conversation so far, so the turns ahead have room. ${runtimeName} also does this on its own when the context is full.`
}

/** And while a turn runs, when it waits for it. */
export function compactAfterTurn(runtimeName: string): string {
  return `Waits until ${runtimeName} finishes this turn, then summarizes the conversation so far.`
}
