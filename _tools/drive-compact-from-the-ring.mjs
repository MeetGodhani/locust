// Compact now, from the context ring (0.797), through the app.
//
//   LOCUST_SPEND=1 node _tools/drive-compact-from-the-ring.mjs [--packaged <exe>] [--tag <name>]
//
// The OpenCode 2 docs review, 2026-10-19 (gap J): OpenCode offers "Compact
// session", Claude Code says to run /compact as its context fills, and Locust
// had /compact only in the `/` menu. The ring is now a button: it opens what
// it says, with Compact now beneath.
//
// One Claude Code turn on HAIKU, so the ring has a reading, then Compact now
// from the ring with a draft in the box. It checks the menu, that /compact
// went as the next message and Claude Code compacted, that the draft stayed,
// and that the ring no longer shows the reading from before the compaction.

import { join } from 'node:path'

import { pickRouteScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const workspace = await scratchRepository('locust-drive-compact-ring-ws-')

const drive = await startDrive({
  name: 'compact-from-the-ring',
  port: 9417,
  workspace,
  spends: true,
  outPath: join(recordRoot('compact-from-the-ring-2026-10-19'), tag),
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

const DRAFT = 'a thought I am still typing'

const MENU = `JSON.stringify((() => {
  const menu = document.querySelector('.lc-menu--context')
  if (!menu) return null
  const item = [...menu.querySelectorAll('.lc-menu__item')].find((b) => b.innerText.includes('Compact now'))
  const box = menu.getBoundingClientRect()
  return {
    head: menu.querySelector('.lc-menu__head')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    item: item ? item.innerText.replace(/\\s+/g, ' ').trim() : '',
    disabled: item ? item.disabled : null,
    inWindow: box.left >= 0 && box.right <= innerWidth && box.top >= 0
  }
})())`

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

  // Asserted BEFORE anything is sent: a drive that sends on the wrong route
  // spends first and notices second.
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

  const before = await drive.evaluate(`(() => {
    const button = document.querySelector('.lc-contextring__button')
    return button ? (button.querySelector('.lc-contextring')?.getAttribute('aria-label') ?? '') : ''
  })()`)
  check('the ring is a button once Claude Code reported its window', /^Context: /.test(String(before)), String(before))

  // A draft in the box, which Compact now must leave where it is.
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(DRAFT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
  })()`)

  const menu = JSON.parse(await drive.capture('the ring pressed: its menu', async () => {
    await drive.evaluate(`document.querySelector('.lc-contextring__button')?.click()`)
    await new Promise((r) => setTimeout(r, 400))
    return drive.evaluate(MENU)
  }) ?? 'null')
  say(`menu: ${JSON.stringify(menu)}`)
  check('the menu reads what the ring says', menu !== null && menu.head.startsWith(String(before)), menu?.head)
  check('it offers Compact now, saying what it does', menu !== null && /Compact now/.test(menu.item) && /Summarize the conversation so far/.test(menu.item) && menu.disabled === false, menu?.item)
  check('the menu is inside the window', menu?.inWindow === true)

  // The same menu in the light theme, then back.
  await drive.evaluate(`window.desktop.setTheme('light')`)
  await drive.waitFor(`document.documentElement.dataset.theme === 'light'`, { timeoutMs: 5000, what: 'light theme' })
  await drive.capture('the menu in the light theme', () => drive.evaluate(MENU))
  await drive.evaluate(`window.desktop.setTheme('dark')`)
  await drive.waitFor(`document.documentElement.dataset.theme !== 'light'`, { timeoutMs: 5000, what: 'dark theme' })

  // Pressed, then waited on from here: a loop of timers inside a window
  // behind others is slowed to one wake a minute after five (the first run
  // of this drive stalled on exactly that), and a poll from outside is not.
  await drive.evaluate(`[...document.querySelectorAll('.lc-menu--context .lc-menu__item')].find((b) => b.innerText.includes('Compact now'))?.click()`)
  const settled = await drive.waitFor(`(() => {
    const thread = document.querySelector('.lc-thread')?.innerText ?? ''
    const running = document.querySelector('button[aria-label^="Stop the running"]') !== null
    return !running && /summarized the conversation so far|failed|could not/i.test(thread) ? 'settled' : ''
  })()`, { timeoutMs: 180_000, everyMs: 1000, what: 'the compaction to settle' }).catch((error) => String(error.message))
  say(`compaction: ${String(settled)}`)
  const after = JSON.parse(await drive.capture('Compact now pressed, and settled', () => drive.evaluate(`JSON.stringify({
    menuOpen: document.querySelector('.lc-menu--context') !== null,
    bubbles: [...document.querySelectorAll('.lc-thread .lc-bubble')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()),
    thread: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-600) ?? '',
    draft: document.querySelector('form.command-dock textarea')?.value ?? null,
    ring: document.querySelector('.lc-contextring')?.getAttribute('aria-label') ?? null
  })`)) ?? '{}')
  say(`after: ${JSON.stringify(after)}`)
  check('the menu closed when it was chosen', after.menuOpen === false)
  check('/compact went as the next message', Array.isArray(after.bubbles) && after.bubbles.some((b) => b.startsWith('/compact')), JSON.stringify(after.bubbles))
  check('Claude Code compacted, as asked', /summarized the conversation so far, as asked/.test(after.thread ?? ''), String(settled))
  check('the draft stayed in the box', after.draft === DRAFT, JSON.stringify(after.draft))
  check('the ring no longer reads the conversation from before', after.ring === null, String(after.ring))

  // WHILE A TURN RUNS it waits in line, as a message sent then does. The ring
  // needs a reading first: one more short turn after the compaction (which
  // also shows the ring coming back), then a longer one, and the ring pressed
  // while that one is still going.
  await drive.capture('a turn after the compaction, settled', () =>
    drive.evaluate(sendAndWaitScript('Say goodbye in three words.', { waitSeconds: 240 }))
  )
  const back = await drive.evaluate(`document.querySelector('.lc-contextring__button .lc-contextring')?.getAttribute('aria-label') ?? ''`)
  check('the ring comes back with the next turn that reports', /^Context: /.test(String(back)), String(back))
  await drive.evaluate(sendAndWaitScript('Count from 1 to 80, one number per line, nothing else.', { settle: false }))
  const working = await drive.waitFor(`document.querySelector('button[aria-label^="Stop the running"]') !== null ? 'working' : ''`, { timeoutMs: 30_000, everyMs: 250, what: 'the turn to start' }).catch((error) => String(error.message))
  const waiting = JSON.parse(await drive.capture('the ring pressed while the turn runs', async () => {
    await drive.evaluate(`document.querySelector('.lc-contextring__button')?.click()`)
    await new Promise((r) => setTimeout(r, 400))
    return drive.evaluate(`JSON.stringify({
      running: document.querySelector('button[aria-label^="Stop the running"]') !== null,
      item: document.querySelector('.lc-menu--context .lc-menu__item')?.innerText.replace(/\\s+/g, ' ').trim() ?? null
    })`)
  }) ?? '{}')
  say(`while running (${String(working)}): ${JSON.stringify(waiting)}`)
  check('while the turn runs it offers to compact when the turn ends', waiting.running === true && /^Compact when this turn ends/.test(waiting.item ?? ''), waiting.item)
  const queuedCard = JSON.parse(await drive.capture('chosen: it waits in line', async () => {
    await drive.evaluate(`document.querySelector('.lc-menu--context .lc-menu__item')?.click()`)
    await new Promise((r) => setTimeout(r, 800))
    return drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-queued')].map((card) => card.innerText.replace(/\\s+/g, ' ').trim()))`)
  }) ?? '[]')
  check('/compact waits in line behind the running turn', queuedCard.some((text) => text.includes('/compact')), JSON.stringify(queuedCard))
  const second = await drive.waitFor(`(() => {
    const thread = document.querySelector('.lc-thread')?.innerText ?? ''
    const running = document.querySelector('button[aria-label^="Stop the running"]') !== null
    const compactions = thread.split('summarized the conversation so far, as asked').length - 1
    return !running && compactions >= 2 && document.querySelector('.lc-queued') === null ? 'settled' : ''
  })()`, { timeoutMs: 300_000, everyMs: 1000, what: 'the queued compaction to run' }).catch((error) => String(error.message))
  const end = JSON.parse(await drive.capture('the turn ended, then it compacted', () => drive.evaluate(`JSON.stringify({
    bubbles: [...document.querySelectorAll('.lc-thread .lc-bubble')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60)),
    ring: document.querySelector('.lc-contextring')?.getAttribute('aria-label') ?? null
  })`)) ?? '{}')
  say(`end: ${JSON.stringify(end)}`)
  check('the queued /compact went once the turn ended, and Claude Code compacted', second === 'settled' && (end.bubbles ?? []).filter((b) => b.startsWith('/compact')).length === 2, String(second))
  say(failures === 0 ? '\nCOMPACT FROM THE RING PASSED' : `\nCOMPACT FROM THE RING: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'One Claude Code turn on Haiku, then Compact now from the context ring with a draft in the box.' })
}
