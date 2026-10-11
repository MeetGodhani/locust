export const LOCUST_MCP_GET = 'locust-mcp:get'
export const LOCUST_MCP_SET = 'locust-mcp:set'
export const LOCUST_MCP_SET_OWN_MODE = 'locust-mcp:set-own-mode'
/** Locust in the Claude app's tools (0.740): read where it stands, and add or remove it in one press. */
export const LOCUST_MCP_CLAUDE_APP = 'locust-mcp:claude-app'
export const LOCUST_MCP_CLAUDE_APP_SET = 'locust-mcp:claude-app-set'
export const LOCUST_MCP_CLAUDE_APP_RESTART = 'locust-mcp:claude-app-restart'
export type ClaudeAppConnection =
  | { readonly kind: 'no-app' }
  | { readonly kind: 'not-added' }
  /** `restart`: Claude was open when Locust was added, and reads its settings only when it starts. */
  | { readonly kind: 'added'; readonly restart?: boolean }
  | { readonly kind: 'unreadable'; readonly message: string }
export interface ClaudeAppResult {
  readonly connection: ClaudeAppConnection
  /** The local server's state after the press: Add turns it on. */
  readonly state?: LocustMcpState
  readonly message?: string
}
export interface LocustMcpState {
  readonly enabled: boolean
  /**
   * Off (the default): every turn another app starts is Ask, read only. On:
   * the teammate's own saved mode, with approvals answered only in Locust's
   * window and Auto only where Settings allows it (0.703).
   */
  readonly ownMode: boolean
  readonly claudeCommand?: string
  readonly codexConfig?: string
  readonly message?: string
}
export interface LocustMcpApi {
  settings(): Promise<LocustMcpState>
  setEnabled(enabled: boolean): Promise<LocustMcpState>
  setOwnMode(ownMode: boolean): Promise<LocustMcpState>
  claudeApp?(): Promise<ClaudeAppConnection>
  setClaudeApp?(added: boolean): Promise<ClaudeAppResult>
  /** Close the Claude app and open it again, so it reads Locust's entry. */
  restartClaudeApp?(): Promise<ClaudeAppResult>
}
