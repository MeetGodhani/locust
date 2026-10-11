import { basename } from 'node:path'

import { createAppServerClient } from '@teammate/runtime-adapters'
import type { AppServerClient, AppServerRunProcess as AppServerProcess, ExecutableLaunch, JsonValue } from '@teammate/runtime-adapters'

import {
  voiceCallInstructions,
  voiceCallRole,
  voiceCallSaid,
  voiceThreadConfig,
  type VoiceCallAvailability,
  type VoiceCallEvent,
  type VoiceCallStartResult
} from '../shared/voice-call.js'

/**
 * ONE VOICE CALL AT A TIME, placed by Codex (0.737). See shared/voice-call.ts for what was measured.
 *
 * The window makes the WebRTC offer and plays what comes back; this side starts Codex's app server,
 * checks it is signed in with ChatGPT, opens a read-only thread of its own in the person's folder with
 * every add-on off, asks for the call on realtime v3, and hands the window the voice service's answer.
 * What is said comes back as Codex's transcript notifications and goes to the window as lines.
 */
export interface VoiceCallDeps {
  /** Codex as discovery found it, when it is ready to start. */
  readonly codex: () => Promise<ExecutableLaunch | undefined>
  readonly spawn: (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>) => AppServerProcess
  /** The folder the teammates work in; a call is refused without one. */
  readonly folder: () => string | undefined
  readonly send: (event: VoiceCallEvent) => void
  readonly version: string
  /** How long the voice service has to answer the offer. */
  readonly answerTimeoutMs?: number
}

export interface VoiceCalls {
  available(): Promise<VoiceCallAvailability>
  start(offer: string): Promise<VoiceCallStartResult>
  stop(): Promise<void>
  dispose(): void
}

interface Live {
  readonly client: AppServerClient
  readonly child: AppServerProcess
  threadId?: string
  answer?: (sdp: string) => void
  failed?: (message: string) => void
  ended: boolean
}

const ANSWER_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 30_000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A failure already in a person's words: passed on as it is, never said twice. */
class Said extends Error {}

