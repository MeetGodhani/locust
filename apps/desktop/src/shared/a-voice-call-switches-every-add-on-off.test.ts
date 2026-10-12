import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { VOICE_CALL_ADD_ON, VOICE_CALL_TOOLS, isVoiceCallOffer, voiceCallInstructions, voiceCallRole, voiceCallSaid, voiceCallText, voiceThreadConfig } from './voice-call.js'

/*
 * A VOICE CALL'S RULES (0.737; 0.738 after Sol's review). The call's Codex thread starts nothing the person's
 * Codex would: measured 2026-10-11 against Codex 0.162.1 on Colin's machine -- cua_repl, node_repl, codex_apps
 * and robinhood without these settings, none with them. Read from his settings alone (config/read): asking
 * mcpServerStatus/list for names started every server to list its tools (Sol's #1).
 */
const NO_TOOLS = { 'features.shell_tool': false, 'features.browser_use': false, 'features.browser_use_external': false, 'features.in_app_browser': false, 'features.computer_use': false } as const
const COLINS_CONFIG = { model: 'gpt-6-sol', mcp_servers: { node_repl: { command: 'node_repl.exe' }, robinhood: { url: 'https://agent.robinhood.com' } } }

describe('the call’s thread starts no add-on', () => {
  it('switches off connectors, plugins, hooks, notify, and each of the person’s own servers by name', () => {
    expect(voiceThreadConfig(COLINS_CONFIG)).toEqual({
      ok: true,
      config: {
        'features.apps': false,
        'features.plugins': false,
        'features.hooks': false,
        notify: [],
        ...NO_TOOLS,
        'mcp_servers.node_repl.enabled': false,
        'mcp_servers.robinhood.enabled': false
      }
    })
    // Settings with no servers of their own still get every category switched off.
    const none = voiceThreadConfig({ model: 'x' })
    expect(none.ok && Object.keys(none.config)).toEqual(['features.apps', 'features.plugins', 'features.hooks', 'notify', ...Object.keys(NO_TOOLS)])
  })

  it('places no call when the settings did not read as settings (Sol’s #2: it failed open)', () => {
    for (const unread of [undefined, null, 'config', ['a'], 42]) expect(voiceThreadConfig(unread).ok).toBe(false)
    expect(voiceThreadConfig({ mcp_servers: ['robinhood'] })).toEqual({ ok: false, message: 'Locust could not read your Codex add-ons, so it did not place the call. Try again.' })
    // A name a dotted key would read as two.
    expect(voiceThreadConfig({ mcp_servers: { 'my.server': {} } }).ok).toBe(false)
  })

  it('places no call when Codex is pointed at a voice or ChatGPT address that is not OpenAI’s (Sol’s #4)', () => {
    const refused = voiceThreadConfig({ experimental_realtime_webrtc_call_base_url: 'https://proxy.example.test/v1' })
    expect(refused).toEqual({ ok: false, message: 'Your Codex settings send voice calls to an address that is not OpenAI’s (experimental_realtime_webrtc_call_base_url), so Locust did not place the call. Remove that setting to use Talk.' })
    expect(voiceThreadConfig({ experimental_realtime_ws_base_url: 'wss://elsewhere.example.test' }).ok).toBe(false)
    expect(voiceThreadConfig({ chatgpt_base_url: 'https://my-proxy.example.test/backend-api' }).ok).toBe(false)
    expect(voiceThreadConfig({ realtime: { base_url: 'https://elsewhere.example.test' } }).ok).toBe(false)
    // OpenAI's own addresses are fine; so is a realtime setting that is not an address.
    expect(voiceThreadConfig({ experimental_realtime_ws_base_url: 'wss://api.openai.com/v1/realtime' }).ok).toBe(true)
    expect(voiceThreadConfig({ chatgpt_base_url: 'https://chatgpt.com/backend-api/' }).ok).toBe(true)
    expect(voiceThreadConfig({ realtime_conversation_version: 'v3' }).ok).toBe(true)
  })
})

