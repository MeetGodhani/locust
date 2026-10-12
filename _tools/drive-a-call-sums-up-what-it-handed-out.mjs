// A call sums up what it handed out, and Talk starts from any app (0.755).
//
//   LOCUST_SPEND=1 node _tools/drive-a-call-sums-up-what-it-handed-out.mjs [--packaged <exe>]
//
// Windows only, Codex CLI signed in with ChatGPT. The drive's window takes Ctrl+Alt+Shift+F11 for Talk
// (LOCUST_TALK_SHORTCUT), never the person's own keys. The window is minimized and the keys are pressed through
// Windows: Locust must come back up and start a call on Home, with ChatGPT's voice and no click in the window first.
// Windows' own voice asks, after seven seconds, "Please have Wren list the files in this folder", then says go ahead.
// The strip must list Wren's to-do as it starts, with how it is going and no Open while the call is on; the voice
// must be heard speaking -- its sound runs, because the window was told the keys were the person's own press; the
// keys again must end the call; the summary must say "1 to-do" and offer Open, and Open must show Wren's
// conversation. It spends a little ChatGPT voice time and a Codex turn behind the voice, so it asks for
// LOCUST_SPEND=1. Wren is on the free model, and listing files changes nothing.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, conversationRows, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
if (process.platform !== 'win32') {
  say('Voice calls are on Windows only for now.')
  process.exit(0)
}

const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim()
const voiceDir = mkdtempSync(join(tmpdir(), 'locust-drive-call-summary-'))
const ask = join(voiceDir, 'ask.wav')
const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="7000ms"/>Please have Wren list the files in this folder.<break time="3000ms"/>Yes, that is right. Go ahead and send it.<break time="10000ms"/><break time="10000ms"/><break time="10000ms"/><break time="10000ms"/><break time="10000ms"/><break time="10000ms"/></speak>'
ps([
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  `$s.SetOutputToWaveFile('${ask}', $f)`,
  `$s.SpeakSsml('${ssml}')`,
  '$s.Dispose()'
].join('; '))
if (!existsSync(ask)) throw new Error('Windows did not record the request.')

// The window, as Windows sees it: minimized, and whether it is the one in front.
const USER32 = `Add-Type -Namespace LocustDrive -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'`
const windowOf = (pid) => `(Get-Process -Id ${String(pid)}).MainWindowHandle`
const minimize = (pid) => ps(`${USER32}; [LocustDrive.Win]::ShowWindowAsync(${windowOf(pid)}, 6) | Out-Null`)
const windowState = (pid) => JSON.parse(ps(`${USER32}; $h = ${windowOf(pid)}; @{ handle = [int64]$h; iconic = [LocustDrive.Win]::IsIconic($h); front = ([LocustDrive.Win]::GetForegroundWindow() -eq $h) } | ConvertTo-Json -Compress`))
// Through Windows, as a person's keyboard would: the keys reach Locust whichever app is in front.
const KEYS = 'Ctrl+Alt+Shift+F11'
const pressKeys = () => ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^%+{F11}')`)

const codexCount = () => Number(ps('(Get-Process -Name codex -ErrorAction SilentlyContinue | Measure-Object).Count') || '0')
const codexBefore = codexCount()

