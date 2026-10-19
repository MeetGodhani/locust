/** An estimate returned by Claude Code's own /context, never an estimate of our own. */
export interface ContextCategory { readonly name: string; readonly tokens: number }
export interface ClaudeContextBreakdown {
  readonly categories: readonly ContextCategory[]
  readonly used: number
  readonly window: number
}
export const CONTEXT_BREAKDOWN_CHANNEL = 'mission:claude-context'

export function contextTokens(tokens: number): string {
  const scale = tokens >= 1_000_000 ? 1_000_000 : tokens >= 1_000 ? 1_000 : 1
  return `${String(Math.round(tokens / scale * 10) / 10)}${scale === 1_000_000 ? 'm' : scale === 1_000 ? 'k' : ''}`
}

/**
 * Listed by /context but not in the window: deferred tools load only when used, and the autocompact buffer is space
 * held back. MEASURED 2026-10-19 (Claude Code 2.1.303, connectors on): "MCP tools (deferred)" read 200.7k while the
 * whole conversation was 24k.
 */
export function inContext(row: ContextCategory): boolean {
  const name = row.name.toLowerCase()
  return !/\(deferred\)\s*$/.test(name) && name !== 'autocompact buffer'
}

/** Keep the menu short; free space is useful even when it is not among the biggest rows. */
export function contextCategories(breakdown: ClaudeContextBreakdown): readonly ContextCategory[] {
  const free = breakdown.categories.find((row) => row.name.toLowerCase() === 'free space')
  const largest = breakdown.categories.filter((row) => row !== free && inContext(row)).sort((a, b) => b.tokens - a.tokens).slice(0, 4)
  return free === undefined ? largest : [...largest, free]
}

/** Below this share of the window a category is not worth a sentence: a fresh conversation's 10k of skills is normal. */
export const CONTEXT_ADVICE_SHARE = 0.1

/** System costs are not a knob. Point only at the largest category the person can actually change, once it matters. */
export function contextAdvice(breakdown: ClaudeContextBreakdown): string | undefined {
  const controlled = new Map<string, number>()
  for (const row of breakdown.categories.filter(inContext)) {
    const name = row.name.toLowerCase()
    const key = name.startsWith('mcp ') ? 'connectors' : name
    if (['connectors', 'messages', 'skills', 'memory files', 'custom agents'].includes(key)) controlled.set(key, (controlled.get(key) ?? 0) + row.tokens)
  }
  const biggest = [...controlled].filter(([, tokens]) => tokens >= breakdown.window * CONTEXT_ADVICE_SHARE).sort((a, b) => b[1] - a[1])[0]
  if (biggest === undefined) return undefined
  const [name, tokens] = biggest, amount = contextTokens(tokens)
  if (name === 'connectors') return `Your connectors take ${amount}: untick ones this teammate does not need in Edit teammate.`
  if (name === 'messages') return `Messages take ${amount}. Compact this conversation to make room while keeping a summary.`
  if (name === 'skills') return `Skills take ${amount}. Review the project's skills and your Skills library for ones this teammate does not need.`
  if (name === 'memory files') return `Memory files take ${amount}. Shorten project instructions that repeat what is already in the conversation.`
  return `Custom agents take ${amount}. Keep only the agent definitions this teammate needs.`
}
