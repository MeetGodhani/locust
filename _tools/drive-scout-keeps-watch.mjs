// Scout keeps watch (0.756): turned on from Home, it hears a teammate's turn fail and tells the person on a card,
// in Locust's words first, then with what its free model adds.
//
//   node _tools/drive-scout-keeps-watch.mjs [--packaged <exe>]
//
// Free models only, so it spends nothing: Scout reads with the steadiest free model listed (Space Bunny unless it is
// down), and Wren's turn fails at OpenCode on a free model that does not exist. Home must offer "Meet Scout" with the
// model it would read with; Turn on Scout must put Scout on the team; Wren's failed turn must come back as a card --
// "Wren's turn failed: ..." -- that reads, then settles; Scout's look must never be listed as a conversation; Dismiss
// must take the card away; Settings must say Scout is on, with its switches.

import { join } from 'node:path'

import { FREE_ROUTE, conversationRows, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const workspace = await scratchRepository('locust-drive-scout-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'scout-keeps-watch',
  port: 9632,
  workspace,
  outPath: join(recordRoot('scout-keeps-watch-2026-10-12'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-12T05:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/no-such-model-free', mode: 'ask' } },
      { teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Docs & QA', createdAt: '2026-10-12T05:00:00.000Z', route: FREE_ROUTE }
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
const state = async () => JSON.parse(String(await drive.evaluate('window.desktop.scout.state().then((s) => JSON.stringify(s))')))
const CARDS = `JSON.stringify([...document.querySelectorAll('[data-scout-card]')].map((card) => ({
  said: card.querySelector('.lc-scoutcard__said')?.innerText ?? '',
  take: card.querySelector('.lc-scoutcard__take')?.innerText ?? '',
  reading: card.querySelector('.lc-scoutcard__reading') !== null,
  draft: card.querySelector('.lc-scoutcard__drafttext')?.innerText ?? '',
  buttons: [...card.querySelectorAll('button')].map((b) => b.innerText.trim())
})))`

try {
  await drive.ready()
  await drive.resize(1215, 860)
  // Home offers Scout to a person with a team and a folder.
  let invite = ''
  for (let i = 0; i < 60 && invite === ''; i += 1) {
    await sleep(500)
    invite = String(await drive.evaluate(`document.querySelector('section[aria-label="Meet Scout"]')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  }
  await drive.capture('Home offers Scout', () => invite)
  check('Home says what Scout would read with, by its name, and that it is free', /Meet Scout/.test(invite) && /That model is [A-Z][\w .]* Free through OpenCode\./.test(invite) && /never sends, merges or changes anything/.test(invite), invite)

  await drive.evaluate(`[...document.querySelectorAll('section[aria-label="Meet Scout"] button')].find((b) => b.innerText.trim() === 'Turn on Scout')?.click()`)
  let on = await state()
  for (let i = 0; i < 40 && !(on.settings.on && on.settings.teammateId); i += 1) { await sleep(250); on = await state() }
  const team = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-hometeam__name, .lc-teamcard__name, [class*="hometeam"] [class*="name"]')].map((n) => n.innerText.trim()))`)))
  check('Turn on Scout puts Scout on the team, on', on.settings.on === true && typeof on.settings.teammateId === 'string', JSON.stringify(on.settings))
  check('and the invitation goes', String(await drive.evaluate(`document.querySelector('section[aria-label="Meet Scout"]') === null`)) === 'true', team.join(', '))

  // Wren's turn fails at OpenCode: the model does not exist.
  say(`open Wren: ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  say(`Wren: ${String(await drive.evaluate(sendAndWaitScript('List the files in this folder.', { waitSeconds: 90 })))}`)
  await sleep(1500)
  // Back Home, and Scout looks (its timer's own look, pressed now).
  await drive.evaluate(`document.querySelector('button[aria-label="Home"]')?.click()`)
  await drive.evaluate('window.desktop.scout.look()')
  let cards = []
  for (let i = 0; i < 40 && cards.length === 0; i += 1) {
    await sleep(500)
    cards = JSON.parse(String(await drive.evaluate(CARDS)))
  }
  await drive.capture('Scout noticed, reading', () => JSON.stringify(cards))
  check('Wren’s failed turn comes back as a card, with why in OpenCode’s own words', cards.some((card) => /^Wren's turn failed: .*Model not found: opencode\/no-such-model-free/.test(card.said)), JSON.stringify(cards))
  // Its model reads it, and the card settles: with a take or a draft if it gave one, never waiting for ever.
  let settled = cards
  for (let i = 0; i < 240 && settled.some((card) => card.reading); i += 1) {
    await sleep(1000)
    settled = JSON.parse(String(await drive.evaluate(CARDS)))
  }
  const after = await state()
  await drive.capture('Scout noticed, settled', () => JSON.stringify({ cards: settled, modelSaid: after.modelSaid }))
  check('the card settles once Scout’s model has answered', settled.length > 0 && !settled.some((card) => card.reading), JSON.stringify(settled))
  // With an answer, or -- every free model refusing -- Locust's words and why; never stuck behind its own last look.
  check('and it settled on an answer, or says why none came', (settled[0]?.take ?? '') !== '' || /These cards are in Locust’s words/.test(after.modelSaid ?? ''), JSON.stringify({ take: settled[0]?.take, modelSaid: after.modelSaid }))
  say(`  Scout's model added: ${JSON.stringify({ take: settled[0]?.take, draft: settled[0]?.draft, modelSaid: after.modelSaid })}`)
  check('Scout’s look is never listed as a conversation', !JSON.parse(String(await drive.evaluate(`JSON.stringify(${conversationRows()}.map((row) => row.title))`))).some((title) => /Scout looked|keeps watch for the person/i.test(title)), after.lookIds.join(' '))
  check('the card offers Open and Dismiss', settled[0]?.buttons.includes('Open it') && settled[0]?.buttons.includes('Dismiss'), JSON.stringify(settled[0]?.buttons))

  await drive.evaluate(`[...document.querySelectorAll('[data-scout-card] button')].find((b) => b.innerText.trim() === 'Dismiss')?.click()`)
  await sleep(800)
  check('Dismiss takes the card away', JSON.parse(String(await drive.evaluate(CARDS))).length === settled.length - 1)

  // Settings says it is on, with its switches.
  await drive.evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Settings')?.click()`)
  let line = ''
  for (let i = 0; i < 20 && line === ''; i += 1) {
    await sleep(300)
    line = String(await drive.evaluate(`document.querySelector('[data-setting="scout"]')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  }
  await drive.capture('Scout in Settings', () => line)
  check('Settings says Scout is on, what it reads with, and what it watches', /Scout keeps watch/.test(line) && /^.*On\. Scout looks every 10 minutes/.test(line) && /It reads with Space Bunny Free through OpenCode/.test(line) && /Pull requests and their checks/.test(line) && /Tell me in Windows/.test(line), line)
  // Its model is changed where any teammate's is (Colin: "allow the user to change the model of proactive teammate").
  await drive.evaluate(`[...document.querySelectorAll('[data-setting="scout"] button')].find((b) => b.innerText.trim() === 'Change its model')?.click()`)
  let dialog = { text: '', name: '' }
  for (let i = 0; i < 20 && dialog.text === ''; i += 1) {
    await sleep(250)
    // The name is in the dialog's name field: a field's value is not the dialog's text.
    dialog = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
      const box = document.querySelector('[role="dialog"][aria-label="Edit teammate"]')
      return { text: box?.innerText.replace(/\\s+/g, ' ') ?? '', name: box?.querySelector('input')?.value ?? '' }
    })())`)))
  }
  await drive.capture('Change its model', () => JSON.stringify(dialog).slice(0, 300))
  check('Change its model opens Scout’s own Edit teammate, with its Model row', dialog.name === 'Scout' && /Model/i.test(dialog.text) && /Space Bunny/.test(dialog.text), JSON.stringify(dialog).slice(0, 300))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Scout turned on from Home; Wren's turn fails; Scout tells it on a card.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
