// Locust in the Claude app, in one press (0.740): Settings > General, "The Claude app", Add, then Remove.
//
//   node _tools/drive-locust-in-the-claude-app.mjs [--packaged <exe>]
//
// Windows. Never the person's own Claude settings: APPDATA points this Locust at a scratch folder holding a
// stand-in `Claude\claude_desktop_config.json` with settings of its own, so the file Locust edits is that one.
// Never presses Restart Claude: the real Claude app may be open on this machine, and the line saying it needs a
// restart is the check, not the restart itself. Sends nothing.

import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
if (process.platform !== 'win32') {
  say('This drive stands in for the Claude app on Windows only.')
  process.exit(0)
}
const appData = mkdtempSync(join(tmpdir(), 'locust-drive-claude-app-'))
mkdirSync(join(appData, 'Claude'), { recursive: true })
const file = join(appData, 'Claude', 'claude_desktop_config.json')
const original = JSON.stringify({ preferences: { theme: 'dark' }, mcpServers: { notes: { command: 'notes.exe' } } }, null, 2)
writeFileSync(file, original, 'utf8')

const workspace = await scratchRepository('locust-drive-claude-app-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'locust-in-the-claude-app',
  port: 9600,
  workspace,
  sendsNothing: true,
  env: { APPDATA: appData },
  outPath: join(recordRoot('locust-in-the-claude-app-2026-10-11'), packaged === undefined ? 'local' : 'packaged'),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const LINE = `(() => {
  const heading = [...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'The Claude app')
  const line = heading?.closest('.lc-settingline')
  line?.scrollIntoView({ block: 'center' })
  return JSON.stringify({
    shown: line !== undefined && line !== null,
    lede: line?.querySelector('.lc-settings__lede')?.innerText ?? '',
    buttons: [...(line?.querySelectorAll('button') ?? [])].map((b) => b.innerText.trim()),
    server: document.querySelector('[role=switch][aria-label="Let your other AI apps use Locust"]')?.getAttribute('aria-checked') ?? ''
  })
})()`
const line = async () => JSON.parse(String(await drive.evaluate(LINE)))
const press = (label) => drive.evaluate(`(async () => {
  const heading = [...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'The Claude app')
  const button = [...(heading?.closest('.lc-settingline')?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  if (!button) return 'no ' + ${JSON.stringify(label)}
  button.click()
  for (let i = 0; i < 40; i += 1) { await new Promise((r) => setTimeout(r, 250)); if (!button.isConnected || !button.disabled) break }
  await new Promise((r) => setTimeout(r, 1200))
  return 'pressed'
})()`)

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1200)
  await drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise((r) => setTimeout(r, 900))
    ;[...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('General'))?.click()
    await new Promise((r) => setTimeout(r, 1200))
  })()`)
  const before = JSON.parse(String(await drive.capture('Settings > General: the Claude app, not added', () => drive.evaluate(LINE))))
  check('the Claude app has a line of its own, with one button to add Locust', before.shown && before.buttons.includes('Add to the Claude app') && /One press/.test(before.lede), JSON.stringify(before))
  check('the server for other apps starts off', before.server === 'false', before.server)

  say(`add: ${String(await press('Add to the Claude app'))}`)
  const after = JSON.parse(String(await drive.capture('added', () => drive.evaluate(LINE))))
  const written = JSON.parse(readFileSync(file, 'utf8'))
  check('one press added Locust to Claude’s settings, and kept the person’s own', written.mcpServers?.locust?.env?.ELECTRON_RUN_AS_NODE === '1' && /locust-mcp-bridge\.mjs$/.test(written.mcpServers.locust.args?.[0] ?? '') && written.mcpServers.notes?.command === 'notes.exe' && written.preferences?.theme === 'dark', JSON.stringify(written))
  check('it kept a copy of the file as it was', existsSync(file + '.before-locust') && readFileSync(file + '.before-locust', 'utf8') === original)
  check('and turned the server for other apps on', after.server === 'true', after.server)
  check('the line says it is added, and what is left to do', /^Added\./.test(after.lede) && after.buttons.includes('Remove'), JSON.stringify(after))
  check('the connection file the entry names exists now', existsSync(written.mcpServers.locust.args[1]), written.mcpServers.locust.args[1])

  say(`remove: ${String(await press('Remove'))}`)
  const removed = JSON.parse(String(await drive.capture('removed', () => drive.evaluate(LINE))))
  const back = JSON.parse(readFileSync(file, 'utf8'))
  check('Remove takes Locust out and leaves the rest', back.mcpServers?.locust === undefined && back.mcpServers?.notes?.command === 'notes.exe' && back.preferences?.theme === 'dark', JSON.stringify(back))
  check('and the line offers Add again', removed.buttons.includes('Add to the Claude app'), JSON.stringify(removed))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Settings > General > The Claude app, against a stand-in settings file.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