describe('the rest of the call’s words', () => {
  it('takes only an offer this window could have made', () => {
    expect(isVoiceCallOffer('v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n')).toBe(true)
    expect(isVoiceCallOffer('https://example.com')).toBe(false)
    expect(isVoiceCallOffer(`v=0${'a'.repeat(70_000)}`)).toBe(false)
    expect(isVoiceCallOffer(42)).toBe(false)
  })

  it('names who spoke in Locust’s words', () => {
    expect([voiceCallRole('user'), voiceCallRole('assistant'), voiceCallRole('system')]).toEqual(['you', 'voice', undefined])
  })

  it('says a failure as something to do', () => {
    expect(voiceCallSaid('realtime conversation requires API key auth')).toMatch(/sign Codex in with ChatGPT/)
    expect(voiceCallSaid('AVAS requires OpenAI-Alpha: quicksilver=v2.')).toMatch(/Update Codex in Settings > AI agents/)
    expect(voiceCallSaid('Rate limit reached for voice')).toMatch(/voice time is used up/)
    // A limit is a limit even when it names the voice service (Sol's #13), and a timeout says to try again.
    expect(voiceCallSaid('AVAS quota exceeded')).toMatch(/voice time is used up/)
    expect(voiceCallSaid('The app server did not answer initialize in time.')).toBe('Codex did not answer in time, so the call did not start. Try again; if it keeps happening, restart Locust.')
    expect(voiceCallSaid('something\nelse')).toBe('The call could not go on. Codex said: something else')
  })

  it('puts a finished call in the chat box line by line, and nothing for a silent one', () => {
    expect(voiceCallText([{ role: 'you', text: ' What is two plus two ' }, { role: 'voice', text: 'That’s four.' }])).toBe('From a voice call:\n\nYou: What is two plus two\nChatGPT: That’s four.')
    expect(voiceCallText([{ role: 'you', text: '   ' }])).toBe('')
  })
})

describe('Locust as the call’s one add-on (0.739)', () => {
  const ADD_ON = { command: 'Locust.exe', args: ['bridge.mjs', 'connection.json'], env: { ELECTRON_RUN_AS_NODE: '1' } }

  it('is switched on under the call’s own name, after everything else is off', () => {
    const made = voiceThreadConfig(COLINS_CONFIG, ADD_ON)
    expect(made.ok && made.config).toMatchObject({
      'features.plugins': false,
      'mcp_servers.robinhood.enabled': false,
      [`mcp_servers.${VOICE_CALL_ADD_ON}.command`]: 'Locust.exe',
      [`mcp_servers.${VOICE_CALL_ADD_ON}.args`]: ['bridge.mjs', 'connection.json'],
      [`mcp_servers.${VOICE_CALL_ADD_ON}.env`]: { ELECTRON_RUN_AS_NODE: '1' },
      [`mcp_servers.${VOICE_CALL_ADD_ON}.enabled`]: true
    })
  })

  it('places no call when one of the person’s own add-ons already has that name', () => {
    expect(voiceThreadConfig({ mcp_servers: { [VOICE_CALL_ADD_ON]: { url: 'https://example.test' } } }, ADD_ON).ok).toBe(false)
    // Without the hand-offs the name is just one of theirs, switched off like the rest.
    expect(voiceThreadConfig({ mcp_servers: { [VOICE_CALL_ADD_ON]: {} } }).ok).toBe(true)
  })

  it('carries only the hand-off tools, and three that read the folder (0.742)', () => {
    expect([...VOICE_CALL_TOOLS].sort()).toEqual(['find_files', 'list_background_runs', 'list_teammates', 'read_file', 'read_reply', 'search_files', 'send_message', 'start_conversation'])
  })

  it('tells the call’s Codex to read a task back and wait for a yes before handing it over', () => {
    const told = voiceCallInstructions('acme', true)
    expect(told).toContain('say back in one short sentence who will do what, and wait for them to say yes')
    expect(told).toContain('never start one they did not agree to')
    expect(voiceCallInstructions('acme')).not.toContain(VOICE_CALL_ADD_ON)
  })

  it('puts what was handed over in the chat box with the call', () => {
    expect(voiceCallText([{ role: 'you', text: 'Have Wren fix the login loop' }], [{ to: 'Wren', task: 'Fix the login  redirect loop' }]))
      .toBe('From a voice call:\n\nYou: Have Wren fix the login loop\n\nHanded over:\n- Wren: Fix the login redirect loop')
  })
})

describe('the call is written down where the network is', () => {
  const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  it('in docs/NETWORK.md and in Settings', () => {
    const network = read('../../../../docs/NETWORK.md')
    expect(network).toContain('| A voice call (Talk, beside the microphone) |')
    expect(network).toContain('**A voice call.**')
    expect(read('../renderer/src/components/Screens.tsx')).toContain('A voice call you start with Talk, beside the microphone, connects this window to OpenAI')
  })
})
