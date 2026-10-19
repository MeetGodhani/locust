// Packaged Windows browser panel + per-run MCP browser tools + ask-first approval cards.
// Uses a local HTTP server and a local ACP test agent in a temp dir — zero model spend, zero account dependencies.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTeammateScript, pickRouteScript, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
assert.equal(process.platform, 'win32', 'this drive checks the packaged Windows desktop app')

const tempRoot = await mkdtemp(join(tmpdir(), 'locust-browser-drive-'))
const workspace = await scratchRepository('locust-browser-ws-')
await writeFile(join(workspace, 'hello.html'), '<!doctype html><html><head><title>Workspace File</title></head><body><h1>Inside Workspace</h1></body></html>', 'utf8')
await writeFile(join(tempRoot, 'outside.html'), '<!doctype html><html><head><title>Outside</title></head><body><h1>Outside</h1></body></html>', 'utf8')

// Local HTTP fixture server
let formSubmitted = false
const httpServer = createServer((req, res) => {
  const url = req.url ?? '/'
  if (url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ pong: true }))
    return
  }
  if (url.startsWith('/submit')) {
    formSubmitted = true
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><head><title>Submitted</title></head><body><p>Form submitted</p></body></html>')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html>
<head>
  <title>Locust Browser Fixture</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #14161b; color: #eef0f4; margin: 0; padding: 20px; }
    h1 { font-size: 18px; margin: 0 0 12px; color: #ffffff; }
    .row { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
    input { background: #1e222a; border: 1px solid #343b48; color: #eef0f4; border-radius: 6px; padding: 6px 10px; }
    button { background: #2b6cb0; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
    #count-out { font-weight: 600; color: #63b3ed; margin: 8px 0 14px; }
    form { border-top: 1px solid #282e38; padding-top: 12px; display: flex; gap: 10px; align-items: center; }
  </style>
</head>
<body>
  <h1>Fixture Ready</h1>
  <div class="row">
    <label>Search <input id="search-box" type="search" aria-label="Search docs" placeholder="Search docs" /></label>
    <button id="count-btn" type="button" onclick="window.__clicks = (window.__clicks || 0) + 1; document.getElementById('count-out').textContent = 'Clicks: ' + window.__clicks; console.log('fixture-clicked-' + window.__clicks); fetch('/api/ping');">Count Click</button>
  </div>
  <p id="count-out">Clicks: 0</p>
  <form id="login-form" action="/submit" method="get" onsubmit="window.__submitted = true;">
    <label>Password <input id="pw-box" type="password" name="password" aria-label="Account password" /></label>
    <button id="signin-btn" type="submit">Sign in</button>
  </form>
</body>
</html>`)
})

await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
const httpPort = httpServer.address().port
const fixtureUrl = `http://127.0.0.1:${String(httpPort)}/`

// Write a local ACP agent script that spawns the per-run `locust-browser` MCP bridge from `session/new`
// and exercises browser_open, browser_read, browser_type (normal), browser_click (normal),
// browser_console, browser_network, browser_screenshot, browser_type (password -> asks first),
// and browser_click (Sign in -> asks first).
const agentLogPath = join(tempRoot, 'agent-log.txt')
const mockAcpScript = join(tempRoot, 'mock-acp-browser-agent.mjs')
await writeFile(
  mockAcpScript,
  `import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const log = (line) => {
  try { appendFileSync(${JSON.stringify(agentLogPath)}, line + '\\n', 'utf8') } catch {}
}
log('agent spawned argv=' + JSON.stringify(process.argv))

let mcpServers = []
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n')
}

async function runMcpClient(serverSpec, url) {
  log('runMcpClient spec=' + JSON.stringify({ command: serverSpec.command, args: serverSpec.args }))
  const env = { ...process.env }
  for (const item of serverSpec.env ?? []) {
    if (item && typeof item.name === 'string' && typeof item.value === 'string') {
      env[item.name] = item.value
    }
  }
  const child = spawn(serverSpec.command, serverSpec.args ?? [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stderr.on('data', (d) => log('bridge stderr: ' + String(d).trim()))
  child.on('exit', (code) => log('bridge exit: ' + String(code)))
  const childRl = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1
  childRl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const msg = JSON.parse(trimmed)
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    } catch {}
  })
  const call = (method, params) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n')
  })
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } })
  log('bridge initialized')
  const callTool = async (name, args) => {
    log('calling tool ' + name + ' ' + JSON.stringify(args))
    const res = await call('tools/call', { name, arguments: args })
    log('tool result ' + name + ' ' + JSON.stringify(res).slice(0, 300))
    return res.result ?? res.error
  }
  try {
    await callTool('browser_open', { url })
    const read1 = await callTool('browser_read', {})
    const text1 = read1?.content?.[0]?.text ?? ''
    const findRef = (pattern) => {
      for (const line of text1.split('\\n')) {
        if (pattern.test(line)) {
          const m = /\\[ref=(@?e\\d+)\\]/.exec(line)
          if (m) return m[1]
        }
      }
      return undefined
    }
    const searchRef = findRef(/Search docs/i)
    const countRef = findRef(/Count Click/i)
    const pwRef = findRef(/Account password/i)
    const signInRef = findRef(/Sign in/i)

    // 1. Safe type + click (no approval needed)
    const typeSafe = await callTool('browser_type', { ref: searchRef, text: 'hello query' })
    const clickSafe = await callTool('browser_click', { ref: countRef })
    const read2 = await callTool('browser_read', {})
    const consoleOut = await callTool('browser_console', {})
    const netOut = await callTool('browser_network', {})
    const shotOut = await callTool('browser_screenshot', {})

    // 2. Sensitive password field -> raises approval card (user allows once)
    const pwResult = await callTool('browser_type', { ref: pwRef, text: 's3cret-pass' })

    // 3. Submit button -> raises approval card (user denies)
    const submitResult = await callTool('browser_click', { ref: signInRef })

    return {
      refs: { searchRef, countRef, pwRef, signInRef },
      typeSafeError: Boolean(typeSafe?.isError),
      clickSafeError: Boolean(clickSafe?.isError),
      readAfterClick: (read2?.content?.[0]?.text ?? '').includes('Clicks: 1'),
      consoleSeen: (consoleOut?.content?.[0]?.text ?? '').includes('fixture-clicked-1'),
      netSeen: (netOut?.content?.[0]?.text ?? '').includes('/api/ping'),
      hasScreenshot: (shotOut?.content ?? []).some((c) => c.type === 'image' && typeof c.data === 'string' && c.data.length > 100),
      pwAllowed: !pwResult?.isError,
      submitDenied: Boolean(submitResult?.isError)
    }
  } finally {
    child.kill()
  }
}

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try { msg = JSON.parse(trimmed) } catch { return }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: 'BrowserVerifier', version: '1.0.0' }
      }
    })
  } else if (msg.method === 'session/new') {
    mcpServers = Array.isArray(msg.params?.mcpServers) ? msg.params.mcpServers : []
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId: 'sess-browser-1',
        configOptions: [
          {
            id: 'model',
            category: 'model',
            currentValue: 'opencode/verifier-free',
            options: [{ value: 'opencode/verifier-free', name: 'Verifier Free' }]
          }
        ]
      }
    })
  } else if (msg.method === 'session/set_config_option') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
  } else if (msg.method === 'session/prompt') {
    const browserServer = mcpServers.find((s) => s.name === 'locust-browser' || s.name === 'locust_browser')
    if (!browserServer) {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-browser-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'NO_BROWSER_MCP' } } } })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }
    const summary = await runMcpClient(browserServer, ${JSON.stringify(fixtureUrl)})
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-browser-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'BROWSER_REPORT:' + JSON.stringify(summary) }
        }
      }
    })
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
  }
})
`,
  'utf8'
)

const profilePath = await mkdtemp(join(tmpdir(), 'locust-browser-profile-'))
const agentCommandLine = `"${process.execPath}" "${mockAcpScript}"`
await writeFile(
  join(profilePath, 'acp-agents.json'),
  JSON.stringify(
    {
      agents: [
        {
          id: 'acp_browser-verifier',
          name: 'BrowserVerifier',
          commandLine: agentCommandLine,
          answer: {
            agentName: 'BrowserVerifier',
            version: '1.0.0',
            modelOption: {
              id: 'model',
              current: 'opencode/verifier-free',
              models: [{ value: 'opencode/verifier-free', name: 'Verifier Free' }]
            }
          },
          testedAt: '2026-10-18T00:00:00.000Z'
        }
      ]
    },
    null,
    2
  ),
  'utf8'
)

const drive = await startDrive({
  name: 'agent-browser',
  port: 9889,
  workspace,
  profilePath,
  sendsNothing: true,
  focused: true,
  ...(packaged ? { packaged } : {}),
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_browser',
        name: 'Navi',
        hue: 'teal',
        role: 'Code & Migrations',
        createdAt: '2026-10-18T00:00:00.000Z',
        route: {
          runtime: 'acp',
          model: 'acp_browser-verifier::opencode/verifier-free',
          mode: 'approve-each'
        }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})

const checks = []
let failures = 0
const check = (claim, actual, detail) => {
  const ok = Boolean(actual)
  checks.push({ claim, ok, ...(detail === undefined ? {} : { detail }) })
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${claim}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
  assert.ok(ok, `${claim}${detail === undefined ? '' : ` (${String(detail)})`}`)
}

try {
  await drive.ready()
  await drive.resize(1200, 720)

  check(
    'Browser toggle is available in the window before a message',
    await drive.evaluate(`Boolean(document.querySelector('button[aria-label="Browser"]'))`)
  )

  // Open the Browser panel
  await drive.evaluate(`document.querySelector('button[aria-label="Browser"]').click()`)
  await drive.waitFor(`Boolean(document.querySelector('.lc-browser:not([hidden])'))`, {
    timeoutMs: 10000,
    what: 'Browser panel visible'
  })
  check(
    'Browser panel shows its isolated session label and address bar',
    await drive.evaluate(
      `Boolean(document.querySelector('.lc-browser__partition')) && Boolean(document.querySelector('.lc-browser__address'))`
    )
  )

  // Navigate to workspace file ./hello.html
  const navWorkspace = await drive.evaluate(
    `window.desktop.browser.navigate('./hello.html').then(r => JSON.stringify({ ok: r.ok, url: r.state.tabs[0]?.url, title: r.state.tabs[0]?.title }))`
  )
  const parsedWorkspaceNav = JSON.parse(String(navWorkspace))
  check('Browser opens a file inside the conversation folder', parsedWorkspaceNav.ok === true && /hello\.html$/i.test(parsedWorkspaceNav.url), navWorkspace)

  // Attempt to navigate outside workspace (../outside.html) -> refused and current page stays open
  const navOutside = JSON.parse(
    String(
      await drive.evaluate(
        `window.desktop.browser.navigate('../outside.html').then(r => JSON.stringify({ ok: r.ok, message: r.message, url: r.state.tabs[0]?.url }))`
      )
    )
  )
  check(
    'Browser refuses a file outside the conversation folder and keeps the current page open',
    navOutside.ok === false && /hello\.html$/i.test(navOutside.url),
    JSON.stringify(navOutside)
  )

  // Navigate to the local HTTP fixture
  const navHttp = JSON.parse(
    String(
      await drive.evaluate(
        `window.desktop.browser.navigate(${JSON.stringify(fixtureUrl)}).then(r => JSON.stringify({ ok: r.ok, title: r.state.tabs[0]?.title, url: r.state.tabs[0]?.url }))`
      )
    )
  )
  check('Browser opens the local HTTP fixture in its isolated WebContentsView', navHttp.ok === true, JSON.stringify(navHttp))
  await sleep(600)
  await drive.capture('Browser panel beside conversation on local HTTP fixture', async () =>
    drive.evaluate(`document.querySelector('.lc-browser__tab [role="tab"]')?.textContent ?? ''`)
  )

  // Open Navi's conversation and trigger the ACP turn that uses the per-run locust-browser MCP server
  await drive.evaluate(`window.desktop.acpAgents.save('BrowserVerifier', ${JSON.stringify(agentCommandLine)}).catch(() => undefined)`)
  await sleep(400)
  await drive.evaluate(openTeammateScript('Navi'))
  await sleep(500)
  const pickedRoute = await drive.evaluate(pickRouteScript({ group: '/BrowserVerifier/i', search: 'Verifier Free', row: '/Verifier Free/i' }))
  say(`  picked route: ${String(pickedRoute)}`)
  await sleep(500)
  // Re-open Browser panel beside Navi's conversation
  await drive.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button[aria-label="Browser"]')].at(-1)
    if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click()
  })()`)
  await sleep(400)

  const sent = await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Exercise the browser tools on the fixture page.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 150))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'not-sent'
  })()`)
  check('Sent prompt to teammate Navi', sent === 'sent', sent)

  // Wait for first approval card (typing into password field)
  await drive.waitFor(
    `Boolean(document.querySelector('[role="group"][aria-label="Approval required"]'))`,
    { timeoutMs: 25000, what: 'password approval card' }
  )
  const firstCardText = String(
    await drive.evaluate(
      `(document.querySelector('[role="group"][aria-label="Approval required"]')?.innerText ?? '').replace(/\\s+/g, ' ')`
    )
  )
  check(
    'Typing into a password field raises an approval card in the conversation before acting',
    /Account password|credential|sensitive/i.test(firstCardText),
    firstCardText
  )
  await drive.capture('Approval card before typing into password field', async () => firstCardText)

  // Allow once on the password card
  await drive.evaluate(
    `[...document.querySelectorAll('[role="group"][aria-label="Approval required"] button')].find((b) => /^Allow once|^Approve once|^Allow$/.test(b.innerText.trim()))?.click()`
  )

  // Wait for second approval card (clicking Sign in submit button)
  await sleep(600)
  await drive.waitFor(
    `Boolean(document.querySelector('[role="group"][aria-label="Approval required"]'))`,
    { timeoutMs: 25000, what: 'submit approval card' }
  )
  const secondCardText = String(
    await drive.evaluate(
      `(document.querySelector('[role="group"][aria-label="Approval required"]')?.innerText ?? '').replace(/\\s+/g, ' ')`
    )
  )
  check(
    'Clicking Sign in raises an approval card in the conversation before submitting',
    /Sign in|Submit/i.test(secondCardText),
    secondCardText
  )
  await drive.capture('Approval card before submitting Sign in form', async () => secondCardText)

  // Deny the Sign in submission
  await drive.evaluate(`(() => {
    const button = [...document.querySelectorAll('[role="group"][aria-label="Approval required"] button')].find((b) => /^Deny/.test(b.innerText.trim()))
    button?.click()
    setTimeout(() => {
      const confirm = [...document.querySelectorAll('[role="group"][aria-label="Approval required"] button, .lc-card button')].find((b) => /^Deny$/.test(b.innerText.trim()) && b !== button)
      confirm?.click()
    }, 250)
  })()`)

  // Wait for turn to finish and output BROWSER_REPORT
  await drive.waitFor(
    `/BROWSER_REPORT:\\{/.test(document.querySelector('.lc-thread')?.innerText ?? '')`,
    { timeoutMs: 25000, what: 'BROWSER_REPORT in thread' }
  )
  const threadText = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText ?? ''`))
  const reportMatch = /BROWSER_REPORT:(\{[^\n]+\})/.exec(threadText)
  const report = reportMatch ? JSON.parse(reportMatch[1]) : null
  check('Teammate received @eN refs from browser_read', Boolean(report?.refs?.searchRef && report?.refs?.countRef && report?.refs?.pwRef && report?.refs?.signInRef), JSON.stringify(report))
  check('Safe type and click succeeded without approval cards', report?.typeSafeError === false && report?.clickSafeError === false && report?.readAfterClick === true, JSON.stringify(report))
  check('browser_console and browser_network returned live page logs and requests', report?.consoleSeen === true && report?.netSeen === true, JSON.stringify(report))
  check('browser_screenshot captured a real PNG from the WebContentsView', report?.hasScreenshot === true, JSON.stringify(report))
  check('Password field succeeded after Allow once, and Sign in was blocked after Deny', report?.pwAllowed === true && report?.submitDenied === true && formSubmitted === false, JSON.stringify(report))
} finally {
  const agentLog = await readFile(agentLogPath, 'utf8').catch(() => '(no agent log)')
  const uiThread = await drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? document.body.innerText ?? '').slice(0, 1200)`).catch(() => '(no ui)')
  if (failures > 0 || !checks.some((c) => c.claim.startsWith('Password field'))) {
    say(`  agentLog:\n${agentLog}`)
    say(`  uiThread:\n${String(uiThread)}`)
  }
  httpServer.close()
  await writeFile(join(drive.out, 'checks.json'), JSON.stringify(checks, null, 2)).catch(() => undefined)
  await drive.finish({ intro: 'Packaged Windows agent browser panel and per-run MCP tools. Zero model spend.', extra: JSON.stringify(checks, null, 2) })
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  await rm(profilePath, { recursive: true, force: true }).catch(() => undefined)
}
