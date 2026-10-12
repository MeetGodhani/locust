import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { VoiceOrb } from './components/VoiceOrb.js'

/*
 * CHATGPT'S VOICE HAS A FACE (0.752). Colin, 2026-10-12, with Book of Shapes' radial patterns: "potentially use one
 * of them for the voice chat orb". A call with a teammate wears the teammate's face in the call bar; a call on Home,
 * with ChatGPT's own voice, wears this orb where the five level bars were. It is a picture of the level, so screen
 * readers hear the bar's status instead, which already says who is speaking.
 */
describe("ChatGPT's voice, as an orb", () => {
  it('is a canvas the size of a face, and hidden from screen readers', () => {
    const html = renderToStaticMarkup(createElement(VoiceOrb, { size: 28, level: 0.5, speaking: true, active: true }))
    expect(html).toMatch(/^<canvas class="lc-voiceorb" width="28" height="28" style="width:28px;height:28px" aria-hidden="true"><\/canvas>$/)
  })
})
