import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../src/acp.js'
import { fakeApp, session, TEAM, type Fields } from './fake-app.js'

const agents: ReturnType<typeof createAcpAgent>[] = []
const WORKSPACE = fileURLToPath(new URL('.', import.meta.url))
afterEach(async () => { await Promise.all(agents.splice(0).map(agent => agent.close())) })
const card = { approvalId: 'approval-one', kind: 'command', summary: 'Run the check', detail: 'echo check', cwd: '/project', answerInLocust: false }

async function editor(script: (name: string, args: Fields) => unknown = () => ({}), teammate?: string) {
  const connections: ReturnType<typeof session>[] = []
  const app = await fakeApp((name, args) => {
    if (name === 'list_teammates') return TEAM
    if (name === 'cli/open') {
      const connection = session(`session-${connections.length + 1}`, TEAM.find(t => t.id === args.teammate || t.name === args.teammate) ?? TEAM[0]!)
      connections.push(connection)
      return connection
    }
    return script(name, args)
  })
  const messages: Fields[] = []
  const agent = createAcpAgent({ client: app.client, send: message => messages.push(message), ...(teammate === undefined ? {} : { teammate }), permissionTimeoutMs: 2_000 })
  agents.push(agent)
  const send = (id: number, method: string, params: Fields = {}) => agent.accept(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  const response = async (id: number): Promise<Fields> => {
    await vi.waitFor(() => expect(messages.some(m => m.id === id && ('result' in m || 'error' in m))).toBe(true), { timeout: 4_000, interval: 5 })
    return messages.find(m => m.id === id && ('result' in m || 'error' in m))!
  }
  send(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })
  await response(1)
  return { ...app, agent, messages, send, response, connections,
    open: async (id = 2) => { send(id, 'session/new', { cwd: WORKSPACE, mcpServers: [] }); return (await response(id)).result as { sessionId: string; configOptions: Fields[] } } }
}

