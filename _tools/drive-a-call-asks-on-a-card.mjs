// On a call with a teammate, a connector's question is a card in their conversation (0.749, canvas board 2).
//
//   LOCUST_SPEND=1 node _tools/drive-a-call-asks-on-a-card.mjs
//
// Windows only, Codex CLI signed in with ChatGPT, a DEVELOPMENT build (out/): the note tool is the drive's own
// throwaway server (LOCUST_VOICE_TEST_SERVER), which only a development build honours. Ada (Claude Code, Haiku) is
// sent one typed message first, so the call has her conversation to live in. Then Talk, and Windows' own voice asks
// Ada to send a note with that tool herself. The tool asks first: the question must be an approval card in the
// conversation -- the action, the note's text on its own row, Allow once and Deny -- and not a row in the call's
// strip, which points at it with Show. The drive presses DENY on the card, never Allow, and the server's log must
// show the note was never sent. Spends one short typed turn on Haiku and a little ChatGPT voice time.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

if (process.platform !== 'win32') {
  say('Voice calls are on Windows only for now.')
  process.exit(0)
}
const MATE = { teammateId: 'tm_ada', name: 'Ada', hue: 'violet', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }

const voiceDir = mkdtempSync(join(tmpdir(), 'locust-drive-call-card-'))
const ask = join(voiceDir, 'ask.wav')
const pause = '<break time="10000ms"/>'
const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="7000ms"/>Ada, use the send note tool yourself, right now, to send a note that says hello. Do not hand it to anyone.${pause}${pause}${pause}${pause}${pause}${pause}${pause}${pause}${pause}</speak>`
execFileSync('powershell.exe', ['-NoProfile', '-Command', [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  `$s.SetOutputToWaveFile('${ask}', $f)`,
  `$s.SpeakSsml('${ssml}')`,
  '$s.Dispose()'
].join('; ')], { windowsHide: true })
if (!existsSync(ask)) throw new Error('Windows did not record the request.')

const probeLog = join(voiceDir, 'probe-calls.log')
const probe = join(voiceDir, 'probe-server.mjs')
writeFileSync(probe, [
  "import { appendFileSync } from 'node:fs'",
  "import { createInterface } from 'node:readline'",
  "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')",
  "createInterface({ input: process.stdin }).on('line', (line) => {",
  "  let r; try { r = JSON.parse(line) } catch { return }",
  "  if (r.id === undefined) return",
  "  if (r.method === 'initialize') send({ jsonrpc: '2.0', id: r.id, result: { protocolVersion: r.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '1' } } })",
  "  else if (r.method === 'tools/list') send({ jsonrpc: '2.0', id: r.id, result: { tools: [{ name: 'send_note', description: 'Sends a short note.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } })",
  `  else if (r.method === 'tools/call') { appendFileSync(${JSON.stringify(probeLog)}, JSON.stringify(r.params) + '\\n'); send({ jsonrpc: '2.0', id: r.id, result: { content: [{ type: 'text', text: 'sent' }] } }) }`,
  "  else send({ jsonrpc: '2.0', id: r.id, result: {} })",
  '})'
].join('\n'), 'utf8')

const workspace = await scratchRepository('locust-drive-call-card-ws-')
writeFileSync(join(workspace, 'README.md'), '# Notes\n\nA folder for a drive.\n', 'utf8')
const drive = await startDrive({
  name: 'a-call-asks-on-a-card',
  port: 9599,
  workspace,
  spends: true,
  env: { LOCUST_VOICE_TEST_SERVER: probe },
  outPath: join(recordRoot('a-call-asks-on-a-card-2026-10-12'), 'local-claude'),
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
const READ = `(() => {
  const strip = document.querySelector('[role=region][aria-label="Voice call"]')
  const card = document.querySelector('.lc-thread [data-call-ask]')
  return JSON.stringify({
    status: strip?.querySelector('.lc-call__status')?.innerText ?? '',
    stripAsks: strip?.querySelectorAll('.lc-call__ask').length ?? 0,
    show: [...(strip?.querySelectorAll('button') ?? [])].some((b) => b.innerText.trim() === 'Show'),
    card: card === null ? '' : card.innerText.replace(/\\s+/g, ' ').trim(),
    rows: card === null ? [] : [...card.querySelectorAll('dt')].map((dt) => dt.innerText.trim() + '=' + (dt.nextElementSibling?.innerText ?? '').replace(/\\s+/g, ' ').trim()),
    lines: [...document.querySelectorAll('.lc-callsaid')].map((line) => (line.classList.contains('is-you') ? 'You: ' : 'Ada: ') + (line.querySelector('.lc-callsaid__bubble, .lc-callsaid__text')?.innerText ?? '').replace(/\\s+/g, ' ').trim()),
    message: strip?.querySelector('.lc-call__message')?.innerText ?? ''
  })
})()`
const read = async () => JSON.parse(String(await drive.evaluate(READ)))

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  const opened = String(await drive.evaluate(openTeammateScript(MATE.name)))
  check(`${MATE.name}'s conversation is open`, opened.startsWith('opened'), opened)
  const typed = String(await drive.evaluate(sendAndWaitScript('Hi. Reply with just the word hello.', { waitSeconds: 240 })))
  check(`${MATE.name} answered the typed message`, typed.startsWith('finished') && /hello/i.test(typed), typed.slice(-160))

  await drive.evaluate(`(async () => { for (let i = 0; i < 40 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250)) })()`)
  await drive.evaluate(`document.querySelector('button[aria-label="Talk"]').click()`)

  let state = await read()
  for (let second = 0; second < 150 && state.card === '' && state.stripAsks === 0 && state.message === ''; second += 1) {
    await sleep(1000)
    state = await read()
  }
  await sleep(800)
  state = await read()
  await drive.capture('the question, on a card in the conversation', () => JSON.stringify(state))
  check('no error on the way', state.message === '', state.message)
  check('the question is a card in the conversation', state.card !== '', JSON.stringify(state).slice(0, 400))
  check('the card is an approval: the action, the note on its own row, Allow once and Deny',
    /Approval required/.test(state.card) && state.rows.some((row) => /^Action=locust probe: send note$/i.test(row)) && state.rows.some((row) => /^Text=.*hello/i.test(row)) && /Allow once/.test(state.card) && /Deny/.test(state.card),
    state.rows.join(' | '))
  check('it says a spoken yes does not allow it', /Saying yes on the call does not allow it/.test(state.card), state.card.slice(-160))
  check('the strip asks nothing itself, waits, and points at the card', state.stripAsks === 0 && /Waiting for you to allow it/.test(state.status) && state.show, `${state.status} · strip asks ${String(state.stripAsks)} · Show ${String(state.show)}`)

  if (state.card !== '') {
    await drive.evaluate(`[...document.querySelectorAll('.lc-thread [data-call-ask] button')].find((b) => b.innerText.trim() === 'Deny')?.click()`)
    await sleep(1500)
    const after = await read()
    check('Deny on the card takes the question away', after.card === '' && !/Waiting for you/.test(after.status), `${after.status} · ${after.card.slice(0, 120)}`)
    await sleep(8000)
    check('and the note was never sent', !existsSync(probeLog), existsSync(probeLog) ? readFileSync(probeLog, 'utf8') : 'no call')
    state = await read()
    await drive.capture('after Deny', () => JSON.stringify(state))
  }
  await drive.evaluate(`[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'End')?.click()`)
  await sleep(2500)
  say(`  lines: ${state.lines.join(' | ').slice(0, 1200)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: out/. On a call with Ada, the note tool asks on a card in her conversation, and is denied there.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
