import { useSyncExternalStore } from 'react'

import type { VoiceCallRole } from '../../shared/voice-call.js'
import type { SavedCall } from '../../shared/calls.js'

/*
 * THE CALL, WHERE THE THREAD CAN READ IT (0.747). The canvas Colin passed on 2026-10-11 ("im down ... just try it
 * out"): a call with a teammate lives in that teammate's conversation -- what you both said, in the thread, among the
 * turns the call started -- rather than in a strip over whatever is on screen. The Talk button owns the call; this is
 * the one place it says what the call holds, for the thread beside it.
 */
export interface LiveCall extends SavedCall {
  readonly phase: 'calling' | 'live' | 'ended'
  /** Words still being said, by whom. */
  readonly partial: Readonly<Record<VoiceCallRole, string>>
}

let current: LiveCall | undefined
const listeners = new Set<() => void>()

export function liveCall(): LiveCall | undefined {
  return current
}

export function setLiveCall(next: LiveCall | undefined): void {
  if (next === current) return
  current = next
  for (const listener of [...listeners]) listener()
}

/** Changes the live call, when there is one; nothing otherwise. */
export function updateLiveCall(change: (call: LiveCall) => LiveCall): void {
  if (current !== undefined) setLiveCall(change(current))
}

/** A turn the call started: kept with its time, so the thread puts the call's words around it. */
export function addLiveCallTurn(missionId: string, at = Date.now()): void {
  updateLiveCall((call) => call.turns.some((turn) => turn.missionId === missionId) ? call : { ...call, turns: [...call.turns, { missionId, at }] })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useLiveCall(): LiveCall | undefined {
  return useSyncExternalStore(subscribe, liveCall, liveCall)
}

/** Bumped each time a call is saved, so the thread reads its conversation's calls again. */
let saved = 0
const savedListeners = new Set<() => void>()
export function markCallSaved(): void {
  saved += 1
  for (const listener of [...savedListeners]) listener()
}
export function useCallsSaved(): number {
  return useSyncExternalStore(
    (listener) => { savedListeners.add(listener); return () => { savedListeners.delete(listener) } },
    () => saved,
    () => saved
  )
}