describe('Locust as an ACP agent', () => {
  it('offers text only, no editor files or terminal, and starts nothing during setup', async () => {
    const e = await editor()
    const init = (await e.response(1)).result as Fields
    expect(init.agentCapabilities).toEqual({ loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false }, mcpCapabilities: { http: false, sse: false } })
    const opened = await e.open()
    expect(opened.configOptions[0]?.currentValue).toBe(TEAM[0]!.id)
    expect(e.requests.map(r => r.name)).toEqual(['list_teammates', 'cli/open'])
    expect(JSON.stringify(e.messages)).not.toContain(e.connections[0]!.key)
  })

  it('selects a teammate by flag or config option before sending', async () => {
    const e = await editor(undefined, 'Two'), opened = await e.open()
    expect(opened.configOptions[0]?.currentValue).toBe('mate-two')
    e.send(3, 'session/set_config_option', { sessionId: opened.sessionId, configId: 'teammate', value: 'mate-one' })
    expect(((await e.response(3)).result as Fields).configOptions).toMatchObject([{ currentValue: 'mate-one' }])
    e.send(4, 'session/set_config_option', { sessionId: opened.sessionId, configId: 'teammate', value: 'mate-two' })
    expect(((await e.response(4)).result as Fields).configOptions).toMatchObject([{ currentValue: 'mate-two' }])
    expect(e.requests.filter(r => r.name === 'cli/prompt')).toEqual([])
  })

  it('streams a reply and keeps the conversation for a second prompt', async () => {
    let poll = 0
    const e = await editor(name => name === 'cli/poll' ? { turn: { phase: 'completed' }, events: [{ sequence: 1, itemId: 'a', operation: 'replace', text: `Reply ${++poll}` }], cursor: 1, approvals: [] } : { ok: true })
    const opened = await e.open()
    e.send(3, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'First' }] })
    expect((await e.response(3)).result).toEqual({ stopReason: 'end_turn' })
    e.send(4, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'Second' }] })
    expect((await e.response(4)).result).toEqual({ stopReason: 'end_turn' })
    expect(e.messages.filter(m => m.method === 'session/update').map(m => ((m.params as Fields).update as Fields).content)).toEqual([{ type: 'text', text: 'Reply 1' }, { type: 'text', text: 'Reply 2' }])
    expect(e.requests.filter(r => r.name === 'cli/prompt').map(r => r.args.sessionId)).toEqual([opened.sessionId, opened.sessionId])
    e.send(5, 'session/set_config_option', { sessionId: opened.sessionId, configId: 'teammate', value: 'mate-two' })
    expect((await e.response(5)).error).toMatchObject({ code: -32602 })
  })

  it.each(['allow', 'deny', 'not-an-option', 'cancelled'])('maps permission outcome %s to at most one once-only decision', async option => {
    let answered = false
    const e = await editor((name, args) => {
      if (name === 'cli/decide') { answered = true; return { ok: true } }
      if (name === 'cli/poll') return { turn: { phase: answered ? 'completed' : 'running' }, events: [], cursor: 0, approvals: answered ? [] : [card] }
      return { ok: true }
    })
    const opened = await e.open()
    e.send(3, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'Check it' }] })
    await vi.waitFor(() => expect(e.messages.some(m => m.method === 'session/request_permission')).toBe(true))
    const request = e.messages.find(m => m.method === 'session/request_permission')!
    expect((request.params as Fields).options).toEqual([{ optionId: 'allow', kind: 'allow_once', name: 'Allow once' }, { optionId: 'deny', kind: 'reject_once', name: 'Deny' }])
    e.agent.accept(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { outcome: option === 'cancelled' ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: option } } }))
    expect((await e.response(3)).result).toEqual({ stopReason: 'end_turn' })
    expect(e.requests.filter(r => r.name === 'cli/decide').map(r => r.args.approve)).toEqual([option === 'allow'])
  })

  it('cancels while a permission is open and ignores its late Allow', async () => {
    const e = await editor(name => name === 'cli/poll' ? { turn: { phase: 'running' }, events: [], cursor: 0, approvals: [card] } : { ok: true })
    const opened = await e.open()
    e.send(3, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'Check' }] })
    await vi.waitFor(() => expect(e.messages.some(m => m.method === 'session/request_permission')).toBe(true))
    const request = e.messages.find(m => m.method === 'session/request_permission')!
    e.agent.accept(JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: opened.sessionId } }))
    expect((await e.response(3)).result).toEqual({ stopReason: 'cancelled' })
    e.agent.accept(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { outcome: { outcome: 'selected', optionId: 'allow' } } }))
    expect(e.requests.filter(r => r.name === 'cli/cancel')).toHaveLength(1)
    expect(e.requests.filter(r => r.name === 'cli/decide')).toEqual([])
  })

  it('does not turn a question into permission to act', async () => {
    let polls = 0
    const e = await editor(name => name === 'cli/poll' ? { turn: { phase: ++polls === 1 ? 'running' : 'completed' }, events: [], cursor: 0, approvals: polls === 1 ? [{ ...card, kind: 'question', answerInLocust: true }] : [] } : { ok: true })
    const opened = await e.open()
    e.send(3, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'Ask' }] })
    await e.response(3)
    expect(e.messages.some(m => m.method === 'session/request_permission')).toBe(false)
    expect(JSON.stringify(e.messages)).toContain('Waiting for you in Locust: Run the check')
    expect(e.requests.filter(r => r.name === 'cli/decide')).toEqual([])
  })

  it('leaves an approval in Locust while the person has not let editors answer', async () => {
    let polls = 0
    const e = await editor(name => name === 'cli/poll' ? { turn: { phase: ++polls === 1 ? 'running' : 'completed' }, events: [], cursor: 0, approvals: polls === 1 ? [{ ...card, answerInLocust: true }] : [] } : { ok: true })
    const opened = await e.open()
    e.send(3, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'Check' }] })
    await e.response(3)
    expect(e.messages.some(m => m.method === 'session/request_permission')).toBe(false)
    expect(JSON.stringify(e.messages)).toContain('Waiting for you in Locust: Run the check')
    expect(e.requests.filter(r => r.name === 'cli/decide')).toEqual([])
  })

  it('rejects concurrent prompts instead of starting two turns', async () => {
    const e = await editor(name => name === 'cli/poll' ? { turn: { phase: 'running' }, events: [], cursor: 0, approvals: [] } : { ok: true })
    const opened = await e.open()
    e.send(3, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'First' }] })
    e.send(4, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'Second' }] })
    expect((await e.response(4)).error).toMatchObject({ code: -32600 })
    await e.agent.close()
    expect(e.requests.filter(r => r.name === 'cli/prompt')).toHaveLength(1)
    expect(e.requests.filter(r => r.name === 'cli/cancel')).toHaveLength(1)
  })

  it('rejects files, editor MCP programs and unknown sessions before starting', async () => {
    const e = await editor(), opened = await e.open()
    e.send(3, 'session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'resource_link', uri: 'file:///private' }] })
    e.send(4, 'session/prompt', { sessionId: 'not-owned', prompt: [{ type: 'text', text: 'No' }] })
    e.send(5, 'session/new', { cwd: WORKSPACE, mcpServers: [{ command: 'do-not-run' }] })
    expect((await e.response(3)).error).toMatchObject({ code: -32602 })
    expect((await e.response(4)).error).toMatchObject({ code: -32602 })
    expect((await e.response(5)).error).toMatchObject({ code: -32602 })
    expect(e.requests.filter(r => r.name === 'cli/prompt')).toEqual([])
  })

  it('rejects malformed JSON and methods without sending hidden turns', async () => {
    const e = await editor()
    e.agent.accept('{broken')
    e.agent.accept(JSON.stringify({ jsonrpc: '2.0', method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'Hidden' }] } }))
    e.send(9, 'fs/write_text_file', { path: '/private', content: 'no' })
    expect(e.messages.some(m => (m.error as Fields | undefined)?.code === -32700)).toBe(true)
    expect((await e.response(9)).error).toMatchObject({ code: -32601 })
    expect(e.requests).toEqual([])
  })

  it('speaks newline-framed JSON on real stdio and stops its turn on EOF', async () => {
    const connection = session()
    const app = await fakeApp(name => name === 'list_teammates' ? TEAM : name === 'cli/open' ? connection : name === 'cli/poll'
      ? { turn: { phase: 'running' }, cursor: 0, events: [], approvals: [] } : { ok: true })
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/locust.mjs', import.meta.url)), '--profile', app.profile, 'acp'], { windowsHide: true })
    let output = '', errors = ''
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += String(chunk) })
    child.stderr.on('data', chunk => { errors += String(chunk) })
    const ended = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`)
      await vi.waitFor(() => expect(output).toContain('protocolVersion'), { timeout: 4_000 })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: WORKSPACE, mcpServers: [] } })}\n`)
      await vi.waitFor(() => expect(output).toContain('configOptions'), { timeout: 4_000 })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: connection.sessionId, prompt: [{ type: 'text', text: 'Start' }] } })}\n`)
      await vi.waitFor(() => expect(app.requests.some(r => r.name === 'cli/poll')).toBe(true), { timeout: 4_000 })
      child.stdin.end()
      expect(await ended).toBe(0)
      expect(app.requests.some(r => r.name === 'cli/cancel')).toBe(true)
      expect(app.requests.some(r => r.name === 'cli/close')).toBe(true)
      expect(output.trim().split('\n').every(line => (JSON.parse(line) as Fields).jsonrpc === '2.0')).toBe(true)
      expect(output).not.toContain(connection.key)
      expect(errors).toBe('')
    } finally { if (child.exitCode === null) { child.stdin.end(); child.kill(); await ended } }
  })
})
