// Dependency-free per-run stdio MCP server for Locust's Browser panel.
// Spawned only for a single teammate run; never written to global agent configs.
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'

const NOT_RUNNING = 'Locust is not running. Open it and try again.'
const textResult = (text, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {})
})
const schema = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

const TOOLS = [
  {
    name: 'browser_open',
    description:
      'Open an http:, https:, localhost, or workspace file: address in the Locust Browser panel and return the page snapshot with [ref=e1] element references.',
    inputSchema: schema(
      {
        url: { type: 'string', minLength: 1, maxLength: 4000, description: 'URL or workspace-relative HTML path to open.' },
        tab_id: { type: 'string', maxLength: 120, description: 'Optional tab id to navigate, or "new" to open a new tab.' }
      },
      ['url']
    )
  },
  {
    name: 'browser_read',
    description:
      'Read the current browser tab: title, URL, interactive elements with [ref=e1] references, and visible text. Read only.',
    inputSchema: schema({
      tab_id: { type: 'string', maxLength: 120, description: 'Optional tab id to read.' }
    }),
    annotations: { readOnlyHint: true }
  },
  {
    name: 'browser_click',
    description:
      'Click an interactive element in the current browser tab by its ref (e.g. "e1" from browser_read). Form submits, purchases, sends, downloads, and leaving for an unvisited site ask the person in Locust first.',
    inputSchema: schema(
      {
        ref: { type: 'string', minLength: 1, maxLength: 64, description: 'Element reference from browser_read, such as "e1".' },
        tab_id: { type: 'string', maxLength: 120 }
      },
      ['ref']
    )
  },
  {
    name: 'browser_type',
    description:
      'Type text into an input or textarea by its ref (e.g. "e2" from browser_read). Password, token, and payment fields ask the person in Locust first.',
    inputSchema: schema(
      {
        ref: { type: 'string', minLength: 1, maxLength: 64, description: 'Element reference from browser_read, such as "e2".' },
        text: { type: 'string', maxLength: 8000, description: 'Text to enter into the field.' },
        submit: { type: 'boolean', description: 'Whether to press Enter after typing.' },
        tab_id: { type: 'string', maxLength: 120 }
      },
      ['ref', 'text']
    )
  },
  {
    name: 'browser_press',
    description:
      'Press a keyboard key (such as "Enter", "Tab", "Escape", "ArrowDown") in the current browser tab, optionally focusing ref first.',
    inputSchema: schema(
      {
        key: { type: 'string', minLength: 1, maxLength: 64, description: 'Key name such as Enter, Tab, Escape, ArrowDown.' },
        ref: { type: 'string', maxLength: 64, description: 'Optional element ref to focus first.' },
        tab_id: { type: 'string', maxLength: 120 }
      },
      ['key']
    )
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> dropdown by its ref and option value or label.',
    inputSchema: schema(
      {
        ref: { type: 'string', minLength: 1, maxLength: 64 },
        value: { type: 'string', minLength: 1, maxLength: 500 },
        tab_id: { type: 'string', maxLength: 120 }
      },
      ['ref', 'value']
    )
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the current browser tab up, down, to top, or to bottom.',
    inputSchema: schema({
      direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] },
      amount: { type: 'integer', minimum: 50, maximum: 5000 },
      tab_id: { type: 'string', maxLength: 120 }
    })
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a PNG screenshot of the current browser tab. Read only.',
    inputSchema: schema({
      tab_id: { type: 'string', maxLength: 120 }
    }),
    annotations: { readOnlyHint: true }
  },
  {
    name: 'browser_console',
    description: 'Read recent console messages (info, warning, error) from the current browser tab. Read only.',
    inputSchema: schema({
      tab_id: { type: 'string', maxLength: 120 }
    }),
    annotations: { readOnlyHint: true }
  },
  {
    name: 'browser_network',
    description: 'Read recent network requests and status codes from the current browser tab. Read only.',
    inputSchema: schema({
      tab_id: { type: 'string', maxLength: 120 }
    }),
    annotations: { readOnlyHint: true }
  },
  {
    name: 'browser_back',
    description: 'Navigate back in the current browser tab history.',
    inputSchema: schema({
      tab_id: { type: 'string', maxLength: 120 }
    })
  },
  {
    name: 'browser_forward',
    description: 'Navigate forward in the current browser tab history.',
    inputSchema: schema({
      tab_id: { type: 'string', maxLength: 120 }
    })
  },
  {
    name: 'browser_tabs',
    description: 'List open browser tabs, switch the active tab, open a new tab, or close a tab.',
    inputSchema: schema({
      action: { type: 'string', enum: ['list', 'select', 'new', 'close'] },
      tab_id: { type: 'string', maxLength: 120 },
      url: { type: 'string', maxLength: 4000 }
    })
  }
]

