import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { AppServerRunProcess, ExecutableLaunch } from '@teammate/runtime-adapters'

import {
  acpAgentId,
  cleanAgentName,
  commandWords,
  MAX_ACP_AGENTS,
  modelOptionOf,
  parsedAcpAgents,
  type AcpAgent,
  type AcpAgentAnswer,
  type AcpAgentsResponse,
  type AcpAgentTest
} from '../shared/acp-agents.js'
import { replaceFile } from './replace-file.js'

/*
 * YOUR OWN AGENTS (0.777, shared/acp-agents.ts): kept in their own file in the profile, tested by opening a session
 * and closing it again, and found again for each run by the same rule the test used.
 */
export const ACP_AGENTS_FILE = 'acp-agents.json'
const TEST_TIMEOUT_MS = 45_000

export type AcpLaunch = { readonly launch: ExecutableLaunch; readonly args: readonly string[] }

export interface AcpAgentsDeps {
  readonly directory: string
  /** A program by its bare name, as discovery finds the agents Locust knows (.cmd shims included). */
  readonly locate: (command: string) => Promise<ExecutableLaunch | undefined>
  readonly spawn: (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>, cwd?: string) => AppServerRunProcess
  /** An empty folder for a test's session: the agent is shown nothing of the person's. */
  readonly scratch: () => Promise<string>
  readonly now?: () => Date
}

/** A line's program and arguments, as a run would start them, or why not. */
export async function launchOf(commandLine: string, locate: AcpAgentsDeps['locate']): Promise<AcpLaunch | { readonly message: string }> {
  const words = commandWords(commandLine)
  if (words === undefined) return { message: 'Write the command that starts the agent, like goose acp. It runs on its own, not through a shell.' }
  const [program, ...args] = words as [string, ...string[]]
  if (isAbsolute(program)) {
    // A full path is run as it is: on Windows only a program file, since a .cmd needs a shell this never starts.
    if (!existsSync(program)) return { message: `${program} is not on this computer.` }
    if (process.platform === 'win32' && !/\.exe$/i.test(program)) return { message: 'On Windows, a full path must end in .exe. A command on your PATH, like goose, can be anything.' }
    return { launch: { commandName: program, discoveredPath: program, executablePath: program, prefixArgs: [], kind: 'native' }, args }
  }
  const launch = await locate(program).catch(() => undefined)
  if (launch === undefined) return { message: `Locust could not find ${program}. Install it, or check it opens in a new terminal, then test again.` }
  return { launch, args }
}

/**
 * initialize, then session/new in an empty folder, then stop. Sends no prompt, so nothing is spent. What it answers
 * is kept as the agent's own words; a refusal to open a session is reported with how it says to sign in.
 */
