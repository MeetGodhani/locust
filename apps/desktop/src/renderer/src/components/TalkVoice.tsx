import { useEffect, useState } from 'react'

import { CHATGPT_VOICES, isChatGptVoice, voiceName, type ChatGptVoice, type VoiceCallApi } from '../../../shared/voice-call.js'

/**
 * TALK'S VOICE (0.745): the nine ChatGPT's own app offers, under the names and words it gives them. Colin,
 * 2026-10-11, holding ChatGPT's "Choose your voice": "see if we can set this up". The next call speaks in it.
 */
export function TalkVoice({ api = typeof window === 'undefined' ? undefined : window.desktop?.voiceCall, platform = typeof window === 'undefined' ? undefined : window.desktop?.platform }: {
  readonly api?: VoiceCallApi
  readonly platform?: string
}) {
  const [voice, setVoice] = useState<ChatGptVoice>()
  const [message, setMessage] = useState('')
  useEffect(() => {
    let alive = true
    void api?.voice().then((chosen) => { if (alive) setVoice(chosen) }).catch(() => { if (alive) setMessage('Talk’s voice could not be read. Calls use ChatGPT’s default.') })
    return () => { alive = false }
  }, [api])
  if (api === undefined || platform !== 'win32') return null
  return <section className="lc-settings__section lc-settings__section--line" data-setting="talk-voice"><div className="lc-settingline">
    <div className="lc-settingline__text">
      <h2 className="lc-settings__heading">Talk’s voice</h2>
      <p className="lc-settings__lede">The voice ChatGPT speaks in when you press Talk. The next call uses it; a call already on keeps its voice.</p>
      {message && <p className="lc-settings__note" role="status">{message}</p>}
    </div>
    <select
      className="lc-control"
      aria-label="Talk’s voice"
      disabled={voice === undefined}
      value={voice ?? ''}
      onChange={(event) => {
        const next = event.target.value
        if (!isChatGptVoice(next)) return
        setVoice(next)
        void api.setVoice(next).then(setVoice).catch(() => { setMessage('That voice could not be kept. Try again.') })
      }}
    >
      {CHATGPT_VOICES.map((entry) => <option key={entry.id} value={entry.id}>{voiceName(entry.id)} — {entry.about}</option>)}
    </select>
  </div></section>
}
