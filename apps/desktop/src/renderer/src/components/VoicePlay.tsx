import { useEffect, useRef, useState } from 'react'

import { voiceName, type ChatGptVoice, type VoiceCallApi } from '../../../shared/voice-call.js'
import { VoicePreviewFailed, playVoicePreview } from '../voicePreview.js'
import { Icon } from './Icon.js'

/**
 * HEAR IT (0.751): beside a voice picker, plays the voice saying hello. The first time is a short call on the
 * person's ChatGPT plan, so it says it is getting the voice; after that the kept greeting plays at once. Pressed
 * again while it plays, it stops.
 */
export function VoicePlay({ voice, api = typeof window === 'undefined' ? undefined : window.desktop?.voiceCall }: {
  /** The voice to hear; none, and the button waits for one. */
  readonly voice: ChatGptVoice | undefined
  readonly api?: VoiceCallApi
}) {
  const [state, setState] = useState<'idle' | 'getting' | 'playing'>('idle')
  const [message, setMessage] = useState('')
  const running = useRef<AbortController | undefined>(undefined)
  // Leaving the page stops it, and ends a call still under way.
  useEffect(() => () => { running.current?.abort() }, [])
  if (api?.preview === undefined) return null
  const name = voice === undefined ? '' : voiceName(voice)
  const press = async (): Promise<void> => {
    if (running.current !== undefined) { running.current.abort(); return }
    if (voice === undefined) return
    const controller = new AbortController()
    running.current = controller
    setMessage('')
    setState('getting')
    try {
      await playVoicePreview(api, voice, { signal: controller.signal, onPlaying: () => { setState('playing') } })
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof VoicePreviewFailed ? error.message : `${name} could not be played. Try again.`)
    } finally {
      if (running.current === controller) running.current = undefined
      setState('idle')
    }
  }
  return <span className="lc-voiceplay">
    <button
      type="button"
      className="lc-control lc-control--boxed"
      disabled={voice === undefined}
      aria-label={state === 'idle' ? (voice === undefined ? 'Pick a voice to hear it' : `Hear ${name}`) : `Stop ${name}`}
      title={voice === undefined ? 'Pick a voice to hear it' : state === 'idle' ? `Hear ${name} say hello. The first time takes a few seconds, on your ChatGPT plan.` : `Stop ${name}`}
      onClick={() => { void press() }}
    >
      <Icon name={state === 'idle' ? 'play' : 'pause'} size={13} />
      {state === 'getting' ? `Getting ${name}…` : state === 'playing' ? 'Stop' : 'Hear it'}
    </button>
    {message && <span className="lc-voiceplay__note" role="status">{message}</span>}
  </span>
}