export async function testAcpAgent(launch: AcpLaunch, deps: Pick<AcpAgentsDeps, 'spawn' | 'scratch'>): Promise<AcpAgentTest> {
  const cwd = await deps.scratch()
  let child: AppServerRunProcess
  try {
    child = deps.spawn(launch.launch.executablePath, [...launch.launch.prefixArgs, ...launch.args], launch.launch.env, cwd)
  } catch {
    return { ok: false, message: 'The agent could not be started.' }
  }
  const waiting = new Map<number, (message: Record<string, unknown>) => void>()
  let buffer = ''
  let exited = false
  let next = 0
  child.onData((chunk) => {
    buffer += chunk
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      if (line.length === 0) continue
      let message: Record<string, unknown>
      try { message = JSON.parse(line) as Record<string, unknown> } catch { continue }
      if (typeof message.id === 'number' && waiting.has(message.id) && ('result' in message || 'error' in message)) {
        waiting.get(message.id)!(message)
        waiting.delete(message.id)
      } else if (message.id !== undefined && typeof message.method === 'string') {
        // The agent asking Locust for something during a test: nothing is offered, so every ask is refused.
        child.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Locust offers nothing during a test.' } })}\n`)
      }
    }
  })
  const gone = new Promise<'exited'>((resolve) => child.onExit(() => { exited = true; resolve('exited') }))
  const call = (method: string, params: unknown): Promise<Record<string, unknown> | 'exited' | 'timed-out'> => {
    next += 1
    const id = next
    const answered = new Promise<Record<string, unknown>>((resolve) => waiting.set(id, resolve))
    try { child.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) } catch { /* the exit says it */ }
    return Promise.race([answered, gone, new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), TEST_TIMEOUT_MS))])
  }
  const said = (): string => (child.stderrTail?.() ?? '').trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 240) ?? ''
  try {
    const init = await call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
    if (init === 'exited') return { ok: false, message: `It stopped without answering.${said() ? ` It said: ${said()}` : ''} Check that the command starts its ACP mode (often acp or --acp).` }
    if (init === 'timed-out') return { ok: false, message: 'It did not answer within 45 seconds. Check that the command starts its ACP mode (often acp or --acp).' }
    const initialized = (init.result ?? {}) as Record<string, unknown>
    if (init.error !== undefined || typeof initialized.protocolVersion !== 'number') return { ok: false, message: 'It answered, but not in the Agent Client Protocol.' }
    const info = (typeof initialized.agentInfo === 'object' && initialized.agentInfo !== null ? initialized.agentInfo : {}) as Record<string, unknown>
    const methods = Array.isArray(initialized.authMethods) ? (initialized.authMethods as Record<string, unknown>[]) : []
    const signIn = methods.flatMap((method) => (typeof method.description === 'string' ? [method.description] : typeof method.name === 'string' ? [method.name] : []))
    const session = await call('session/new', { cwd, mcpServers: [] })
    const base: AcpAgentAnswer = {
      ...(typeof info.name === 'string' ? { agentName: info.name.slice(0, 80) } : typeof info.title === 'string' ? { agentName: info.title.slice(0, 80) } : {}),
      ...(typeof info.version === 'string' ? { version: info.version.slice(0, 40) } : {})
    }
    if (session === 'exited' || session === 'timed-out' || session.error !== undefined) {
      const how = signIn.length > 0 ? ` It says to sign in: ${signIn.join('; ')}.` : ''
      return { ok: false, message: `It answered, but would not open a session.${how}` }
    }
    const modelOption = modelOptionOf(session.result)
    return { ok: true, answer: { ...base, ...(modelOption === undefined ? {} : { modelOption }), ...(signIn.length === 0 ? {} : { signIn }) } }
  } finally {
    if (!exited) child.kill()
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function createAcpAgents(deps: AcpAgentsDeps) {
  const file = join(deps.directory, ACP_AGENTS_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  const read = async (): Promise<readonly AcpAgent[]> => parsedAcpAgents(JSON.parse(await readFile(file, 'utf8').catch(() => '{}')))
  const write = async (agents: readonly AcpAgent[]): Promise<void> => {
    await mkdir(deps.directory, { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify({ agents }, null, 2), 'utf8')
    await replaceFile(`${file}.tmp`, file)
  }
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const task = queue.then(work)
    queue = task.catch(() => undefined)
    return task
  }
  const test = async (commandLine: string): Promise<AcpAgentTest> => {
    const found = await launchOf(commandLine, deps.locate)
    if ('message' in found) return { ok: false, message: found.message }
    return testAcpAgent(found, deps)
  }
  return {
    list: async (): Promise<AcpAgentsResponse> => ({ ok: true, agents: await read() }),
    test,
    save: (name: unknown, commandLine: unknown) => serial(async (): Promise<AcpAgentsResponse> => {
      const clean = cleanAgentName(name)
      if (clean === undefined) return { ok: false, message: 'Give it a name of up to 40 letters.' }
      if (typeof commandLine !== 'string') return { ok: false, message: 'Write the command that starts the agent.' }
      const agents = await read()
      if (agents.length >= MAX_ACP_AGENTS) return { ok: false, message: `Locust keeps up to ${String(MAX_ACP_AGENTS)} of your own agents. Remove one first.` }
      if (agents.some((agent) => agent.name.toLowerCase() === clean.toLowerCase())) return { ok: false, message: `You already have an agent called ${clean}.` }
      const tested = await test(commandLine)
      if (!tested.ok) return tested
      const agent: AcpAgent = {
        id: acpAgentId(clean, agents.map((entry) => entry.id)),
        name: clean,
        commandLine: commandLine.trim(),
        answer: tested.answer,
        testedAt: (deps.now ?? (() => new Date()))().toISOString()
      }
      await write([...agents, agent])
      return { ok: true, agents: [...agents, agent] }
    }),
    remove: (id: unknown) => serial(async (): Promise<AcpAgentsResponse> => {
      const agents = await read()
      const kept = agents.filter((agent) => agent.id !== id)
      if (kept.length !== agents.length) await write(kept)
      return { ok: true, agents: kept }
    }),
    /** An agent and how to start it, for a run. */
    resolve: async (agentId: string): Promise<{ readonly agent: AcpAgent; readonly found: AcpLaunch } | { readonly message: string }> => {
      const agent = (await read()).find((entry) => entry.id === agentId)
      if (agent === undefined) return { message: 'That agent is not in Settings > AI agents > Your own agents any more.' }
      const found = await launchOf(agent.commandLine, deps.locate)
      return 'message' in found ? found : { agent, found }
    }
  }
}

export type AcpAgents = ReturnType<typeof createAcpAgents>

export const acpScratch = (root: string) => async (): Promise<string> => {
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, 'acp-test-'))
}
