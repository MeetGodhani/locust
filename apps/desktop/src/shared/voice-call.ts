/**
 * A VOICE CALL (0.737): ChatGPT's own voice, through the Codex CLI Locust already drives.
 *
 * Colin, 2026-10-10: "locust interacts with these clis and models all day, can you just mirror or have a
 * command activate chatgpt and activate the voice model, the same way we interface with every other thing".
 * Codex 0.162 carries it: `codex features list` has `realtime_conversation` on, and its app server takes
 * `thread/realtime/start`. MEASURED on Colin's Plus sign-in (C:\work\scratch\voice-probe): over a websocket
 * Codex says "realtime conversation requires API key auth"; over WebRTC with Codex's default version the
 * voice service asks for a header Codex does not send; `version: 'v2'` is refused ("AVAS realtime calls
 * require realtime v1 or v3"); `version: 'v3'` connects -- "What is two plus two" came back as "That's four."
 * in about a second. Nothing of the sign-in passes through Locust: Codex places the call as itself.
 *
 * The call stands in the person's folder on a Codex thread of its own -- ephemeral, read-only, every
 * request for approval refused -- and with every add-on the person's Codex would start switched off for
 * that thread (Colin's has a trading connector). The voice can look and answer; it cannot change anything.
 */

export const VOICE_CALL_AVAILABLE = 'voice-call:available'
export const VOICE_CALL_START = 'voice-call:start'
export const VOICE_CALL_STOP = 'voice-call:stop'
export const VOICE_CALL_EVENT = 'voice-call:event'

export type VoiceCallAvailability = { readonly available: true } | { readonly available: false; readonly why: string }
export type VoiceCallStartResult = { readonly ok: true; readonly answer: string } | { readonly ok: false; readonly message: string }

/** Who said a line: the person, or the voice. */
export type VoiceCallRole = 'you' | 'voice'

export type VoiceCallEvent =
  /** Words as they are heard or spoken, before the line is finished. */
  | { readonly kind: 'partial'; readonly role: VoiceCallRole; readonly delta: string }
  /** A finished line. */
  | { readonly kind: 'said'; readonly role: VoiceCallRole; readonly text: string }
  /** Codex is working behind the voice (it was handed something to look at). */
  | { readonly kind: 'working'; readonly working: boolean }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ended'; readonly why?: string }

export interface VoiceCallApi {
  available(): Promise<VoiceCallAvailability>
  /** The window's own WebRTC offer in; the voice service's answer back. */
  start(offer: string): Promise<VoiceCallStartResult>
  stop(): Promise<void>
  onEvent(listener: (event: VoiceCallEvent) => void): () => void
}

/** An offer is SDP from this window's own RTCPeerConnection: bounded text that starts as SDP does. */
export const VOICE_CALL_MAX_OFFER = 64 * 1024
export function isVoiceCallOffer(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('v=0') && value.length <= VOICE_CALL_MAX_OFFER
}

/** Codex's transcript roles, in Locust's words. */
export function voiceCallRole(role: unknown): VoiceCallRole | undefined {
  if (role === 'user') return 'you'
  if (role === 'assistant') return 'voice'
  return undefined
}

/** A name that can sit inside a dotted config key without being read as two. */
const PLAIN_NAME = /^[A-Za-z0-9@_-]{1,128}$/

/**
 * EVERY ADD-ON OFF, FOR THIS ONE THREAD (measured 2026-10-10 against Codex 0.162.1, thread/start alone).
 *
 * `mcp_servers: {}` changes nothing (it merges). What works: `features.apps = false` for ChatGPT's
 * connectors (`codex_apps`), `plugins.<id>.enabled = false` for a server a plugin brings (`cua_repl` is
 * `unified-computer-use@openai-bundled`), and `mcp_servers.<name>.enabled = false` for one in the person's
 * config. Naming a server that is NOT in their config makes a half entry Codex refuses ("invalid transport
 * in `mcp_servers.codex_app`"), so a name is only switched off where it lives. With all three, Colin's six
 * (code-review, codex_app, codex_apps, cua_repl, node_repl, robinhood) start none.
 *
 * `undefined` when a server's name or plugin could not be written as a key: the call is then refused rather
 * than placed with something left on.
 */
export function voiceThreadConfig(status: unknown, config: unknown): Readonly<Record<string, boolean>> | undefined {
  const out: Record<string, boolean> = { 'features.apps': false }
  const configured = new Set<string>()
  const servers = typeof config === 'object' && config !== null ? (config as { readonly mcp_servers?: unknown }).mcp_servers : undefined
  if (typeof servers === 'object' && servers !== null && !Array.isArray(servers)) {
    for (const name of Object.keys(servers)) {
      if (!PLAIN_NAME.test(name)) return undefined
      configured.add(name)
      out[`mcp_servers.${name}.enabled`] = false
    }
  }
  const entries = typeof status === 'object' && status !== null ? (status as { readonly data?: unknown }).data : undefined
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const { name, pluginId } = entry as { readonly name?: unknown; readonly pluginId?: unknown }
    if (typeof pluginId === 'string' && pluginId.length > 0) {
      if (!PLAIN_NAME.test(pluginId)) return undefined
      out[`plugins.${pluginId}.enabled`] = false
      continue
    }
    if (typeof name !== 'string' || configured.has(name)) continue
    // Neither a plugin's nor the person's: ChatGPT's connectors, which `features.apps` already holds off.
    if (name === 'codex_apps') continue
    return undefined
  }
  return out
}

/** What the call's Codex is told when it starts: where it is, and what it may not do. */
export function voiceCallInstructions(folderName: string): string {
  return `This is a voice call the person started in Locust, about the folder "${folderName}". You may read files in that folder to answer, but nothing can be changed during this call: no edits, no commands that change anything. If they ask for a change, say that one of their teammates can make it, and that they can hand it over after the call.`
}

/** A failure from Codex or the voice service, in words a person can act on. */
export function voiceCallSaid(message: string): string {
  const first = message.replace(/\s+/g, ' ').trim()
  if (/requires API key auth|apiKey/i.test(first)) {
    return 'Codex could not place the call with how it is signed in. Voice calls use your ChatGPT sign-in; sign Codex in with ChatGPT and try again.'
  }
  if (/quicksilver|AVAS|realtime v1 or v3/i.test(first)) {
    return `This version of Codex answered the call in a way Locust does not know yet. Update Codex in Settings > AI agents and try again. (Codex said: ${first.slice(0, 160)})`
  }
  if (/rate.?limit|usage limit|quota|too many/i.test(first)) {
    return 'ChatGPT says your plan’s voice time is used up for now. Try again later.'
  }
  return `The call could not go on. Codex said: ${first.slice(0, 200)}`
}

/** A finished call as text for the chat box, said line by line. */
export function voiceCallText(lines: readonly { readonly role: VoiceCallRole; readonly text: string }[]): string {
  const said = lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() })).filter((line) => line.text.length > 0)
  if (said.length === 0) return ''
  return ['From a voice call:', '', ...said.map((line) => `${line.role === 'you' ? 'You' : 'ChatGPT'}: ${line.text}`)].join('\n')
}
