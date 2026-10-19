/** Reference identities come from the host's picker or its own GitHub cache, never a window-supplied path. */
export interface ConversationReference {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly repository?: string
  readonly refreshedAt?: number
  readonly problem?: string
}

export const REFERENCES_CHANNEL = 'conversation:references'
export const MAX_REFERENCES = 5
export type ReferencesReply = { readonly ok: true; readonly references: readonly ConversationReference[]; readonly cwd?: string } | { readonly ok: false; readonly message: string }
export type ReferenceRequest =
  | { readonly action: 'list'; readonly missionId?: string }
  | { readonly action: 'folder' }
  | { readonly action: 'github'; readonly repository: string }
  | { readonly action: 'set'; readonly missionId: string; readonly ids: readonly string[] }
  | { readonly action: 'discard'; readonly id: string }

/** Never change a mode or its tools for a reference. An extra writable root is not a read-only grant. */
export function referenceAccess(runtime: string, mode: string, path: string, cwd?: string, cloud = false): { readonly include: boolean; readonly note: string } {
  if (cloud) return { include: false, note: 'Not shared: this reference is on this computer, not your cloud computer.' }
  if (mode === 'auto') return { include: true, note: 'This mode can change it. The brief asks for reading, not changing.' }
  if (runtime === 'claude') return { include: true, note: 'For reading, not changing.' }
  const normalize = (value: string): string => {
    const path = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path
  }
  const inside = cwd !== undefined && (normalize(path) === normalize(cwd) || normalize(path).startsWith(`${normalize(cwd)}/`))
  if (inside) return { include: true, note: mode === 'ask' || mode === 'plan' ? 'For reading, not changing.' : 'This reference is inside the working folder. This mode can change it.' }
  if (runtime === 'codex') return { include: true, note: 'For reading, not changing. No extra writable folder is granted.' }
  if ((mode === 'ask' || mode === 'plan') && ['claude', 'opencode', 'copilot', 'antigravity'].includes(runtime)) return { include: true, note: 'For reading, not changing.' }
  if (['claude', 'opencode', 'copilot', 'antigravity'].includes(runtime)) return { include: false, note: 'Not shared in this mode: adding this folder would also grant write access. Use Ask or Auto.' }
  // No extra path grant for other runtimes. Naming a folder must not change their existing permissions either.
  return { include: true, note: 'Named in the brief; this runtime\'s existing permissions still apply.' }
}
