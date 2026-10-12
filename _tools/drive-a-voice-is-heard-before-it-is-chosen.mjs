// Hear it (0.751, canvas board 4): beside Talk's voice in Settings, a voice says hello before it is chosen.
//
//   LOCUST_SPEND=1 node _tools/drive-a-voice-is-heard-before-it-is-chosen.mjs [--packaged <exe>] [--voice sol]
//
// Windows only, Codex CLI signed in with ChatGPT. Settings > General > Talk's voice is set to the voice, and Hear it
// is pressed: the first time it is a short call with that voice alone (no microphone: a "Hello?" made by Windows'
// own speech goes into it), which says it is getting the voice, plays its answer, and keeps it in the profile's
// voice-previews folder. Pressed again, the kept greeting plays at once -- no "Getting" -- and nothing new is kept.
// It spends a few seconds of the ChatGPT plan's voice time, so it asks for LOCUST_SPEND=1.

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const voice = arg('--voice') ?? 'sol'
const name = voice.charAt(0).toUpperCase() + voice.slice(1)
if (process.platform !== 'win32') {
  say('Voice calls are on Windows only for now.')
  process.exit(0)
}

const workspace = await scratchRepository('locust-drive-voice-heard-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-voice-is-heard',
  port: 9602,
  workspace,
  spends: true,
  outPath: join(recordRoot('a-voice-is-heard-before-it-is-chosen-2026-10-12'), packaged === undefined ? 'local' : 'packaged'),
  // The kept greeting plays from a press the drive makes in script, which Chromium does not count as a gesture.
  extraArgs: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const kept = join(drive.profile, 'voice-previews', `${voice}.webm`)
const BUTTON = `(() => {
  const button = document.querySelector('[data-setting="talk-voice"] .lc-voiceplay button')
  return JSON.stringify({ text: button?.innerText.trim() ?? '', label: button?.getAttribute('aria-label') ?? '', note: document.querySelector('[data-setting="talk-voice"] .lc-voiceplay__note')?.innerText ?? '' })
})()`
const button = async () => JSON.parse(String(await drive.evaluate(BUTTON)))
/** Presses Hear it and follows the button until it is back to rest; what it said on the way. */
async function hear(seconds) {
  const seen = []
  const startedAt = Date.now()
  let playingAfter
  await drive.evaluate(`document.querySelector('[data-setting="talk-voice"] .lc-voiceplay button')?.click()`)
  let state = await button()
  for (let tick = 0; tick < seconds * 10; tick += 1) {
    await sleep(100)
    state = await button()
    if (!seen.includes(state.text)) seen.push(state.text)
    if (playingAfter === undefined && state.text === 'Stop') playingAfter = Date.now() - startedAt
    if (state.text === 'Hear it' && tick > 2) break
  }
  return { seen, playingAfter, state }
}

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  const chosen = String(await drive.evaluate(`(async () => {
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
    return select.value
  })()`))
  check(`Talk's voice is ${name}`, chosen === voice, chosen)
  const before = await drive.capture(`Hear it beside Talk's voice`, () => button())
  check('Hear it sits beside the picker, named for the voice', before.text === 'Hear it' && before.label === `Hear ${name}`, JSON.stringify(before))

  const first = await hear(45)
  await drive.capture(`${name}, heard the first time`, () => JSON.stringify(first))
  check(`the first play says it is getting ${name}, then plays it`, first.seen.includes(`Getting ${name}…`) && first.seen.includes('Stop'), first.seen.join(' -> '))
  check('and comes back to rest with nothing wrong', first.state.text === 'Hear it' && first.state.note === '', JSON.stringify(first.state))
  const size = existsSync(kept) ? statSync(kept).size : 0
  check(`the greeting is kept in the profile (${String(size)} bytes)`, size > 5_000, kept)
  const keptAt = existsSync(kept) ? statSync(kept).mtimeMs : 0

  await sleep(1500)
  const back = String(await drive.evaluate(`(async () => { const kept = await window.desktop.voiceCall.previewSaved(${JSON.stringify(voice)}); return kept === undefined ? 'nothing kept' : (kept.constructor?.name ?? typeof kept) + ' of ' + String(kept.byteLength) + ' bytes, starting ' + [...kept.slice(0, 4)].map((b) => b.toString(16)).join(' ') })()`))
  say(`  the window gets back: ${back}`)
  const second = await hear(20)
  say(`  second play: ${JSON.stringify(second)}`)
  check('the second play is the kept one: playing at once, never getting', second.playingAfter !== undefined && second.playingAfter < 1_500 && !second.seen.some((text) => text.startsWith('Getting')), `${second.seen.join(' -> ')} · playing after ${String(second.playingAfter)} ms`)
  check('and nothing new is kept', existsSync(kept) && statSync(kept).mtimeMs === keptAt)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Hear it beside Talk's voice: ${name}, first by a short call, then kept.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
