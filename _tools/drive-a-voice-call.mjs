// A voice call with ChatGPT's voice, placed by Codex, from the chat box (0.737).
//
//   LOCUST_SPEND=1 node _tools/drive-a-voice-call.mjs [--packaged <exe>]
//
// Windows only, with Codex CLI signed in with ChatGPT. Windows' own voice records "What is two plus two?
// Answer in one short sentence." to a WAV, and Chromium's fake microphone plays it into the call in place
// of the person's, over and over (--use-file-for-fake-audio-capture); --mute-audio keeps the reply off the speakers. It
// spends a little of the ChatGPT plan's voice time, so it asks for LOCUST_SPEND=1.
//
// Talk must be beside the microphone; pressing it must reach "Listening"; ChatGPT must answer, in the
// strip, with "four"; End must end it and leave no Codex the call started; "Put it in the chat box" must
// put the call in the box as lines. Nothing else of the folder changes.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const voice = arg('--voice')
if (process.platform !== 'win32') {
  say('Voice calls are on Windows only for now.')
  process.exit(0)
}

// The question, in Windows' own voice: 24 kHz mono 16-bit, the format the call takes.
const voiceDir = mkdtempSync(join(tmpdir(), 'locust-drive-voice-'))
const ask = join(voiceDir, 'ask.wav')
execFileSync('powershell.exe', ['-NoProfile', '-Command', [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  `$s.SetOutputToWaveFile('${ask}', $f)`,
  "$s.Speak('What is two plus two? Answer in one short sentence.')",
  '$s.Dispose()'
].join('; ')], { windowsHide: true })
if (!existsSync(ask)) throw new Error('Windows did not record the question.')

const codexCount = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', "(Get-Process -Name codex -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: 'utf8', windowsHide: true }).trim() || '0')
const codexBefore = codexCount()

