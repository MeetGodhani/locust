import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { VoiceCallApi } from '../../shared/voice-call.js'
import { VOICE_CALL_TITLE, VoiceCallButton } from './components/VoiceCall.js'

/*
 * TALK, BESIDE THE MICROPHONE (0.737): the waveform Claude's and ChatGPT's apps draw for a voice call,
 * shown only where Codex can place one (Windows, Codex ready, a folder picked).
 */
const api: VoiceCallApi = {
  available: async () => ({ available: true }),
  start: async () => ({ ok: false, message: 'not in a test' }),
  stop: async () => undefined,
  answer: async () => undefined,
  voice: async () => 'cove' as const,
  setVoice: async (voice) => voice,
  onEvent: () => () => undefined
}

describe('the Talk button', () => {
  it('is a button named Talk, saying what the call can and cannot do', () => {
    const html = renderToStaticMarkup(<VoiceCallButton platform="win32" api={api} availability={{ available: true }} onText={() => undefined} />)
    expect(html).toContain('aria-label="Talk"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain(`title="${VOICE_CALL_TITLE}"`)
    // No strip until a call starts.
    expect(html).not.toContain('Voice call')
  })

  it('is not there where no call can be placed', () => {
    expect(renderToStaticMarkup(<VoiceCallButton platform="darwin" api={api} availability={{ available: true }} onText={() => undefined} />)).toBe('')
    expect(renderToStaticMarkup(<VoiceCallButton platform="win32" api={api} availability={{ available: false, why: 'Pick a folder first.' }} onText={() => undefined} />)).toBe('')
    expect(renderToStaticMarkup(<VoiceCallButton platform="win32" availability={{ available: true }} onText={() => undefined} />)).toBe('')
  })

  it('sits right after voice typing in the chat box', () => {
    const composer = readFileSync(fileURLToPath(new URL('./components/Composer.tsx', import.meta.url)), 'utf8')
    const mic = composer.indexOf('<VoiceButton ')
    const talk = composer.indexOf('<VoiceCallButton ')
    expect(mic).toBeGreaterThan(0)
    expect(talk).toBeGreaterThan(mic)
    expect(composer.slice(mic, talk)).not.toMatch(/<button|<Beam/)
  })
})
