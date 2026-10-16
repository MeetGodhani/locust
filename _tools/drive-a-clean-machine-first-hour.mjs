// A brand-new person's first hour, on the PACKAGED build, on a machine made to look clean.
//
//   node _tools/drive-a-clean-machine-first-hour.mjs
//
// Run after `ship` has packaged release/win-unpacked. Spends nothing: free route only (drive-lib's LOCUST_FREE_ONLY),
// no account exists on the machine it makes, and no tool approval is ever pressed. It downloads OpenCode with
// Locust's own Install button, as a new person does.
//
// THE MACHINE (2026-10-16). Every other drive runs on a machine with every agent installed and signed in. This one
// makes a machine that has none of it, and launches the packaged app the way the Start menu does:
//   - USERPROFILE, APPDATA, LOCALAPPDATA and TEMP point into a throwaway home. Every home lookup in main is
//     `homedir()`, which reads USERPROFILE, so no CLI config or sign-in of the person's can be read or written.
//   - The environment is a stock Windows one: the system's variables only, a stock PATH -- no node, npm or git.
//   - The profile has never existed (no teammates.json), and the app starts in its install folder, so its workspace
//     is the default one (moved into the throwaway Documents by LOCUST_DEFAULT_WORKSPACE).
//   - The throwaway machine lives OUTSIDE the person's home. Under it, OpenCode -- which looks for skills in every
//     folder above a project -- found the person's real `.claude\skills` on the first such run.
//
// WHAT IT CHECKS, all found on 0.779 by the first run of this drive and changed in 0.780: the Install button above
// the fold at three sizes; Settings' own Install and no claude.ai switch without Claude Code; OpenCode's first-start
// setup starting on its own (opencode-first-start.ts), and the start line while it runs; Undo, pressed, on a machine
// with no git (checkpoints-plain.ts); and that nothing of the person's real folders changed.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { APP_DIR, say, sleep, startDrive, sendAndWaitScript } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const INSTALL_DIR = dirname(EXE)
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE}; run ship first`)
  process.exit(1)
}
const REAL = homedir()
const scratch = resolve(process.env.LOCUST_CLEAN_ROOT ?? join(APP_DIR, '..', '..', '..', 'scratch'))
const within = relative(REAL, scratch)
if (within === '' || (!within.startsWith('..') && !/^[A-Za-z]:/.test(within))) {
  say(`the throwaway machine would be inside your home (${scratch}); OpenCode would find your own skills from there.`)
  say('set LOCUST_CLEAN_ROOT to a folder outside it.')
  process.exit(1)
}

// What must not change: stat only, nothing is read.
const watched = [join(REAL, 'Documents', 'Locust'), join(REAL, '.config', 'opencode'), join(REAL, '.local', 'share', 'opencode'), join(REAL, '.codex')]
const stamp = (path) => { try { return statSync(path).mtimeMs } catch { return 'absent' } }
const before = Object.fromEntries(watched.map((path) => [path, stamp(path)]))

const root = join(scratch, `clean-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)
const home = join(root, 'home')
const profile = join(root, 'profile')
const local = join(home, 'AppData', 'Local')
for (const dir of [profile, join(home, 'AppData', 'Roaming'), join(local, 'Temp'), join(local, 'Microsoft', 'WindowsApps'), join(home, 'Documents'), join(home, 'Desktop'), join(home, 'Downloads')]) {
  await mkdir(dir, { recursive: true })
}
const madeWorkspace = join(home, 'Documents', 'Locust')
const setUpMarker = join(home, '.config', 'opencode', 'node_modules', '@opencode-ai', 'plugin')

// A fresh Windows environment: the system's own variables, nothing a developer machine added.
const KEEP = new Set(['systemroot', 'systemdrive', 'windir', 'comspec', 'pathext', 'os', 'processor_architecture', 'processor_identifier',
  'processor_level', 'processor_revision', 'number_of_processors', 'computername', 'username', 'userdomain', 'userdomain_roamingprofile',
  'logonserver', 'programfiles', 'programfiles(x86)', 'programw6432', 'commonprogramfiles', 'commonprogramfiles(x86)', 'commonprogramw6432',
  'programdata', 'allusersprofile', 'public', 'driverdata', 'psmodulepath', 'sessionname'])
const env = {}
for (const key of Object.keys(process.env)) if (!KEEP.has(key.toLowerCase())) env[key] = undefined
const stockPath = ['C:\\Windows\\system32', 'C:\\Windows', 'C:\\Windows\\System32\\Wbem', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\',
  'C:\\Windows\\System32\\OpenSSH\\', join(local, 'Microsoft', 'WindowsApps')].join(';')
Object.assign(env, {
  PATH: stockPath, Path: stockPath, USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2),
  APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: local, TEMP: join(local, 'Temp'), TMP: join(local, 'Temp'),
  LOCUST_DEFAULT_WORKSPACE: madeWorkspace
})
say(`throwaway machine: ${root}`)

