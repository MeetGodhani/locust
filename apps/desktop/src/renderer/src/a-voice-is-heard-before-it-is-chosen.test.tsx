import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { VoiceCallApi } from '../../shared/voice-call.js'
import { TalkVoice } from './components/TalkVoice.js'
import { VoicePlay } from './components/VoicePlay.js'

/*
 * HEAR IT (0.751). Canvas board 4: "Press a voice's play button to hear it." Beside each voice picker -- Talk's own
 * in Settings, and a teammate's -- a button plays the voice saying hello; with no voice picked it waits for one, and
 * a Locust whose window cannot make the preview call shows none.
 */
const api = (withPreview: boolean): VoiceCallApi => ({
  available: async () => ({ available: true }),
  start: async () => ({ ok: false, message: 'no' }),
  stop: async () => undefined,
  answer: async () => undefined,
  voice: async () => 'sol',
  setVoice: async (voice) => voice,
  onEvent: () => () => undefined,
  ...(withPreview ? { preview: async () => ({ ok: false, message: 'no' }) as const, previewSaved: async () => undefined, previewSave: async () => false, previewTrigger: async () => undefined } : {})
})

describe('hearing a voice before choosing it', () => {
  it('names the voice it plays, and says it is a play', () => {
    const html = renderToStaticMarkup(createElement(VoicePlay, { voice: 'sol', api: api(true) }))
    expect(html).toContain('aria-label="Hear Sol"')
    expect(html).toContain('Hear it')
    expect(html).toContain('on your ChatGPT plan')
    expect(html).not.toContain('disabled')
  })

  it('waits for a voice to be picked, and is not there without a way to play one', () => {
    const waiting = renderToStaticMarkup(createElement(VoicePlay, { voice: undefined, api: api(true) }))
    expect(waiting).toContain('disabled')
    expect(waiting).toContain('Pick a voice to hear it')
    expect(renderToStaticMarkup(createElement(VoicePlay, { voice: 'sol', api: api(false) }))).toBe('')
  })

  it("sits beside Talk's voice in Settings", () => {
    const html = renderToStaticMarkup(createElement(TalkVoice, { api: api(true), platform: 'win32' }))
    expect(html).toContain('lc-voicepick')
    expect(html).toContain('Hear it')
  })
})
