// Talk to a teammate (0.746): the call is with the teammate, its asks go into the teammate's OWN conversation, and the
// voice tells you what the teammate found.
//
//   LOCUST_SPEND=1 node _tools/drive-a-voice-call-with-a-teammate.mjs [--packaged <exe>] [--teammate claude|codex]
//
// Windows only, Codex CLI signed in with ChatGPT. The teammate is Ada on Claude Code (Haiku) or Atlas on Codex
// (gpt-6-luna, low). First a typed message, so Ada has a conversation the PERSON started -- the one Talk must
// continue. Then Talk, and Windows' own voice asks for the README's secret ingredient, waits, and asks what was
// found. The README is the only place the answer is, so a spoken "cardamom" means the teammate's run read it and
// the voice relayed it. Spends one short typed turn, one asked turn and a little ChatGPT voice time.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { conversationRows, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const which = arg('--teammate') ?? 'claude'
const MATE = which === 'codex'
  ? { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', route: { runtime: 'codex', model: 'gpt-6-luna', effort: 'low', mode: 'accept-edits' } }
  : { teammateId: 'tm_ada', name: 'Ada', hue: 'violet', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }
if (process.platform !== 'win32') {
  say('Voice calls are on Windows only for now.')
  process.exit(0)
}

const voiceDir = mkdtempSync(join(tmpdir(), 'locust-drive-voice-mate-'))
const ask = join(voiceDir, 'ask.wav')
const pause = '<break time="10000ms"/>'
const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="7000ms"/>${MATE.name}, can you check the read me file and tell me the secret ingredient?${pause}${pause}${pause}${pause}${pause}So, what did you find?${pause}${pause}${pause}${pause}${pause}</speak>`
execFileSync('powershell.exe', ['-NoProfile', '-Command', [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  `$s.SetOutputToWaveFile('${ask}', $f)`,
  `$s.SpeakSsml('${ssml}')`,
  '$s.Dispose()'
].join('; ')], { windowsHide: true })
if (!existsSync(ask)) throw new Error('Windows did not record the request.')

const workspace = await scratchRepository('locust-drive-voice-mate-ws-')
writeFileSync(join(workspace, 'README.md'), '# Grandma\'s soup\n\nThe secret ingredient is cardamom, added at the very end.\n', 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-voice-call-with-${which}`,
  port: 9597,
  workspace,
  spends: true,
  outPath: join(recordRoot('a-voice-call-with-a-teammate-2026-10-11'), `${packaged === undefined ? 'local' : 'packaged'}-${which}`),
  extraArgs: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${ask}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: MATE.teammateId, name: MATE.name, hue: MATE.hue, role: 'Code & Migrations', createdAt: '2026-10-11T10:00:00.000Z', route: MATE.route }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const STRIP = `(() => {
  const strip = document.querySelector('[role=region][aria-label="Voice call"]')
  return JSON.stringify({
    status: strip?.querySelector('.lc-call__status')?.innerText ?? '',
    face: strip?.querySelector('.lc-call__head [data-teammate]') !== null && strip?.querySelector('.lc-call__head [data-teammate]') !== undefined,
    // A call with a teammate says its lines in the thread (0.747); the strip keeps the call's controls.
    lines: [...document.querySelectorAll('.lc-callsaid')].map((line) => (line.classList.contains('is-you') ? 'You' : ${JSON.stringify(MATE.name)}) + (line.querySelector('.lc-callsaid__bubble, .lc-callsaid__text')?.innerText ?? '').replace(/\\s+/g, ' ').trim()),
    message: strip?.querySelector('.lc-call__message')?.innerText ?? ''
  })
})()`
const strip = async () => JSON.parse(String(await drive.evaluate(STRIP)))
const matesRows = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify(${conversationRows()}.filter((row) => row.owner === ${JSON.stringify(MATE.teammateId)}).map((row) => row.title))`)))
const thread = async () => String(await drive.evaluate(`JSON.stringify({ text: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? '', markers: [...document.querySelectorAll('.lc-thread__marker')].map((m) => m.innerText.trim()) })`))

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  const opened = String(await drive.evaluate(openTeammateScript(MATE.name)))
  check(`${MATE.name}'s conversation is open`, opened.startsWith('opened'), opened)
  // A conversation the PERSON started: the one Talk must continue.
  const typed = String(await drive.evaluate(sendAndWaitScript('Hi. Reply with just the word hello.', { waitSeconds: 240 })))
  check(`${MATE.name} answered the typed message`, typed.startsWith('finished') && /hello/i.test(typed), typed.slice(-160))
  const rowsBefore = await matesRows()

  await drive.evaluate(`(async () => { for (let i = 0; i < 40 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250)) })()`)
  const titled = String(await drive.evaluate(`document.querySelector('button[aria-label="Talk"]')?.title ?? ''`))
  check(`Talk says it calls ${MATE.name}`, titled.startsWith(`Talk to ${MATE.name}`), titled)
  await drive.evaluate(`document.querySelector('button[aria-label="Talk"]').click()`)

  let state = { status: '', face: false, lines: [], message: '' }
  const heard = []
  let sawFace = false
  let sawName = false
  for (let second = 0; second < 170; second += 1) {
    await sleep(1000)
    state = await strip()
    sawFace = sawFace || state.face
    sawName = sawName || new RegExp(`^${MATE.name}`).test(state.status) || state.lines.some((line) => line.startsWith(MATE.name))
    for (const line of state.lines) if (!heard.includes(line)) heard.push(line)
    if (heard.some((line) => line.startsWith(MATE.name) && /cardamom/i.test(line)) || state.message) break
  }
  await drive.capture(`the call with ${MATE.name}`, () => JSON.stringify(state))
  check(`the strip wears ${MATE.name}'s face`, sawFace, JSON.stringify(state))
  check(`the voice speaks as ${MATE.name}`, sawName, heard.slice(0, 4).join(' | '))
  check(`${MATE.name} said what the README says: cardamom`, heard.some((line) => line.startsWith(MATE.name) && /cardamom/i.test(line)), heard.join(' | '))
  check('no error on the way', state.message === '', state.message)

  const rowsAfter = await matesRows()
  check(`it stayed ONE conversation of ${MATE.name}'s`, rowsAfter.length === rowsBefore.length && rowsAfter.length === 1, `${String(rowsBefore.length)} -> ${String(rowsAfter.length)}: ${rowsAfter.join(' | ')}`)
  const read = JSON.parse(await thread())
  check('the asked turn is in that conversation, marked as from the call, and it found the answer', read.markers.some((marker) => /voice call/i.test(marker)) && /cardamom/i.test(read.text), `${read.markers.join(' | ')} :: ${read.text.slice(-240)}`)

  await drive.evaluate(`[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'End')?.click()`)
  await sleep(2500)
  say(`  lines: ${heard.filter((line, index) => !heard.slice(index + 1).some((later) => later.startsWith(line))).join(' | ').slice(0, 1400)}`)
  // Ended, the call folds to one row in the conversation, and opens to every word again (0.747).
  const folded = JSON.parse(String(await drive.capture('the call, ended', () => drive.evaluate(`JSON.stringify({ row: document.querySelector('.lc-callrow')?.innerText.replace(/\\s+/g, ' ').trim() ?? '', open: document.querySelectorAll('.lc-callsaid').length })`))))
  check('ended, the call folds to one row in the conversation', /Call with/.test(folded.row) && /lines? said/.test(folded.row) && folded.open === 0, JSON.stringify(folded))
  const reopened = String(await drive.capture('the call, opened again', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-callrow')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return String(document.querySelectorAll('.lc-callsaid').length) + ' lines · ' + (/call ended/i.test(document.querySelector('.lc-thread')?.innerText ?? '') ? 'ended line' : 'no ended line')
  })()`)))
  check('and opens to every word again', /^[1-9]\d* lines · ended line$/.test(reopened), reopened)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A call with ${MATE.name} (${MATE.route.runtime}): asked through the call, answered by ${MATE.name}'s own run.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
