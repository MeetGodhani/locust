/** Private local API, carried by the existing authenticated /tools/call listener, never advertised as MCP tools. */
export interface CliTeammate {
  readonly id: string
  readonly name: string
  readonly runtime: string | null
  readonly model: string | null
  readonly runs_in: string
}

export interface CliSession {
  readonly sessionId: string
  /** Per-session capability: never printed, logged, or persisted. */
  readonly key: string
  readonly teammate: CliTeammate
  readonly workspace: string
}

export interface CliText {
  readonly sequence: number
  readonly itemId: string
  readonly operation: 'append' | 'replace'
  readonly text: string
}

export interface CliApproval {
  readonly approvalId: string
  readonly kind: 'command' | 'file-change' | 'connector' | 'question'
  readonly summary: string
  readonly detail: string
  readonly cwd: string | null
  /**
   * Answered in Locust, not in the editor: every question (secret ones especially, never reduced to a yes/no
   * permission), and every card while Let editors answer cards for their own turns is off in Locust's Settings.
   */
  readonly answerInLocust: boolean
}

export interface CliTurn {
  readonly requestId: string
  readonly phase: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
  readonly missionId?: string
  readonly runId?: string
  readonly message?: string
}

export interface CliPoll {
  readonly turn?: CliTurn
  readonly events: readonly CliText[]
  readonly cursor: number
  readonly approvals: readonly CliApproval[]
}

export interface CliStatus {
  readonly workspace: string
  readonly turns: readonly {
    readonly missionId: string
    readonly teammate: string
    readonly state: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  }[]
}
