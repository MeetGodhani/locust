import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { contextAdvice, contextCategories } from '../shared/context-breakdown.js'
import type { ClaudeContextBreakdown } from '../shared/context-breakdown.js'
import { createClaudeContextReader, parseClaudeContext, runClaudeContext } from './claude-context.js'
import type { ClaudeContextLaunch, ClaudeContextTurn } from './claude-context.js'

/*
 * THE CONTEXT MENU READS CLAUDE'S OWN ESTIMATE (0.806). The ring's menu shows what Claude Code's /context says fills
 * the conversation, run with the turn's own flags after the turn ends: free (0 turns, $0), never while a turn runs,
 * once per finished turn. MEASURED 2026-10-19 on Claude Code 2.1.303: /context also lists "(deferred)" tools and the
 * autocompact buffer, which are not in the window -- with connectors on, "MCP tools (deferred)" read 200.7k while the
 * whole conversation was 24k. Those never become a bar or a sentence.
 */
const FIXTURE = fileURLToPath(new URL('./fixtures/claude-context.json', import.meta.url))
const reply = (result: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ type: 'result', is_error: false, num_turns: 0, total_cost_usd: 0, result, ...extra })

describe("Claude Code's /context reply", () => {
  it('is read from its category table, the totals included', async () => {
    const breakdown = parseClaudeContext(await readFile(FIXTURE, 'utf8'))
    expect(breakdown).toMatchObject({ used: 45_200, window: 200_000 })
    expect(breakdown?.categories.find((row) => row.name === 'Messages')).toEqual({ name: 'Messages', tokens: 24_500 })
    // Not the per-tool table after it.
    expect(breakdown?.categories.some((row) => row.name === 'fixture_tool')).toBe(false)
  })

  it("is read on a resumed session, whose reply carries that session's earlier cost", async () => {
    // MEASURED 2026-10-19 through the app: num_turns 0 and duration_api_ms 0, with total_cost_usd 0.00107 -- the
    // turn before it. Refusing on cost left the menu empty for every real conversation.
    const raw = JSON.parse(await readFile(FIXTURE, 'utf8')) as { result: string }
    expect(parseClaudeContext(reply(raw.result, { total_cost_usd: 0.00107, duration_api_ms: 0 }))?.used).toBe(45_200)
  })

  it('is refused when it ran a turn or called the model, failed, or has no table', async () => {
    const raw = JSON.parse(await readFile(FIXTURE, 'utf8')) as { result: string }
    expect(parseClaudeContext(reply(raw.result, { num_turns: 1 }))).toBeUndefined()
    expect(parseClaudeContext(reply(raw.result, { duration_api_ms: 850 }))).toBeUndefined()
    expect(parseClaudeContext(reply(raw.result, { is_error: true }))).toBeUndefined()
    expect(parseClaudeContext(reply('**Tokens:** 1k / 200k'))).toBeUndefined()
    expect(parseClaudeContext('not json')).toBeUndefined()
  })
})

describe('the menu', () => {
  it('shows the biggest rows in the window and free space, never deferred tools or the autocompact buffer', async () => {
    const breakdown = parseClaudeContext(await readFile(FIXTURE, 'utf8'))!
    const names = contextCategories(breakdown).map((row) => row.name)
    expect(names).toEqual(['Messages', 'Skills', 'System tools', 'System prompt', 'Free space'])
    expect(contextAdvice(breakdown)).toBe('Messages take 24.5k. Compact this conversation to make room while keeping a summary.')
  })

  it('says nothing when no category the person controls is a real share of the window', () => {
    const fresh: ClaudeContextBreakdown = { used: 24_000, window: 1_000_000, categories: [
      { name: 'System prompt', tokens: 2_500 }, { name: 'MCP tools (deferred)', tokens: 200_700 }, { name: 'Skills', tokens: 10_000 },
      { name: 'MCP tools', tokens: 600 }, { name: 'Messages', tokens: 10 }, { name: 'Free space', tokens: 943_000 }, { name: 'Autocompact buffer', tokens: 33_000 }
    ] }
    expect(contextAdvice(fresh)).toBeUndefined()
    expect(contextCategories(fresh).map((row) => row.name)).not.toContain('MCP tools (deferred)')
  })

  it('points at connectors when they are what fills it, server instructions counted with them', () => {
    const heavy: ClaudeContextBreakdown = { used: 190_000, window: 200_000, categories: [
      { name: 'MCP tools', tokens: 150_000 }, { name: 'MCP server instructions', tokens: 20_000 }, { name: 'Messages', tokens: 15_000 }, { name: 'Free space', tokens: 10_000 }
    ] }
    expect(contextAdvice(heavy)).toBe('Your connectors take 170k: untick ones this teammate does not need in Edit teammate.')
  })
})

