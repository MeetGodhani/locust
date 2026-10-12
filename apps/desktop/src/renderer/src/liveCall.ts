import { useSyncExternalStore } from 'react'

import type { VoiceCallAskField, VoiceCallRole } from '../../shared/voice-call.js'
import { MAX_CALL_LINE, MAX_CALL_LINES, type SavedCall } from '../../shared/calls.js'

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
  /** A connector's questions waiting on the person (0.749): cards in the conversation, never kept with the call. */
  readonly asks?: readonly LiveCallAsk[]
}

/** One connector's question on the call: what it would do, and each value it would send. */
export interface LiveCallAsk {
  readonly id: string
  readonly what: string
  readonly detail: string
  readonly fields: readonly VoiceCallAskField[]
}

/*
 * THE ANSWER, FROM THE CARD (0.749). The Talk button owns the call, and the card in the thread answers its questions:
 * the button says here how, for as long as its call is on.
 */
let answerer: ((id: string, allowed: boolean) => Promise<void>) | undefined
export function setLiveCallAnswer(next: ((id: string, allowed: boolean) => Promise<void>) | undefined): void {
  answerer = next
}
/** False when no call is on to take it, or the answer did not reach it. */
export async function answerLiveCallAsk(id: string, allowed: boolean): Promise<boolean> {
  if (answerer === undefined) return false
  try { await answerer(id, allowed); return true } catch { return false }
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

/**
 * The call as it is kept when it ends (0.748). Words the end of the call cut off were still said: they are kept, from
 * when they began, so the thread does not lose the last thing either of you said.
 */
export function keptCall(call: LiveCall, began: Partial<Record<VoiceCallRole, number>>, now = Date.now()): SavedCall {
  const cutOff = (['you', 'voice'] as const)
    .filter((role) => call.partial[role].trim().length > 0)
    .map((role) => ({ role, text: call.partial[role].trim().slice(0, MAX_CALL_LINE), at: began[role] ?? now }))
  return {
    callId: call.callId, teammateId: call.teammateId, name: call.name,
    ...(call.afterMissionId === undefined ? {} : { afterMissionId: call.afterMissionId }),
    startedAt: call.startedAt, endedAt: call.endedAt ?? now,
    lines: [...call.lines, ...cutOff].slice(-MAX_CALL_LINES), turns: call.turns
  }
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

/**
 * WHERE THE CALL IS, AS ONE KEY (0.750): the turns of the conversation a call that is on lives in. It changes when the
 * call moves, not with every word said, so a sidebar row that says "on a call" draws again only then.
 */
export function liveCallPlace(): string {
  const call = current
  if (call === undefined || call.phase === 'ended') return ''
  return [...(call.afterMissionId === undefined ? [] : [call.afterMissionId]), ...call.turns.map((turn) => turn.missionId)].join(' ')
}
export function useLiveCallPlace(): string {
  return useSyncExternalStore(subscribe, liveCallPlace, liveCallPlace)
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
