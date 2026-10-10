// A Codex command its Windows sandbox never started, as the row says it (0.736), to look at before it ships.
//
//   LOCUST_SPEND=1 node _tools/look-a-codex-sandbox-that-did-not-start.mjs [--packaged <exe>] [--out <dir>]
//
// Only shows anything while the sandbox is failing on this computer: with the Codex desktop app open, every
// sandboxed Codex command fails with "helper_unknown_error: setup refresh had errors" (read ~/.codex/.sandbox/).
// One Codex turn on GPT-6-Luna, low effort, in Accept edits (sandboxed; Auto skips the sandbox): it runs
// `node --version`, and the command's row is opened and framed. The record stays outside the repository.

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const outPath = arg('--out') ?? join(tmpdir(), 'locust-look-a-codex-sandbox')

const workspace = await scratchRepository('locust-look-sandbox-ws-')
const drive = await startDrive({
  name: 'look-a-codex-sandbox',
  port: 9594,
  workspace,
  outPath,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_cody', name: 'Cody', hue: 'lime', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-10-10T10:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', effort: 'low', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Cody')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, 'Run this shell command once and reply with what it printed: node --version')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
  })()`)
  await drive.capture('the turn, folded', () => 'framed')
  say(`row: ${String(await drive.capture('the command row, opened', () => drive.evaluate(`(async () => {
    const lines = [...document.querySelectorAll('.lc-steps__line, .lc-activity')]
    const line = lines.find((el) => /sandbox/.test(el.innerText)) ?? lines.at(-1)
    const folded = line?.innerText.replace(/\\s+/g, ' ') ?? 'no line'
    if (line && line.getAttribute('aria-expanded') !== 'true') { line.click(); await new Promise(r => setTimeout(r, 400)) }
    const row = [...document.querySelectorAll('.lc-filerow.is-shell')].find((el) => /sandbox did not start/.test(el.innerText))
    if (!row) return 'folded: ' + folded + ' || no row'
    if (row.getAttribute('aria-expanded') !== 'true') { row.click(); await new Promise(r => setTimeout(r, 400)) }
    row.scrollIntoView({ block: 'center' })
    await new Promise(r => setTimeout(r, 300))
    return row.innerText.replace(/\\s+/g, ' ') + ' || why: ' + (document.querySelector('.lc-shellwhy')?.innerText ?? 'none')
  })()`)))}`)
  await drive.resize(860, 720)
  await sleep(800)
  await drive.capture('the command row, 860', () => 'framed')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Cody on Codex (GPT-6-Luna, low) in Accept edits runs node --version.` })
}