const workspace = await scratchRepository('locust-drive-call-summary-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-call-sums-up-what-it-handed-out',
  port: 9631,
  workspace,
  spends: true,
  env: { LOCUST_TALK_SHORTCUT: KEYS },
  outPath: join(recordRoot('a-call-sums-up-what-it-handed-out-2026-10-12'), packaged === undefined ? 'local' : 'packaged'),
  // No --autoplay-policy here: the call's sound must run on the press of the keys alone.
  extraArgs: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${ask}`, '--mute-audio'],
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-12T04:00:00.000Z', route: FREE_ROUTE }],
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
    label: strip?.querySelector('.lc-calltodos__label')?.innerText ?? '',
    todos: [...(strip?.querySelectorAll('.lc-calltodo') ?? [])].map((row) => ({
      who: row.querySelector('.lc-calltodo__who')?.innerText ?? '',
      task: row.querySelector('.lc-calltodo__task')?.innerText ?? '',
      status: row.querySelector('.lc-status')?.innerText ?? '',
      open: row.querySelector('.lc-calltodo__open') !== null
    })),
    message: strip?.querySelector('.lc-call__message')?.innerText ?? ''
  })
})()`
const strip = async () => JSON.parse(String(await drive.evaluate(STRIP)))
const wrensRows = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify(${conversationRows()}.filter((row) => row.owner === 'tm_wren').map((row) => row.title))`)))

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { for (let i = 0; i < 60 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250)) })()`)
  const before = JSON.parse(String(await drive.evaluate(`(async () => {
    const context = new AudioContext()
    const sound = context.state
    await context.close()
    return JSON.stringify({ talk: document.querySelector('button[aria-label="Talk"]') !== null, active: navigator.userActivation.hasBeenActive, sound })
  })()`)))
  say(`before the keys: ${JSON.stringify(before)}`)
  check('Home has a Talk button, and nobody has pressed anything in the window', before.talk && !before.active, JSON.stringify(before))
  const rowsBefore = await wrensRows()

  minimize(drive.pid)
  await sleep(1500)
  const down = windowState(drive.pid)
  check('the window is minimized, another app in front', down.iconic && !down.front, JSON.stringify(down))

  pressKeys()
  let state = await strip()
  let up = windowState(drive.pid)
  for (let i = 0; i < 40 && !(state.status.length > 0 && !up.iconic); i += 1) {
    await sleep(250)
    state = await strip()
    up = windowState(drive.pid)
  }
  check(`${KEYS} brings Locust up, in front`, !up.iconic && up.front, JSON.stringify(up))
  check('and starts Talk on Home', /Calling|Listening|speaking/i.test(state.status), state.status)
  const active = Boolean(await drive.evaluate('navigator.userActivation.hasBeenActive'))
  check('the press counts as the person’s own, so the call’s sound may run', active)

  // The voice hears the ask, hands it to Wren, and says so.
  let heardSpeaking = false
  let handed = state
  for (let second = 0; second < 120; second += 1) {
    await sleep(1000)
    handed = await strip()
    if (/is speaking/.test(handed.status)) heardSpeaking = true
    if ((handed.todos.length > 0 && heardSpeaking) || handed.message) break
  }
  await drive.capture('the call, handing it over', () => JSON.stringify(handed))
  check('no error on the way', handed.message === '', handed.message)
  const todo = handed.todos[0]
  check('the strip lists Wren’s to-do as it starts', handed.label === 'HANDED OUT ON THIS CALL' || /handed out on this call/i.test(handed.label), JSON.stringify(handed))
  check('with who has it, what was asked and how it is going', todo?.who === 'Wren' && /files/i.test(todo?.task ?? '') && /Starting|Working|Done|Needs you/.test(todo?.status ?? ''), JSON.stringify(todo))
  check('and no Open while the call is on', todo !== undefined && !todo.open, JSON.stringify(todo))
  check('the voice was heard speaking: its sound runs on the keys alone', heardSpeaking)

  // The keys again end it.
  pressKeys()
  let ended = await strip()
  for (let i = 0; i < 40 && !/ended/i.test(ended.status); i += 1) {
    await sleep(250)
    ended = await strip()
  }
  await sleep(1500)
  ended = await strip()
  await drive.capture('the call ended, summed up', () => JSON.stringify(ended))
  check(`${KEYS} again ends the call, and the bar counts its to-dos`, /Call ended/.test(ended.status) && /1 to-do\b/.test(ended.status), ended.status)
  check('the summary is first: what the call handed out', /what the call handed out/i.test(ended.label), ended.label)
  check('Wren’s to-do now offers Open', ended.todos.length === 1 && ended.todos[0].open, JSON.stringify(ended.todos))

  // A real conversation of Wren's, and Open shows it.
  let rows = rowsBefore
  for (let second = 0; second < 30 && rows.length <= rowsBefore.length; second += 1) {
    await sleep(1000)
    rows = await wrensRows()
  }
  check('a conversation of Wren’s started from the call', rows.length > rowsBefore.length, `${String(rowsBefore.length)} -> ${String(rows.length)}: ${rows.join(' | ')}`)
  const opened = String(await drive.capture('Open, from the summary', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-calltodo__open')?.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const markers = [...document.querySelectorAll('.lc-thread__marker')].map((m) => m.innerText.trim())
      if (markers.some((m) => /voice call/i.test(m))) return markers.join(' | ')
    }
    return [...document.querySelectorAll('.lc-thread__marker')].map((m) => m.innerText.trim()).join(' | ') || 'no marker'
  })()`)))
  check('Open shows Wren’s conversation, started from the call', /Started from a voice call/i.test(opened), opened)
  await sleep(3000)
  const codexAfter = codexCount()
  check('the end leaves no Codex the call started', codexAfter <= codexBefore, `${String(codexBefore)} before, ${String(codexAfter)} after`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. ${KEYS} starts a call from Home with the window minimized; the voice hands Wren a task; the keys end it.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
