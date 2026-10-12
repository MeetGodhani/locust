import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVoicePreviews, speakHelloCommand } from './voice-preview.js'

/*
 * WHAT A VOICE SOUNDED LIKE, KEPT (0.751). The first play of a voice is a short call; the greeting the window records
 * is kept, one file a voice, and every play after that is the kept one. Only one of ChatGPT's nine, and only a short
 * WebM recording, is kept. The spoken "Hello?" the voice answers is made once by Windows' own speech.
 */
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const place = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-voice-previews-'))
  roots.push(root)
  return join(root, 'voice-previews')
}
/** A WebM recording begins with the EBML magic 1A 45 DF A3. */
const webm = (size = 2_000): Uint8Array => { const bytes = new Uint8Array(size).fill(7); bytes.set([0x1a, 0x45, 0xdf, 0xa3]); return bytes }
const wave = (): Uint8Array => { const bytes = new Uint8Array(200); bytes.set([...Buffer.from('RIFF')], 0); bytes.set([...Buffer.from('WAVE')], 8); return bytes }

describe("a voice's greeting, kept", () => {
  it('keeps a short recording for one of the nine and gives it back whole', async () => {
    const previews = createVoicePreviews({ root: await place(), speak: async () => undefined })
    expect(await previews.saved('sol')).toBeUndefined()
    expect(await previews.save('sol', webm())).toBe(true)
    expect(await previews.saved('sol')).toEqual(webm())
    expect(await previews.saved('cove')).toBeUndefined()
  })

  it('refuses any other voice, and anything that is not a short WebM recording', async () => {
    const root = await place()
    const previews = createVoicePreviews({ root, speak: async () => undefined })
    for (const [voice, audio] of [
      ['alloy', webm()], ['../sol', webm()], ['sol', new Uint8Array(500)], ['sol', webm(1_600_000)],
      ['sol', new Uint8Array(2_000).fill(1)], ['sol', 'not audio'], [undefined, webm()]
    ] as const) {
      expect(await previews.save(voice, audio)).toBe(false)
    }
    expect(await previews.saved('../sol')).toBeUndefined()
    expect(await readdir(root).catch(() => [])).toEqual([])
    // A file put there by something else is not handed out as a greeting.
    await previews.save('sol', webm())
    await writeFile(join(root, 'sol.webm'), 'not a recording')
    expect(await previews.saved('sol')).toBeUndefined()
  })

  it('makes the hello once, by one caller at a time, and again only after a failure', async () => {
    const root = await place()
    let fail = true
    const speak = vi.fn(async (path: string) => {
      if (fail) { fail = false; throw new Error('no speech here') }
      await writeFile(path, wave())
    })
    const previews = createVoicePreviews({ root, speak })
    expect(await previews.trigger()).toBeUndefined()
    const [one, two] = await Promise.all([previews.trigger(), previews.trigger()])
    expect(speak).toHaveBeenCalledTimes(2)
    expect(one).toEqual(wave())
    expect(two).toEqual(wave())
    // Kept: a new Locust reads it rather than speaking again.
    const again = createVoicePreviews({ root, speak })
    expect(await again.trigger()).toEqual(wave())
    expect(speak).toHaveBeenCalledTimes(2)
  })

  it('hands PowerShell its script encoded, so no quote in the path is ever parsed', () => {
    const args = speakHelloCommand("C:\\Users\\O'Brien\\AppData\\Roaming\\Locust\\voice-previews\\hello.wav")
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
    const script = Buffer.from(args[3]!, 'base64').toString('utf16le')
    expect(script).toContain("SetOutputToWaveFile('C:\\Users\\O''Brien\\AppData\\Roaming\\Locust\\voice-previews\\hello.wav', $f)")
    expect(script).toContain("Speak('Hello?')")
  })
})
