import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isVoiceCallOffer, voiceCallRole, voiceCallSaid, voiceCallText, voiceThreadConfig } from './voice-call.js'

/*
 * A VOICE CALL'S RULES (0.737). The call's Codex thread starts nothing the person's Codex would: measured
 * 2026-10-10 against Codex 0.162.1 on Colin's machine, whose six were code-review, codex_app, codex_apps,
 * cua_repl, node_repl and robinhood -- three a plugin brings, ChatGPT's connectors, and two in his config.
 */
const COLINS_STATUS = {
  data: [
    { name: 'code-review', pluginId: 'code-review@openai-bundled' },
    { name: 'codex_app', pluginId: 'codex-app-tools@openai-bundled' },
    { name: 'codex_apps', pluginId: null, httpOrigin: 'https://chatgpt.com' },
    { name: 'cua_repl', pluginId: 'unified-computer-use@openai-bundled' },
    { name: 'node_repl', pluginId: null },
    { name: 'robinhood', pluginId: null, httpOrigin: 'https://agent.robinhood.com' }
  ]
}
const COLINS_CONFIG = { mcp_servers: { node_repl: { command: 'node_repl.exe' }, robinhood: { url: 'https://agent.robinhood.com' } } }

describe('the call’s thread starts no add-on', () => {
  it('switches each off where it lives: plugin, connectors, or the person’s config', () => {
    expect(voiceThreadConfig(COLINS_STATUS, COLINS_CONFIG)).toEqual({
      'features.apps': false,
      'mcp_servers.node_repl.enabled': false,
      'mcp_servers.robinhood.enabled': false,
      'plugins.code-review@openai-bundled.enabled': false, // public-guard: allow (Codex plugin ids, not addresses)
      'plugins.codex-app-tools@openai-bundled.enabled': false, // public-guard: allow (Codex plugin ids, not addresses)
      'plugins.unified-computer-use@openai-bundled.enabled': false // public-guard: allow (Codex plugin ids, not addresses)
    })
  })

  it('never names a server where it does not live (Codex refuses a half entry)', () => {
    const config = voiceThreadConfig(COLINS_STATUS, COLINS_CONFIG)!
    expect(Object.keys(config)).not.toContain('mcp_servers.codex_app.enabled')
    expect(Object.keys(config)).not.toContain('mcp_servers.cua_repl.enabled')
  })

  it('places no call when a server could not be switched off', () => {
    // A server neither a plugin's nor the person's nor ChatGPT's: nothing to switch, so no call.
    expect(voiceThreadConfig({ data: [{ name: 'mystery' }] }, { mcp_servers: {} })).toBeUndefined()
    // A name a dotted key would read as two.
    expect(voiceThreadConfig({ data: [] }, { mcp_servers: { 'my.server': {} } })).toBeUndefined()
    expect(voiceThreadConfig({ data: [{ name: 'x', pluginId: 'odd plugin' }] }, {})).toBeUndefined()
  })

  it('still holds ChatGPT’s connectors off when Codex lists nothing', () => {
    expect(voiceThreadConfig(undefined, undefined)).toEqual({ 'features.apps': false })
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
    expect(voiceCallSaid('something\nelse')).toBe('The call could not go on. Codex said: something else')
  })

  it('puts a finished call in the chat box line by line, and nothing for a silent one', () => {
    expect(voiceCallText([{ role: 'you', text: ' What is two plus two ' }, { role: 'voice', text: 'That’s four.' }])).toBe('From a voice call:\n\nYou: What is two plus two\nChatGPT: That’s four.')
    expect(voiceCallText([{ role: 'you', text: '   ' }])).toBe('')
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
