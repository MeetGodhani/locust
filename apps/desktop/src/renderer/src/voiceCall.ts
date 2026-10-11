import type { VoiceCallApi } from '../../shared/voice-call.js'

/**
 * THE WINDOW'S HALF OF A VOICE CALL (0.737): the microphone, the WebRTC connection, and the voice played.
 *
 * Made the way the probe that first reached ChatGPT's voice through Codex made it (2026-10-10): one audio
 * track out, the `oai-events` data channel the voice service expects, the offer sent whole once ICE has
 * gathered (no trickle on this route), the answer from Codex set as the remote description. The
 * microphone is opened WITH echo cancellation -- unlike voice typing's -- because the voice plays from
 * the same speakers it would otherwise hear and answer itself.
 *
 * EVERY WAY OUT CLOSES WHAT IT OPENED (0.738, Sol's review of 0.737). The microphone was opened outside the
 * guard, so a failure building the audio graph left it on (#8); a refused answer closed this side and left
 * Codex's call running (#9); End or leaving the conversation could not reach a start still under way (#5);
 * and a connection that never came up, or never came back, waited for ever (#10). Now one close runs on every
 * failure, Codex is told to stop once it has been asked, the signal ends a start at its next step, and the
 * connection has a deadline to come up and a grace period to come back.
 */
export interface LiveVoiceCall {
  /** 0 to 1, each side's loudness now, for the strip and the glow. */
  levels(): { readonly you: number; readonly voice: number }
  setMuted(muted: boolean): void
  hangUp(): Promise<void>
}

/** The call was refused before it began; its message is already in a person's words. */
export class VoiceCallRefused extends Error {}

/** The person ended the call while it was starting; nothing to say about it. */
export class VoiceCallAborted extends Error {}

export interface VoiceCallTimings {
  /** How long ICE may gather before the offer goes as it stands. */
  readonly gatherMs: number
  /** How long the connection has to come up once the answer is set. */
  readonly connectMs: number
  /** How long a `disconnected` connection may take to come back before the call counts as dropped. */
  readonly reconnectMs: number
}

const TIMINGS: VoiceCallTimings = { gatherMs: 3_000, connectMs: 15_000, reconnectMs: 8_000 }

function gathered(connection: RTCPeerConnection, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (connection.iceGatheringState === 'complete') return resolve()
    const done = (): void => {
      if (connection.iceGatheringState !== 'complete') return
      connection.removeEventListener('icegatheringstatechange', done)
      resolve()
    }
    connection.addEventListener('icegatheringstatechange', done)
    setTimeout(resolve, ms)
  })
}

function loudness(analyser: AnalyserNode | undefined, buffer: Float32Array<ArrayBuffer>): number {
  if (analyser === undefined) return 0
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (const sample of buffer) sum += sample * sample
  // Speech sits around 0.02-0.2 RMS; scaled so ordinary talk fills most of the range.
  return Math.min(1, Math.sqrt(sum / buffer.length) * 5)
}

