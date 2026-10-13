// CLAUDE CODE AND CODEX ON YOUR CLOUD COMPUTER, SIGNED IN WITH ONE CLICK (0.768), the way a person meets it: Cloud
// computer picked in the chat-type menu for a Claude Code teammate, the dialog that says what will happen, Sign in
// with Claude -- the computer woken, Claude Code readied there, its own sign-in page caught and its way back carried
// to this computer -- then Stop; and Codex's from Settings > Cloud computers, then Stop.
//
//   node _tools/drive-a-cloud-agent-signs-in.mjs [--packaged <exe>]
//
// Signs nothing in. A drive is not the person: LOCUST_SIGN_IN_PAGES, the labelled stand-in for the person's browser,
// writes each sign-in page down instead of opening it, and nobody clicks Authorize. What it proves is the way through:
// the page is the maker's own, and a request from this computer to the port it comes back to reaches the agent's own
// server on the cloud computer (it answers "/" with 404; /callback is never asked). Spends nothing: no turn is sent,
// and GitHub's free codespace hours run for a few minutes on the throwaway repository locust-cloud-test.

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const REPO = 'automatedworkflowllc-design/locust-cloud-test'
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const gh = (args) => new Promise((resolve) => {
  execFile('gh', args, { windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }))
})
/** What answers on a port here: a status code, or none. */
const answers = (port) => new Promise((resolve) => {
  const asked = request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 4000 }, (response) => {
    response.resume()
    resolve(response.statusCode ?? 0)
  })
  asked.on('timeout', () => asked.destroy())
  asked.on('error', () => resolve(undefined))
  asked.end()
})
const portOf = (page) => {
  try {
    return Number(new URL(new URL(page).searchParams.get('redirect_uri') ?? '').port)
  } catch {
    return undefined
  }
}

