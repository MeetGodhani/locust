import type { VoiceCallApi } from '../../shared/voice-call.js'

/**
 * THE WINDOW'S HALF OF A VOICE CALL (0.737): the microphone, the WebRTC connection, and the voice played.
 *
 * Made the way the probe that first reached ChatGPT's voice through Codex made it (2026-10-10): one audio
 * track out, the `oai-events` data channel the voice service expects, the offer sent whole once ICE has
 * gathered (no trickle on this route), the answer from Codex set as the remote description. The
 * microphone is opened WITH echo cancellation -- unlike voice typing's -- because the voice plays from
 * the same speakers it would otherwise hear and answer itself.
 */
export interface LiveVoiceCall {
  /** 0 to 1, each side's loudness now, for the strip and the glow. */
  levels(): { readonly you: number; readonly voice: number }
  setMuted(muted: boolean): void
  hangUp(): Promise<void>
}

/** The call was refused before it began; its message is already in a person's words. */
export class VoiceCallRefused extends Error {}

/** How long ICE may gather before the offer goes as it stands. */
const GATHER_MS = 3000

function gathered(connection: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (connection.iceGatheringState === 'complete') return resolve()
    const done = (): void => {
      if (connection.iceGatheringState !== 'complete') return
      connection.removeEventListener('icegatheringstatechange', done)
      resolve()
    }
    connection.addEventListener('icegatheringstatechange', done)
    setTimeout(resolve, GATHER_MS)
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

export async function openVoiceCall(api: VoiceCallApi, onDropped: (why: string) => void): Promise<LiveVoiceCall> {
  let mic: MediaStream
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
  } catch {
    throw new VoiceCallRefused('Locust could not use the microphone. Check that Windows lets apps use it (Settings > Privacy > Microphone) and try again.')
  }
  const connection = new RTCPeerConnection()
  const context = new AudioContext()
  const played = new Audio()
  played.autoplay = true
  const youAnalyser = context.createAnalyser()
  youAnalyser.fftSize = 1024
  context.createMediaStreamSource(mic).connect(youAnalyser)
  let voiceAnalyser: AnalyserNode | undefined
  let closed = false
  let muted = false
  const close = (): void => {
    if (closed) return
    closed = true
    connection.close()
    for (const track of mic.getTracks()) track.stop()
    played.srcObject = null
    void context.close().catch(() => undefined)
  }
  try {
    for (const track of mic.getAudioTracks()) connection.addTrack(track, mic)
    connection.createDataChannel('oai-events')
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      played.srcObject = stream
      void played.play().catch(() => undefined)
      voiceAnalyser = context.createAnalyser()
      voiceAnalyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(voiceAnalyser)
    }
    // `disconnected` can come back by itself; `failed` does not.
    connection.onconnectionstatechange = () => {
      if (!closed && connection.connectionState === 'failed') {
        close()
        void api.stop().catch(() => undefined)
        onDropped('The connection to the voice service dropped.')
      }
    }
    await connection.setLocalDescription(await connection.createOffer())
    await gathered(connection)
    const offer = connection.localDescription?.sdp
    if (offer === undefined || offer.length === 0) throw new VoiceCallRefused('The call could not start: this window made no offer.')
    const started = await api.start(offer)
    if (!started.ok) throw new VoiceCallRefused(started.message)
    await connection.setRemoteDescription({ type: 'answer', sdp: started.answer })
  } catch (error) {
    close()
    throw error
  }
  const youBuffer = new Float32Array(youAnalyser.fftSize)
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
