import type { AppServerRunProcess as AppServerProcess } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import type { VoiceCallEvent } from '../shared/voice-call.js'
import { createVoiceCalls } from './voice-call.js'

/*
 * A VOICE CALL, PLACED BY CODEX (0.737). Against a stand-in for `codex app-server` that answers the way
 * Codex 0.162.1 did for Colin's Plus sign-in on 2026-10-10: the call is asked for on a read-only,
 * ephemeral thread with every add-on off, over WebRTC on realtime v3, and the voice service's answer is
 * handed back; the lines said come through; an approval is refused; End stops it and the server.
 */
interface Asked { readonly method: string; readonly params: Record<string, unknown> }

function fakeCodex(answers: { readonly account?: unknown; readonly realtime?: 'answer' | 'error' } = {}) {
  const asked: Asked[] = []
  let onData: (chunk: string) => void = () => undefined
  let onExit: () => void = () => undefined
  let killed = false
  const say = (message: unknown): void => { setTimeout(() => onData(`${JSON.stringify({ jsonrpc: '2.0', ...(message as object) })}\n`), 0) }
  const result = (method: string, params: Record<string, unknown>): unknown => {
    switch (method) {
      case 'initialize': return { userAgent: 'codex' }
      case 'account/read': return answers.account ?? { account: { type: 'chatgpt', email: 'someone@example.test', planType: 'plus' }, requiresOpenaiAuth: true }
      case 'mcpServerStatus/list': return { data: [{ name: 'cua_repl', pluginId: 'unified-computer-use@openai-bundled' }, { name: 'robinhood', pluginId: null }, { name: 'codex_apps', pluginId: null }] }
      case 'config/read': return { config: { mcp_servers: { robinhood: {} } } }
      case 'thread/start': return { thread: { id: 'thread_1' } }
      case 'thread/realtime/start':
        if (answers.realtime === 'error') say({ method: 'thread/realtime/error', params: { threadId: 'thread_1', message: 'realtime conversation requires API key auth' } })
        else {
          say({ method: 'thread/realtime/started', params: { threadId: 'thread_1', version: 'v3' } })
          say({ method: 'thread/realtime/sdp', params: { threadId: 'thread_1', sdp: 'v=0\r\nanswer' } })
        }
        return {}
      case 'thread/realtime/stop': return {}
      default: return {}
    }
  }
  const child: AppServerProcess = {
    write: (line) => {
      const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown }
      if (message.method === undefined) { asked.push({ method: `answer:${String(message.id)}`, params: message.result as Record<string, unknown> }); return }
      asked.push({ method: message.method, params: message.params ?? {} })
      if (message.id !== undefined) say({ id: message.id, result: result(message.method, message.params ?? {}) })
    },
    kill: () => { killed = true; setTimeout(() => onExit(), 0) },
    onData: (listener) => { onData = listener },
    onExit: (listener) => { onExit = listener }
  }
  return { child, asked, killed: () => killed, say }
}

const CODEX = { commandName: 'codex', discoveredPath: 'codex', executablePath: 'codex.exe', prefixArgs: [] as string[], kind: 'native' as const }

function calls(fake: ReturnType<typeof fakeCodex>, folder: string | null = 'C:\\work\\acme') {
  const sent: VoiceCallEvent[] = []
  const spawned: { path: string; args: readonly string[] }[] = []
  const voice = createVoiceCalls({
    codex: async () => CODEX,
    spawn: (path, args) => { spawned.push({ path, args }); return fake.child },
    folder: () => folder ?? undefined,
    send: (event) => sent.push(event),
    version: '0.737.0',
    answerTimeoutMs: 2_000
  })
  return { voice, sent, spawned }
}