export function createVoiceCalls(deps: VoiceCallDeps): VoiceCalls {
  let live: Live | undefined

  const end = (call: Live, why?: string): void => {
    if (call.ended) return
    call.ended = true
    if (live === call) live = undefined
    // A start still waiting on the answer is told why it will not come.
    call.failed?.(why ?? 'The call ended.')
    call.failed = undefined
    call.client.dispose('The call ended.')
    call.child.kill()
    deps.send(why === undefined ? { kind: 'ended' } : { kind: 'ended', why })
  }

  const notified = (call: Live, method: string, params: JsonValue | undefined): void => {
    const p = isRecord(params) ? params : {}
    // Another thread's news is not this call's (there is only one, but say so).
    if (call.threadId !== undefined && typeof p.threadId === 'string' && p.threadId !== call.threadId) return
    switch (method) {
      case 'thread/realtime/sdp':
        if (typeof p.sdp === 'string') call.answer?.(p.sdp)
        return
      case 'thread/realtime/transcript/delta': {
        const role = voiceCallRole(p.role)
        if (role !== undefined && typeof p.delta === 'string' && p.delta.length > 0) deps.send({ kind: 'partial', role, delta: p.delta })
        return
      }
      case 'thread/realtime/transcript/done': {
        const role = voiceCallRole(p.role)
        if (role !== undefined && typeof p.text === 'string') deps.send({ kind: 'said', role, text: p.text })
        return
      }
      case 'thread/realtime/error': {
        const message = voiceCallSaid(typeof p.message === 'string' ? p.message : 'The voice service reported an error.')
        if (call.failed !== undefined) {
          // Still starting: the start answers with it.
          call.failed(message)
          return
        }
        deps.send({ kind: 'error', message })
        return
      }
      case 'thread/realtime/closed':
        end(call, typeof p.reason === 'string' && p.reason !== 'requested' ? `The voice service closed the call (${p.reason}).` : undefined)
        return
      // Codex working behind the voice: something it was handed to look at.
      case 'turn/started':
        deps.send({ kind: 'working', working: true })
        return
      case 'turn/completed':
        deps.send({ kind: 'working', working: false })
        return
      default:
    }
  }

  const stop = async (): Promise<void> => {
    const call = live
    if (call === undefined) return
    if (call.threadId !== undefined) {
      await call.client.request('thread/realtime/stop', { threadId: call.threadId }).catch(() => undefined)
    }
    end(call)
  }

  return {
    async available() {
      if (deps.folder() === undefined) return { available: false, why: 'Pick a folder first.' }
      const codex = await deps.codex().catch(() => undefined)
      return codex === undefined
        ? { available: false, why: 'Voice calls use ChatGPT’s voice through Codex CLI, which is not ready on this computer.' }
        : { available: true }
    },

    async start(offer) {
      await stop()
      const folder = deps.folder()
      if (folder === undefined) return { ok: false, message: 'Pick a folder first.' }
      const codex = await deps.codex().catch(() => undefined)
      if (codex === undefined) return { ok: false, message: 'Voice calls use ChatGPT’s voice through Codex CLI, which is not ready on this computer.' }
      const child = deps.spawn(codex.executablePath, [...codex.prefixArgs, 'app-server'], codex.env)
      let call: Live
      const client = createAppServerClient({
        transport: { send: (line) => child.write(line), close: () => child.kill() },
        onNotification: ({ method, params }) => notified(call, method, params),
        // Nothing in a call may act: every approval Codex asks for is refused.
        onRequest: async () => ({ decision: 'reject' }),
        requestTimeoutMs: REQUEST_TIMEOUT_MS
      })
      call = { client, child, ended: false }
      live = call
      child.onData((chunk) => client.accept(chunk))
      // Nothing if the call already ended; otherwise Codex went away under it.
      child.onExit(() => end(call, 'Codex stopped, so the call ended.'))
      const refuse = (message: string): VoiceCallStartResult => {
        end(call, message)
        return { ok: false, message }
      }
      try {
        await client.request('initialize', { clientInfo: { name: 'locust', title: 'Locust', version: deps.version }, capabilities: { experimentalApi: true, requestAttestation: false } })
        client.notify('initialized')
        const account = await client.request('account/read', {})
        const kind = isRecord(account) && isRecord(account.account) ? account.account.type : undefined
        if (kind !== 'chatgpt') {
          return refuse(kind === undefined
            ? 'Codex is not signed in. Voice calls use your ChatGPT sign-in: sign Codex in with ChatGPT and try again.'
            : 'Codex is signed in with an API key. Voice calls use your ChatGPT sign-in: sign Codex in with ChatGPT and try again.')
        }
        const [status, config] = await Promise.all([
          client.request('mcpServerStatus/list', {}).catch(() => undefined),
          client.request('config/read', { cwd: folder }).then((read) => (isRecord(read) ? read.config : undefined)).catch(() => undefined)
        ])
        const threadConfig = voiceThreadConfig(status, config)
        if (threadConfig === undefined) return refuse('Locust could not switch off one of your Codex add-ons for the call, so it did not place it.')
        const thread = await client.request('thread/start', {
          cwd: folder,
          sandbox: 'read-only',
          approvalPolicy: 'untrusted',
          ephemeral: true,
          config: threadConfig as Readonly<Record<string, JsonValue>>
        })
        const threadId = isRecord(thread) && isRecord(thread.thread) && typeof thread.thread.id === 'string' ? thread.thread.id : undefined
        if (threadId === undefined) return refuse('Codex did not start the call’s conversation.')
        call.threadId = threadId
        const answered = new Promise<string>((resolve, reject) => {
          call.answer = resolve
          call.failed = (message) => reject(new Said(message))
          setTimeout(() => reject(new Said('The voice service did not answer in time. Try again.')), deps.answerTimeoutMs ?? ANSWER_TIMEOUT_MS)
        })
        // Settled whichever way the start goes, so a failure before the answer is never unhandled.
        answered.catch(() => undefined)
        await client.request('thread/realtime/start', {
          threadId,
          outputModality: 'audio',
          transport: { type: 'webrtc', sdp: offer },
          version: 'v3',
          realtimeStartInstructions: voiceCallInstructions(basename(folder) || folder)
        })
        const answer = await answered
        call.answer = undefined
        call.failed = undefined
        return { ok: true, answer }
      } catch (error) {
        const message = error instanceof Said ? error.message : voiceCallSaid(error instanceof Error ? error.message : String(error))
        return call.ended ? { ok: false, message } : refuse(message)
      }
    },

    stop,

    dispose() {
      if (live !== undefined) end(live)
    }
  }
}
