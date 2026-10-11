import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { voiceCallText, type VoiceCallApi, type VoiceCallAvailability, type VoiceCallRole } from '../../../shared/voice-call.js'
import type { LiveVoiceCall } from '../voiceCall.js'
import { setVoiceLevel, setVoiceState } from '../voiceLevel.js'
import { Icon } from './Icon.js'

/**
 * TALK (0.737): a voice call with ChatGPT's own voice, placed by Codex -- the waveform beside the
 * microphone, as Claude's and ChatGPT's apps draw it (Colin's screenshot: "Use voice mode" next to the
 * dictation mic). Voice typing types what you say; this talks back.
 *
 * The strip above the chat box carries the call: who is speaking, the lines as they are said, Mute and
 * End. When it ends the lines stay, and one press puts them in the chat box for any teammate.
 */
type Phase = 'idle' | 'calling' | 'live' | 'ended'
interface Line { readonly role: VoiceCallRole; readonly text: string }

export const VOICE_CALL_TITLE = 'Talk with ChatGPT’s voice. It can read this folder and change nothing.'

export function VoiceCallButton({ platform, onText, api = typeof window === 'undefined' ? undefined : window.desktop?.voiceCall, availability: given }: {
  readonly platform: string
  readonly onText: (text: string) => void
  readonly api?: VoiceCallApi
  /** For a test: what `available()` would say. */
  readonly availability?: VoiceCallAvailability
}) {
  const [availability, setAvailability] = useState<VoiceCallAvailability | undefined>(given)
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState<readonly Line[]>([])
  const [partial, setPartial] = useState<Readonly<Record<VoiceCallRole, string>>>({ you: '', voice: '' })
  const [message, setMessage] = useState('')
  const [muted, setMuted] = useState(false)
  const [working, setWorking] = useState(false)
  const [levels, setLevels] = useState({ you: 0, voice: 0 })
  const [seconds, setSeconds] = useState(0)
  const call = useRef<LiveVoiceCall | undefined>(undefined)
  const anchor = useRef<HTMLSpanElement>(null)
  const [lift, setLift] = useState(0)
  const current = useRef<Phase>('idle')
  const transition = (next: Phase): void => { current.current = next; setPhase(next) }

  useEffect(() => {
    if (given !== undefined || api === undefined || platform !== 'win32') return
    let alive = true
    void api.available().then((answer) => { if (alive) setAvailability(answer) }).catch(() => undefined)
    return () => { alive = false }
  }, [api, given, platform])

  // What is said, as Codex hears and speaks it.
  useEffect(() => {
    if (api === undefined || (phase !== 'calling' && phase !== 'live')) return
    return api.onEvent((update) => {
      if (update.kind === 'partial') setPartial((was) => ({ ...was, [update.role]: was[update.role] + update.delta }))
      else if (update.kind === 'said') {
        setPartial((was) => ({ ...was, [update.role]: '' }))
        if (update.text.trim().length > 0) setLines((was) => [...was, { role: update.role, text: update.text.trim() }])
      } else if (update.kind === 'working') setWorking(update.working)
      else if (update.kind === 'error') setMessage(update.message)
      else if (update.kind === 'ended' && current.current === 'live') {
        void call.current?.hangUp()
        call.current = undefined
        if (update.why !== undefined) setMessage(update.why)
        transition('ended')
      }
    })
  }, [api, phase])

  // The strip's bars and the chat box's glow follow whoever is talking; nothing runs between calls.
  useEffect(() => {
    if (phase !== 'live') return
    setVoiceState('listening')
    const started = performance.now()
    const timer = setInterval(() => {
      const now = call.current?.levels() ?? { you: 0, voice: 0 }
      setLevels(now)
      setVoiceLevel(Math.max(now.you, now.voice))
      setSeconds(Math.floor((performance.now() - started) / 1000))
    }, 100)
    return () => {
      clearInterval(timer)
      setVoiceLevel(0)
      setVoiceState('off')
    }
  }, [phase])

  // The strip stands above the whole chat box, not on its text: lifted from this button to the box's top
  // edge, and kept there if the box grows (the drive's first frame had it over "Message Wren...").
  useLayoutEffect(() => {
    if (phase === 'idle') return
    const span = anchor.current
    const form = span?.closest('form')
    if (span === null || span === undefined || form === null || form === undefined) return
    const measure = (): void => { setLift(Math.max(0, span.getBoundingClientRect().top - form.getBoundingClientRect().top)) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(form)
    return () => { observer.disconnect() }
  }, [phase])

  // Leaving the conversation ends its call: no voice goes on talking from a box nobody can see.
  useEffect(() => () => { void call.current?.hangUp(); call.current = undefined }, [])

  const start = async (): Promise<void> => {
    if (api === undefined || current.current === 'calling' || current.current === 'live') return
    setLines([]); setPartial({ you: '', voice: '' }); setMessage(''); setMuted(false); setWorking(false); setSeconds(0)
    transition('calling')
    try {
      const { openVoiceCall } = await import('../voiceCall.js')
      const opened = await openVoiceCall(api, (why) => {
        call.current = undefined
        setMessage(why)
        transition('ended')
      })
      if ((current.current as Phase) !== 'calling') { await opened.hangUp(); return }
      call.current = opened
      transition('live')
    } catch (error) {
      setMessage(error instanceof Error && error.message.length > 0 ? error.message : 'The call could not start.')
      transition('ended')
    }
  }
  const end = async (): Promise<void> => {
    const live = call.current
    call.current = undefined
    transition('ended')
    await live?.hangUp()
  }
  const close = (): void => { transition('idle'); setMessage('') }

  if (platform !== 'win32' || api === undefined || availability?.available !== true) return null
  const on = phase === 'calling' || phase === 'live'
  const speaking = levels.voice > 0.08
  const status = phase === 'calling'
    ? 'Calling…'
    : working ? 'Codex is looking in the folder…' : speaking ? 'ChatGPT is speaking' : muted ? 'Muted' : 'Listening'
  const clock = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
  const shown = phase === 'ended' ? lines : lines.slice(-3)
  const loud = Math.max(levels.you, levels.voice)
  return <span className="lc-call" ref={anchor}>
    <button
      type="button"
      className={`lc-control lc-call__button${on ? ' is-on' : ''}`}
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => { void (on ? end() : start()) }}
      aria-label={on ? 'End the voice call' : 'Talk'}
      aria-pressed={on}
      title={on ? 'End the call' : VOICE_CALL_TITLE}
    >
      <Icon name="waveform" size={17} />
    </button>
    {phase !== 'idle' && <div className="lc-call__strip" role="region" aria-label="Voice call" style={{ bottom: `calc(100% + ${String(lift + 10)}px)` }}>
      <div className="lc-call__head">
        {phase === 'ended'
          ? <span className="lc-call__status">Call ended{seconds > 0 ? ` · ${clock}` : ''}</span>
          : <>
            <span className={`lc-call__bars${speaking ? ' is-voice' : ''}`} aria-hidden="true">
              {[0.55, 0.85, 1, 0.85, 0.55].map((weight, index) => (
                <span key={index} className="lc-call__bar" style={{ transform: `scaleY(${String(0.18 + 0.82 * Math.sqrt(Math.min(1, loud * weight * (phase === 'live' ? 1 : 0))))})` }} />
              ))}
            </span>
            <span className="lc-call__status" role="status">{status}{phase === 'live' ? ` · ${clock}` : ''}</span>
          </>}
        <span className="lc-call__acts">
          {phase === 'live' && <button type="button" className="lc-control" aria-pressed={muted} onClick={() => { const next = !muted; setMuted(next); call.current?.setMuted(next) }}>
            <Icon name={muted ? 'mic-off' : 'mic'} size={15} />{muted ? 'Unmute' : 'Mute'}
          </button>}
          {on && <button type="button" className="lc-control lc-call__end" onClick={() => { void end() }}>End</button>}
          {phase === 'ended' && voiceCallText(lines).length > 0 && <button type="button" className="lc-control lc-control--boxed" onClick={() => { onText(voiceCallText(lines)); close() }}>Put it in the chat box</button>}
          {phase === 'ended' && <button type="button" className="lc-control" onClick={close}>Close</button>}
        </span>
      </div>
      {(shown.length > 0 || partial.you.length > 0 || partial.voice.length > 0) && <div className="lc-call__lines">
        {shown.map((line, index) => <p key={index} className={`lc-call__line is-${line.role}`}><span className="lc-call__who">{line.role === 'you' ? 'You' : 'ChatGPT'}</span>{line.text}</p>)}
        {on && (['you', 'voice'] as const).map((role) => partial[role].trim().length > 0 && <p key={`partial-${role}`} className={`lc-call__line is-${role} is-partial`}><span className="lc-call__who">{role === 'you' ? 'You' : 'ChatGPT'}</span>{partial[role].trim()}</p>)}
      </div>}
      {message && <p className="lc-call__message">{message}</p>}
    </div>}
  </span>
}
