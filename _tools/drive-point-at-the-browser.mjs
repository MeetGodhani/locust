// Point at a part of the browser page (the preview's picker, in the browser).
//
//   node _tools/drive-point-at-the-browser.mjs
//
// Opens the browser on a local page with a button and a login form. Points at
// the button: a chip, its picture, its styles, and the source the page named.
// Points at the password field: no value, and no picture of its contents.
// A note is typed on the chip. Nothing is sent. No model turn.

import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const PORT = 9786
const OUT = join(recordRoot('point-at-the-browser-2026-10-19'), 'point-at-the-browser')
await mkdir(OUT, { recursive: true })

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Point fixture</title>
<style>
  body { margin: 0; padding: 24px; font-family: sans-serif; background: #f4f1ea; color: #222; }
  #save { width: 180px; height: 40px; margin: 0; padding: 8px 16px; display: flex; align-items: center; justify-content: center; color: rgb(11, 22, 33); background: #fff; border: 1px solid rgb(1, 2, 3); border-radius: 6px; }
  form { margin-top: 24px; display: flex; gap: 8px; align-items: center; }
  #pw { width: 200px; }
</style></head>
<body>
  <button id="save" type="button" data-source="src/SaveButton.tsx:18" onclick="window.__acted = true">Save</button>
  <form id="login">
    <label>Password <input id="pw" type="password" name="password" value="s3cret-pass" autocomplete="current-password"></label>
  </form>
</body></html>`

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(page)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const httpPort = server.address().port
const fixtureUrl = `http://127.0.0.1:${String(httpPort)}/`

const drive = await startDrive({
  name: 'point-at-the-browser',
  port: PORT,
  workspace: await scratchRepository('locust-point-browser-ws-'),
  outPath: OUT,
  sendsNothing: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-19T12:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

function connect(wsUrl) {
  let seq = 0
  const pending = new Map()
  const contexts = []
  const socket = new WebSocket(wsUrl)
  const open = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(undefined))
    socket.addEventListener('error', () => reject(new Error('the browser page debugger did not open')))
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context)
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? 'debugger error'))
    else waiter.resolve(message.result)
  })
  const send = (method, params = {}) => {
    const id = ++seq
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    socket.send(JSON.stringify({ id, method, params }))
    return result
  }
  const pageContext = async () => {
    await open
    await send('Runtime.enable')
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const found = contexts.find((context) => typeof context.origin === 'string' && context.origin.startsWith('http://127.0.0.1'))
      if (found !== undefined) return found.id
      await sleep(100)
    }
    throw new Error(`the page context never arrived. Contexts: ${JSON.stringify(contexts.map((context) => context.origin))}`)
  }
  return {
    ready: pageContext(),
    evaluate: async (expression) => {
      const contextId = await pageContext()
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, contextId })
      const value = result?.result?.value
      if (value === undefined) say(`  page eval had no value: ${JSON.stringify(result).slice(0, 600)}`)
      return value
    },
    mouse: async (x, y) => {
      await open
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(120)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    },
    close: () => socket.close()
  }
}

