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
 * The call stands in the person's folder on a Codex thread of its own -- ephemeral, read-only, running no
 * command. 0.737 switched every add-on off for that thread (Colin's has a trading connector); since 0.742 the
 * person's connectors are the call's, and one that would change something asks them in the strip first.
 */

export const VOICE_CALL_AVAILABLE = 'voice-call:available'
export const VOICE_CALL_START = 'voice-call:start'
export const VOICE_CALL_STOP = 'voice-call:stop'
export const VOICE_CALL_EVENT = 'voice-call:event'
/** The person's Allow or Deny for something a call asked to do (0.742). */
export const VOICE_CALL_ANSWER = 'voice-call:answer'

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
  /** The voice handed something to a teammate (0.739): a real conversation, in the teammate's own mode. */
  | { readonly kind: 'handed'; readonly to: string; readonly task: string }
  /** One of the person's connectors would change something: it waits for Allow in the strip (0.742). */
  | { readonly kind: 'asks'; readonly id: string; readonly what: string; readonly detail: string }
  /** That wait is over: answered, timed out, or the call ended. */
  | { readonly kind: 'asked'; readonly id: string; readonly allowed: boolean }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ended'; readonly why?: string }

export interface VoiceCallApi {
  available(): Promise<VoiceCallAvailability>
  /** The window's own WebRTC offer in; the voice service's answer back. */
  start(offer: string): Promise<VoiceCallStartResult>
  stop(): Promise<void>
  /** Allow or Deny one `asks`. */
  answer(id: string, allowed: boolean): Promise<void>
  onEvent(listener: (event: VoiceCallEvent) => void): () => void
}

/** How long a connector's question waits for the person before it is a Deny. */
export const VOICE_CALL_ASK_WAIT_MS = 120_000

/** The name a person knows a server by: ChatGPT's own connectors come through Codex as `codex_apps`. */
export function voiceCallServerName(server: string): string {
  return server === 'codex_apps' ? 'ChatGPT' : server.replace(/[_-]+/g, ' ').trim() || 'A connector'
}

/**
 * WHAT A CONNECTOR WOULD DO, IN THE STRIP (0.742). Measured 2026-10-11 against Codex 0.162.1 with a throwaway
 * server: a tool marked read only runs with no question; one that is not first asks `mcpServer/elicitation/
 * request`, mode `form`, its message `Allow the probe MCP server to run tool "send_note"?` and its `_meta`
 * carrying `codex_approval_kind: mcp_tool_call`, `tool_description` and `tool_params_display` ([{display_name,
 * value}]). Undefined for anything that is not that question: it is declined unasked.
 */
export function voiceCallAsk(params: unknown): { readonly what: string; readonly detail: string } | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  const p = params as Record<string, unknown>
  const meta = typeof p._meta === 'object' && p._meta !== null ? p._meta as Record<string, unknown> : {}
  if (meta.codex_approval_kind !== 'mcp_tool_call' || p.mode !== 'form' || typeof p.serverName !== 'string') return undefined
  const tool = typeof p.message === 'string' ? /run tool "([^"]{1,120})"/.exec(p.message)?.[1] : undefined
  const words = (value: string): string => value.replace(/[_-]+/g, ' ').trim()
  const what = `${voiceCallServerName(p.serverName)}: ${tool === undefined ? 'a tool' : words(tool)}`
  const shown = Array.isArray(meta.tool_params_display) ? meta.tool_params_display : []
  const detail = shown
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return undefined
      const { display_name: name, value } = entry as Record<string, unknown>
      if (typeof name !== 'string') return undefined
      const said = typeof value === 'string' ? value : JSON.stringify(value)
      return `${name}: ${String(said).replace(/\s+/g, ' ').slice(0, 160)}`
    })
    .filter((line): line is string => line !== undefined)
    .join(' · ')
    .slice(0, 400)
  return { what: what.slice(0, 140), detail }
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

/**
 * LOCUST ITSELF, THE ONE ADD-ON A CALL'S CODEX HAS (0.739). A private copy of Locust's own add-on server
 * ("Let your other AI apps use Locust", which can stay off), started for the call and stopped with it, carrying
 * only the hand-off tools. Its name is the call's own, so it never meets one of the person's servers.
 */
export const VOICE_CALL_ADD_ON = 'locust_call'
export interface VoiceAddOn {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}
/** The tools the call's copy of Locust's server answers; anything else is refused there. */
export const VOICE_CALL_TOOLS: ReadonlySet<string> = new Set(['list_teammates', 'start_conversation', 'send_message', 'read_reply', 'list_background_runs', 'find_files', 'read_file', 'search_files'])

/** A name that can sit inside a dotted config key without being read as two. */
const PLAIN_NAME = /^[A-Za-z0-9@_-]{1,128}$/

/** What the call's Codex thread is started with, or why the call is not placed. */
export type VoiceThreadConfig =
  | { readonly ok: true; readonly config: Readonly<Record<string, boolean | string | readonly string[] | Readonly<Record<string, string>>>> }
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
/*
 * AND THE PERSON'S CONNECTORS, WHEN THEY ARE THE CALL'S (0.742). Colin, 2026-10-11: "want to be able to do simple
 * things like check gmail by asking but then i also want to be able to hand off larger tasks". With `connectors`,
 * ChatGPT's connectors and the person's own servers stay as their Codex has them: one that only reads answers at
 * once, and one that would change something waits for Allow in the call's strip (voiceCallAsk). Plugins, hooks
 * and notify stay off either way: none of them is a connector the person asked for by name. The thinking behind
 * the voice is set low, because a call waits on it out loud.
 */
