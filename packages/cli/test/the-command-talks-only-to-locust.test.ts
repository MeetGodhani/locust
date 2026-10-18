import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LocustClient, profileDirectory, TextStream } from '../src/client.js'
import { fakeApp, session, TEAM } from './fake-app.js'

describe('the locust command', () => {
  it('uses Electron’s actual profile name on each operating system', () => {
    expect(profileDirectory('win32', { APPDATA: 'C:\\profile data' }, 'C:\\home')).toBe('C:\\profile data\\@teammate\\desktop')
    expect(profileDirectory('darwin', {}, '/home/test')).toBe('/home/test/Library/Application Support/@teammate/desktop')
    expect(profileDirectory('linux', {}, '/home/test')).toBe('/home/test/.config/@teammate/desktop')
    expect(profileDirectory('linux', { XDG_CONFIG_HOME: '/custom config' }, '/home/test')).toBe('/custom config/@teammate/desktop')
    expect(() => profileDirectory('win32', {}, 'C:\\home')).toThrow(/--profile/)
  })

  it('authenticates against a fake app and reads teammates and status', async () => {
    const app = await fakeApp(name => name === 'list_teammates' ? TEAM : { workspace: '/project', turns: [{ missionId: 'm1', teammate: 'One', state: 'waiting' }] })
    expect(await app.client.teammates()).toEqual(TEAM)
    expect((await app.client.status()).turns[0]?.state).toBe('waiting')
    expect(app.requests.map(r => r.name)).toEqual(['list_teammates', 'cli/status'])
  })

  it.each(['https://127.0.0.1:1234/tools/call', 'http://localhost:1234/tools/call', 'http://example.test:1234/tools/call', 'http://127.0.0.1:1234/elsewhere', 'http://person:secret@127.0.0.1:1234/tools/call', 'http://127.0.0.1:1234/tools/call?token=other'])('refuses a connection file naming %s', async url => {
    const app = await fakeApp(() => [])
    await writeFile(join(app.profile, 'locust-mcp-connection.json'), JSON.stringify({ url, token: 'a'.repeat(64) }))
    await expect(app.client.teammates()).rejects.toThrow(/Settings > General/)
    expect(app.requests).toEqual([])
  })

  it('explains a missing connection file without reading any other app', async () => {
    await expect(new LocustClient(fileURLToPath(new URL('./missing-test-profile', import.meta.url))).teammates()).rejects.toThrow(/not open.*server is off/)
  })

  it('does not follow a redirect with its token', async () => {
    const app = await fakeApp((_name, _args, res) => { res.writeHead(302, { location: 'https://example.test/' }).end() })
    await expect(app.client.teammates()).rejects.toThrow(/could not complete/)
    expect(app.requests).toHaveLength(1)
  })

  it('has an absolute deadline even when a server never finishes its reply', async () => {
    const app = await fakeApp((_name, _args, res) => { res.write('{') }, 50)
    await expect(app.client.teammates()).rejects.toThrow(/time|interrupted/)
    expect(app.requests).toHaveLength(1)
  })

  it('passes the server’s refusal through rather than retrying a start', async () => {
    const app = await fakeApp((_name, _args, res) => { res.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: 'Choose One or Two. Nothing was started.' }] })) })
    await expect(app.client.open('missing')).rejects.toThrow('Choose One or Two')
    expect(app.requests).toHaveLength(1)
  })

  it('prints incremental text once, not again for the final replacement', async () => {
    const connection = session()
    let poll = 0
    const app = await fakeApp(name => name === 'cli/poll' ? { turn: { requestId: 'p', phase: ++poll === 1 ? 'running' : 'completed' },
      events: poll === 1 ? [{ sequence: 1, itemId: 'a', operation: 'append', text: 'Hello' }] : [{ sequence: 2, itemId: 'a', operation: 'replace', text: 'Hello world' }], cursor: poll, approvals: [] } : { ok: true })
    const printed: string[] = [], stream = new TextStream(text => printed.push(text))
    expect(await app.client.prompt(connection, 'Say hello', { onText: event => stream.accept(event), pollMs: 1 })).toBe('end_turn')
    expect(printed).toEqual(['Hello', ' world'])
    expect(app.requests.filter(r => r.name === 'cli/prompt')).toHaveLength(1)
    expect(app.requests.findLast(r => r.name === 'cli/poll')?.args.after).toBe(1)
  })

  it('cancels only this prompt when interrupted while its start request is pending', async () => {
    const controller = new AbortController(), connection = session()
    const app = await fakeApp(async name => { if (name === 'cli/prompt') { controller.abort(); await new Promise(resolve => setTimeout(resolve, 20)) }; return { ok: true } })
    expect(await app.client.prompt(connection, 'Start', { signal: controller.signal, onText: () => undefined })).toBe('cancelled')
    const start = app.requests.find(r => r.name === 'cli/prompt')!, cancel = app.requests.find(r => r.name === 'cli/cancel')!
    expect(cancel.args.requestId).toBe(start.args.requestId)
    expect(cancel.args.sessionId).toBe(connection.sessionId)
  })

  it('does not start an already-cancelled prompt', async () => {
    const app = await fakeApp(() => ({})), controller = new AbortController()
    controller.abort()
    expect(await app.client.prompt(session(), 'Do not send', { signal: controller.signal, onText: () => undefined })).toBe('cancelled')
    expect(app.requests).toEqual([])
  })

  it('cancels an uncertain turn when reading its reply fails', async () => {
    const app = await fakeApp((name, _args, res) => name === 'cli/poll' ? void res.end('not json') : { ok: true })
    await expect(app.client.prompt(session(), 'Start', { onText: () => undefined })).rejects.toThrow(/unreadable/)
    expect(app.requests.map(r => r.name)).toEqual(['cli/prompt', 'cli/poll', 'cli/cancel'])
  })

  it('does not silently duplicate text that an agent rewrote', () => {
    const stream = new TextStream(() => undefined)
    stream.accept({ sequence: 1, itemId: 'a', operation: 'append', text: 'old' })
    expect(() => stream.accept({ sequence: 2, itemId: 'a', operation: 'replace', text: 'new' })).toThrow(/revised/)
  })

  it('runs the built teammates command without a live app or a global install', async () => {
    const app = await fakeApp(() => TEAM)
    const output = await new Promise<{ code: number | null; text: string; errors: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/locust.mjs', import.meta.url)), '--profile', app.profile, 'teammates'], { windowsHide: true })
      let text = '', errors = ''
      child.stdout.on('data', chunk => { text += String(chunk) }); child.stderr.on('data', chunk => { errors += String(chunk) })
      child.once('error', reject); child.once('close', code => resolve({ code, text, errors }))
    })
    expect(output.code).toBe(0)
    expect(output.text).toContain('One\tmate-one\tcodex\ttest-model')
    expect(output.errors).toBe('')
  })
})