async function browserPage() {
  const deadline = Date.now() + 20_000
  let last = []
  while (Date.now() < deadline) {
    const list = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`).then((response) => response.json())
    last = list.map((target) => `${target.type} ${target.url}`)
    const found = list.find((target) => typeof target.url === 'string' && target.url.startsWith(fixtureUrl) && target.webSocketDebuggerUrl)
    if (found !== undefined) {
      say(`  browser page: ${found.type} ${found.url}`)
      return connect(found.webSocketDebuggerUrl)
    }
    await sleep(200)
  }
  throw new Error(`the fixture never appeared in the debugger. Saw: ${last.join(' | ')}`)
}

const chips = `JSON.stringify([...document.querySelectorAll('.lc-pagepoint')].map((chip) => ({
  selector: chip.getAttribute('data-selector'),
  picture: chip.getAttribute('data-picture'),
  pictureNote: chip.getAttribute('data-picture-note'),
  styles: chip.getAttribute('data-styles'),
  source: chip.getAttribute('data-source'),
  note: chip.querySelector('.lc-pagepoint__note')?.value ?? '',
  shot: chip.querySelector('img.lc-thumb')?.getAttribute('src')?.slice(0, 16) ?? ''
})))`
const threadHasPick = `(() => (document.querySelector('.lc-thread')?.innerText ?? '').includes('Page content from the browser'))()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 720)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(500)
  await drive.evaluate(`document.querySelector('button[aria-label="Browser"]')?.click()`)
  await drive.waitFor(`document.querySelector('input[aria-label="Browser address"]') !== null`, { timeoutMs: 15_000, what: 'the browser address' })
  await drive.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Browser address"]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(fixtureUrl)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(250)
  await drive.evaluate(`document.querySelector('button[aria-label="Go"]')?.click()`)
  await drive.waitFor(
    `!document.querySelector('button[aria-label="Point at a part of the page"]')?.disabled`,
    { timeoutMs: 20_000, what: 'pointing becoming available' }
  )
  const guest = await browserPage()
  await guest.ready

  await drive.evaluate(`document.querySelector('button[aria-label="Point at a part of the page"]')?.click()`)
  const hint = await drive.evaluate(`document.querySelector('.lc-browser__hint')?.innerText ?? ''`)
  check('pointing says what to do', String(hint).includes('Click a part of the page to ask about it'), String(hint))
  const saveAt = await guest.evaluate(`(() => { const el = document.querySelector('#save'); if (!el) return { missing: true, href: location.href, title: document.title, body: (document.body && document.body.innerText || '').slice(0, 160) }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, href: location.href } })()`)
  if (saveAt === undefined || saveAt.x === undefined) throw new Error(`the button was not on the page: ${JSON.stringify(saveAt)}`)
  await guest.mouse(saveAt.x, saveAt.y)
  await drive.waitFor(`document.querySelector('.lc-pagepoint[data-selector="button#save"]') !== null`, { timeoutMs: 15_000, what: 'the button chip' })
  await drive.waitFor(
    `document.querySelector('.lc-pagepoint[data-selector="button#save"] img.lc-thumb') !== null`,
    { timeoutMs: 15_000, what: 'the button picture' }
  )
  const acted = await guest.evaluate(`window.__acted === true`)
  const saveChip = JSON.parse(String(await drive.capture('the button, in the chat box', () => drive.evaluate(chips))))[0]
  check('the click stayed in the picker', acted === false, String(acted))
  check('the button chip has its picture and its styles', saveChip?.picture?.includes('page-part-') === true && /width:\s*180px/.test(saveChip?.styles ?? '') && saveChip?.shot.startsWith('data:'), JSON.stringify(saveChip))
  check('the page named its source', saveChip?.source === 'src/SaveButton.tsx:18', String(saveChip?.source))

  await drive.evaluate(`document.querySelector('button[aria-label="Point at a part of the page"]')?.click()`)
  await sleep(400)
  const pwAt = await guest.evaluate(`(() => { const r = document.querySelector('#pw').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await guest.mouse(pwAt.x, pwAt.y)
  await drive.waitFor(`document.querySelector('.lc-pagepoint[data-selector="input#pw"]') !== null`, { timeoutMs: 15_000, what: 'the password chip' })
  await drive.evaluate(`(() => {
    const note = document.querySelector('.lc-pagepoint[data-selector="button#save"] .lc-pagepoint__note')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(note, 'the label sits tight against the edge')
    note.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(200)
  const held = JSON.parse(String(await drive.capture('both parts, before send', () => drive.evaluate(chips))))
  const password = held.find((chip) => chip.selector === 'input#pw')
  const noted = held.find((chip) => chip.selector === 'button#save')
  const body = String(await drive.evaluate(`document.body.innerText`))
  check('the password chip has no value and no picture of its contents', password?.picture === '' && /password field is not photographed/.test(password?.pictureNote ?? '') && !body.includes('s3cret-pass'), JSON.stringify(password))
  check('a note sits on the chip', noted?.note === 'the label sits tight against the edge', String(noted?.note))
  const sent = await drive.evaluate(threadHasPick)
  check('nothing was sent', sent === false, String(sent))
  guest.close()
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  server.close()
  await drive.finish({ intro: 'Dev build. A local page with a button and a password field. Nothing sent, and no model turn.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
