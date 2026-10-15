// An agent of your own (0.777): any Agent Client Protocol agent, added by its command line.
//
//   node _tools/drive-your-own-acp-agent.mjs [--packaged <exe>] [--tag <name>]
//
// The agent added is OpenCode's own ACP server (`opencode acp`), as if it were one Locust had never heard of: it is
// the one ACP agent on this machine with free models, so nothing is spent. Settings > AI agents > Your own agents:
// type a name and the command, Test (it must answer with its name, version and models), Add. The model picker then
// lists it in a group of its own; Muse Spark free is picked; the composer must be on Approve each. A message is
// answered; a file it is asked to make raises a card in the window, Allow once, and the file is there. Reloaded,
// the conversation comes back from the record (LEDGER v25).

import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, pickRouteScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const AGENT = 'OpenCode over ACP'

const workspace = await scratchRepository('locust-drive-own-acp-ws-')
// What it asks about is the agent's own setting, and OpenCode edits without asking unless its permissions say ask --
// so the project says ask, the way a person would set it for their own agent (MEASURED: without this file the first
// run made the file with no card).
await writeFile(join(workspace, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: { edit: 'ask', bash: 'ask' } }, null, 2), 'utf8')
const ORI = { teammateId: 'tm_ori00000000000000000000', name: 'Ori', hue: 'teal', role: 'Custom', roleTitle: 'Developer', createdAt: '2026-10-15T01:00:00.000Z', route: FREE_ROUTE }
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `own-acp-${tag}`,
  port: 9778,
  workspace,
  outPath: join(recordRoot('your-own-acp-agent-2026-10-15'), tag),
  seed: { schemaVersion: 1, teammates: [ORI], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const typeInto = (selector, value) => `(() => {
  const field = document.querySelector(${JSON.stringify(selector)})
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(value)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
})()`
const SAID = `document.querySelector('[data-acp-agents] .lc-ownmodel__said')?.innerText ?? ''`
const waitSaid = async (pattern, seconds) => {
  let said = ''
  for (let i = 0; i < seconds; i += 1) {
    said = String(await drive.evaluate(SAID))
    if (pattern.test(said)) return said
    await sleep(1000)
  }
  return said
}
const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); return 'sent' }
  }
  return 'no send'
})()`)
const THREAD = `(document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ')`
const settled = async (seconds) => {
  for (let i = 0; i < seconds; i += 1) {
    await sleep(1000)
    const busy = await drive.evaluate(`document.querySelector('button[aria-label^="Stop the running"]') !== null`)
    const card = await drive.evaluate(`document.querySelector('[role="group"][aria-label="Approval required"]') !== null`)
    if (i > 5 && (!busy || card)) return card ? 'card' : 'ended'
  }
  return 'timed out'
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1440, 900)

  // Settings > AI agents > Your own agents.
  const opened = String(await drive.capture('Settings > AI agents: Your own agents', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((one) => one.innerText.trim() === 'Settings')?.click()
    await new Promise((r) => setTimeout(r, 900))
    ;[...document.querySelectorAll('.lc-settings__navitem')].find((one) => one.innerText.trim().startsWith('AI agents'))?.click()
    await new Promise((r) => setTimeout(r, 900))
    const section = document.querySelector('[data-setting="acp-agents"]')
    section?.scrollIntoView({ block: 'center' })
    return (section?.innerText ?? 'no section').replace(/\\s+/g, ' ')
  })()`)))
  check('Settings has Your own agents, with a name and a command to fill in', /^Your own agents/.test(opened) && /Add agent/.test(opened), opened.slice(0, 200))

  await drive.evaluate(typeInto('[data-acp-agents] input[placeholder="Goose"]', AGENT))
  await drive.evaluate(typeInto('[data-acp-agents] input[placeholder="goose acp"]', 'opencode acp'))
  await drive.evaluate(`[...document.querySelectorAll('[data-acp-agents] button')].find((b) => b.innerText.trim() === 'Test')?.click()`)
  const tested = await waitSaid(/answered|could not|stopped|not/i, 90)
  await drive.capture('Test: what the agent answered', () => tested)
  check('Test opens a session and says what answered: OpenCode, its version, and its models', /^OpenCode \d+\.\d+\.\d+ answered\. It offers \d+ models to pick from\.$/.test(tested), tested)

  await drive.evaluate(`[...document.querySelectorAll('[data-acp-agents] button')].find((b) => b.innerText.trim() === 'Add agent')?.click()`)
  const added = await waitSaid(/model list|could not|already/i, 90)
  const row = String(await drive.capture('Added: the agent listed', () => drive.evaluate(`(document.querySelector('[data-acp-agent]')?.innerText ?? '').replace(/\\s+/g, ' ')`)))
  check('Add keeps it: listed with its command, what answered and how many models', /is in every teammate's model list/.test(added) && new RegExp(`^${AGENT} opencode acp · OpenCode \\d`).test(row), `${added} || ${row}`)

  // The picker, from Ori's conversation.
  await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => /^(Back|Close settings)$/.test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 600))
  })()`)
  await drive.evaluate(openTeammateScript('Ori'))
  const picked = String(await drive.capture('the picker: the agent in a group of its own', () => drive.evaluate(pickRouteScript({ group: `/${AGENT} · your own agent/i`, search: 'muse spark 1.3 free', row: '/Muse Spark 1\\.3 Free/' }))))
  await sleep(800)
  const chip = String(await drive.evaluate(`(document.querySelector('form.command-dock')?.innerText ?? '').replace(/\\s+/g, ' ')`))
  check('picked from its own group, the chat box names the agent and the model, in Approve each', /OpenCode over ACP · OpenCode\/Muse Spark 1\.3 Free/.test(chip) && /Approve/.test(chip), `${picked} || ${chip.slice(0, 300)}`)

  // A message.
  await send('Write the word PELICAN in capitals and nothing else. Do not use any tool.')
  const first = await settled(240)
  const answered = String(await drive.capture('answered by the agent of your own', () => drive.evaluate(THREAD)))
  check('the agent answers', first === 'ended' && /PELICAN/.test(answered.slice(answered.indexOf('Do not use any tool.') + 20)), `${first} || ${answered.slice(-300)}`)

  // A card.
  await send('Create a file named acp-check.txt in this folder containing the word OK.')
  let state = await settled(240)
  const asked = String(await drive.capture('it asks first: a card in the window', () => drive.evaluate(`(document.querySelector('[role="group"][aria-label="Approval required"]')?.innerText ?? '').replace(/\\s+/g, ' ')`)))
  check('making a file, it asks first: a card in the window', state === 'card' && asked.length > 0, `${state} || ${asked.slice(0, 300)}`)
  for (let round = 0; round < 6 && state === 'card'; round += 1) {
    await drive.evaluate(`[...document.querySelectorAll('[role="group"][aria-label="Approval required"] button')].find((b) => /^Allow once|^Approve once|^Allow$/.test(b.innerText.trim()))?.click()`)
    state = await settled(240)
  }
  const made = await access(join(workspace, 'acp-check.txt')).then(() => true, () => false)
  const content = made ? (await readFile(join(workspace, 'acp-check.txt'), 'utf8')).trim() : '(no file)'
  await drive.capture('allowed once: the file', () => content)
  check('allowed once, the file is made', state === 'ended' && made && /OK/.test(content), `${state} || ${content}`)

  // From the record.
  await drive.evaluate('location.reload()').catch(() => undefined)
  await sleep(4000)
  await drive.ready().catch(() => undefined)
  const reopened = String(await drive.capture('reloaded: the conversation from the record', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-convrow button.lc-conv')].find((r) => /PELICAN/i.test(r.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return ${THREAD}
  })()`)))
  check('reloaded, both turns come back from the record', /Write the word PELICAN/.test(reopened) && /acp-check\.txt/.test(reopened), reopened.slice(0, 300))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. OpenCode's own ACP server added as an agent of your own ("opencode acp"), on its free Muse Spark model.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