const workspace = await scratchRepository('locust-drive-voice-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-voice-call',
  port: 9595,
  workspace,
  spends: true,
  outPath: join(recordRoot('a-voice-call-2026-10-10'), packaged === undefined ? 'local' : 'packaged'),
  // Looped, not %noloop: the fake microphone plays from the moment it opens, and the call takes a few
  // seconds to connect after that (measured: a single play was over before the voice was listening).
  extraArgs: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${ask}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-10T10:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const STRIP = `(() => {
  const strip = document.querySelector('[role=region][aria-label="Voice call"]')
  return JSON.stringify({
    strip: !!strip,
    status: strip?.querySelector('.lc-call__status')?.innerText ?? '',
    lines: [...(strip?.querySelectorAll('.lc-call__line') ?? [])].map((line) => line.innerText.replace(/\\s+/g, ' ').trim()),
    message: strip?.querySelector('.lc-call__message')?.innerText ?? '',
    buttons: [...(strip?.querySelectorAll('button') ?? [])].map((button) => button.innerText.trim())
  })
})()`
const strip = async () => JSON.parse(String(await drive.evaluate(STRIP)))

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  // --voice <id> (0.745): Settings > General > Talk's voice first, so the call speaks in it.
  if (voice !== undefined) {
    const chosen = String(await drive.capture(`Talk’s voice: ${voice}`, () => drive.evaluate(`(async () => {
      document.querySelector('button[title="Settings (Ctrl 3)"]').click()
      await new Promise(r => setTimeout(r, 900))
      ;[...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('General'))?.click()
      let select
      for (let i = 0; i < 40 && !(select = document.querySelector('select[aria-label="Talk’s voice"]')); i += 1) await new Promise(r => setTimeout(r, 250))
      if (!select) return 'no voice picker'
      select.scrollIntoView({ block: 'center' })
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(voice)})
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(r => setTimeout(r, 900))
      return select.value + ' :: ' + (select.closest('.lc-settingline')?.querySelector('.lc-settings__lede')?.innerText ?? '')
    })()`)))
    check(`Settings keeps the voice: ${voice}`, chosen.startsWith(`${voice} ::`), chosen)
    await drive.evaluate(`document.querySelector('button[title="Settings (Ctrl 3)"]')?.click()`)
    await sleep(600)
    await drive.evaluate(`document.querySelector('button[aria-label="Home"]')?.click()`)
    await sleep(900)
  }
  // On Home, where Talk is ChatGPT's own voice: in a teammate's conversation it is a call with them (0.746).
  await drive.evaluate(`(async () => { document.querySelector('button[aria-label="Home"]')?.click(); await new Promise(r => setTimeout(r, 800)) })()`)
  const beside = String(await drive.capture('Talk, beside the microphone', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 40 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250))
    const talk = document.querySelector('button[aria-label="Talk"]')
    const mic = document.querySelector('button[aria-label="Voice typing"]')
    if (!talk) return 'no Talk button'
    return (mic && mic.compareDocumentPosition(talk) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after the mic' : 'not after the mic') + ' :: ' + talk.title
  })()`)))
  check('Talk is in the chat box, right after the microphone', /^after the mic/.test(beside), beside)

  // End while it is still calling (0.738, Sol's review #5/#6): the strip ends, and no Codex is left behind it.
  const early = String(await drive.capture('Talk, then End while calling', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Talk"]').click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 50))
      if (/Calling/.test(document.querySelector('.lc-call__status')?.innerText ?? '')) break
    }
    const calling = document.querySelector('.lc-call__status')?.innerText ?? ''
    ;[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'End')?.click()
    await new Promise(r => setTimeout(r, 600))
    return calling + ' -> ' + (document.querySelector('.lc-call__status')?.innerText ?? 'no strip')
  })()`)))
  await sleep(4000)
  const codexAfterEarly = codexCount()
  check('End while calling ends it, and leaves no Codex running', /^Calling/.test(early) && /Call ended/.test(early) && codexAfterEarly <= codexBefore, `${early} · codex ${String(codexBefore)} before, ${String(codexAfterEarly)} after`)
  await drive.evaluate(`[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'Close')?.click()`)
  await sleep(500)

  await drive.evaluate(`document.querySelector('button[aria-label="Talk"]').click()`)
  let state = { strip: false, status: '', lines: [], message: '' }
  for (let second = 0; second < 25; second += 1) {
    await sleep(1000)
    state = await strip()
    if (/Listening|speaking|looking/i.test(state.status) || state.message) break
  }
  check('pressing Talk reaches the call: it listens', /Listening|speaking|looking/i.test(state.status), JSON.stringify(state))
  // ChatGPT's own voice wears the orb (0.752) where a teammate's call wears the face: in the bar, drawing, moving.
  const orbSeen = JSON.parse(String(await drive.evaluate(`(async () => {
    const strip = document.querySelector('[role=region][aria-label="Voice call"]')
    const canvas = strip?.querySelector('canvas.lc-voiceorb')
    if (!canvas) return JSON.stringify({ orb: false, bars: strip?.querySelectorAll('.lc-call__bars').length ?? 0 })
    const sample = () => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let lit = 0
      let sum = 0
      for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) lit += 1; sum += data[i] }
      return { lit, sum }
    }
    const first = sample()
    await new Promise((r) => setTimeout(r, 300))
    const second = sample()
    return JSON.stringify({ orb: true, bars: strip.querySelectorAll('.lc-call__bars').length, size: canvas.getBoundingClientRect().width, lit: first.lit, moved: first.sum !== second.sum })
  })()`)))
  check('ChatGPT’s voice wears the orb in the bar, in place of the level bars', orbSeen.orb && orbSeen.bars === 0 && orbSeen.size === 28, JSON.stringify(orbSeen))
  check('the orb draws, and moves while the call is on', orbSeen.lit > 50 && orbSeen.moved, JSON.stringify(orbSeen))

  // The fake microphone asks once; the answer is a line from ChatGPT with "four" in it.
  for (let second = 0; second < 45; second += 1) {
    await sleep(1000)
    state = await strip()
    if (state.lines.some((line) => /^ChatGPT/.test(line) && /\bfour\b|\b4\b/i.test(line))) break
    if (state.message) break
  }
  await drive.capture('the call, answered', () => JSON.stringify(state))
  await drive.resize(860, 720)
  await sleep(600)
  const narrow = JSON.parse(String(await drive.capture('the call, at 860', () => drive.evaluate(`(() => { const strip = document.querySelector('[role=region][aria-label="Voice call"]')?.getBoundingClientRect(); const box = document.querySelector('textarea[aria-label="Message"]')?.closest('form')?.getBoundingClientRect(); return JSON.stringify({ left: strip?.left ?? -1, right: strip?.right ?? -1, bottom: strip?.bottom ?? -1, boxTop: box?.top ?? -1, width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth }) })()`))))
  check('at 860 the strip is whole, above the chat box, and nothing scrolls sideways', narrow.left >= 0 && narrow.right <= narrow.width && narrow.bottom <= narrow.boxTop && narrow.overflow <= 0, JSON.stringify(narrow))
  await drive.resize(1215, 800)
  await sleep(400)
  check('the question is heard, as a line of yours', state.lines.some((line) => /^You/.test(line) && /two plus two|2\s*\+\s*2/i.test(line)), state.lines.join(' | '))
  check('ChatGPT answers out loud, and the strip says it: four', state.lines.some((line) => /^ChatGPT/.test(line) && /\bfour\b|\b4\b/i.test(line)), state.lines.join(' | '))
  check('no error on the way', state.message === '', state.message)

  await drive.evaluate(`[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'End')?.click()`)
  await sleep(2500)
  state = await drive.capture('the call, ended', () => strip())
  check('End ends the call, and the lines stay', /Call ended/.test(state.status) && state.lines.length > 0, JSON.stringify(state))
  check('it offers to put the call in the chat box', state.buttons.includes('Put it in the chat box'), state.buttons.join(' / '))
  await sleep(2000)
  const codexAfter = codexCount()
  check('no Codex the call started is left running', codexAfter <= codexBefore, `${String(codexBefore)} before, ${String(codexAfter)} after`)

  const box = String(await drive.capture('the call, in the chat box', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'Put it in the chat box')?.click()
    await new Promise(r => setTimeout(r, 500))
    return document.querySelector('textarea[aria-label="Message"]')?.value ?? 'no box'
  })()`)))
  check('the chat box holds the call, line by line', /^From a voice call:/.test(box) && /ChatGPT: .*(four|4)/i.test(box), box)
  check('and the strip has gone', !(await strip()).strip)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A voice call from Wren's chat box, the question played by Chromium's fake microphone, the reply muted.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