describe('a voice call', () => {
  it('is asked of Codex on a read-only thread with every add-on off, and the answer comes back', async () => {
    const fake = fakeCodex()
    const { voice, spawned } = calls(fake)
    const started = await voice.start('v=0\r\noffer')
    expect(started).toEqual({ ok: true, answer: 'v=0\r\nanswer' })
    expect(spawned).toEqual([{ path: 'codex.exe', args: ['app-server'] }])
    const by = (method: string): Record<string, unknown> => fake.asked.find((entry) => entry.method === method)!.params
    expect(by('initialize')).toMatchObject({ capabilities: { experimentalApi: true } })
    expect(by('thread/start')).toEqual({
      cwd: 'C:\\work\\acme',
      sandbox: 'read-only',
      approvalPolicy: 'untrusted',
      ephemeral: true,
      config: { 'features.apps': false, 'mcp_servers.robinhood.enabled': false, 'plugins.unified-computer-use@openai-bundled.enabled': false } // public-guard: allow (a Codex plugin id, not an address)
    })
    expect(by('thread/realtime/start')).toMatchObject({ threadId: 'thread_1', outputModality: 'audio', transport: { type: 'webrtc', sdp: 'v=0\r\noffer' }, version: 'v3' })
    expect(String(by('thread/realtime/start').realtimeStartInstructions)).toContain('"acme"')
    // The order matters: the account is checked, and the add-ons read, before any thread exists.
    const order = fake.asked.map((entry) => entry.method).filter((method) => !method.startsWith('answer:'))
    expect(order.slice(0, 6)).toEqual(['initialize', 'initialized', 'account/read', 'mcpServerStatus/list', 'config/read', 'thread/start'])
  })

  it('says what is said, refuses whatever Codex asks to do, and ends with End', async () => {
    const fake = fakeCodex()
    const { voice, sent } = calls(fake)
    await voice.start('v=0\r\noffer')
    fake.say({ method: 'thread/realtime/transcript/delta', params: { threadId: 'thread_1', role: 'user', delta: 'What is two' } })
    fake.say({ method: 'thread/realtime/transcript/done', params: { threadId: 'thread_1', role: 'user', text: 'What is two plus two' } })
    fake.say({ method: 'thread/realtime/transcript/done', params: { threadId: 'thread_1', role: 'assistant', text: 'That’s four.' } })
    fake.say({ method: 'turn/started', params: { threadId: 'thread_1' } })
    fake.say({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread_1', command: 'rm -rf build' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toEqual([
      { kind: 'partial', role: 'you', delta: 'What is two' },
      { kind: 'said', role: 'you', text: 'What is two plus two' },
      { kind: 'said', role: 'voice', text: 'That’s four.' },
      { kind: 'working', working: true }
    ])
    expect(fake.asked).toContainEqual({ method: 'answer:99', params: { decision: 'reject' } })
    await voice.stop()
    expect(fake.asked.map((entry) => entry.method)).toContain('thread/realtime/stop')
    expect(fake.killed()).toBe(true)
    expect(sent.at(-1)).toEqual({ kind: 'ended' })
  })

  it('is not placed on an API key, and says how to fix it', async () => {
    const fake = fakeCodex({ account: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } })
    const { voice } = calls(fake)
    const started = await voice.start('v=0\r\noffer')
    expect(started).toEqual({ ok: false, message: 'Codex is signed in with an API key. Voice calls use your ChatGPT sign-in: sign Codex in with ChatGPT and try again.' })
    expect(fake.asked.map((entry) => entry.method)).not.toContain('thread/start')
    expect(fake.killed()).toBe(true)
  })

  it('says the voice service’s refusal in words, and stops the server', async () => {
    const fake = fakeCodex({ realtime: 'error' })
    const { voice } = calls(fake)
    const started = await voice.start('v=0\r\noffer')
    expect(started.ok).toBe(false)
    expect(started.ok === false && started.message).toMatch(/sign Codex in with ChatGPT/)
    expect(fake.killed()).toBe(true)
  })

  it('needs a folder, and Codex', async () => {
    const fake = fakeCodex()
    expect(await calls(fake, null).voice.available()).toEqual({ available: false, why: 'Pick a folder first.' })
    const none = createVoiceCalls({ codex: async () => undefined, spawn: () => fake.child, folder: () => 'C:\\work', send: () => undefined, version: '0' })
    expect((await none.available()).available).toBe(false)
    expect((await none.start('v=0\r\n')).ok).toBe(false)
  })
})