async function readConnection() {
  if (process.env.LOCUST_BROWSER_URL && process.env.LOCUST_BROWSER_TOKEN) {
    return {
      url: process.env.LOCUST_BROWSER_URL,
      token: process.env.LOCUST_BROWSER_TOKEN,
      missionId: process.env.LOCUST_BROWSER_MISSION_ID ?? '',
      teammate: process.env.LOCUST_BROWSER_TEAMMATE ?? ''
    }
  }
  if (process.argv[2]) {
    const raw = JSON.parse(await readFile(process.argv[2], 'utf8'))
    return {
      url: raw.url,
      token: raw.token,
      missionId: raw.missionId ?? '',
      teammate: raw.teammate ?? ''
    }
  }
  throw new Error('missing connection')
}

async function callLocustBrowser(name, args) {
  let conn
  try {
    conn = await readConnection()
    const parsed = new URL(conn.url)
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.pathname !== '/browser/call' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password ||
      !parsed.port ||
      typeof conn.token !== 'string' ||
      conn.token.length < 16
    ) {
      throw new Error('invalid')
    }
  } catch {
    return textResult(NOT_RUNNING, true)
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      token: conn.token,
      missionId: conn.missionId,
      teammate: conn.teammate,
      name,
      arguments: args ?? {}
    })
    const req = httpRequest(
      conn.url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${conn.token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        },
        timeout: 10 * 60 * 1000
      },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size <= 15 * 1024 * 1024) chunks.push(chunk)
          else res.destroy()
        })
        res.on('error', () => resolve(textResult("Locust's browser answer could not be read. Nothing was retried.", true)))
        res.on('end', () => {
          try {
            const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (Array.isArray(answer?.content)) {
              resolve(answer)
              return
            }
            resolve(textResult(answer?.message ?? 'Locust could not complete that browser action. Nothing was retried.', true))
          } catch {
            resolve(textResult("Locust's browser answer could not be read. Nothing was retried.", true))
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(textResult('Locust did not answer in time. Nothing was retried.', true))
    })
    req.on('error', (err) => {
      resolve(
        textResult(
          err.code === 'ECONNREFUSED'
            ? NOT_RUNNING
            : 'The connection to Locust ended without an answer. Nothing was retried.',
          true
        )
      )
    })
    req.end(payload)
  })
}

const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
const sendError = (id, code, message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += String(chunk)
  if (Buffer.byteLength(buffer) > 512 * 1024) {
    sendError(null, -32600, 'MCP request is too large. Nothing was started.')
    process.exitCode = 1
    process.stdin.destroy()
    return
  }
  let cut
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (!line) continue
    let rpc
    try {
      rpc = JSON.parse(line)
    } catch {
      sendError(null, -32700, 'Invalid JSON')
      continue
    }
    if (typeof rpc !== 'object' || rpc === null || rpc.jsonrpc !== '2.0') {
      sendError(null, -32600, 'Invalid request')
      continue
    }
    if (rpc.id === undefined) continue
    if (rpc.method === 'initialize') {
      const requested = rpc.params?.protocolVersion
      const protocolVersion = ['2024-11-05', '2025-03-26', '2025-06-18'].includes(requested) ? requested : '2025-06-18'
      send(rpc.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'locust_browser', version: '1.0.0' }
      })
      continue
    }
    if (rpc.method === 'ping') {
      send(rpc.id, {})
      continue
    }
    if (rpc.method === 'tools/list') {
      send(rpc.id, { tools: TOOLS })
      continue
    }
    if (rpc.method === 'tools/call') {
      const toolName = rpc.params?.name
      if (!TOOLS.some((t) => t.name === toolName)) {
        sendError(rpc.id, -32602, `Unknown browser tool: ${String(toolName)}`)
        continue
      }
      void callLocustBrowser(toolName, rpc.params?.arguments ?? {})
        .then((answer) => send(rpc.id, answer))
        .catch(() =>
          send(rpc.id, textResult('Locust could not complete that browser action. Nothing was retried.', true))
        )
      continue
    }
    sendError(rpc.id, -32601, 'Method not found')
  }
})
process.stdin.on('end', () => process.exit(0))
