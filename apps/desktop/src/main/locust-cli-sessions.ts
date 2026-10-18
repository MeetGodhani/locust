import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import type { CliApproval, CliPoll, CliSession, CliStatus, CliTeammate, CliText, CliTurn } from '@teammate/cli/protocol'
import type { CodexMissionStartRequest, CodexMissionStartResponse, CodexMissionUpdate, MissionApprovalRequest, MissionMode } from '../shared/ipc.js'
import { mcpText } from './locust-mcp-host.js'

interface Turn {
  state: CliTurn
  starting: boolean
  stopped: boolean
  finished: boolean
  events: CliText[]
  sequence: number
  bytes: number
  acknowledged: number
}
interface Session {
  readonly public: CliSession
  readonly cancelledRequests: Set<string>
  readonly requests: Map<string, string>
  expires: number
  closed: boolean
  missionId?: string
  turn?: Turn
}

/**
 * The CLI/editor's private API on the existing loopback listener. It never appears in the MCP bridge's tool list.
 * A random, process-local capability owns one new conversation; neither cancellation nor decisions accept a run
 * or mission supplied by the client. Existing window/phone/MCP conversations cannot be adopted. The editor can
 * authorize only a pending action of its own turn, once, through the window's guarded decision path, and only
 * while the person has turned on Let editors answer cards for their own turns (0.790). Any app connected to
 * Locust holds the key that opens a session, so until then every card waits in the window, as it always has.
 */