describe('running /context', () => {
  // Through the real process runner, not a stand-in: the first build passed every test above and never ran.
  const command = (script: string) => ({ runtime: 'claude' as const, executablePath: process.execPath, args: ['-e', script], cwd: tmpdir(), stdin: 'none' as const, stdout: 'jsonl' as const })

  it('returns what the process printed', async () => {
    const raw = await runClaudeContext(command(`process.stdout.write(JSON.stringify({ type: 'result', num_turns: 0 }) + '\\n')`), new AbortController().signal)
    expect(JSON.parse(raw)).toEqual({ type: 'result', num_turns: 0 })
  })

  it('throws when the process fails, so the menu shows nothing from it', async () => {
    await expect(runClaudeContext(command('process.exit(3)'), new AbortController().signal)).rejects.toThrow('Context was not available.')
  })
})

describe('the reader', () => {
  const launch: ClaudeContextLaunch = { cwd: 'C:/project', executablePath: 'claude', args: ['--print'], sandbox: 'read-only', plugins: [] }
  const turn = (busy: boolean): ClaudeContextTurn => ({ missionId: 'mission_a', sessionId: 'session_a', busy, fallback: launch })
  const setup = async (options: { busy?: () => boolean; run?: (signal: AbortSignal) => Promise<string> }) => {
    let runs = 0
    let disposed = 0
    const reader = createClaudeContextReader({
      file: join(await mkdtemp(join(tmpdir(), 'locust-context-')), 'launches.json'),
      resolve: async () => turn(options.busy?.() ?? false),
      prepare: async () => ({ command: { runtime: 'claude', executablePath: 'claude', args: [], cwd: 'C:/project' } as never, dispose: async () => { disposed += 1 } }),
      run: async (_command, signal) => { runs += 1; return options.run === undefined ? readFile(FIXTURE, 'utf8') : options.run(signal) }
    })
    return { reader, runs: () => runs, disposed: () => disposed }
  }

  it('runs /context once for a finished turn, then answers from what it read', async () => {
    const { reader, runs, disposed } = await setup({})
    expect((await reader.read('mission_a'))?.used).toBe(45_200)
    expect((await reader.read('mission_a'))?.used).toBe(45_200)
    expect(runs()).toBe(1)
    expect(disposed()).toBe(1)
  })

  it('does not run while a turn is running', async () => {
    const { reader, runs } = await setup({ busy: () => true })
    expect(await reader.read('mission_a')).toBeUndefined()
    expect(runs()).toBe(0)
  })

  it('gives way to a starting turn: the inspection is stopped and the menu shows nothing from it', async () => {
    const { reader, disposed } = await setup({ run: (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))) })
    const reading = reader.read('mission_a')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await reader.beforeStart()
    expect(await reading).toBeUndefined()
    expect(disposed()).toBe(1)
  })

  it('shows nothing, and says nothing wrong, when /context fails', async () => {
    const { reader } = await setup({ run: async () => { throw new Error('exit 1') } })
    expect(await reader.read('mission_a')).toBeUndefined()
  })
})
