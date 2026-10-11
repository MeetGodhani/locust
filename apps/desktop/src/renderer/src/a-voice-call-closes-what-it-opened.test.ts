import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VoiceCallApi, VoiceCallStartResult } from '../../shared/voice-call.js'
import { VoiceCallAborted, VoiceCallRefused, openVoiceCall } from './voiceCall.js'

/*
 * THE WINDOW'S HALF OF A CALL CLOSES WHAT IT OPENED (0.738, Sol's review of 0.737: #5, #8, #9, #10). With a
 * stand-in microphone, peer connection and audio: a failure building the audio leaves the microphone off, a
 * refused answer stops Codex's call too, a connection that never comes up gives up in words, an End during the
 * start reaches it, and a call that drops says so.
 */
let tracksStopped = 0
let peers: FakePeer[] = []
const behaviour = { remote: 'ok' as 'ok' | 'reject', connect: 'connected' as 'connected' | 'never', audioThrows: false }

class FakePeer {
  connectionState = 'new'
  iceGatheringState = 'complete'
  localDescription: { readonly sdp: string } | undefined
  ontrack: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  closed = false
  private readonly listeners = new Map<string, Set<() => void>>()
  constructor() { peers.push(this) }
  addTrack(): void {}
  createDataChannel(): object { return {} }
  async createOffer(): Promise<{ type: string; sdp: string }> { return { type: 'offer', sdp: 'v=0\r\nfake offer' } }
  async setLocalDescription(description: { sdp: string }): Promise<void> { this.localDescription = description }
  async setRemoteDescription(): Promise<void> {
    if (behaviour.remote === 'reject') throw new Error('The answer is not valid SDP')
    if (behaviour.connect === 'connected') setTimeout(() => this.become('connected'), 0)
  }
  addEventListener(type: string, listener: () => void): void { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener) }
  removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener) }
  become(state: string): void {
    this.connectionState = state
    for (const listener of [...(this.listeners.get('connectionstatechange') ?? [])]) listener()
    this.onconnectionstatechange?.()
  }
  close(): void { this.closed = true; this.connectionState = 'closed' }
}
class FakeAudioContext {
  constructor() { if (behaviour.audioThrows) throw new Error('audio device busy') }
  createAnalyser(): object { return { fftSize: 1024, getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0) } }
  createMediaStreamSource(): object { return { connect: () => undefined } }
  async close(): Promise<void> {}
}
class FakeAudio { autoplay = false; srcObject: unknown = null; async play(): Promise<void> {} }

function api(start: () => Promise<VoiceCallStartResult> = async () => ({ ok: true, answer: 'v=0\r\nanswer' })) {
  const stops: number[] = []
  const calls: VoiceCallApi = { available: async () => ({ available: true }), start, stop: async () => { stops.push(1) }, answer: async () => undefined, onEvent: () => () => undefined }
  return { calls, stops }
}
const FAST = { gatherMs: 10, connectMs: 60, reconnectMs: 40 }

beforeEach(() => {
  tracksStopped = 0
  peers = []
  Object.assign(behaviour, { remote: 'ok', connect: 'connected', audioThrows: false })
  const track = { stop: () => { tracksStopped += 1 }, enabled: true }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } })
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('MediaStream', class {})
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the window’s half of a call', () => {
  it('opens, and hangs up everything: microphone, connection, and Codex', async () => {
    const { calls, stops } = api()
    const live = await openVoiceCall(calls, () => undefined, undefined, FAST)
    expect(tracksStopped).toBe(0)
    await live.hangUp()
    expect([tracksStopped, peers[0]!.closed, stops.length]).toEqual([1, true, 1])
  })

  it('turns the microphone off when the audio cannot be built (#8)', async () => {
    behaviour.audioThrows = true
    const { calls, stops } = api(async () => { throw new Error('never asked') })
    await expect(openVoiceCall(calls, () => undefined, undefined, FAST)).rejects.toEqual(new VoiceCallRefused('The call could not start. Try again.'))
    expect(tracksStopped).toBe(1)
    expect(stops).toHaveLength(0)
  })

  it('stops Codex’s call when its answer is refused here (#9)', async () => {
    behaviour.remote = 'reject'
    const { calls, stops } = api()
    await expect(openVoiceCall(calls, () => undefined, undefined, FAST)).rejects.toBeInstanceOf(VoiceCallRefused)
    expect([tracksStopped, stops.length]).toEqual([1, 1])
  })

  it('gives up in words when the connection never comes up (#10)', async () => {
    behaviour.connect = 'never'
    const { calls, stops } = api()
    await expect(openVoiceCall(calls, () => undefined, undefined, FAST)).rejects.toEqual(new VoiceCallRefused('The call did not connect. Check your internet connection and try again.'))
    expect([tracksStopped, stops.length]).toEqual([1, 1])
  })

  it('is reached by End while Codex is still placing it (#5)', async () => {
    let answer: (result: VoiceCallStartResult) => void = () => undefined
    const { calls, stops } = api(() => new Promise((resolve) => { answer = resolve }))
    const controller = new AbortController()
    const opening = openVoiceCall(calls, () => undefined, controller.signal, FAST)
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    // The microphone is off and Codex told at once, before Codex's own answer arrives.
    expect([tracksStopped, stops.length]).toEqual([1, 1])
    answer({ ok: true, answer: 'v=0\r\nlate' })
    await expect(opening).rejects.toBeInstanceOf(VoiceCallAborted)
    expect(peers[0]!.closed).toBe(true)
  })

  it('says a dropped call dropped, after a disconnection that does not come back (#10)', async () => {
    const { calls, stops } = api()
    const dropped: string[] = []
    await openVoiceCall(calls, (why) => dropped.push(why), undefined, FAST)
    peers[0]!.become('disconnected')
    expect(dropped).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(dropped).toEqual(['The connection to the voice service dropped.'])
    expect([tracksStopped, stops.length]).toEqual([1, 1])
  })

  it('keeps a call whose connection comes back in time', async () => {
    const { calls, stops } = api()
    const dropped: string[] = []
    await openVoiceCall(calls, (why) => dropped.push(why), undefined, FAST)
    peers[0]!.become('disconnected')
    await new Promise((resolve) => setTimeout(resolve, 10))
    peers[0]!.become('connected')
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect([dropped.length, tracksStopped, stops.length]).toEqual([0, 0, 0])
  })
})
