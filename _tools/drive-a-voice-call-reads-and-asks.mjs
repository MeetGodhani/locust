// A voice call reads the folder with Locust's own tools, and a connector that would act asks in the strip (0.742).
//
//   LOCUST_SPEND=1 node _tools/drive-a-voice-call-reads-and-asks.mjs [--packaged <exe>]
//
// Windows only, Codex CLI signed in with ChatGPT. Windows' own voice records, after seven seconds of silence,
// "What is the secret ingredient in the read me file?", then, later, "Now use the send note tool to send a note
// that says hello." The folder's README names the ingredient, so the answer can only come from reading it. The
// note tool is the drive's own throwaway server (LOCUST_VOICE_TEST_SERVER, honoured by a development build only):
// it asks first, the drive presses DENY, never Allow, and the server's log must show the note was never sent.
// It spends a little ChatGPT voice time and a Codex turn behind the voice, so it asks for LOCUST_SPEND=1.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
if (process.platform !== 'win32') {
  say('Voice calls are on Windows only for now.')
  process.exit(0)
}

const voiceDir = mkdtempSync(join(tmpdir(), 'locust-drive-voice-reads-'))
const ask = join(voiceDir, 'ask.wav')
const pause = '<break time="10000ms"/>'
const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="7000ms"/>What is the secret ingredient in the read me file?${pause}${pause}${pause}Now use the send note tool to send a note that says hello.${pause}${pause}${pause}${pause}${pause}${pause}</speak>`
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

const workspace = await scratchRepository('locust-drive-voice-reads-ws-')
writeFileSync(join(workspace, 'README.md'), '# Grandma\'s soup\n\nThe secret ingredient is cardamom, added at the very end.\n', 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-voice-call-reads-and-asks',
  port: 9598,
  workspace,
  spends: true,
  env: { LOCUST_VOICE_TEST_SERVER: probe },
  outPath: join(recordRoot('a-voice-call-reads-and-asks-2026-10-11'), packaged === undefined ? 'local' : 'packaged'),
  extraArgs: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${ask}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
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
    lines: [...(strip?.querySelectorAll('.lc-call__line') ?? [])].map((line) => line.innerText.replace(/\\s+/g, ' ').trim()),
    asks: [...(strip?.querySelectorAll('.lc-call__ask') ?? [])].map((ask) => ask.innerText.replace(/\\s+/g, ' ').trim()),
    message: strip?.querySelector('.lc-call__message')?.innerText ?? ''
  })
})()`
const strip = async () => JSON.parse(String(await drive.evaluate(STRIP)))

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { for (let i = 0; i < 40 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250)) })()`)
  await drive.evaluate(`document.querySelector('button[aria-label="Talk"]').click()`)
  let state = { status: '', lines: [], asks: [], message: '' }
  const heard = []
  for (let second = 0; second < 90; second += 1) {
    await sleep(1000)
    state = await strip()
    for (const line of state.lines) if (!heard.includes(line)) heard.push(line)
    if (heard.some((line) => /^ChatGPT/.test(line) && /cardamom/i.test(line)) || state.message) break
  }
  await drive.capture('the call, reading the folder', () => JSON.stringify(state))
  check('the voice read the README and said the ingredient', heard.some((line) => /^ChatGPT/.test(line) && /cardamom/i.test(line)), heard.join(' | '))
  check('no error on the way', state.message === '', state.message)

  // The connector that would act: its question in the strip, answered Deny.
  let asked
  for (let second = 0; second < 60 && asked === undefined; second += 1) {
    await sleep(1000)
    state = await strip()
    for (const line of state.lines) if (!heard.includes(line)) heard.push(line)
    asked = state.asks[0]
  }
  if (asked === undefined) {
    check('the note tool asked in the strip', false, heard.slice(-4).join(' | '))
  } else {
    await drive.capture('a connector asks in the strip', () => JSON.stringify(state))
    check('the question names the tool and what it would send, with Allow and Deny', /locust probe: send note/i.test(asked) && /hello/i.test(asked) && /Allow/.test(asked) && /Deny/.test(asked), asked)
    check('the strip says it waits for you', /Waiting for you to allow it/.test(state.status), state.status)
    await drive.evaluate(`[...document.querySelectorAll('.lc-call__ask button')].find((b) => b.innerText.trim() === 'Deny')?.click()`)
    await sleep(1500)
    const after = await strip()
    check('Deny takes the question away', after.asks.length === 0, JSON.stringify(after.asks))
    await sleep(8000)
    check('and the note was never sent', !existsSync(probeLog), existsSync(probeLog) ? readFileSync(probeLog, 'utf8') : 'no call')
  }
  await drive.evaluate(`[...document.querySelectorAll('[role=region][aria-label="Voice call"] button')].find((b) => b.innerText.trim() === 'End')?.click()`)
  await sleep(2500)
  const ended = await strip()
  await drive.capture('the call, ended', () => JSON.stringify(ended))
  say(`  lines: ${ended.lines.join(' | ').slice(0, 1200)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A voice call reads the README, then a connector asks and is denied.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