export function createLocustCliSessions(options: {
  readonly teammates: () => Promise<readonly CliTeammate[]>
  readonly workspace: () => string | undefined
  readonly start: (request: CodexMissionStartRequest, update: (update: CodexMissionUpdate) => void) => Promise<CodexMissionStartResponse>
  readonly cancel: (runId: string) => void
  readonly approvals: () => readonly MissionApprovalRequest[]
  readonly answer: (approvalId: string, approve: boolean) => Promise<boolean>
  /** Let editors answer cards for their own turns, in Settings (off by default): read at every poll and decision. */
  readonly editorAnswers: () => boolean
  /** A session opened: from now on Settings shows that switch. */
  readonly opened?: () => void
  readonly status: () => Promise<CliStatus>
  readonly now?: () => number
  readonly leaseMs?: number
  readonly startTimeoutMs?: number
}) {
  const now = options.now ?? Date.now
  const leaseMs = options.leaseMs ?? 30_000
  const sessions = new Map<string, Session>()
  let disposed = false
  const terminal = (turn: Turn) => !turn.starting && turn.finished
  const cancel = (session: Session) => {
    const turn = session.turn
    if (turn === undefined || terminal(turn)) return
    turn.stopped = true
    turn.state = { ...turn.state, phase: 'cancelled' }
    if (turn.state.runId !== undefined) options.cancel(turn.state.runId)
  }
  const close = (session: Session) => {
    session.closed = true
    cancel(session)
    sessions.delete(session.public.sessionId)
  }
  const expire = () => { for (const session of sessions.values()) if (session.expires <= now()) close(session) }
  const timer = setInterval(expire, Math.min(1_000, leaseMs))
  timer.unref()
  const owned = (args: Record<string, unknown>): Session | undefined => {
    const session = typeof args.sessionId === 'string' ? sessions.get(args.sessionId) : undefined
    if (!session || typeof args.key !== 'string' || !/^[0-9a-f]{64}$/.test(args.key) || !timingSafeEqual(Buffer.from(args.key), Buffer.from(session.public.key))) return undefined
    session.expires = now() + leaseMs
    return session
  }
  const pending = (session: Session): readonly CliApproval[] => {
    const turn = session.turn
    if (turn === undefined || turn.stopped || terminal(turn) || turn.state.missionId === undefined || turn.state.runId === undefined) return []
    return options.approvals().filter(a => a.missionId === turn.state.missionId && a.runId === turn.state.runId).map(a => ({
      approvalId: a.approvalId, kind: a.kind, summary: a.summary, detail: a.kind === 'question' ? '' : a.detail, cwd: a.cwd,
      answerInLocust: a.kind === 'question' || a.answerIn !== undefined || !options.editorAnswers()
    }))
  }
  const start = async (session: Session, turn: Turn, message: string) => {
    const deadline = setTimeout(() => {
      if (!turn.starting || turn.stopped) return
      turn.stopped = true
      turn.state = { ...turn.state, phase: 'failed', message: 'The teammate did not finish starting in time. Check Locust before creating a new editor session; nothing was retried.' }
      if (turn.state.runId !== undefined) options.cancel(turn.state.runId)
    }, options.startTimeoutMs ?? 120_000)
    deadline.unref()
    try {
      const team = await options.teammates()
      const teammate = team.find(t => t.id === session.public.teammate.id)
      if (teammate === undefined) throw new Error('This teammate is no longer in Locust. Run locust teammates and choose another.')
      if (options.workspace() !== session.public.workspace) throw new Error('The folder open in Locust changed. Create a new editor session before sending.')
      if (turn.stopped || session.closed || disposed) { turn.starting = false; turn.finished = true; return }
      const mode = teammate.runs_in as MissionMode
      const result = await options.start({ prompt: message, teammateId: teammate.id, mode, keepSavedRoute: true,
        ...(session.missionId === undefined ? {} : { followUpOf: session.missionId }) } as CodexMissionStartRequest, update => {
        if (session.turn !== turn) return
        if ('runId' in update && 'missionId' in update) {
          const firstRun = turn.state.runId === undefined
          turn.state = { ...turn.state, runId: update.runId, missionId: update.missionId }
          if (turn.stopped && firstRun) options.cancel(update.runId)
        }
        const events = update.kind === 'event' ? [update.event] : update.kind === 'message-deltas' ? update.events : []
        if (events.some(event => event.type === 'run.completed' || event.type === 'run.cancelled' || event.type === 'run.failed')) turn.finished = true
        if (turn.stopped || session.closed) return
        if (update.kind === 'transport-error' || update.kind === 'persistence-error') {
          turn.state = { ...turn.state, phase: 'failed', message: update.error.message }
          if (turn.state.runId !== undefined) options.cancel(turn.state.runId)
        }
        for (const event of events) {
          if (event.type === 'message.delta') {
            const { itemId, operation, text } = event.payload
            const bytes = Buffer.byteLength(text)
            if (turn.bytes + bytes > 2 * 1024 * 1024 || turn.events.length >= 8_000) {
              turn.state = { ...turn.state, phase: 'failed', message: 'The editor did not keep up with the reply. Read it in Locust; nothing was resent.' }
              turn.stopped = true
              if (turn.state.runId !== undefined) options.cancel(turn.state.runId)
              break
            }
            turn.bytes += bytes
            turn.events.push({ sequence: ++turn.sequence, itemId, operation, text })
          } else if (event.type === 'run.completed') turn.state = { ...turn.state, phase: 'completed' }
          else if (event.type === 'run.cancelled') turn.state = { ...turn.state, phase: 'cancelled' }
          else if (event.type === 'run.failed') turn.state = { ...turn.state, phase: 'failed', message: event.payload.message }
        }
      })
      turn.starting = false
      if (!result.ok) {
        turn.finished = true
        if (!turn.stopped) turn.state = { ...turn.state, phase: 'failed', message: result.error.message }
        return
      }
      session.missionId = result.data.missionId
      turn.state = { ...turn.state, missionId: result.data.missionId, runId: result.data.runId,
        phase: turn.stopped ? turn.state.phase : turn.state.phase === 'starting' ? 'running' : turn.state.phase }
      if (turn.stopped || session.closed || disposed) options.cancel(result.data.runId)
    } catch (error) {
      turn.starting = false
      if (turn.state.runId === undefined) turn.finished = true
      if (!turn.stopped) turn.state = { ...turn.state, phase: 'failed', message: error instanceof Error ? error.message : 'The teammate could not start. Check the conversation in Locust.' }
    } finally {
      clearTimeout(deadline)
    }
  }
  return {
    async call(name: string, input: unknown) {
      expire()
      if (disposed) return mcpText('Locust is closing. Open it again before sending.', true)
      const args = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {}
      if (name === 'cli/status') return mcpText(JSON.stringify(await options.status()))
      if (name === 'cli/open') {
        if (sessions.size >= 128) return mcpText('Too many editor sessions are open. Close an editor session and try again.', true)
        const workspace = options.workspace()
        if (workspace === undefined) return mcpText('Choose a folder in Locust before sending a message.', true)
        const normalized = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
        if (args.cwd !== undefined && (typeof args.cwd !== 'string' || normalized(args.cwd) !== normalized(workspace))) return mcpText('The editor’s folder is not the folder open in Locust. Open that folder in Locust, then create a new editor session.', true)
        const team = await options.teammates()
        if (disposed) return mcpText('Locust is closing. Nothing was started.', true)
        const matches = args.teammate === undefined ? team.slice(0, 1) : team.filter(t => t.id === args.teammate || typeof args.teammate === 'string' && t.name.toLowerCase() === args.teammate.toLowerCase())
        if (matches.length !== 1) return mcpText(`That teammate could not be identified. Choose one from locust teammates: ${team.map(t => `${t.name} (${t.id})`).join(', ') || 'add a teammate in Locust first'}. Nothing was started.`, true)
        const publicSession: CliSession = { sessionId: randomUUID(), key: randomBytes(32).toString('hex'), teammate: matches[0]!, workspace }
        if (sessions.size >= 128) return mcpText('Too many editor sessions are open. Close a session and try again.', true)
        sessions.set(publicSession.sessionId, { public: publicSession, cancelledRequests: new Set(), requests: new Map(), expires: now() + leaseMs, closed: false })
        options.opened?.()
        return mcpText(JSON.stringify(publicSession))
      }
      const session = owned(args)
      if (session === undefined) return mcpText('This editor session is no longer connected to Locust. Create a new session.', true)
      if (name === 'cli/close') { close(session); return mcpText('{"ok":true}') }
      if (name === 'cli/keepalive') return mcpText('{"ok":true}')
      if (name === 'cli/cancel') {
        if (typeof args.requestId === 'string' && args.requestId.length <= 100 && session.turn?.state.requestId !== args.requestId) {
          session.cancelledRequests.add(args.requestId)
          if (session.cancelledRequests.size > 100) close(session)
        } else cancel(session)
        return mcpText('{"ok":true}')
      }
      if (name === 'cli/decide') {
        if (!options.editorAnswers()) return mcpText('Answering cards from the editor is off, so this one waits in Locust. To answer them in the editor, turn on Let editors answer cards for their own turns in Locust’s Settings.', true)
        const card = pending(session).find(a => a.approvalId === args.approvalId)
        if (!card || card.answerInLocust || typeof args.approve !== 'boolean') return mcpText('That action is not waiting for this editor. Answer questions in Locust.', true)
        const ok = await options.answer(card.approvalId, args.approve)
        return mcpText(JSON.stringify({ ok }))
      }
      if (name === 'cli/prompt') {
        if (typeof args.message !== 'string' || args.message.trim().length === 0 || args.message.length > 8_000 || args.message.includes('\0') || typeof args.requestId !== 'string' || args.requestId.length > 100) return mcpText('Write a message of up to 8,000 characters. Nothing was sent.', true)
        const previous = session.turn
        const digest = createHash('sha256').update(args.message).digest('hex')
        if (session.requests.has(args.requestId)) return previous?.state.requestId === args.requestId && session.requests.get(args.requestId) === digest
          ? mcpText('{"ok":true}') : mcpText('That request was already accepted. Check the conversation in Locust; it was not sent again.', true)
        if (previous && !terminal(previous)) return mcpText('This editor session is still working. Cancel it or wait for its reply.', true)
        if (session.requests.size >= 1_024) return mcpText('This editor session reached its turn limit. Create a new session in the editor.', true)
        // Claim synchronously, before roster lookup or asynchronous startup. Cancellation also owns a late start.
        const wasCancelled = session.cancelledRequests.delete(args.requestId)
        const turn: Turn = { state: { requestId: args.requestId, phase: wasCancelled ? 'cancelled' : 'starting' }, starting: !wasCancelled, finished: wasCancelled, stopped: wasCancelled, events: [], sequence: 0, bytes: 0, acknowledged: 0 }
        session.turn = turn
        session.requests.set(args.requestId, digest)
        if (!wasCancelled) void start(session, turn, args.message)
        return mcpText('{"ok":true}')
      }
      if (name === 'cli/poll') {
        const turn = session.turn
        const after = args.after
        if (!Number.isSafeInteger(after) || (after as number) < 0 || turn && ((after as number) < turn.acknowledged || (after as number) > turn.sequence)) return mcpText('The reply cursor is no longer valid. Read the conversation in Locust.', true)
        if (turn) {
          turn.acknowledged = after as number
          turn.events = turn.events.filter(event => event.sequence > (after as number))
          turn.bytes = turn.events.reduce((sum, event) => sum + Buffer.byteLength(event.text), 0)
        }
        const poll: CliPoll = { ...(turn === undefined ? {} : { turn: turn.state }), events: turn?.events ?? [], cursor: turn?.sequence ?? 0, approvals: pending(session) }
        return mcpText(JSON.stringify(poll))
      }
      return mcpText('That command is not offered by Locust. Update the locust command and the app together.', true)
    },
    dispose() { disposed = true; clearInterval(timer); for (const session of sessions.values()) close(session) }
  }
}
