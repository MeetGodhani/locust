import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { CliApproval, CliPoll, CliSession, CliStatus, CliTeammate, CliText } from './protocol.js'

const SWITCH = 'Open Locust and turn on Settings > General > Let your other AI apps use Locust.'
const MAX_REPLY = 5 * 1024 * 1024
export class LocalError extends Error {}

/** Electron's appData locations. --profile explicitly selects a development or --user-data-dir profile. */
export function profileDirectory(platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (platform === 'win32') {
    if (!env.APPDATA) throw new LocalError('The Windows profile folder could not be found. Pass --profile with Locust’s profile folder.')
    return win32.join(env.APPDATA, '@teammate', 'desktop')
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', '@teammate', 'desktop')
  return posix.join(env.XDG_CONFIG_HOME || posix.join(home, '.config'), '@teammate', 'desktop')
}

type Connection = { readonly url: string; readonly token: string }
function connectionOf(raw: string): Connection {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid')
  const { url, token } = parsed as Record<string, unknown>
  if (typeof url !== 'string' || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new Error('invalid')
  const address = new URL(url)
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.pathname !== '/tools/call' || !address.port || address.search || address.hash || address.username || address.password) throw new Error('invalid')
  return { url, token }
}

/** No redirects, proxies, shell, automatic retry, or reads of another app's config. */
export class LocustClient {
  constructor(private readonly profile: string, private readonly timeoutMs = 15_000) {}

  async call<T>(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    let connection: Connection
    try { connection = connectionOf(await readFile(join(this.profile, 'locust-mcp-connection.json'), 'utf8')) }
    catch { throw new LocalError(`Locust is not open, or its local server is off. ${SWITCH}`) }
    return new Promise<T>((resolve, reject) => {
      const payload = JSON.stringify({ name, arguments: args })
      // A direct one-use agent also bypasses a global Agent configured with an environment proxy.
      const req = request(connection.url, { method: 'POST', agent: false, ...(signal === undefined ? {} : { signal }), headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } })
      const timer = setTimeout(() => req.destroy(new LocalError('Locust did not answer in time. Nothing was retried; check the conversation in Locust before sending again.')), this.timeoutMs)
      const done = (error?: Error, value?: T) => { clearTimeout(timer); if (error) reject(error); else resolve(value as T) }
      req.on('error', error => done(error instanceof LocalError ? error : new LocalError(`The connection to Locust ended without an answer. Nothing was retried. ${SWITCH} Check the conversation before sending again.`)))
      req.on('response', res => {
        if (res.statusCode !== 200) {
          res.resume()
          done(new LocalError(res.statusCode === 401 ? `Locust refused this connection. ${SWITCH}` : 'This Locust could not complete the request. Update Locust and check the conversation before sending again.'))
          return
        }
        const chunks: Buffer[] = []
        let bytes = 0
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_REPLY) req.destroy(new LocalError('Locust’s answer was too large. Read the conversation in Locust.')); else chunks.push(chunk) })
        res.on('error', () => done(new LocalError('Locust’s answer was interrupted. Nothing was retried; read the conversation in Locust.')))
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { content?: { type: string; text: string }[]; isError?: boolean }
            const text = body.content?.filter(c => c.type === 'text').map(c => c.text).join('\n')
            if (typeof text !== 'string') throw new Error('shape')
            if (body.isError) { done(new LocalError(text)); return }
            done(undefined, JSON.parse(text) as T)
          } catch { done(new LocalError('Locust returned an unreadable answer. Update Locust; nothing was retried.')) }
        })
      })
      req.end(payload)
    })
  }

  teammates(): Promise<readonly CliTeammate[]> { return this.call('list_teammates') }
  status(): Promise<CliStatus> { return this.call('cli/status') }
  open(teammate?: string, cwd?: string): Promise<CliSession> { return this.call('cli/open', { ...(teammate === undefined ? {} : { teammate }), ...(cwd === undefined ? {} : { cwd }) }) }
  close(session: CliSession): Promise<unknown> { return this.call('cli/close', this.auth(session)) }
  cancel(session: CliSession, requestId?: string): Promise<unknown> { return this.call('cli/cancel', { ...this.auth(session), ...(requestId === undefined ? {} : { requestId }) }) }
  decide(session: CliSession, approvalId: string, approve: boolean): Promise<unknown> { return this.call('cli/decide', { ...this.auth(session), approvalId, approve }) }
  private auth(session: CliSession): Record<string, unknown> { return { sessionId: session.sessionId, key: session.key } }

  async prompt(session: CliSession, message: string, options: {
    readonly signal?: AbortSignal
    readonly onText: (event: CliText) => void
    readonly onApprovals?: (approvals: readonly CliApproval[], signal: AbortSignal) => void
    readonly pollMs?: number
  }): Promise<'end_turn' | 'cancelled'> {
    if (options.signal?.aborted) return 'cancelled'
    const permissions = new AbortController()
    const requestId = randomUUID()
    let cancelSent: Promise<unknown> | undefined
    const stop = () => {
      permissions.abort()
      cancelSent ??= this.cancel(session, requestId)
      // Observe it immediately, even if a poll is still waiting for its transport deadline.
      void cancelSent.catch(() => undefined)
    }
    options.signal?.addEventListener('abort', stop, { once: true })
    try {
      await this.call('cli/prompt', { ...this.auth(session), message, requestId })
      let cursor = 0
      while (true) {
        if (options.signal?.aborted) { await cancelSent; return 'cancelled' }
        const poll = await this.call<CliPoll>('cli/poll', { ...this.auth(session), after: cursor }, options.signal)
        if (options.signal?.aborted) { await cancelSent; return 'cancelled' }
        for (const event of poll.events) options.onText(event)
        cursor = poll.cursor
        options.onApprovals?.(poll.approvals, permissions.signal)
        if (poll.turn?.phase === 'completed') return 'end_turn'
        if (poll.turn?.phase === 'cancelled') return 'cancelled'
        if (poll.turn?.phase === 'failed') throw new LocalError(poll.turn.message ?? 'The teammate could not finish. Read the conversation in Locust.')
        await delay(options.pollMs ?? 250, undefined, { signal: options.signal }).catch(error => { if (!options.signal?.aborted) throw error })
      }
    } catch (error) {
      stop()
      await cancelSent?.catch(() => undefined)
      if (options.signal?.aborted) return 'cancelled'
      throw error
    } finally {
      permissions.abort()
      options.signal?.removeEventListener('abort', stop)
      // Also observes a rejected cancellation, never an unhandled background rejection.
      await cancelSent
    }
  }
}

/** ACP has append-only chunks. Do not print the final replacement a second time. */
export class TextStream {
  private readonly items = new Map<string, string>()
  constructor(private readonly write: (text: string) => void) {}
  accept(event: CliText): void {
    const before = this.items.get(event.itemId) ?? ''
    const after = event.operation === 'append' ? before + event.text : event.text
    if (!after.startsWith(before)) throw new LocalError('The agent revised text already streamed. Read the corrected answer in Locust.')
    this.items.set(event.itemId, after)
    if (after.length > before.length) this.write(after.slice(before.length))
  }
}
