// Does the picker still find Cursor's Composer 2.5?
//
//   node _tools/drive-picker-search.mjs
//
// The diff smoke failed with `no composer row after search, rows: []` -- an
// EMPTY picker, not a missing row. The catalogue is now re-read when the
// picker opens (0.37.0, so a runtime that finishes probing late is not
// missing for the session), and a re-read that comes back thinner than what
// it replaces would empty the list at exactly the moment a person is looking
// at it. This checks the rows before and after that refresh lands.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-picker-ws-')
const drive = await startDrive({
  name: 'picker-search',
  port: 9323,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const rowsNow = `(() => {
  const picker = document.querySelector('.lc-picker')
  if (picker === null) return 'picker closed'
  const rows = [...picker.querySelectorAll('.lc-picker__row')]
  return rows.length + ' rows :: ' + rows.map(r => r.innerText.split(String.fromCharCode(10))[0]).slice(0, 6).join(', ')
})()`

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}

try {
  await drive.capture('open the picker and wait for it to settle', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 800))
      const chip = [...document.querySelectorAll('.lc-control')].find(b => /Codex|OpenCode|Claude/.test(b.innerText))
      chip?.click()
      await new Promise(r => setTimeout(r, 2500))
    })()`)
    return drive.evaluate(rowsNow)
  })

  await drive.capture('search for composer 2.5, the way the smoke does', () => drive.evaluate(`(async () => {
    const picker = document.querySelector('.lc-picker')
    const input = picker?.querySelector('.lc-picker__input')
    if (!input) return 'no search field'
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setInput.call(input, 'composer 2.5')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    const rows = [...picker.querySelectorAll('.lc-picker__row')]
    return rows.length + ' rows :: ' + rows.map(r => r.innerText.split(String.fromCharCode(10))[0]).slice(0, 6).join(', ')
  })()`))

  await drive.capture('and once more after everything has settled', () => drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 4000))
    const picker = document.querySelector('.lc-picker')
    const rows = [...(picker?.querySelectorAll('.lc-picker__row') ?? [])]
    return rows.length + ' rows :: ' + rows.map(r => r.innerText.split(String.fromCharCode(10))[0]).slice(0, 6).join(', ')
  })()`))

  const quiet = `(() => {
    const filler = new Set(['through', 'via', 'cli', 'model', 'models', 'tier', 'tiers', 'the', 'a', 'an', 'its', 'and', 'of', 'on', 'with', 'your', 'own', 'account'])
    const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0 && !filler.has(word))
    const ready = [...document.querySelectorAll('.lc-picker__tag')].filter((el) => (el.textContent ?? '').trim() === 'READY').length
    const plain = [...document.querySelectorAll('.lc-picker__row.is-plain')]
    const short = plain.filter((row) => row.getBoundingClientRect().height < 31.5).length
    const repeated = []
    let group = ''
    for (const node of document.querySelectorAll('.lc-picker__group, .lc-picker__row:not(.is-recent)')) {
      if (node.classList.contains('lc-picker__group')) {
        group = (node.innerText ?? '').split('\\n')[0] ?? ''
        continue
      }
      const detail = node.querySelector('.lc-picker__detail')
      if (detail === null) continue
      const said = words(detail.innerText ?? '')
      const named = new Set(words((group.split(' · ')[0] ?? group)))
      if (said.length > 0 && said.every((word) => named.has(word))) repeated.push(group + ' / ' + (detail.innerText ?? ''))
    }
    const kept = [...document.querySelectorAll('.lc-picker__detail')].map((el) => (el.innerText ?? '').replace(/\\s+/g, ' ').trim()).filter((text) => text.length > 0)
    return JSON.stringify({ ready, plain: plain.length, short, repeated, kept: kept.slice(0, 8), rows: document.querySelectorAll('.lc-picker__row').length, theme: document.documentElement.dataset.theme ?? '' })
  })()`
  const show = async (width, height, theme) => {
    await drive.resize(width, height)
    await drive.evaluate(`window.desktop.setTheme(${JSON.stringify(theme)})`)
    await drive.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, { what: `${theme} theme` })
    return JSON.parse(String(await drive.capture(`picker ${theme} ${String(width)}`, () => drive.evaluate(`(async () => {
      const box = document.querySelector('.lc-picker__input')
      if (box) {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(box, '')
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 200))
      }
      return ${quiet}
    })()`))))
  }
  for (const [width, height] of [[1440, 900], [1205, 803]]) {
    for (const theme of ['dark', 'light']) {
      const seen = await show(width, height, theme)
      check(`at ${theme} ${String(width)} the picker is open`, seen.rows > 0, JSON.stringify(seen))
      check(`at ${theme} ${String(width)} no row says READY`, seen.ready === 0, JSON.stringify(seen))
      check(`at ${theme} ${String(width)} no detail only repeats its heading`, seen.repeated.length === 0, JSON.stringify(seen.repeated))
      check(`at ${theme} ${String(width)} a plain row is at least 32px`, seen.short === 0, JSON.stringify(seen))
    }
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. The picker searched the way the diff smoke searches it, then at 1440x900 and 1205x803 in both themes.' })
  process.exitCode = failures === 0 ? 0 : 1
}
