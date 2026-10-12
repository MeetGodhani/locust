// A voice call hands work to a teammate (0.739): the voice starts a real conversation with Wren.
//
//   LOCUST_SPEND=1 node _tools/drive-a-voice-call-hands-off.mjs [--packaged <exe>]
//
// Windows only, Codex CLI signed in with ChatGPT. Windows' own voice records, after seven seconds of silence
// (the call connects meanwhile -- Chromium's fake microphone plays from the moment it opens), "Please have
// Wren list the files in this folder", then "Yes, that's right, go ahead and send it", then a minute of
// silence, so the request is heard once. --mute-audio keeps the reply off the speakers. Wren is on the free
// model, in Edit; listing files changes nothing. It spends a little ChatGPT voice time and a Codex turn
// behind the voice, so it asks for LOCUST_SPEND=1.
//
// The strip must say "Handed to Wren"; a conversation of Wren's must appear and say it was started from a
// voice call; End must leave no Codex running.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, conversationRows, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
if (process.platform !== 'win32') {
  say('Voice calls are on Windows only for now.')
  process.exit(0)
}

const voiceDir = mkdtempSync(join(tmpdir(), 'locust-drive-voice-handoff-'))
const ask = join(voiceDir, 'ask.wav')
const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="7000ms"/>Please have Wren list the files in this folder.<break time="3000ms"/>Yes, that is right. Go ahead and send it.<break time="10000ms"/><break time="10000ms"/><break time="10000ms"/><break time="10000ms"/><break time="10000ms"/><break time="10000ms"/></speak>'
execFileSync('powershell.exe', ['-NoProfile', '-Command', [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  `$s.SetOutputToWaveFile('${ask}', $f)`,
  `$s.SpeakSsml('${ssml}')`,
  '$s.Dispose()'
].join('; ')], { windowsHide: true })
if (!existsSync(ask)) throw new Error('Windows did not record the request.')

const codexCount = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process -Name codex -ErrorAction SilentlyContinue | Measure-Object).Count'], { encoding: 'utf8', windowsHide: true }).trim() || '0')
const codexBefore = codexCount()

const workspace = await scratchRepository('locust-drive-voice-handoff-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-voice-call-hands-off',
  port: 9599,
  workspace,
  spends: true,
  outPath: join(recordRoot('a-voice-call-hands-off-2026-10-11'), packaged === undefined ? 'local' : 'packaged'),
  extraArgs: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${ask}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-11T10:00:00.000Z', route: FREE_ROUTE }],
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
    status: strip?.querySelector('.lc-call__status')?.innerText ?? '',
    lines: [...(strip?.querySelectorAll('.lc-call__line') ?? [])].map((line) => line.innerText.replace(/\\s+/g, ' ').trim()),
    message: strip?.querySelector('.lc-call__message')?.innerText ?? ''
  })
})()`
const strip = async () => JSON.parse(String(await drive.evaluate(STRIP)))
const wrensRows = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify(${conversationRows()}.filter((row) => row.owner === 'tm_wren').map((row) => row.title))`)))

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 800)) })()`)
  await drive.evaluate(`(async () => { for (let i = 0; i < 40 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250)) })()`)
  const rowsBefore = await wrensRows()
  await drive.evaluate(`document.querySelector('button[aria-label="Talk"]').click()`)
  // Since 0.747 a call with Wren says its lines in Wren's conversation, among the turn it starts.
  const THREAD_LINES = `JSON.stringify([...document.querySelectorAll('.lc-callsaid')].map((line) => (line.classList.contains('is-you') ? 'You' : 'Wren') + (line.querySelector('.lc-callsaid__bubble, .lc-callsaid__text')?.innerText ?? '').replace(/\\s+/g, ' ').trim()))`
  let state = { status: '', lines: [], message: '' }
  let said = []
  for (let second = 0; second < 120; second += 1) {
    await sleep(1000)
    state = await strip()
    said = JSON.parse(String(await drive.evaluate(THREAD_LINES)))
    if (((await wrensRows()).length > rowsBefore.length && said.some((line) => line.startsWith('Wren'))) || state.message) break
  }
  await drive.capture('the call, handing it over', () => JSON.stringify({ ...state, said }))
  check('the call’s words are in Wren’s conversation, the ask among them', said.some((line) => /^You/.test(line) && /files/i.test(line)) && said.some((line) => line.startsWith('Wren')), said.join(' | '))
  check('no error on the way', state.message === '', state.message)

  // A real conversation of Wren's, new since the call began.
  let rows = rowsBefore
  for (let second = 0; second < 30 && rows.length <= rowsBefore.length; second += 1) {
    await sleep(1000)
    rows = await wrensRows()
  }
  check('a conversation of Wren’s started from the call', rows.length > rowsBefore.length, `${String(rowsBefore.length)} -> ${String(rows.length)}: ${rows.join(' | ')}`)

  await drive.evaluate(`[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'End')?.click()`)
  await sleep(2500)
  // Ended, the call folds to one row in Wren's conversation; opened, it says every line (0.747).
  const folded = String(await drive.evaluate(`document.querySelector('.lc-callrow')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
  check('ended, the call folds to one row', /Call with Wren/.test(folded) && /lines? said/.test(folded), folded)
  await drive.evaluate(`(async () => { document.querySelector('.lc-callrow')?.click(); await new Promise((r) => setTimeout(r, 500)) })()`)
  const ended = { lines: JSON.parse(String(await drive.evaluate(THREAD_LINES))) }
  // Windows' voice saying "Wren" is often heard as "Ren".
  check('the voice heard the request', ended.lines.some((line) => /^You/.test(line) && /\bw?ren\b/i.test(line) && /files/i.test(line)), ended.lines.join(' | '))
  const marker = String(await drive.capture('Wren’s conversation, from the call', () => drive.evaluate(`(async () => {
    const row = ${conversationRows()}.filter((r) => r.owner === 'tm_wren')[0]
    row?.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const markers = [...document.querySelectorAll('.lc-thread__marker')].map((m) => m.innerText.trim())
      if (markers.some((m) => /voice call/i.test(m))) return markers.join(' | ')
    }
    return [...document.querySelectorAll('.lc-thread__marker')].map((m) => m.innerText.trim()).join(' | ') || 'no marker'
  })()`)))
  check('that conversation says it was started from a voice call', /Started from a voice call/i.test(marker), marker)
  await sleep(3000)
  const codexAfter = codexCount()
  check('End leaves no Codex the call started', codexAfter <= codexBefore + 0, `${String(codexBefore)} before, ${String(codexAfter)} after`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A voice call asks for Wren to list the files; the voice hands it over.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
