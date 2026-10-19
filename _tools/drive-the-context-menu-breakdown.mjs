// What fills the context, in the ring's menu (0.806), through the app.
//
//   LOCUST_SPEND=1 node _tools/drive-the-context-menu-breakdown.mjs [--packaged <exe>] [--tag <name>]
//
// One Claude Code turn on HAIKU, then the ring pressed: the menu lists Claude Code's own /context estimate by
// category, run after the turn with the turn's own flags. It checks the rows are there and said to be Claude Code's,
// that deferred tools and the autocompact buffer are not among them, that reading it added no turn to the
// conversation, and the menu in both themes.

import { join } from 'node:path'

import { pickRouteScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const workspace = await scratchRepository('locust-drive-context-breakdown-ws-')

const drive = await startDrive({
  name: 'context-menu-breakdown',
  port: 9651,
  workspace,
  spends: true,
  outPath: join(recordRoot('context-breakdown-2026-10-19'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const MENU = `JSON.stringify((() => {
  const menu = document.querySelector('.lc-menu--context')
  if (!menu) return null
  const group = menu.querySelector('.lc-contextbreakdown')
  const box = menu.getBoundingClientRect()
  return {
    head: menu.querySelector('.lc-menu__head')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    note: group?.querySelector('.lc-menu__headnote')?.innerText.trim() ?? '',
    rows: group ? [...group.querySelectorAll('.lc-contextbreakdown__label')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()) : [],
    advice: group?.querySelector('.lc-contextbreakdown__advice')?.innerText.trim() ?? '',
    order: group !== null && [...menu.querySelectorAll('.lc-menu__item')].some((item) => /Compact/.test(item.innerText) && (group.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    inWindow: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
  }
})())`

const bubbles = `document.querySelectorAll('.lc-thread .lc-bubble').length`

try {
  await drive.capture('Wren on Claude Code / haiku', async () => {
    await drive.ready()
    await drive.resize(1280, 800)
    await drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 700))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  })

  // Asserted BEFORE anything is sent: a drive that sends on the wrong route spends first and notices second.
  const route = await drive.evaluate(`(() => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    return control ? control.innerText.replace(/\\s+/g, ' ').trim() : ''
  })()`)
  if (!/haiku/i.test(route)) {
    say(`refusing to send: the composer is on "${route}", not Haiku.`)
    throw new Error('wrong route')
  }
  say(`route: ${route}`)

  await drive.capture('one short turn, settled', () =>
    drive.evaluate(sendAndWaitScript('Say hello in five words.', { waitSeconds: 240 }))
  )
  const sent = Number(await drive.evaluate(bubbles))

  await drive.evaluate(`document.querySelector('.lc-contextring__button')?.click()`)
  const arrived = await drive.waitFor(`document.querySelector('.lc-menu--context .lc-contextbreakdown') !== null ? 'shown' : ''`, { timeoutMs: 20_000, everyMs: 250, what: 'the breakdown' }).catch((error) => String(error.message))
  const menu = JSON.parse(await drive.capture('the ring pressed: what fills it', () => drive.evaluate(MENU)) ?? 'null')
  say(`menu (${String(arrived)}): ${JSON.stringify(menu)}`)
  check("the menu lists Claude Code's estimate, said to be its own", menu !== null && menu.note === 'Estimated by Claude Code' && menu.rows.length >= 2, menu?.note)
  check('it has the conversation and the room left', menu !== null && menu.rows.some((row) => /^Messages /.test(row)) && menu.rows.some((row) => /^Free space /.test(row)), JSON.stringify(menu?.rows))
  check('deferred tools and the autocompact buffer are not among them', menu !== null && !menu.rows.some((row) => /deferred|autocompact/i.test(row)), JSON.stringify(menu?.rows))
  check('it sits above Compact now, inside the window', menu?.order === true && menu?.inWindow === true)
  check('a fresh conversation gets no advice', menu?.advice === '', menu?.advice)
  check('reading it added nothing to the conversation', Number(await drive.evaluate(bubbles)) === sent && await drive.evaluate(`document.querySelector('button[aria-label^="Stop the running"]') === null`) === true)

  await drive.evaluate(`window.desktop.setTheme('light')`)
  await drive.waitFor(`document.documentElement.dataset.theme === 'light'`, { timeoutMs: 5000, what: 'light theme' })
  await drive.capture('the menu in the light theme', () => drive.evaluate(MENU))
  await drive.evaluate(`window.desktop.setTheme('dark')`)
  await drive.waitFor(`document.documentElement.dataset.theme !== 'light'`, { timeoutMs: 5000, what: 'dark theme' })

  // Closed and opened again: the same finished turn is answered from what was read, at once.
  await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await new Promise((r) => setTimeout(r, 300))
  await drive.evaluate(`document.querySelector('.lc-menu--context') === null && document.querySelector('.lc-contextring__button')?.click()`)
  const again = await drive.waitFor(`document.querySelector('.lc-menu--context .lc-contextbreakdown') !== null ? 'shown' : ''`, { timeoutMs: 1500, everyMs: 100, what: 'the breakdown again' }).catch((error) => String(error.message))
  check('opened again, it is there at once', again === 'shown', String(again))
  say(failures === 0 ? '\nCONTEXT MENU BREAKDOWN PASSED' : `\nCONTEXT MENU BREAKDOWN: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "One Claude Code turn on Haiku, then the context ring's menu read for what fills the conversation." })
}
process.exit(failures === 0 ? 0 : 1)
