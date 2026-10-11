// The chat box's control row with Talk in it, and without, at three widths (0.737), to look at before it ships.
//
//   node _tools/look-the-chat-box-row-with-talk.mjs [--packaged <exe>] [--out <dir>]
//
// Talk (the voice call's waveform) sits after voice typing's microphone. This frames Wren's chat box at 1215,
// 960 and 860 wide, reads whether any two controls in the row overlap, then takes Talk out of the page and
// reads it again -- so a crowding Talk causes is told apart from one the row already had. Sends nothing.

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const outPath = arg('--out') ?? join(tmpdir(), 'locust-look-chat-box-row')
const workspace = await scratchRepository('locust-look-row-ws-')
const drive = await startDrive({
  name: 'look-the-chat-box-row-with-talk',
  port: 9596,
  workspace,
  outPath,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-10T10:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// Every visible control in the chat box's row, and each pair whose boxes overlap by more than a pixel.
const ROW = `(() => {
  const form = document.querySelector('textarea[aria-label="Message"]')?.closest('form')
  if (!form) return JSON.stringify({ error: 'no chat box' })
  const field = form.querySelector('textarea').getBoundingClientRect()
  const controls = [...form.querySelectorAll('button, .lc-control')].filter((el) => {
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.top > field.bottom - 2 && !el.closest('[role=menu], [role=dialog], [role=region]')
  })
  const named = (el) => (el.getAttribute('aria-label') || el.innerText || el.className).replace(/\\s+/g, ' ').trim().slice(0, 40)
  // The plus is one control drawn in layers (Attach files / Choose a folder under its own button): not an overlap.
  const outer = controls.filter((el) => !controls.some((other) => other !== el && other.contains(el)) && !/^(Attach files|Choose a folder)$/.test(el.getAttribute('aria-label') ?? ''))
  const overlaps = []
  for (let i = 0; i < outer.length; i += 1) for (let j = i + 1; j < outer.length; j += 1) {
    const a = outer[i].getBoundingClientRect(), b = outer[j].getBoundingClientRect()
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    if (x > 1 && y > 1) overlaps.push(named(outer[i]) + ' x ' + named(outer[j]) + ' (' + Math.round(x) + 'px)')
  }
  const inner = document.querySelector('.lc-composer__inner')?.getBoundingClientRect().width ?? -1
  const groups = [...form.querySelectorAll('.lc-composer__controls > .lc-composer__group')].map((group) => group.clientWidth + '/' + group.scrollWidth)
  return JSON.stringify({ talk: !!form.querySelector('button[aria-label="Talk"]'), box: Math.round(inner), groups, controls: outer.length, overlaps })
})()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 800)) })()`)
  await drive.evaluate(`(async () => { for (let i = 0; i < 40 && !document.querySelector('button[aria-label="Talk"]'); i += 1) await new Promise(r => setTimeout(r, 250)) })()`)
  for (const [width, height] of [[1215, 800], [960, 720], [860, 720]]) {
    await drive.resize(width, height)
    await sleep(700)
    say(`${String(width)} with Talk: ${String(await drive.capture(`the row at ${String(width)}, with Talk`, () => drive.evaluate(ROW)))}`)
  }
  // The same row with Talk taken out of the page: what the row did before 0.737.
  await drive.evaluate(`document.querySelector('button[aria-label="Talk"]')?.closest('.lc-call')?.remove()`)
  for (const [width, height] of [[960, 720], [860, 720]]) {
    await drive.resize(width, height)
    await sleep(700)
    say(`${String(width)} without Talk: ${String(await drive.capture(`the row at ${String(width)}, without Talk`, () => drive.evaluate(ROW)))}`)
  }
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren's chat box row, with Talk and without, at three widths.` })
}
