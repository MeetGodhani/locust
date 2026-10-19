import { connectorLabel } from './components/NewTeammateDialog.js'

/**
 * WHEN A TEAMMATE'S CONNECTORS ARE OFF (0.798).
 *
 * A teammate carries the person's connectors only once it has one ticked: Claude Code sends every tool of every
 * connector with each call, about 170k tokens a turn on Colin's account. Off is the right default, and a person who
 * types "check my Gmail" to a teammate without them should hear why it will not, before they send -- not from the
 * teammate saying it has no Gmail. So a draft that names a connector says so under the box.
 */
export function connectorMentioned(text: string, names: readonly string[]): string | undefined {
  const lower = text.toLowerCase()
  for (const name of names) {
    const label = connectorLabel(name)
    if (label.length < 3) continue
    const escaped = label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(lower)) return label
  }
  return undefined
}

/** What the box says, in the person's words: whose, which, and where to turn it on. */
export function connectorsOffHint(teammate: string, label: string): string {
  return `${teammate}'s connectors are off, so ${label} won't be in this turn. Tick it in ${teammate}'s settings, under Connectors, to turn it on.`
}
