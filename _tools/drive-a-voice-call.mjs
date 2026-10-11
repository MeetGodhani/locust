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

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
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
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 800)) })()`)
  const beside = String(await drive.capture('Talk, beside the microphone', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 40 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250))
    const talk = document.querySelector('button[aria-label="Talk"]')
    const mic = document.querySelector('button[aria-label="Voice typing"]')
    if (!talk) return 'no Talk button'
    return (mic && mic.compareDocumentPosition(talk) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after the mic' : 'not after the mic') + ' :: ' + talk.title
  })()`)))
  check('Talk is in the chat box, right after the microphone', /^after the mic/.test(beside), beside)

  await drive.evaluate(`document.querySelector('button[aria-label="Talk"]').click()`)
  let state = { strip: false, status: '', lines: [], message: '' }
  for (let second = 0; second < 25; second += 1) {
    await sleep(1000)
    state = await strip()
    if (/Listening|speaking|looking/i.test(state.status) || state.message) break
  }
  check('pressing Talk reaches the call: it listens', /Listening|speaking|looking/i.test(state.status), JSON.stringify(state))

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
