import type { VoiceCallRole } from './voice-call.js'

/*
 * A CALL, KEPT WITH ITS CONVERSATION (0.747). The canvas of 2026-10-11 ("im down ... just try it out"): a call with a
 * teammate lives in that teammate's conversation. What the person and the teammate SAID is kept here -- the turns the
 * call started are already in the record, each marked as started from a voice call -- and the thread puts the words
 * among those turns by time.
 */

export const CALLS_SAVE = 'calls:save'
export const CALLS_LIST = 'calls:list'

export interface SavedCallLine {
  readonly role: VoiceCallRole
  readonly text: string
  /** When it was said, ms since the epoch. */
  readonly at: number
}

/** A turn the call started, and when. */
export interface SavedCallTurn {
  readonly missionId: string
  readonly at: number
}

export interface SavedCall {
  readonly callId: string
  readonly teammateId: string
  /** The teammate's name when the call was made, for its lines. */
  readonly name: string
  /** The turn on screen when the call began; absent when the call began a conversation of its own. */
  readonly afterMissionId?: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly lines: readonly SavedCallLine[]
  readonly turns: readonly SavedCallTurn[]
}

export interface CallsApi {
  save(call: SavedCall): Promise<boolean>
  /** The calls kept with any of these turns. */
  list(missionIds: readonly string[]): Promise<readonly SavedCall[]>
}

export const MAX_CALL_LINES = 400
export const MAX_CALL_LINE = 2_000
export const MAX_CALL_TURNS = 40
export const MAX_KEPT_CALLS = 500
const ID = /^[A-Za-z0-9_-]{1,128}$/

const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** A call as the window sends it or the file holds it; anything else is not one. */
export function isSavedCall(value: unknown): value is SavedCall {
  const call = record(value)
  if (call === undefined) return false
  if (typeof call.callId !== 'string' || !ID.test(call.callId) || typeof call.teammateId !== 'string' || !ID.test(call.teammateId)) return false
  if (typeof call.name !== 'string' || call.name.length === 0 || call.name.length > 80) return false
  if (call.afterMissionId !== undefined && (typeof call.afterMissionId !== 'string' || !ID.test(call.afterMissionId))) return false
  if (!time(call.startedAt) || (call.endedAt !== undefined && !time(call.endedAt))) return false
  if (!Array.isArray(call.lines) || call.lines.length > MAX_CALL_LINES || !Array.isArray(call.turns) || call.turns.length > MAX_CALL_TURNS) return false
  const lineOk = (line: unknown): boolean => {
    const one = record(line)
    return one !== undefined && (one.role === 'you' || one.role === 'voice') && typeof one.text === 'string' && one.text.length > 0 && one.text.length <= MAX_CALL_LINE && time(one.at)
  }
  const turnOk = (turn: unknown): boolean => {
    const one = record(turn)
    return one !== undefined && typeof one.missionId === 'string' && ID.test(one.missionId) && time(one.at)
  }
  return call.lines.every(lineOk) && call.turns.every(turnOk)
}

/** The calls kept with any of these turns: started from one, or after one. */
export function callsOf(calls: readonly SavedCall[], missionIds: readonly string[]): readonly SavedCall[] {
  const ids = new Set(missionIds)
  return calls.filter((call) => (call.afterMissionId !== undefined && ids.has(call.afterMissionId)) || call.turns.some((turn) => ids.has(turn.missionId)))
}

/** A run of one call's lines, at one place in the thread. */
export interface CallPiece {
  readonly call: SavedCall
  readonly lines: readonly SavedCallLine[]
  /** The call's first piece: its divider goes here. */
  readonly first: boolean
  /** Its last piece: where it ends, and where words still being said go. */
  readonly last: boolean
}

/** Where pieces go: before a turn's message, after a turn's work, or at the end of the thread. */
export type CallPlace = `before:${string}` | `after:${string}` | 'end'

/**
 * WHERE A CALL'S WORDS GO among a conversation's turns, by time. The words said before the call's first turn go just
 * above that turn's message -- they are what asked for it; the words said between two of its turns go under the
 * earlier one's work; the words after its last turn go under that turn. A call that started no turn sits under the
 * turn that was on screen when it began, or, with none of its turns here, at the end.
 */
export function callPlacements(calls: readonly SavedCall[], missionIds: readonly string[]): ReadonlyMap<CallPlace, readonly CallPiece[]> {
  const here = new Set(missionIds)
  const placed = new Map<CallPlace, CallPiece[]>()
  const put = (place: CallPlace, piece: CallPiece): void => { placed.set(place, [...(placed.get(place) ?? []), piece]) }
  for (const call of [...calls].sort((a, b) => a.startedAt - b.startedAt)) {
    const turns = call.turns.filter((turn) => here.has(turn.missionId)).sort((a, b) => a.at - b.at)
    const lines = [...call.lines].sort((a, b) => a.at - b.at)
    if (turns.length === 0) {
      const place: CallPlace = call.afterMissionId !== undefined && here.has(call.afterMissionId) ? `after:${call.afterMissionId}` : 'end'
      put(place, { call, lines, first: true, last: true })
      continue
    }
    put(`before:${turns[0]!.missionId}`, { call, lines: lines.filter((line) => line.at < turns[0]!.at), first: true, last: false })
    turns.forEach((turn, index) => {
      const next = turns[index + 1]
      const last = next === undefined
      put(`after:${turn.missionId}`, { call, lines: lines.filter((line) => line.at >= turn.at && (last || line.at < next.at)), first: false, last })
    })
  }
  return placed
}

/** "1:43", a call's length. */
export function callLength(call: SavedCall, now = Date.now()): string {
  const seconds = Math.max(0, Math.round(((call.endedAt ?? now) - call.startedAt) / 1000))
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}
