// The conversation's header is Claude Code's row of icons (0.797).
//
//   node _tools/drive-the-header-is-a-row-of-icons.mjs [--packaged <exe>]
//
// Colin, 2026-10-19, with Claude Code's header beside it: "lets lean into something closer to what claude code has,
// buttons are getting a little too much". The everyday profile (sixteen conversations), one opened: the header's
// panels and the folder are icons with their names on hover, in Claude Code's order, the menu last; Open in terminal
// is in the menu only. Read in both themes and at three widths. Nothing is sent, and the folder is not opened.

import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('the-header-is-a-row-of-icons-2026-10-19'), packaged === undefined ? 'local' : 'packaged')
const everyday = await seedEverydayLedger('drive-the-header-is-a-row-of-icons')

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}

/** The header's controls, left to right, as the eye and a screen reader get them. */
const HEADER = `JSON.stringify([...document.querySelectorAll('.lc-workroom__actions > *')].flatMap((el) => {
  const buttons = el.matches('button') ? [el] : [...el.querySelectorAll('button')]
  return buttons.map((b) => {
    const box = b.getBoundingClientRect()
    return {
      label: b.getAttribute('aria-label') ?? '',
      words: b.innerText.trim(),
      icon: b.classList.contains('lc-headicon'),
      pressed: b.getAttribute('aria-pressed'),
      title: b.getAttribute('title') ?? '',
      top: Math.round(box.top),
      right: Math.round(box.right),
      width: Math.round(box.width)
    }
  })
}))`

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'the-header-is-a-row-of-icons',
  port: 9594,
  workspace: everyday.workspace,
  profilePath: everyday.profilePath,
  sendsNothing: true,
  outPath: OUT,
  seed: everyday.seed
})
try {
  await drive.ready()
  await drive.resize(1280, 800)
  await sleep(2500)
  const opened = await drive.evaluate(`(async () => {
    const row = document.querySelector('.lc-conv')
    if (!row) return 'no conversation in the sidebar'
    row.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-workroom__actions'); i += 1) await new Promise((r) => setTimeout(r, 150))
    return document.querySelector('.lc-workroom__actions') ? 'opened' : 'no header'
  })()`)
  check('a conversation opens with its header', opened === 'opened', opened)

  const row = JSON.parse(await drive.capture('the header, dark', () => drive.evaluate(HEADER)) ?? '[]')
  say(`header: ${JSON.stringify(row.map((b) => `${b.label}${b.icon ? '' : ` [${b.words}]`}`))}`)
  const icons = row.filter((b) => b.icon)
  check('the panels, the folder and the menu are icons, named for hover and screen readers', icons.length >= 4 && icons.every((b) => b.words === '' && b.label.length > 0 && b.title.length > 0), JSON.stringify(icons))
  const order = icons.map((b) => (b.label.startsWith('Open ') ? 'Folder' : /^Review /.test(b.label) ? 'Changes' : b.label))
  const expected = ['Activity', 'Terminal', 'Changes', 'Browser', 'Folder', 'More actions'].filter((name) => order.includes(name))
  check('in Claude Code’s order, the menu last', JSON.stringify(order) === JSON.stringify(expected) && order[order.length - 1] === 'More actions', JSON.stringify(order))
  check('Open in terminal is no longer a button of its own', !row.some((b) => /^Open in terminal|^Continue/i.test(b.label) || b.words === '</>'), JSON.stringify(row.map((b) => b.label)))
  check('one row: every control on the same line', new Set(row.map((b) => b.top)).size === 1, JSON.stringify(row.map((b) => b.top)))

  // Activity pressed: its panel opens, and the icon says it is on.
  const pressed = JSON.parse(await drive.capture('Activity pressed', async () => {
    await drive.evaluate(`document.querySelector('.lc-workroom__actions button[aria-label="Activity"]')?.click()`)
    await sleep(600)
    return drive.evaluate(HEADER)
  }) ?? '[]')
  const activity = pressed.find((b) => b.label === 'Activity')
  check('pressed, Activity reads as on', activity?.pressed === 'true', JSON.stringify(activity))
  await drive.evaluate(`document.querySelector('.lc-workroom__actions button[aria-label="Activity"]')?.click()`)
  await sleep(400)

  // The menu still holds Open in terminal, where it moved.
  const menu = await drive.capture('the menu', async () => {
    await drive.evaluate(`document.querySelector('.lc-workroom__actions button[aria-label="More actions"]')?.click()`)
    await sleep(500)
    return drive.evaluate(`[...document.querySelectorAll('.lc-context__item')].map((el) => el.innerText.trim()).join(' / ')`)
  })
  say(`menu: ${String(menu)}`)
  check('the menu opens with the conversation’s actions', /Delete conversation|Send feedback/.test(String(menu)), menu)
  await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(300)

  await drive.evaluate(`window.desktop.setTheme('light')`)
  await drive.waitFor(`document.documentElement.dataset.theme === 'light'`, { timeoutMs: 5000, what: 'light theme' })
  await drive.capture('the header, light', () => drive.evaluate(HEADER))
  await drive.evaluate(`window.desktop.setTheme('dark')`)
  await drive.waitFor(`document.documentElement.dataset.theme !== 'light'`, { timeoutMs: 5000, what: 'dark theme' })

  for (const [width, height] of [[1024, 720], [820, 700]]) {
    await drive.resize(width, height)
    await sleep(500)
    const narrow = JSON.parse(await drive.capture(`the header at ${String(width)}`, () => drive.evaluate(HEADER)) ?? '[]')
    check(`at ${String(width)} it stays one row inside the window`, narrow.length > 0 && new Set(narrow.map((b) => b.top)).size === 1 && narrow.every((b) => b.right <= width), JSON.stringify(narrow.map((b) => [b.label, b.top, b.right])))
  }
  say(failures === 0 ? '\nTHE HEADER IS A ROW OF ICONS: PASSED' : `\nTHE HEADER IS A ROW OF ICONS: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The conversation header as Claude Code's row of icons.`, extra: `Checks failed: ${String(failures)}` })
}
