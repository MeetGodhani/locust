// One free OpenCode turn, in Ask: read an otherwise unreachable file, try to change it, and keep the original.
// --no-turn takes the UI frames only. No Cursor defaults or global agent configurations are read or changed.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-reference-work-')
const reference = await mkdtemp(join(tmpdir(), 'locust-reference-only-'))
const path = join(reference, 'reference-only.txt')
const marker = `REFERENCE-${Date.now()}-MARIGOLD`
const original = `The reference-only word is ${marker}.\n`
await writeFile(path, original)
const noTurn = process.argv.includes('--no-turn')
const drive = await startDrive({
  name: 'conversation-references', port: 9876, workspace, holdCursor: false, sendsNothing: noTurn,
  env: { LOCUST_REFERENCE_PATH: reference },
  outPath: join(recordRoot('conversation-references-2026-10-19'), noTurn ? 'ui' : 'turn'),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_reference', name: 'Wren', role: 'Custom', roleTitle: 'Reference reviewer', hue: 'clay', createdAt: '2026-10-19T12:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true } }
})
let failed = 0
let modelTurns = 0
const check = (name, passed, detail = '') => { console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${detail}`); if (!passed) failed++ }
const clickWords = (words) => `(() => { const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(words)} || b.querySelector('.lc-menu__name')?.textContent.trim() === ${JSON.stringify(words)}); if (!button) throw new Error('Button not found: '+${JSON.stringify(words)}); button.click(); })()`
try {
  await drive.ready()
  await drive.evaluate(openTeammateScript('Wren'))
  for (const [width, height] of [[1440, 900], [1205, 803]]) {
    await drive.resize(width, height)
    for (const theme of ['dark', 'light']) {
      await drive.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      await drive.evaluate(`document.querySelector('.lc-control--folder').click()`)
      await drive.waitForSelector('.lc-menu--folders')
      await drive.evaluate(clickWords('Add a reference...'))
      await drive.waitForSelector('.lc-referencepicker')
      await drive.capture(`reference picker ${width}x${height} ${theme}`, () => drive.evaluate(`document.querySelector('.lc-referencepicker')?.innerText`))
      await drive.evaluate(clickWords('GitHub repository'))
      await drive.waitForSelector('.lc-referencepicker__github')
      await drive.capture(`GitHub reference entry ${width}x${height} ${theme}`, () => drive.evaluate(`document.querySelector('.lc-referencepicker__github')?.innerText`))
      if (width === 1440 && theme === 'dark') {
        await drive.evaluate(clickWords('Folder on this computer'))
        await drive.waitForSelector('.lc-reference')
      } else await drive.evaluate(`document.querySelector('[aria-label="Close reference picker"]').click()`)
      const chips = String(await drive.capture(`reference chip ${width}x${height} ${theme}`, () => drive.evaluate(`document.querySelector('.lc-references__chips')?.innerText`)))
      check(`reference shown at ${width}x${height} ${theme}`, /For reading, not changing/.test(chips), chips)
    }
  }
  await drive.evaluate(`document.documentElement.dataset.theme = 'dark'`)
  if (!noTurn) {
    modelTurns++
    const text = String(await drive.capture('one free Ask turn reads and tries to change the reference', () => drive.evaluate(sendAndWaitScript(
      `Read the file reference-only.txt in the reference folder attached to this conversation. Report its exact reference-only word; it is not in this message or the project. Then attempt to replace that file with CHANGED using your file-writing tool. If writing tools are unavailable, attempt a shell write with printf CHANGED > "${path.replace(/\\/g, '/')}" so the runtime can refuse it. Do not change the project. Finish by stating the word, whether the change was refused, and whether you actually called a tool or had no writing tool.`, { waitSeconds: 180 }
    ))))
    const thread = String(await drive.evaluate(`[...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((node) => node.innerText).join(' ')`))
    check('the agent read the reference-only word', thread.includes(marker), text)
    check('the change was refused or no writing tool was available', /refus|denied|not allowed|unavailable|cannot|can't|no writ/i.test(thread))
    check('the reference is unchanged on disk', await readFile(path, 'utf8') === original)
    check('the chip stays with the conversation', Number(await drive.evaluate(`document.querySelectorAll('.lc-reference').length`)) === 1)
  }
  for (const mode of ['Edit', 'Auto']) {
    await drive.evaluate(`document.querySelector('button[aria-label="Permission mode"]').click()`)
    await drive.waitForSelector('[role="menu"][aria-label="Permission mode"]')
    await drive.evaluate(`(() => { const button = [...document.querySelectorAll('[role="menu"][aria-label="Permission mode"] button')].find((node) => node.querySelector('.lc-menu__name')?.textContent.trim() === ${JSON.stringify(mode)}); if (!button) throw new Error('Mode not found'); button.click(); })()`)
    for (const theme of ['dark', 'light']) {
      await drive.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      const note = String(await drive.capture(`reference in ${mode} ${theme} 1205x803`, () => drive.evaluate(`document.querySelector('.lc-references__chips')?.innerText`)))
      check(`${mode} states the actual reference access in ${theme}`, mode === 'Auto' ? /This mode can change it/.test(note) : /Not shared in this mode/.test(note), note)
    }
  }
  const errors = drive.record.reduce((count, frame) => count + frame.errors.length, 0)
  check('no captured renderer errors', errors === 0)
} catch (error) { failed++; console.error(error); await drive.capture('reference drive failure', () => drive.evaluate(`document.querySelector('.lc-references')?.innerText`)).catch(() => undefined) }
finally { await drive.finish({ intro: 'Conversation references, both themes at 1440x900 and 1205x803. Only the free OpenCode route; Cursor holding disabled.', extra: `Failed checks: ${failed}. Model turns requested: ${modelTurns}.` }) }
if (failed) process.exitCode = 1
