import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { voiceCallAsk, voiceCallInstructions, voiceThreadConfig } from '../shared/voice-call.js'
import { callFolderTools } from './voice-call-folder.js'

/*
 * A VOICE CALL READS THE FOLDER ITSELF, AND USES YOUR CONNECTORS (0.742). Colin, 2026-10-11, in a call: "local
 * reads failed with approval request, no approval field in locust", then "want to be able to do simple things
 * like check gmail by asking but then i also want to be able to hand off larger tasks".
 */
const NO_TOOLS = { 'features.shell_tool': false, 'features.browser_use': false, 'features.browser_use_external': false, 'features.in_app_browser': false, 'features.computer_use': false } as const
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-call-folder-'))
  roots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'login.ts'), 'export function login() {\n  // TODO: check the password\n  return true\n}\n')
  await writeFile(join(root, 'README.md'), '# Acme\nThe login page is in src/login.ts.\n')
  await writeFile(join(root, '.env'), 'SECRET=hunter2\n')
  await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))
  return root
}
const said = (result: { readonly content: readonly { readonly text: string }[]; readonly isError?: boolean }) => ({ text: result.content.map((part) => part.text).join(''), error: result.isError === true })
// The walk, not git: the folder is not a repository.
const noGit = async () => undefined

describe('the call’s folder tools', () => {
  it('finds files by their path, and never lists a file of secrets', async () => {
    const root = await folder()
    const { listWorkspaceFiles } = await import('./workspace-files.js')
    const tools = callFolderTools(() => root, (at) => listWorkspaceFiles(at, { git: noGit }))
    const all = said(await tools('find_files', {}))
    expect(all.text.split('\n').sort()).toEqual(['README.md', 'logo.png', 'src/login.ts'])
    expect(said(await tools('find_files', { query: 'LOGIN' })).text).toBe('src/login.ts')
    expect(said(await tools('find_files', { query: 'nothing-here' })).text).toBe('No file\'s path has "nothing-here" in it.')
  })

  it('reads a text file in the folder, and refuses secrets, binaries and anything outside it', async () => {
    const root = await folder()
    const tools = callFolderTools(() => root)
    const read = said(await tools('read_file', { path: 'src/login.ts' }))
    expect(read.error).toBe(false)
    expect(read.text).toContain('src/login.ts, lines 1-5 of 5.')
    expect(read.text).toContain('// TODO: check the password')
    expect(said(await tools('read_file', { path: 'src/login.ts', from_line: 3 })).text).toContain('lines 3-5 of 5')
    expect(said(await tools('read_file', { path: '.env' }))).toEqual({ text: 'That file holds secrets, so a call never reads it.', error: true })
    expect(said(await tools('read_file', { path: 'logo.png' }))).toEqual({ text: 'logo.png is not text, so a call cannot read it out.', error: true })
    expect(said(await tools('read_file', { path: '../outside.txt' })).error).toBe(true)
    expect(said(await tools('read_file', { path: 'C:\\Windows\\win.ini' }))).toEqual({ text: 'Give the path inside the folder, like src/app.ts.', error: true })
    expect(said(await tools('read_file', { path: 'missing.ts' }))).toEqual({ text: 'There is no missing.ts in the folder.', error: true })
  })

  it('searches the folder’s text, never a file of secrets', async () => {
    const root = await folder()
    const { listWorkspaceFiles } = await import('./workspace-files.js')
    const tools = callFolderTools(() => root, (at) => listWorkspaceFiles(at, { git: noGit }))
    expect(said(await tools('search_files', { text: 'login' })).text.split('\n').sort()).toEqual(['README.md:2: The login page is in src/login.ts.', 'src/login.ts:1: export function login() {'])
    expect(said(await tools('search_files', { text: 'hunter2' })).text).toMatch(/is in none of the \d+ files searched/)
  })

  it('needs a folder open, and does nothing else', async () => {
    expect(said(await callFolderTools(() => undefined)('find_files', {}))).toEqual({ text: 'No folder is open in Locust.', error: true })
    const root = await folder()
    expect(said(await callFolderTools(() => root)('write_file', { path: 'a' })).error).toBe(true)
  })
})

