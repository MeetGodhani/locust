// Create named accounts, stop before login, select them through teammate settings and inspect launch receipts.
// No model turn and no real sign-in. The entire drive, including every agent's ordinary home, is disposable.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('..', '.tmp', 'account-drive')
await mkdir(root, { recursive: true })
const isolated = await mkdtemp(join(root, 'profile-home-'))
const npmBin = join(process.env.APPDATA, 'npm')
process.env.USERPROFILE = isolated
process.env.LOCUST_SCRATCH = join(isolated, 'scratch')
const { startDrive, scratchRepository, say, teammateFace, sleep } = await import('./drive-lib.mjs')
const workspace = await scratchRepository('locust-accounts-work-')
for (const home of ['claude', 'codex', 'config', 'AppData/Roaming', 'AppData/Local', 'Documents', 'Desktop', 'Downloads', 'Pictures', 'Music', 'Videos']) await mkdir(join(isolated, home), { recursive: true })
const seed = { schemaVersion: 1, teammates: ['Wren', 'Finch'].map((name, i) => ({ teammateId: `tm_${name.toLowerCase()}`, name, hue: i ? 'clay' : 'lime', role: 'Code & Migrations', createdAt: '2026-10-19T00:00:00Z', route: { runtime: i ? 'codex' : 'claude', model: 'account-default', mode: 'ask' } })), missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
const drive = await startDrive({ name: 'agent-accounts', port: 9839, workspace, seed, sendsNothing: true,
  env: { USERPROFILE: isolated, HOME: isolated, APPDATA: join(isolated, 'AppData/Roaming'), LOCALAPPDATA: join(isolated, 'AppData/Local'), XDG_CONFIG_HOME: join(isolated, 'config'), CLAUDE_CONFIG_DIR: join(isolated, 'claude'), CODEX_HOME: join(isolated, 'codex'), CODEX_SQLITE_HOME: join(isolated, 'codex'), ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '', OPENAI_API_KEY: '', CODEX_API_KEY: '', CODEX_ACCESS_TOKEN: '', OPENAI_ACCESS_TOKEN: '', PATH: `${npmBin};${process.env.PATH}`, LOCUST_ACCOUNT_PREVIEW: '1', LOCUST_DRIVE_OUT: resolve('docs/user-session') } })
let failures = 0
const check = (what, ok, detail = '') => { if (!ok) failures++; say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? `: ${detail}` : ''}`) }
const json = async script => JSON.parse(String(await drive.evaluate(`(async () => JSON.stringify(await (${script})))()`)))
const press = async (label, scope = 'document') => {
  const result = await drive.evaluate(`(() => { const b = [...${scope}.querySelectorAll('button')].find(b => b.innerText.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
  if (!result) throw new Error(`No ${label} button`)
  await sleep(200)
}
try {
  await drive.ready()
  await drive.resize(1200, 720)
  await press('Settings')
  await press('AI agents')
  await drive.capture('AI agents page', () => drive.evaluate('document.body.innerText'))
  await drive.waitFor(`!!(document.querySelector('.lc-agentaccounts[data-runtime="claude"]') && document.querySelector('.lc-agentaccounts[data-runtime="codex"]'))`, { what: 'the two installed agents account controls', timeoutMs: 30_000 })
  for (const runtime of ['claude', 'codex']) {
    const scope = `document.querySelector('.lc-agentaccounts[data-runtime="${runtime}"]')`
    await press('Add another account', scope)
    await drive.evaluate(`(() => { const input = ${scope}.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Work ${runtime}'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await sleep(100)
    await press('Add account', scope)
    await drive.waitFor(`${scope}.innerText.includes('Ready to sign in.')`, { what: `${runtime} sign-in card` })
    await drive.capture(`${runtime}: named account before sign-in`, () => drive.evaluate(`${scope}.innerText`))
    const state = await json(`window.desktop.agentAccounts({ kind: 'list' })`)
    const account = state.accounts.find(a => a.runtime === runtime)
    check(`${runtime} added with its name, still signed out`, account?.name === `Work ${runtime}` && account.state === 'new')
    const preview = await json(`window.desktop.agentAccounts({ kind: 'preview', id: ${JSON.stringify(account.id)} })`)
    check(`${runtime} launch uses its own home`, preview.ok && preview.preview?.home === account.home && preview.preview?.variable === (runtime === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'), JSON.stringify(preview.preview))
  }
  // Back to the conversation, then the ordinary face context menu and Edit teammate.
  await press('Back') .catch(async () => { await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`) })
  for (const [name, runtime] of [['Wren', 'claude'], ['Finch', 'codex']]) {
    const opened = await drive.evaluate(`(async () => { const face = ${teammateFace(name)}; if (!face) return 'no face'; const box = face.getBoundingClientRect(); face.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.top + 4 })); await new Promise(r => setTimeout(r, 250)); const edit = [...document.querySelectorAll('.lc-context__item')].find(b => /^Edit/.test(b.textContent.trim())); edit?.click(); return !!edit })()`)
    if (!opened) throw new Error(`No Edit for ${name}`)
    await drive.waitFor(`!!document.querySelector('.lc-dialog[aria-label="Edit teammate"]')`, { what: `${name} editor` })
    await press('Change', `document.querySelector('.lc-teammatemodel')`)
    await drive.waitFor(`!!document.querySelector('.lc-teammatemodel__picker .lc-picker')`, { what: 'route picker' })
    const picked = await drive.evaluate(`(() => { const rows = [...document.querySelectorAll('.lc-teammatemodel__picker .lc-picker__row')]; const row = rows.find(r => r.innerText.includes('Work ${runtime}') && !r.disabled); row?.click(); return !!row })()`)
    check(`${name} can pick Work ${runtime}`, picked === true)
    await sleep(100)
    await press('Save changes', `document.querySelector('.lc-dialog[aria-label="Edit teammate"]')`)
    await drive.waitFor(`!document.querySelector('.lc-dialog[aria-label="Edit teammate"]')`, { what: 'saved teammate' })
    const roster = await json(`window.desktop.listTeammates()`)
    const list = await json(`window.desktop.agentAccounts({ kind: 'list' })`)
    const account = list.accounts.find(a => a.runtime === runtime)
    check(`${name}'s route retains the selected account`, roster.data.teammates.find(t => t.name === name)?.route?.account === account.id)
    await drive.evaluate(`${teammateFace(name)}.click()`)
    await sleep(250)
    const chip = await drive.evaluate(`document.querySelector('.lc-control[aria-haspopup="listbox"]')?.innerText ?? ''`)
    check(`${name}'s composer chip names its account`, String(chip).includes(`Work ${runtime}`), String(chip))
    await drive.capture(`${name}: account on the route chip`, () => chip)
  }
  const accounts = await json(`window.desktop.agentAccounts({ kind: 'list' })`)
  check('the drive stopped before either sign-in', accounts.accounts.length === 2 && accounts.accounts.every(a => a.state === 'new'))
  const history = await json(`window.desktop.getMissionHistory()`)
  check('no model turn was recorded', history.ok && history.data.missions.length === 0)
} finally {
  await drive.finish({ intro: 'Named Claude Code and Codex accounts, stopped before their own sign-in. Launch receipts use the same account launcher as mission discovery. No model turns.' })
  // The throwaway home holds whatever the installed CLIs unpacked into it (over a gigabyte for Copilot).
  if (process.env.LOCUST_DRIVE_KEEP !== '1') await rm(isolated, { recursive: true, force: true, maxRetries: 5 })
}
say(failures ? `${failures} ACCOUNT DRIVE FAILURES` : 'ACCOUNT DRIVE PASSED')
process.exitCode = failures ? 1 : 0
