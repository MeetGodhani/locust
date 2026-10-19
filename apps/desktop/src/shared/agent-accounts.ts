export const AGENT_ACCOUNTS_CHANNEL = 'agent-accounts:call'
export type AccountAgent = 'claude' | 'codex'
export interface AgentAccount {
  readonly id: string
  readonly runtime: AccountAgent
  readonly name: string
  readonly state: 'new' | 'waiting' | 'ready' | 'failed'
  /** Display only; the renderer never chooses a home. */
  readonly home?: string
}
export interface AgentAccountsState {
  readonly ok: boolean
  readonly accounts: readonly AgentAccount[]
  readonly message?: string
  /** Development-only, read-only drive receipt. Never contains the parent environment. */
  readonly preview?: { readonly runtime: AccountAgent; readonly variable: string; readonly home: string }
}
export type AccountAction = { readonly kind: 'list' } | { readonly kind: 'add'; readonly runtime: string; readonly name: string }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | { readonly kind: 'remove' | 'login' | 'cancel' | 'preview'; readonly id: string }
export const supportsAccounts = (runtime: string): runtime is AccountAgent => runtime === 'claude' || runtime === 'codex'
export const isAccountId = (id: unknown): id is string => typeof id === 'string' && /^account_[a-f0-9]{32}$/.test(id)
export const accountUsageKey = (runtime: string, account?: string): string => account === undefined ? runtime : `${runtime}:${account}`
export const accountFromRoute = (route: string): string | undefined => /-account:(account_[a-f0-9]{32})$/.exec(route)?.[1]