describe('the call’s copy of Locust’s add-on', () => {
  const bridge = fileURLToPath(new URL('../../resources/locust-mcp-bridge.mjs', import.meta.url))
  const list = (extra: readonly string[]) => new Promise<readonly { name: string; annotations?: { readOnlyHint?: boolean } }[]>((resolve, reject) => {
    const child = spawn(process.execPath, [bridge, join(tmpdir(), 'no-connection.json'), ...extra], { stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
      const line = out.split('\n').find((entry) => entry.includes('"id":1'))
      if (line === undefined) return
      child.kill()
      resolve((JSON.parse(line) as { result: { tools: { name: string }[] } }).result.tools)
    })
    child.on('error', reject)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`)
  })

  it('lists the hand-off tools and the folder’s, each that only reads marked so, so Codex asks nothing for them', async () => {
    const tools = await list(['call'])
    expect(tools.map((tool) => tool.name).sort()).toEqual(['find_files', 'list_background_runs', 'list_teammates', 'read_file', 'read_reply', 'search_files', 'send_message', 'start_conversation'])
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name).sort()
    expect(readOnly).toEqual(['find_files', 'list_background_runs', 'list_teammates', 'read_file', 'read_reply', 'search_files'])
  })

  it('leaves another app’s list as it was: no folder tools there', async () => {
    const names = (await list([])).map((tool) => tool.name)
    expect(names).not.toContain('read_file')
    expect(names).toContain('run_routine')
  })
})

describe('your connectors in the call', () => {
  it('stay on, with plugins, hooks and notify still off, and a clash with the call’s own name still refused', () => {
    // A service at an address stays on, whatever its name; a program this computer runs is switched off (node_repl
    // ran JavaScript here with no question, measured 2026-10-11).
    expect(voiceThreadConfig({ mcp_servers: { robinhood: { url: 'https://agent.robinhood.com/mcp/trading' }, 'my.service': { url: 'https://example.com/mcp' }, node_repl: { command: 'node_repl.exe' } } }, undefined, { connectors: true })).toEqual({
      ok: true,
      config: { 'features.plugins': false, 'features.hooks': false, notify: [], ...NO_TOOLS, model_reasoning_effort: 'low', 'mcp_servers.node_repl.enabled': false }
    })
    // A program whose name a key cannot hold: no call, as before.
    expect(voiceThreadConfig({ mcp_servers: { 'my.tool': { command: 'tool.exe' } } }, undefined, { connectors: true }).ok).toBe(false)
    const addOn = { command: 'locust.exe', args: ['bridge.mjs'], env: {} }
    expect(voiceThreadConfig({ mcp_servers: { locust_call: {} } }, addOn, { connectors: true }).ok).toBe(false)
  })

  it('leave Locust\'s own call tools unasked, and every other server asking as before (0.747)', () => {
    const addOn = { command: 'locust.exe', args: ['bridge.mjs', 'conn.json', 'call'], env: { ELECTRON_RUN_AS_NODE: '1' } }
    const testServer = { command: 'node.exe', args: ['probe.mjs'], env: {} }
    const made = voiceThreadConfig({ mcp_servers: { robinhood: { url: 'https://agent.robinhood.com/mcp/trading' } } }, addOn, { connectors: true, testServer })
    expect(made.ok && made.config['mcp_servers.locust_call.default_tools_approval_mode']).toBe('approve')
    expect(made.ok && Object.keys(made.config).filter((key) => key.endsWith('approval_mode'))).toEqual(['mcp_servers.locust_call.default_tools_approval_mode'])
    // No shell, browser or computer for the call's own Codex: asked to read, it reads through Locust's tools.
    expect(made.ok && made.config['features.shell_tool']).toBe(false)
    expect(made.ok && made.config['features.computer_use']).toBe(false)
  })

  it('say in the strip what they would do, from the question Codex asks', () => {
    const asked = {
      serverName: 'codex_apps', mode: 'form', message: 'Allow the codex_apps MCP server to run tool "gmail_send_email"?',
      _meta: { codex_approval_kind: 'mcp_tool_call', tool_params_display: [{ display_name: 'to', value: 'a@example.com' }, { display_name: 'subject', value: 'Hi\nthere' }] } // public-guard: allow (a placeholder address in a test)
    }
    expect(voiceCallAsk(asked)).toEqual({
      what: 'ChatGPT: gmail send email', detail: 'to: a@example.com · subject: Hi there', // public-guard: allow (a placeholder address in a test)
      // One row each on the card in a teammate's conversation (0.749).
      fields: [{ name: 'to', value: 'a@example.com' }, { name: 'subject', value: 'Hi there' }] // public-guard: allow (a placeholder address in a test)
    })
    // A value that is not text is said as JSON; a nameless one is left out; eight at most, each bounded.
    const many = { ...asked, _meta: { ...asked._meta, tool_params_display: [{ display_name: 'quantity', value: 1 }, { value: 'nameless' }, ...Array.from({ length: 9 }, (_, index) => ({ display_name: 'note ' + String(index), value: 'x'.repeat(700) }))] } }
    const fields = voiceCallAsk(many)?.fields ?? []
    expect(fields[0]).toEqual({ name: 'quantity', value: '1' })
    expect(fields).toHaveLength(8)
    expect(Math.max(...fields.map((field) => field.value.length))).toBe(600)
    expect(voiceCallAsk({ ...asked, mode: 'url' })).toBeUndefined()
    expect(voiceCallAsk({ ...asked, _meta: {} })).toBeUndefined()
    expect(voiceCallAsk('nothing')).toBeUndefined()
  })

  it('are told to the voice only when they are the call’s, and the folder is read with tools, never commands', () => {
    const told = voiceCallInstructions('acme', true, true)
    expect(told).toContain('find_files, read_file and search_files; never run shell commands')
    expect(told).toContain('only say it is done once the tool says so')
    expect(voiceCallInstructions('acme', true, false)).not.toContain('connectors')
  })
})
