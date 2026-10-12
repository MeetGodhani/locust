import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MAX_KEPT_CALLS, callPlacements, isSavedCall, type SavedCall } from '../shared/calls.js'
import { createCallLog } from './call-log.js'

/*
 * A CALL IS KEPT WITH ITS CONVERSATION (0.747). The canvas of 2026-10-11 ("im down ... just try it out"): what was
 * said on a call with a teammate goes in that teammate's conversation, among the turns the call started, and stays
 * there after the call -- folded to one line that opens again.
 */
const call = (overrides: Partial<SavedCall> = {}): SavedCall => ({
  callId: 'call_1', teammateId: 'tm_ada', name: 'Ada', afterMissionId: 'm_typed', startedAt: 1_000, endedAt: 104_000,
  lines: [
    { role: 'you', text: 'Ada, check the readme for the secret ingredient.', at: 10_000 },
    { role: 'voice', text: 'Let me check.', at: 12_000 },
    { role: 'you', text: 'So what did you find?', at: 60_000 },
    { role: 'voice', text: 'It is cardamom.', at: 62_000 }
  ],
  turns: [{ missionId: 'm_asked', at: 20_000 }],
  ...overrides
})

describe('where a call\'s words go among the turns', () => {
  it('puts what asked for a turn above it, and what came after under it', () => {
    const placed = callPlacements([call()], ['m_typed', 'm_asked'])
    expect(placed.get('before:m_asked')?.map((piece) => piece.lines.map((line) => line.text))).toEqual([['Ada, check the readme for the secret ingredient.', 'Let me check.']])
    expect(placed.get('after:m_asked')?.map((piece) => piece.lines.map((line) => line.text))).toEqual([['So what did you find?', 'It is cardamom.']])
    expect(placed.get('before:m_asked')?.[0]?.first).toBe(true)
    expect(placed.get('after:m_asked')?.[0]?.last).toBe(true)
  })

  it('puts a call that started nothing under the turn that was on screen, else at the end', () => {
    expect(callPlacements([call({ turns: [] })], ['m_typed']).get('after:m_typed')?.[0]?.lines).toHaveLength(4)
    expect(callPlacements([call({ turns: [], afterMissionId: 'elsewhere' })], ['m_typed']).get('end')?.[0]?.lines).toHaveLength(4)
  })

  it('splits the words between two turns at the second one', () => {
    const two = call({ turns: [{ missionId: 'm_asked', at: 20_000 }, { missionId: 'm_again', at: 61_000 }] })
    const placed = callPlacements([two], ['m_typed', 'm_asked', 'm_again'])
    expect(placed.get('after:m_asked')?.[0]?.lines.map((line) => line.text)).toEqual(['So what did you find?'])
    expect(placed.get('after:m_again')?.[0]?.lines.map((line) => line.text)).toEqual(['It is cardamom.'])
  })
})

describe('a call as the window sends it', () => {
  it('is kept only when it reads as one', () => {
    expect(isSavedCall(call())).toBe(true)
    for (const bad of [undefined, {}, call({ callId: 'no spaces allowed' }), call({ lines: [{ role: 'them' as 'you', text: 'x', at: 1 }] }), call({ name: '' }), call({ startedAt: -1 })]) {
      expect(isSavedCall(bad)).toBe(false)
    }
  })
})

describe('the calls file', () => {
  const roots: string[] = []
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
  const fileIn = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'locust-calls-'))
    roots.push(root)
    return join(root, 'calls.json')
  }

  it('keeps a call, gives it back for any of its turns, and replaces it when it is sent again', async () => {
    const file = await fileIn()
    const log = createCallLog(file)
    expect(await log.save(call({ endedAt: undefined }))).toBe(true)
    expect(await log.save(call())).toBe(true)
    expect(await log.list(['m_asked'])).toEqual([call()])
    expect(await log.list(['m_typed'])).toHaveLength(1)
    expect(await log.list(['m_other'])).toEqual([])
    expect(JSON.parse(await readFile(file, 'utf8')).calls).toHaveLength(1)
  })

  it('refuses what is not a call, and keeps only the newest', async () => {
    const file = await fileIn()
    const log = createCallLog(file)
    expect(await log.save({ callId: 'x' })).toBe(false)
    expect(await log.list('m_asked')).toEqual([])
    await writeFile(file, JSON.stringify({ calls: Array.from({ length: MAX_KEPT_CALLS }, (_, index) => call({ callId: `call_${String(index)}`, startedAt: 1_000 + index })) }), 'utf8')
    await log.save(call({ callId: 'call_new', startedAt: 999_999 }))
    const kept = JSON.parse(await readFile(file, 'utf8')).calls as SavedCall[]
    expect(kept).toHaveLength(MAX_KEPT_CALLS)
    expect(kept.at(-1)?.callId).toBe('call_new')
    expect(kept.some((one) => one.callId === 'call_0')).toBe(false)
  })

  /*
   * A FILE THAT DOES NOT READ IS NOT "NO CALLS" (0.753, bug hunt 2026-10-12, TK2). One cut short by a sync tool was read
   * as empty, and the next call's save wrote that one call over it: every call kept before it gone.
   */
  it('writes nothing over a calls.json that does not read, and lists none from it', async () => {
    const file = await fileIn()
    const log = createCallLog(file)
    expect(await log.save(call({ callId: 'call_old1' }))).toBe(true)
    const cutShort = (await readFile(file, 'utf8')).slice(0, 40)
    await writeFile(file, cutShort, 'utf8')
    expect(await log.save(call({ callId: 'call_new1' }))).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(cutShort)
    expect(await log.list(['m_asked'])).toEqual([])
    // A file that holds no list of calls is unreadable too; a missing one is simply none yet.
    await writeFile(file, 'null', 'utf8')
    expect(await log.save(call({ callId: 'call_new2' }))).toBe(false)
    expect(await createCallLog(join(file, '..', 'nothing-yet.json')).save(call({ callId: 'call_first' }))).toBe(true)
  })
})