const root = await mkdtemp(join(tmpdir(), 'locust-drive-cloud-agent-'))
const workspace = join(root, 'locust-cloud-test')
const cloned = await gh(['repo', 'clone', REPO, workspace])
if (cloned.code !== 0) throw new Error(`clone failed: ${cloned.stderr}`)
const pages = join(root, 'sign-in-pages.txt')
await writeFile(pages, '', 'utf8')
const pagesSeen = async () => (await readFile(pages, 'utf8')).split(/\r?\n/).filter((line) => line.length > 0)
/** A page as the record keeps it: its one-time values left out. */
const shownPage = (page) => String(page).replace(/(code_challenge|state)=[^&]*/g, '$1=…')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-cloud-agent-signs-in',
  port: 9644,
  workspace,
  sendsNothing: true,
  env: { LOCUST_SIGN_IN_PAGES: pages },
  outPath: join(recordRoot('a-cloud-agent-signs-in-2026-10-13'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'blue', role: 'Code & Migrations', createdAt: '2026-10-13T15:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const text = (selector) => drive.evaluate(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '').replace(/\\s+/g, ' ').trim()`)
const click = (selector, words) => drive.evaluate(`(() => {
  const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((one) => one.innerText.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(words)}))
  if (!found) return 'no ' + ${JSON.stringify(words)}
  found.click()
  return 'clicked'
})()`)
const until = async (expression, seconds) => {
  for (let index = 0; index < seconds; index += 1) {
    if (await drive.evaluate(`Boolean(${expression})`)) return true
    await sleep(1000)
  }
  return false
}
const untilPage = async (count, seconds) => {
  for (let index = 0; index < seconds; index += 1) {
    const seen = await pagesSeen()
    if (seen.length >= count) return seen[count - 1]
    await sleep(1000)
  }
  return undefined
}

try {
  await drive.ready()
  await drive.resize(1215, 860)
  say(`open Wren: ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  await sleep(800)

  // The chat-type menu, for a Claude Code teammate: Claude's own cloud, and the person's own cloud computer.
  say(`  chip: ${String(await drive.evaluate(`(() => { const chip = document.querySelector('.lc-control--chatmode'); if (!chip) return 'no chip'; chip.click(); return 'opened' })()`))}`)
  await sleep(500)
  const menu = String(await drive.capture('the chat-type menu for a Claude Code teammate', () => text('.lc-menu[aria-label="Direct or compare"]')))
  check("Cloud computer is offered beside Claude's cloud", /Cloud Runs in Claude’s cloud/.test(menu) && /Cloud computer Claude Code runs it on your cloud computer, a GitHub Codespace/.test(menu), menu)
  say(`  pick Cloud computer: ${String(await click('.lc-menu__item', 'Cloud computer'))}`)

  // Not signed in there yet: the dialog says what will happen, before anything does.
  const asked = await until(`document.querySelector('.lc-cloudsetup')`, 60)
  const ask = String(await drive.capture('Claude Code not signed in there: what will happen', () => text('.lc-cloudsetup')))
  check('the dialog offers the sign-in, and says there is no code to copy', asked && /Claude Code is not signed in on your cloud computer yet/.test(ask) && /There is no code to copy/.test(ask) && /Sign in with Claude/.test(ask), ask)
  say(`  sign in: ${String(await click('.lc-cloudsetup button', 'Sign in with Claude'))}`)
  await sleep(3000)
  await drive.capture('signing in: the computer readied first', () => text('.lc-cloudsetup'))

  // Its own page, caught there and handed here; the person's browser would open it now.
  const claudePage = await untilPage(1, 300)
  check("the page is Claude's own sign-in, coming back to a port on localhost", claudePage !== undefined && /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/.test(claudePage) && /redirect_uri=http%3A%2F%2Flocalhost%3A\d+%2Fcallback/.test(claudePage), shownPage(claudePage ?? 'no page'))
  await until(`/Click Authorize on Claude/.test(document.querySelector('.lc-cloudsetup')?.innerText ?? '')`, 30)
  const waiting = String(await drive.capture("waiting on the person, on Claude's page", () => text('.lc-cloudsetup')))
  check("the dialog says the rest is the person's, on Claude's page", /Click Authorize on Claude's page/.test(waiting) && /waiting for you/.test(waiting) && /Stop/.test(waiting), waiting)
  const claudePort = claudePage === undefined ? undefined : portOf(claudePage)
  const through = claudePort === undefined ? undefined : await answers(claudePort)
  check("from this computer, that port reaches Claude Code's own server on the cloud computer", through === 404, `port ${String(claudePort)} answered ${String(through)}`)

  // Stop: the sign-in ends there, and the way back closes.
  say(`  stop: ${String(await click('.lc-cloudsetup button', 'Stop'))}`)
  await until(`/was stopped/.test(document.querySelector('.lc-cloudsetup')?.innerText ?? '')`, 30)
  const stopped = String(await drive.capture('stopped', () => text('.lc-cloudsetup')))
  check('Stop ends it, says so, and offers it again', /Signing Claude Code in was stopped\./.test(stopped) && /Try again/.test(stopped), stopped)
  await sleep(1500)
  const closed = claudePort === undefined ? 'no port' : await answers(claudePort)
  check('the way back is closed once it is stopped', closed === undefined, `answered ${String(closed)}`)
  say(`  close: ${String(await click('.lc-cloudsetup button', 'Close'))}`)
  await sleep(600)
  const chip = String(await text('.lc-control--chatmode'))
  check('not signed in, the chat goes back to Direct, so a send cannot go nowhere', !/Cloud computer/.test(chip), chip)

  // Settings > Cloud computers: each agent there, and Codex's sign-in from here.
  say(`  settings: ${String(await drive.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((one) => one.innerText.trim() === 'Settings'); if (!button) return 'no settings'; button.click(); return 'opened' })()`))}`)
  await sleep(800)
  say(`  page: ${String(await click('.lc-settings__navitem', 'Cloud computers'))}`)
  const listed = await until(`document.querySelector('.lc-cloudcomputer__agents')`, 60)
  const settings = String(await drive.capture('Settings > Cloud computers: the agents on it', () => text('.lc-cloudcomputer')))
  check('each agent there is said, with Sign in for those that sign in', listed && /Claude Code Not signed in Sign in with Claude/.test(settings) && /Codex Not signed in Sign in with ChatGPT/.test(settings) && /OpenCode Free models, nothing to sign in/.test(settings), settings)
  say(`  codex: ${String(await click('.lc-cloudcomputer__agent button', 'Sign in with ChatGPT'))}`)
  const codexPage = await untilPage(2, 180)
  check("Codex's page is OpenAI's own, coming back to 127.0.0.1:1455", codexPage !== undefined && /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/.test(codexPage) && /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A1455%2Fauth%2Fcallback/.test(codexPage), shownPage(codexPage ?? 'no page'))
  await until(`/Click Authorize on OpenAI/.test(document.querySelector('.lc-cloudcomputer__agents')?.innerText ?? '')`, 30)
  const row = String(await drive.capture("Codex's row, waiting on the person", () => text('.lc-cloudcomputer__agents')))
  check("its row says the rest is the person's, with Stop", /Click Authorize on OpenAI's page in your browser/.test(row) && /Stop/.test(row), row)
  const codexThrough = await answers(1455)
  check("from this computer, 1455 reaches Codex's own server on the cloud computer", codexThrough !== undefined, `answered ${String(codexThrough)}`)
  say(`  stop: ${String(await click('.lc-cloudcomputer__agent button', 'Stop'))}`)
  await until(`/Codex Not signed in Sign in with ChatGPT/.test((document.querySelector('.lc-cloudcomputer__agents')?.innerText ?? '').replace(/\\s+/g, ' '))`, 30)
  const after = String(await drive.capture('stopped from Settings', () => text('.lc-cloudcomputers')))
  check('stopped, its row is as it was, with why said', /Codex Not signed in Sign in with ChatGPT/.test(after) && /Signing Codex in was stopped/.test(after), after)
  check('nothing was opened in a browser: each page went to the stand-in only', (await pagesSeen()).length === 2)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on Claude Code / Haiku, Cloud computer picked, in a clone of ${REPO}. Sign-in pages go to LOCUST_SIGN_IN_PAGES, never a browser; nobody authorizes.`, extra: `Checks failed: ${String(failures)}` })
  process.exit(failures === 0 ? 0 : 1)
}