/** The test server a drive gives a development build's call (never a packaged one): `locust_probe`. */
export const VOICE_CALL_TEST_SERVER = 'locust_probe'

export function voiceThreadConfig(config: unknown, addOn?: VoiceAddOn, options: { readonly connectors?: boolean; readonly testServer?: VoiceAddOn } = {}): VoiceThreadConfig {
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
  const connectors = options.connectors === true
  const out: Record<string, boolean | string | readonly string[] | Readonly<Record<string, string>>> = {
    ...(connectors ? {} : { 'features.apps': false }),
    'features.plugins': false,
    'features.hooks': false,
    notify: [],
    ...(connectors ? { model_reasoning_effort: 'low' } : {})
  }
  const servers = settings.mcp_servers
  if (servers !== undefined && servers !== null) {
    if (typeof servers !== 'object' || Array.isArray(servers)) return { ok: false, message: 'Locust could not read your Codex add-ons, so it did not place the call. Try again.' }
    for (const name of Object.keys(servers)) {
      // The call's own name is the call's: one of the person's by that name cannot share it.
      if (name === VOICE_CALL_ADD_ON && addOn !== undefined) return { ok: false, message: `Your Codex has an add-on named "${VOICE_CALL_ADD_ON}", the name a call keeps for Locust, so Locust did not place the call.` }
      /*
       * A connector is a service somewhere else, reached at an address: those stay. A server the person's machine
       * runs as a program stays off: measured 2026-10-11, a call's Codex ran Colin's node_repl -- JavaScript on
       * this computer, outside the sandbox -- with no question, because Codex counts it as one that needs none.
       */
      const entry: unknown = (servers as Record<string, unknown>)[name]
      const remote = typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).url === 'string' && (entry as Record<string, unknown>).command === undefined
      if (connectors && remote) continue
      if (!PLAIN_NAME.test(name)) return { ok: false, message: `Locust could not switch off your Codex add-on "${name.slice(0, 60)}" for the call, so it did not place it.` }
      out[`mcp_servers.${name}.enabled`] = false
    }
  }
  if (options.testServer !== undefined) {
    out[`mcp_servers.${VOICE_CALL_TEST_SERVER}.command`] = options.testServer.command
    out[`mcp_servers.${VOICE_CALL_TEST_SERVER}.args`] = options.testServer.args
    out[`mcp_servers.${VOICE_CALL_TEST_SERVER}.env`] = options.testServer.env
    out[`mcp_servers.${VOICE_CALL_TEST_SERVER}.enabled`] = true
  }
  if (addOn !== undefined) {
    out[`mcp_servers.${VOICE_CALL_ADD_ON}.command`] = addOn.command
    out[`mcp_servers.${VOICE_CALL_ADD_ON}.args`] = addOn.args
    out[`mcp_servers.${VOICE_CALL_ADD_ON}.env`] = addOn.env
    out[`mcp_servers.${VOICE_CALL_ADD_ON}.enabled`] = true
  }
  return { ok: true, config: out }
}

/** What the call's Codex is told when it starts: where it is, and what it may not do. */
export function voiceCallInstructions(folderName: string, handsOff = false, connectors = false): string {
  /*
   * Said as what works, because the voice believed what it was not told (2026-10-11): asked to read the folder,
   * it ran commands Locust refused, and said "I just sent the request in the app" when there was nothing to answer.
   */
  const folder = handsOff
    ? `This is a voice call the person started in Locust, about the folder "${folderName}". To look in that folder, use the ${VOICE_CALL_ADD_ON} tools find_files, read_file and search_files; never run shell commands, which this call cannot run. You change no file yourself.`
    : `This is a voice call the person started in Locust, about the folder "${folderName}". You may read files in that folder to answer, but you change nothing yourself during this call: no edits, no commands that change anything.`
  const tools = connectors
    ? ' For quick things, like checking their email or calendar, use their connectors directly. A connector that only reads answers at once. One that would send, change or buy something first shows Allow and Deny in the call’s strip in Locust: say what it will do and ask them to press Allow, and only say it is done once the tool says so. If they press Deny, or it is not answered, it did not happen.'
    : ''
  if (!handsOff) return `${folder}${tools} If they ask for a change, say that one of their teammates can make it, and that they can hand it over after the call.`
  const hands = ` Bigger work goes to their teammates: list_teammates says who there is and what each runs on. Before you hand anything over, say back in one short sentence who will do what, and wait for them to say yes; never start one they did not agree to. Then start_conversation with that teammate and the task in plain words, as the person would type it. The teammate works in its own mode, and anything it needs approved shows in Locust's window. Tell them it has started. When they ask how it went, read_reply with the conversation's id and say what came back, briefly.`
  return folder + tools + hands
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

/** A finished call as text for the chat box, said line by line, and what was handed over (0.739). */
export function voiceCallText(
  lines: readonly { readonly role: VoiceCallRole; readonly text: string }[],
  handed: readonly { readonly to: string; readonly task: string }[] = []
): string {
  const said = lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() })).filter((line) => line.text.length > 0)
  if (said.length === 0 && handed.length === 0) return ''
  const over = handed.map((hand) => `- ${hand.to}: ${hand.task.replace(/\s+/g, ' ').trim()}`)
  return [
    'From a voice call:',
    '',
    ...said.map((line) => `${line.role === 'you' ? 'You' : 'ChatGPT'}: ${line.text}`),
    ...(over.length === 0 ? [] : ['', 'Handed over:', ...over])
  ].join('\n')
}
