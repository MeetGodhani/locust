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

/** What the call's Codex thread is started with, or why the call is not placed. */
export type VoiceThreadConfig =
  | { readonly ok: true; readonly config: Readonly<Record<string, boolean | readonly string[]>> }
  | { readonly ok: false; readonly message: string }

/** The hosts a call's own traffic may be pointed at: OpenAI's. */
function openAiHost(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'openai.com' || host.endsWith('.openai.com')
  } catch {
    return false
  }
}

/**
 * NOTHING THE PERSON'S CODEX WOULD START, FOR THIS ONE THREAD (measured 2026-10-11 against Codex 0.162.1,
 * thread/start alone: Colin's machine starts cua_repl, node_repl, codex_apps and robinhood without this, none
 * with it).
 *
 * Read from `config/read` alone, which connects to nothing. 0.737 also asked `mcpServerStatus/list` for the
 * names, and that request STARTS every server to list its tools -- it tried Robinhood's OAuth refresh before
 * the call's thread existed (Sol's review of 0.737, #1). So: `features.apps` off (ChatGPT's connectors),
 * `features.plugins` off (every server a plugin brings, whatever its name), `features.hooks` off and `notify`
 * empty (commands Codex runs on the host, outside the sandbox: #3), and each server in the person's own
 * config switched off by name. `mcp_servers: {}` would change nothing (it merges), and naming a server that is
 * not in their config makes a half entry Codex refuses.
 *
 * Refused, rather than placed with something left on (#2), when the settings did not read as settings or a
 * name cannot be written as a key; and when Codex has been pointed at a voice or ChatGPT address that is not
 * OpenAI's, since the call's audio and control would follow it (#4).
 */
export function voiceThreadConfig(config: unknown): VoiceThreadConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { ok: false, message: 'Locust could not read your Codex settings, so it did not place the call. Try again.' }
  }
  const settings = config as Record<string, unknown>
  for (const [key, value] of Object.entries(settings)) {
    // A realtime setting counts when it is an address; a base URL counts whatever it holds.
    const pointed = typeof value === 'string' && value.length > 0 && !openAiHost(value)
      && (key === 'chatgpt_base_url' || key === 'openai_base_url' || (/realtime/i.test(key) && /:\/\//.test(value)))
    const nested = /realtime/i.test(key) && typeof value === 'object' && value !== null && Object.values(value).some((inner) => typeof inner === 'string' && /:\/\//.test(inner) && !openAiHost(inner))
    if (pointed || nested) {
      return { ok: false, message: `Your Codex settings send ${/realtime/i.test(key) ? 'voice calls' : 'ChatGPT requests'} to an address that is not OpenAI’s (${key}), so Locust did not place the call. Remove that setting to use Talk.` }
    }
  }
  const out: Record<string, boolean | readonly string[]> = {
    'features.apps': false,
    'features.plugins': false,
    'features.hooks': false,
    notify: []
  }
  const servers = settings.mcp_servers
  if (servers !== undefined && servers !== null) {
    if (typeof servers !== 'object' || Array.isArray(servers)) return { ok: false, message: 'Locust could not read your Codex add-ons, so it did not place the call. Try again.' }
    for (const name of Object.keys(servers)) {
      if (!PLAIN_NAME.test(name)) return { ok: false, message: `Locust could not switch off your Codex add-on "${name.slice(0, 60)}" for the call, so it did not place it.` }
      out[`mcp_servers.${name}.enabled`] = false
    }
  }
  return { ok: true, config: out }
}

/** What the call's Codex is told when it starts: where it is, and what it may not do. */
export function voiceCallInstructions(folderName: string): string {
  return `This is a voice call the person started in Locust, about the folder "${folderName}". You may read files in that folder to answer, but nothing can be changed during this call: no edits, no commands that change anything. If they ask for a change, say that one of their teammates can make it, and that they can hand it over after the call.`
}

/** A failure from Codex or the voice service, in words a person can act on. */
export function voiceCallSaid(message: string): string {
  const first = message.replace(/\s+/g, ' ').trim()
  // A limit first: "AVAS quota exceeded" is a limit, not a version Locust does not know (Sol's review, #13).
  if (/rate.?limit|usage limit|quota|too many/i.test(first)) {
    return 'ChatGPT says your plan’s voice time is used up for now. Try again later.'
  }
  if (/did not answer .* in time|timed out|timeout/i.test(first)) {
    return 'Codex did not answer in time, so the call did not start. Try again; if it keeps happening, restart Locust.'
  }
  if (/requires API key auth|apiKey/i.test(first)) {
    return 'Codex could not place the call with how it is signed in. Voice calls use your ChatGPT sign-in; sign Codex in with ChatGPT and try again.'
  }
  if (/quicksilver|AVAS|realtime v1 or v3/i.test(first)) {
    return `This version of Codex answered the call in a way Locust does not know yet. Update Codex in Settings > AI agents and try again. (Codex said: ${first.slice(0, 160)})`
  }
  return `The call could not go on. Codex said: ${first.slice(0, 200)}`
}

/** A finished call as text for the chat box, said line by line. */
export function voiceCallText(lines: readonly { readonly role: VoiceCallRole; readonly text: string }[]): string {
  const said = lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() })).filter((line) => line.text.length > 0)
  if (said.length === 0) return ''
  return ['From a voice call:', '', ...said.map((line) => `${line.role === 'you' ? 'You' : 'ChatGPT'}: ${line.text}`)].join('\n')
}