export async function openVoiceCall(
  api: VoiceCallApi,
  onDropped: (why: string) => void,
  signal?: AbortSignal,
  timings: VoiceCallTimings = TIMINGS
): Promise<LiveVoiceCall> {
  if (signal?.aborted === true) throw new VoiceCallAborted('ended')
  let mic: MediaStream
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
  } catch {
    throw new VoiceCallRefused('Locust could not use the microphone. Check that Windows lets apps use it (Settings > Privacy > Microphone) and try again.')
  }
  let connection: RTCPeerConnection | undefined
  let context: AudioContext | undefined
  let played: HTMLAudioElement | undefined
  let voiceAnalyser: AnalyserNode | undefined
  let closed = false
  let muted = false
  /** Codex has been asked for the call, so ending must tell it. */
  let asked = false
  let reconnecting: ReturnType<typeof setTimeout> | undefined
  const close = (): void => {
    if (closed) return
    closed = true
    if (reconnecting !== undefined) clearTimeout(reconnecting)
    connection?.close()
    for (const track of mic.getTracks()) track.stop()
    if (played !== undefined) played.srcObject = null
    void context?.close().catch(() => undefined)
  }
  const stopped = (): void => {
    close()
    if (asked) void api.stop().catch(() => undefined)
  }
  const onAbort = (): void => { stopped() }
  signal?.addEventListener('abort', onAbort, { once: true })
  const abortedNow = (): boolean => signal?.aborted === true || closed
  let youAnalyser: AnalyserNode
  try {
    // Everything from here is inside the guard: the microphone is already open (#8).
    connection = new RTCPeerConnection()
    context = new AudioContext()
    played = new Audio()
    played.autoplay = true
    youAnalyser = context.createAnalyser()
    youAnalyser.fftSize = 1024
    context.createMediaStreamSource(mic).connect(youAnalyser)
    for (const track of mic.getAudioTracks()) connection.addTrack(track, mic)
    connection.createDataChannel('oai-events')
    const peer = connection
    const audioContext = context
    const audio = played
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      audio.srcObject = stream
      void audio.play().catch(() => undefined)
      voiceAnalyser = audioContext.createAnalyser()
      voiceAnalyser.fftSize = 1024
      audioContext.createMediaStreamSource(stream).connect(voiceAnalyser)
    }
    await peer.setLocalDescription(await peer.createOffer())
    await gathered(peer, timings.gatherMs)
    if (abortedNow()) throw new VoiceCallAborted('ended')
    const offer = peer.localDescription?.sdp
    if (offer === undefined || offer.length === 0) throw new VoiceCallRefused('The call could not start: this window made no offer.')
    asked = true
    const started = await api.start(offer)
    if (abortedNow()) throw new VoiceCallAborted('ended')
    if (!started.ok) {
      // Codex refused it and has ended its side already.
      asked = false
      throw new VoiceCallRefused(started.message)
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: started.answer })
    // The connection has a deadline to come up (#10).
    await new Promise<void>((resolve, reject) => {
      if (peer.connectionState === 'connected') return resolve()
      const timer = setTimeout(() => {
        peer.removeEventListener('connectionstatechange', watch)
        reject(new VoiceCallRefused('The call did not connect. Check your internet connection and try again.'))
      }, timings.connectMs)
      const watch = (): void => {
        if (peer.connectionState === 'connected') {
          clearTimeout(timer)
          peer.removeEventListener('connectionstatechange', watch)
          resolve()
        } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          clearTimeout(timer)
          peer.removeEventListener('connectionstatechange', watch)
          reject(new VoiceCallRefused('The call did not connect. Check your internet connection and try again.'))
        }
      }
      peer.addEventListener('connectionstatechange', watch)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new VoiceCallAborted('ended')) }, { once: true })
    })
    if (abortedNow()) throw new VoiceCallAborted('ended')
    // Once up: `failed` is the end, and `disconnected` gets a grace period to come back (#10).
    peer.onconnectionstatechange = () => {
      if (closed) return
      if (peer.connectionState === 'connected' && reconnecting !== undefined) {
        clearTimeout(reconnecting)
        reconnecting = undefined
        return
      }
      const drop = (): void => {
        if (closed) return
        stopped()
        onDropped('The connection to the voice service dropped.')
      }
      if (peer.connectionState === 'failed') drop()
      else if (peer.connectionState === 'disconnected' && reconnecting === undefined) reconnecting = setTimeout(drop, timings.reconnectMs)
    }
  } catch (error) {
    stopped()
    signal?.removeEventListener('abort', onAbort)
    if (error instanceof VoiceCallRefused || error instanceof VoiceCallAborted) throw error
    if ((signal?.aborted as boolean | undefined) === true) throw new VoiceCallAborted('ended')
    throw new VoiceCallRefused('The call could not start. Try again.')
  }
  signal?.removeEventListener('abort', onAbort)
  const youBuffer = new Float32Array(1024)
  const voiceBuffer = new Float32Array(1024)
  return {
    levels: () => ({ you: muted || closed ? 0 : loudness(youAnalyser, youBuffer), voice: closed ? 0 : loudness(voiceAnalyser, voiceBuffer) }),
    setMuted: (next) => {
      muted = next
      for (const track of mic.getAudioTracks()) track.enabled = !next
    },
    hangUp: async () => {
      if (closed) return
      close()
      await api.stop().catch(() => undefined)
    }
  }
}