const drive = await startDrive({ name: 'clean-machine-first-hour', port: 9534, workspace: INSTALL_DIR, packaged: EXE, env, keep: true, profilePath: profile })

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const controls = `[...document.querySelectorAll('form.command-dock .lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' · ')`
const settingsAgents = `(async () => {
  ;[...document.querySelectorAll('button')].find(x => (x.getAttribute('title') ?? '').startsWith('Settings'))?.click()
  await new Promise(r => setTimeout(r, 1200))
  ;[...document.querySelectorAll('.lc-settings__navitem')].find((b) => b.innerText.trim() === 'AI agents')?.click()
  await new Promise(r => setTimeout(r, 1000))
  return 'on AI agents'
})()`
const goHome = `(async () => { [...document.querySelectorAll('button')].find(x => x.getAttribute('title') === 'Home')?.click(); await new Promise(r => setTimeout(r, 1200)); return 'home' })()`
const openCodeRow = `[...document.querySelectorAll('.lc-runtimerow')].find(r => /^OpenCode/.test(r.querySelector('.lc-runtimerow__name')?.innerText.trim() ?? ''))`
let installedAt
let setUpAt

try {
  await drive.capture('first screen as it opens', async () => {
    const settled = await drive.ready()
    const seen = JSON.parse(await drive.evaluate(`JSON.stringify((() => {
      const panel = document.querySelector('.lc-runtimepanel')
      const team = document.querySelector('.lc-teamtemplates')
      const install = document.querySelector('.lc-runtimecell__install.is-primary')?.getBoundingClientRect()
      const dock = document.querySelector('form.command-dock')?.getBoundingClientRect()
      return {
        first: panel !== null && team !== null && Boolean(panel.compareDocumentPosition(team) & Node.DOCUMENT_POSITION_FOLLOWING),
        visible: Boolean(install && dock && install.bottom <= dock.top),
        placeholder: document.querySelector('form.command-dock textarea')?.placeholder ?? ''
      }
    })())`))
    check('with nothing installed, the Install row comes before the team templates', seen.first)
    check('and its button is above the chat box in the app\'s own window', seen.visible)
    check('the chat box says AI agent', /AI agent/.test(seen.placeholder) && !/coding agent/.test(seen.placeholder), seen.placeholder)
    return `${String(settled)} || ${JSON.stringify(seen)}`
  })

  for (const [w, h] of [[1024, 680], [1366, 768]]) {
    await drive.capture(`first screen at ${String(w)}x${String(h)}`, async () => {
      await drive.resize(w, h)
      await sleep(900)
      const visible = await drive.evaluate(`(() => { const r = document.querySelector('.lc-runtimecell__install.is-primary')?.getBoundingClientRect(); const d = document.querySelector('form.command-dock')?.getBoundingClientRect(); return Boolean(r && d && r.bottom <= d.top) })()`)
      check(`the Install button is in view at ${String(w)}x${String(h)}`, visible === true)
      return `visible: ${String(visible)}`
    })
  }
  await drive.send('Emulation.clearDeviceMetricsOverride')

  await drive.capture('Settings, AI agents, nothing installed', async () => {
    await drive.evaluate(settingsAgents)
    const seen = JSON.parse(await drive.evaluate(`JSON.stringify({
      claudeSwitch: Boolean(document.querySelector('[aria-label="Let me start sessions on this computer from claude.ai"]')),
      install: Boolean(${openCodeRow} && [...${openCodeRow}.querySelectorAll('button')].some(b => b.innerText.trim() === 'Install'))
    })`))
    check('no claude.ai switch on a machine without Claude Code', !seen.claudeSwitch)
    check('Settings has its own Install for OpenCode', seen.install)
    return JSON.stringify(seen)
  })

  await drive.capture('Install OpenCode from Settings', async () => {
    await drive.evaluate(`(() => { const b = [...(${openCodeRow}?.querySelectorAll('button') ?? [])].find(x => x.innerText.trim() === 'Install'); b?.click(); return Boolean(b) })()`)
    const started = Date.now()
    for (;;) {
      await sleep(2000)
      const footer = String(await drive.evaluate(`document.querySelector('.lc-connected')?.innerText ?? ''`))
      if (/[1-9] agents? ready/.test(footer)) {
        installedAt = Date.now()
        check('OpenCode installs from Settings with no Node on the machine', true, `${String(Math.round((installedAt - started) / 1000))}s`)
        return footer
      }
      if (Date.now() - started > 6 * 60_000) {
        check('OpenCode installs from Settings with no Node on the machine', false, 'not connected after 6 minutes')
        return footer
      }
    }
  })

  await drive.capture('Home, after the install', async () => {
    await drive.evaluate(goHome)
    // Locust's first-start setup is `opencode debug config`: seen as that process, or as its finished install.
    const settingUp = () => {
      const found = spawnSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*debug config*' -and $_.CommandLine -like '*opencode*' } | Measure-Object).Count"], { encoding: 'utf8' })
      return Number(String(found.stdout).trim()) > 0 || existsSync(setUpMarker)
    }
    const started = Date.now()
    let begun = settingUp()
    while (!begun && Date.now() - started < 30_000) { await sleep(1000); begun = settingUp() }
    check('OpenCode starts setting itself up on its own, before any message', begun)
    return `chip: ${String(await drive.evaluate(controls))}`
  })

  // An eager person: the first message at once, while the setup may still run -- the two must not collide.
  await drive.capture('first message, at once', async () => {
    const chip = String(await drive.evaluate(controls))
    if (!/free/i.test(chip)) {
      check('the chat box is on a free model', false, chip)
      return 'not sent'
    }
    const readyAtSend = existsSync(setUpMarker)
    await drive.evaluate(sendAndWaitScript('Hi! I just installed this. What can you help me with?', { settle: false }))
    const lines = new Set()
    let words = 0
    for (let i = 0; i < 240; i += 1) {
      await sleep(1500)
      const now = JSON.parse(await drive.evaluate(`JSON.stringify({ live: (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-200), running: Boolean(document.querySelector('button[aria-label^="Stop the running"]')), words: [...document.querySelectorAll('.lc-agentline__body')].map(e => e.innerText.trim()).join(' ').length })`))
      const line = /(Setting up OpenCode[^…]*|Starting OpenCode)/.exec(now.live)?.[0]
      if (line !== undefined) lines.add(line)
      if (setUpAt === undefined && existsSync(setUpMarker)) setUpAt = Date.now()
      words = now.words
      if (i > 4 && !now.running) break
    }
    check('the first message is answered', words > 0)
    check('a start that still has to set OpenCode up says so', readyAtSend || ([...lines].some((line) => line.startsWith('Setting up OpenCode for its first start')) && !lines.has('Starting OpenCode')), [...lines].join(' | '))
    return `start lines: ${[...lines].join(' | ') || 'none'}`
  })

  await drive.capture('second message: make a file', async () => {
    await drive.evaluate(sendAndWaitScript('Make a file called laptop-setup.md with a short checklist for setting up a new laptop.', { settle: false }))
    for (let i = 0; i < 200; i += 1) {
      await sleep(1500)
      if (i > 3 && !(await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`))) break
    }
    await sleep(2500)
    const made = existsSync(join(madeWorkspace, 'laptop-setup.md'))
    check('the free model made the file', made)
    return `file on disk: ${String(made)}`
  })

  await drive.capture('Undo, with no git on the machine', async () => {
    const said = await drive.evaluate(`(async () => {
      const b = [...document.querySelectorAll('button')].filter(x => /^Undo these changes/.test(x.innerText.trim())).pop()
      if (!b) return 'no Undo these changes'
      b.scrollIntoView({ block: 'center' }); b.click(); await new Promise(r => setTimeout(r, 1500))
      const confirm = [...document.querySelectorAll('.lc-thread button')].find(x => x.innerText.trim() === 'Undo')
      if (!confirm) return 'no confirmation'
      confirm.click(); await new Promise(r => setTimeout(r, 3000))
      return [...document.querySelectorAll('.lc-thread *')].filter(e => e.children.length === 0 && /^Undone/.test(e.textContent ?? '')).map(e => e.textContent.trim()).pop() ?? 'pressed; nothing said'
    })()`)
    const gone = !existsSync(join(madeWorkspace, 'laptop-setup.md'))
    check('Undo takes the turn back on a machine with no git', gone && /^Undone/.test(String(said)), String(said))
    return String(said)
  })
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Packaged ${EXE}, a profile that never existed, launched from its install folder, on a throwaway machine at ${root} (outside the home): a stock Windows environment and PATH, no Node, no Git.` })
  if (setUpAt === undefined && existsSync(setUpMarker)) setUpAt = statSync(setUpMarker).mtimeMs
  say(`OpenCode set itself up: ${setUpAt === undefined || installedAt === undefined ? 'not seen' : `${String(Math.round((setUpAt - installedAt) / 1000))} s after the install`}`)
  for (const path of watched) {
    const same = before[path] === stamp(path)
    if (!same) failures += 1
    say(`  [${same ? 'PASS' : 'FAIL'}] unchanged: ${path}`)
  }
  const log = join(home, '.local', 'share', 'opencode', 'log')
  const logs = existsSync(log) ? readdirSync(log).map((file) => join(log, file)) : []
  // OpenCode's log writes paths with doubled backslashes; either spelling of the real home is a leak.
  const reachedHome = logs.some((file) => {
    const text = readFileSync(file, 'utf8')
    return text.includes(REAL) || text.includes(REAL.replace(/\\/g, '\\\\'))
  })
  if (reachedHome) failures += 1
  say(`  [${reachedHome ? 'FAIL' : 'PASS'}] OpenCode never named a path in the real home`)
  console.error(failures === 0 ? 'CLEAN MACHINE FIRST HOUR PASSED' : `${String(failures)} check(s) failed`)
  process.exitCode = failures === 0 ? 0 : 1
}
