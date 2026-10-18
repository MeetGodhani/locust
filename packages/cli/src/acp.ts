import { isAbsolute } from 'node:path'
import { LocustClient, TextStream } from './client.js'
import type { CliApproval, CliSession, CliTeammate } from './protocol.js'

type ObjectValue = Record<string, unknown>
type Id = string | number
const object = (value: unknown): ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ObjectValue : {}
class RpcError extends Error { constructor(readonly code: number, message: string) { super(message) } }
interface Session {
  readonly connection: CliSession
  readonly team: readonly CliTeammate[]
  used: boolean
  configuring?: boolean
  active?: AbortController
}
interface Permission {
  readonly sessionId: string
  readonly approvalId: string
  readonly timer: ReturnType<typeof setTimeout>
  readonly resolve: (approve: boolean | undefined) => void
}

/** ACP v1 JSON-RPC, newline framed. stdout belongs only to the protocol, never diagnostics or tokens. */
export function createAcpAgent(options: {
  readonly client: LocustClient
  readonly send: (message: ObjectValue) => void
  readonly teammate?: string
  readonly diagnostic?: (message: string) => void
  readonly permissionTimeoutMs?: number
}) {
  const sessions = new Map<string, Session>()
  const permissions = new Map<Id, Permission>()
  const tasks = new Set<Promise<unknown>>()
  let permissionId = 0
  let initialized = false
  let closing = false
  let closePromise: Promise<void> | undefined
  const send = (message: ObjectValue) => { if (!closing) options.send({ jsonrpc: '2.0', ...message }) }
  const result = (id: Id, value: unknown) => send({ id, result: value })
  const failure = (id: Id | null, code: number, message: string) => send({ id, error: { code, message } })
  const update = (sessionId: string, value: unknown) => send({ method: 'session/update', params: { sessionId, update: value } })
  const configs = (session: Session) => [{ id: 'teammate', name: 'Teammate', type: 'select', currentValue: session.connection.teammate.id,
    options: session.team.map(t => ({ value: t.id, name: `${t.name} (${t.runtime ?? 'agent not set'} / ${t.model ?? 'model not set'})` })) }]
  const get = (id: unknown): Session => {
    const session = typeof id === 'string' ? sessions.get(id) : undefined
    if (!session) throw new RpcError(-32602, 'This editor session is not open. Create a new session in the editor.')
    return session
  }
  const clearPermissions = (sessionId: string, offered?: ReadonlySet<string>) => {
    for (const [id, pending] of permissions) {
      if (pending.sessionId !== sessionId || offered?.has(pending.approvalId)) continue
      clearTimeout(pending.timer)
      permissions.delete(id)
      pending.resolve(undefined)
    }
  }
  const permission = (sessionId: string, card: CliApproval): Promise<boolean | undefined> => new Promise(resolve => {
    const id = `locust-permission-${++permissionId}`
    const timer = setTimeout(() => { permissions.delete(id); resolve(false) }, options.permissionTimeoutMs ?? 120_000)
    permissions.set(id, { sessionId, approvalId: card.approvalId, timer, resolve })
    send({ id, method: 'session/request_permission', params: { sessionId,
      toolCall: { toolCallId: card.approvalId, title: card.summary,
        kind: card.kind === 'command' ? 'execute' : card.kind === 'file-change' ? 'edit' : 'other',
        content: [{ type: 'content', content: { type: 'text', text: card.detail } }],
        rawInput: { detail: card.detail, cwd: card.cwd } },
      options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow once' }, { optionId: 'deny', kind: 'reject_once', name: 'Deny' }] } })
  })
  const keepalive = setInterval(() => {
    for (const session of sessions.values()) {
      const task = options.client.call('cli/keepalive', { sessionId: session.connection.sessionId, key: session.connection.key })
        .catch(() => { session.active?.abort(); options.diagnostic?.('The editor lost its connection to Locust. Check Locust before sending again.') })
      tasks.add(task)
      void task.finally(() => tasks.delete(task))
    }
  }, 10_000)
  keepalive.unref()

  const handle = async (method: string, params: ObjectValue): Promise<unknown> => {
    if (method === 'initialize') {
      if (initialized) throw new RpcError(-32600, 'This editor connection is already initialized.')
      if (params.protocolVersion !== 1) throw new RpcError(-32602, 'Locust speaks Agent Client Protocol version 1. Update the editor’s ACP client.')
      initialized = true
      return { protocolVersion: 1, agentCapabilities: { loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false }, mcpCapabilities: { http: false, sse: false } },
      agentInfo: { name: 'locust', title: 'Locust', version: '0.0.1' }, authMethods: [] }
    }
    if (!initialized) throw new RpcError(-32600, 'Initialize this ACP connection before creating a session.')
    if (method === 'session/new') {
      if (typeof params.cwd !== 'string' || !isAbsolute(params.cwd) || !Array.isArray(params.mcpServers) || params.mcpServers.length !== 0) throw new RpcError(-32602, 'Use an absolute cwd and an empty mcpServers list. Locust uses the teammate’s connectors configured in Locust, not programs supplied by the editor.')
      const team = await options.client.teammates()
      const connection = await options.client.open(options.teammate, params.cwd)
      if (closing) { await options.client.close(connection); throw new RpcError(-32000, 'The editor connection closed. Nothing was sent.') }
      const session: Session = { connection, team, used: false }
      sessions.set(connection.sessionId, session)
      return { sessionId: connection.sessionId, configOptions: configs(session) }
    }
    if (method === 'session/set_config_option') {
      const session = get(params.sessionId)
      if (session.used || session.active || session.configuring) throw new RpcError(-32602, 'Create a new editor session to switch teammates after a conversation has started.')
      if (params.configId !== 'teammate' || typeof params.value !== 'string' || !session.team.some(t => t.id === params.value)) throw new RpcError(-32602, 'Choose a teammate from this session’s Teammate option.')
      session.configuring = true
      try {
        const connection = await options.client.open(params.value, session.connection.workspace)
        if (closing || sessions.get(params.sessionId as string) !== session) {
          await options.client.close(connection)
          throw new RpcError(-32602, 'This session changed while selecting a teammate. Create a new session.')
        }
        try { await options.client.close(session.connection) }
        catch (error) { await options.client.close(connection).catch(() => undefined); throw error }
        const next: Session = { connection, team: session.team, used: false }
        sessions.set(params.sessionId as string, next)
        return { configOptions: configs(next) }
      } finally {
        delete session.configuring
      }
    }
    if (method === 'session/prompt') {
      const sessionId = params.sessionId as string
      const session = get(sessionId)
      if (session.active || session.configuring) throw new RpcError(-32600, 'This session is still working. Cancel the turn or wait for its reply.')
      if (!Array.isArray(params.prompt) || params.prompt.length === 0 || params.prompt.some(block => object(block).type !== 'text' || typeof object(block).text !== 'string')) throw new RpcError(-32602, 'Locust accepts text prompts only. Send text, not a file, image, audio, or embedded resource.')
      const text = params.prompt.map(block => object(block).text as string).join('\n\n')
      if (text.trim().length === 0 || text.length > 8_000) throw new RpcError(-32602, 'Write a text prompt of up to 8,000 characters. Nothing was sent.')
      const controller = new AbortController()
      session.active = controller
      session.used = true
      const seen = new Set<string>()
      const answers = new Set<Promise<void>>()
      const stream = new TextStream(text => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }))
      controller.signal.addEventListener('abort', () => clearPermissions(sessionId), { once: true })
      try {
        const stopReason = await options.client.prompt(session.connection, text, { signal: controller.signal, onText: event => stream.accept(event),
          onApprovals: (cards, signal) => {
            clearPermissions(sessionId, new Set(cards.map(card => card.approvalId)))
            for (const card of cards) {
              if (seen.has(card.approvalId)) continue
              seen.add(card.approvalId)
              if (card.answerInLocust) { update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `\nWaiting for you in Locust: ${card.summary}\n` } }); continue }
              const task = permission(sessionId, card).then(async approve => {
                if (approve !== undefined && !signal.aborted && !controller.signal.aborted) await options.client.decide(session.connection, card.approvalId, approve)
              }).catch(() => { options.diagnostic?.('The permission answer could not be delivered. Check the card in Locust.'); controller.abort() })
              answers.add(task)
              void task.finally(() => answers.delete(task))
            }
          } })
        return { stopReason }
      } finally {
        controller.abort()
        clearPermissions(sessionId)
        await Promise.all(answers)
        delete session.active
      }
    }
    if (method === 'session/cancel') { get(params.sessionId).active?.abort(); return {} }
    throw new RpcError(-32601, 'Locust does not offer that ACP method. It offers no editor filesystem or terminal operations.')
  }
  const accept = (raw: string) => {
    if (closing) return
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { failure(null, -32700, 'This ACP message is not valid JSON.'); return }
    const message = object(parsed)
    if (message.jsonrpc !== '2.0') { failure(null, -32600, 'Use a JSON-RPC 2.0 object.'); return }
    const id = typeof message.id === 'string' || typeof message.id === 'number' && Number.isFinite(message.id) ? message.id : undefined
    if (typeof message.method !== 'string') {
      const waiting = id === undefined ? undefined : permissions.get(id)
      if (waiting) {
        permissions.delete(id!)
        clearTimeout(waiting.timer)
        const outcome = object(object(message.result).outcome)
        waiting.resolve(outcome.outcome === 'selected' && outcome.optionId === 'allow' && message.error === undefined)
      }
      return
    }
    // Only cancel is a supported notification. Never start a hidden turn without a request id to answer.
    if (id === undefined && message.method !== 'session/cancel') return
    const task = handle(message.method, object(message.params)).then(value => { if (id !== undefined) result(id, value) }, error => {
      if (id !== undefined) failure(id, error instanceof RpcError ? error.code : -32000, error instanceof Error ? error.message : 'Locust could not finish. Check the conversation in Locust.')
    })
    tasks.add(task)
    void task.finally(() => tasks.delete(task))
  }
  return {
    accept,
    close(): Promise<void> {
      if (closePromise) return closePromise
      closing = true
      clearInterval(keepalive)
      for (const [id, session] of sessions) { session.active?.abort(); clearPermissions(id) }
      closePromise = (async () => {
        await Promise.allSettled([...tasks])
        await Promise.all([...sessions.values()].map(session => options.client.close(session.connection).catch(() => options.diagnostic?.('The editor disconnected, but stopping its turn could not be confirmed. Check Locust.'))))
        sessions.clear()
      })()
      return closePromise
    }
  }
}
