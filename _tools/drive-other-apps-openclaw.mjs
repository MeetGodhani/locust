// OpenClaw reaches Locust's team (0.754), end to end, with OpenClaw's own CLI.
//
//   node _tools/drive-other-apps-openclaw.mjs [--packaged <exe>] [--openclaw <path to openclaw.cmd>]
//
// A throwaway profile with one teammate. The drive turns the real switch on in Settings > General, opens "by hand",
// and reads the OpenClaw line the card shows. It runs that line in PowerShell exactly as written -- only the word
// `openclaw` is pointed at a copy of OpenClaw's CLI (default D:\work\scratch\openclaw-try, installed with
// --ignore-scripts) -- with OpenClaw's home in a throwaway folder, so no OpenClaw settings of the person's are read or
// written. `openclaw mcp add` connects before it saves; then `openclaw mcp probe locust` must list Locust's tools, and
// `openclaw mcp doctor locust` find it ok with the tools that only read marked so. Spends nothing: no turn is sent. Skips, saying so, when no OpenClaw CLI is there.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FREE_ROUTE, say, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const openclaw = arg('--openclaw') ?? 'D:\\work\\scratch\\openclaw-try\\node_modules\\.bin\\openclaw.cmd'
if (process.platform !== 'win32' || !existsSync(openclaw)) {
  say(`No OpenClaw CLI at ${openclaw}: install one with npm install --prefix <folder> openclaw --ignore-scripts, then pass --openclaw.`)
  process.exit(0)
}

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = join(root, '.tmp', 'other-apps-openclaw')
await mkdir(scratch, { recursive: true })
const workspace = await mkdtemp(join(scratch, 'workspace-'))
const profile = await mkdtemp(join(scratch, 'profile-'))
const home = await mkdtemp(join(scratch, 'openclaw-home-'))

const drive = await startDrive({
  name: 'other-apps-openclaw', port: 9603, workspace, profilePath: profile,
  ...(packaged === undefined ? {} : { packaged }),
  outPath: join(scratch, new Date().toISOString().replace(/[:.]/g, '-')),
  focused: true,
  seed: { schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-12T00:00:00Z', route: FREE_ROUTE }],
    missionOwners: {}, settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail = '') => {
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? ` -- ${String(detail).slice(0, 600)}` : ''}`)
}
const wait = async (expression, seconds = 30) => {
  for (let i = 0; i < seconds * 4; i += 1) {
    if (await drive.evaluate(expression)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${expression}`)
}
/** PowerShell, with OpenClaw's home in the throwaway folder: its settings, state and logs land there. */
const powershell = (script) => new Promise((resolve) => {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, HOME: home, USERPROFILE: home, OPENCLAW_HOME: home, NO_COLOR: '1' }
  }, (error, stdout, stderr) => resolve({ code: error === null ? 0 : (typeof error.code === 'number' ? error.code : 1), out: `${stdout}\n${stderr}` }))
})

try {
  await drive.ready()
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Settings/.test(b.innerText))?.click()`)
  await wait(`!!document.querySelector('[aria-label="Let your other AI apps use Locust"]:not(:disabled)')`)
  await drive.evaluate(`document.querySelector('[aria-label="Let your other AI apps use Locust"]').click()`)
  await wait(`document.querySelector('[aria-label="Let your other AI apps use Locust"]').getAttribute('aria-checked') === 'true' && document.querySelectorAll('.lc-mcp-setup').length === 3`)
  const line = String(await drive.capture('Settings > General: the OpenClaw line', () => drive.evaluate(`(() => {
    const fold = document.querySelector('.lc-mcp-byhand')
    if (fold) fold.open = true
    return [...document.querySelectorAll('.lc-mcp-setup')].map((p) => p.innerText).find((text) => text.startsWith('openclaw ')) ?? ''
  })()`)))
  check('the card shows an OpenClaw line, token-free, naming this Locust, its bridge and the connection file', /^openclaw mcp add locust --command ".+" --arg ".+locust-mcp-bridge\.mjs" --arg ".+locust-mcp-connection\.json" --env ELECTRON_RUN_AS_NODE=1$/.test(line) && !/[0-9a-f]{64}/.test(line), line)

  // The line as the card wrote it; only `openclaw` is this copy of the CLI.
  const added = await powershell(`& '${openclaw.replace(/'/g, "''")}'${line.slice('openclaw'.length)}`)
  check('OpenClaw takes the line: it connects to Locust, then saves it', added.code === 0, added.out.trim().split('\n').slice(-6).join(' | '))
  const probe = await powershell(`& '${openclaw.replace(/'/g, "''")}' mcp probe locust`)
  // OpenClaw 2026.10.1 counts them ("locust: 8 tools"): the eight Locust lists for other apps.
  check('OpenClaw\'s own probe finds Locust\'s eight tools', probe.code === 0 && /locust: 8 tools/.test(probe.out), `${String(probe.code)} :: ${probe.out.replace(/\s+/g, ' ').slice(0, 500)}`)
  // The tools that only read are marked so (0.754): OpenClaw's doctor no longer says calls need approval for want of it.
  const doctor = await powershell(`& '${openclaw.replace(/'/g, "''")}' mcp doctor locust`)
  check('OpenClaw\'s doctor finds the server ok, with its read-only tools marked', /locust: ok/.test(doctor.out) && !/tools have no safety annotations/.test(doctor.out), doctor.out.replace(/\s+/g, ' ').slice(0, 400))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.evaluate(`(() => { const s = document.querySelector('[aria-label="Let your other AI apps use Locust"]'); if (s && s.getAttribute('aria-checked') === 'true') s.click() })()`).catch(() => undefined)
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. OpenClaw's CLI (${openclaw}) adds Locust from the card's line and lists its tools.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
