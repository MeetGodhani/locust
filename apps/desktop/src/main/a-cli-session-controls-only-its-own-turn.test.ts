import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { CliPoll, CliSession, CliTeammate } from '@teammate/cli/protocol'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import type { CodexMissionStartData, CodexMissionStartRequest, CodexMissionStartResponse, CodexMissionUpdate, MissionApprovalRequest } from '../shared/ipc.js'
import { createLocustCliSessions } from './locust-cli-sessions.js'

const TEAM: readonly CliTeammate[] = [{ id: 'mate-one', name: 'One', runtime: 'codex', model: 'test', runs_in: 'ask' }]
const WORKSPACE = fileURLToPath(new URL('.', import.meta.url))
const hosts: ReturnType<typeof createLocustCliSessions>[] = []
afterEach(() => { for (const host of hosts.splice(0)) host.dispose(); vi.useRealTimers() })
const response: CodexMissionStartResponse = { ok: true, data: { missionId: 'mission-one', runId: 'run-one' } as CodexMissionStartData }
function fixture(overrides: Partial<Parameters<typeof createLocustCliSessions>[0]> = {}) {
  let update: (value: CodexMissionUpdate) => void = () => undefined
  const starts: CodexMissionStartRequest[] = []
  const cancel = vi.fn(), answer = vi.fn(async () => true), opened = vi.fn()
  const approvals: MissionApprovalRequest[] = []
  // As a new Locust has it: Let editors answer cards for their own turns is off.
  const host = createLocustCliSessions({ teammates: async () => TEAM, workspace: () => WORKSPACE,
    start: async (request, listener) => { starts.push(request); update = listener; return response },
    cancel, answer, editorAnswers: () => false, opened, approvals: () => approvals, status: async () => ({ workspace: WORKSPACE, turns: [] }), ...overrides })
  hosts.push(host)
  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await host.call(name, args)
    if (result.isError) throw Error(result.content[0]!.text)
    return JSON.parse(result.content[0]!.text) as T
  }
  const auth = (session: CliSession) => ({ sessionId: session.sessionId, key: session.key })
  const emit = (type: NormalizedRuntimeEvent['type'], payload: Record<string, unknown> = {}) => update({ kind: 'event', missionId: 'mission-one', runId: 'run-one', event: { type, payload } as unknown as NormalizedRuntimeEvent })
  return { host, starts, cancel, answer, opened, approvals, call, auth, emit, open: () => call<CliSession>('cli/open') }
}

describe('a CLI session’s ownership', () => {
  it('opens without starting a turn and ignores client route or mode overrides', async () => {
    const f = fixture(), session = await f.open()
    expect(f.starts).toEqual([])
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Hello', mode: 'auto', runtime: 'other', runId: 'not-owned' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    expect(f.starts[0]).toEqual({ prompt: 'Hello', teammateId: 'mate-one', mode: 'ask', keepSavedRoute: true })
  })

  it('claims before asynchronous lookup and does not replay a duplicate request', async () => {
    let release!: (team: readonly CliTeammate[]) => void, lookups = 0
    const team = new Promise<readonly CliTeammate[]>(resolve => { release = resolve })
    const f = fixture({ teammates: async () => ++lookups === 1 ? TEAM : team }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'First' })
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'First' })
    await expect(f.call('cli/prompt', { ...f.auth(session), requestId: 'two', message: 'Second' })).rejects.toThrow(/still working/)
    release(TEAM)
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
  })

  it('rejects a wrong capability for reading, cancellation and decisions', async () => {
    const f = fixture(), session = await f.open()
    for (const name of ['cli/poll', 'cli/cancel', 'cli/decide', 'cli/prompt']) await expect(f.call(name, { sessionId: session.sessionId, key: 'b'.repeat(64), approvalId: 'other', approve: true })).rejects.toThrow(/no longer connected/)
    expect(f.cancel).not.toHaveBeenCalled()
    expect(f.answer).not.toHaveBeenCalled()
    expect(f.starts).toEqual([])
  })

  it('leaves every card in Locust until the person lets editors answer', async () => {
    const f = fixture(), session = await f.open()
    expect(f.opened).toHaveBeenCalledOnce()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Check' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    f.emit('run.started')
    f.approvals.push({ approvalId: 'own', missionId: 'mission-one', runId: 'run-one', kind: 'command', summary: 'Check', detail: 'echo check', cwd: null, requestedAt: new Date().toISOString() })
    const poll = await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })
    expect(poll.approvals.map(a => [a.approvalId, a.answerInLocust])).toEqual([['own', true]])
    await expect(f.call('cli/decide', { ...f.auth(session), approvalId: 'own', approve: true })).rejects.toThrow(/Let editors answer cards for their own turns/)
    expect(f.answer).not.toHaveBeenCalled()
  })

  it('answers only its own current action, never another run or a question', async () => {
    const f = fixture({ editorAnswers: () => true }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Check' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    f.emit('run.started')
    const card: MissionApprovalRequest = { approvalId: 'own', missionId: 'mission-one', runId: 'run-one', kind: 'command', summary: 'Check', detail: 'echo check', cwd: null, requestedAt: new Date().toISOString() }
    f.approvals.push(card, { ...card, approvalId: 'foreign', runId: 'another-run' }, { ...card, approvalId: 'foreign-mission', missionId: 'another-mission' }, { ...card, approvalId: 'question', kind: 'question' })
    const poll = await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })
    expect(poll.approvals.map(a => a.approvalId)).toEqual(['own', 'question'])
    for (const approvalId of ['foreign', 'foreign-mission', 'question']) await expect(f.call('cli/decide', { ...f.auth(session), approvalId, approve: true })).rejects.toThrow(/not waiting/)
    await f.call('cli/decide', { ...f.auth(session), approvalId: 'own', approve: true })
    expect(f.answer).toHaveBeenCalledExactlyOnceWith('own', true)
  })

  it('cancels a late start using its returned run id, not a client-supplied one', async () => {
    let started!: (value: CodexMissionStartResponse) => void
    const pending = new Promise<CodexMissionStartResponse>(resolve => { started = resolve })
    const start = vi.fn(async () => pending)
    const f = fixture({ start }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Start' })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    await f.call('cli/cancel', { ...f.auth(session), runId: 'do-not-stop' })
    started(response)
    await vi.waitFor(() => expect(f.cancel).toHaveBeenCalledWith('run-one'))
    expect(f.cancel).not.toHaveBeenCalledWith('do-not-stop')
    expect((await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })).turn?.phase).toBe('cancelled')
  })

  it('does not start when a cancellation arrives before its prompt request', async () => {
    const f = fixture(), session = await f.open()
    await f.call('cli/cancel', { ...f.auth(session), requestId: 'one' })
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Do not start' })
    expect((await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })).turn?.phase).toBe('cancelled')
    expect(f.starts).toEqual([])
  })

  it('does not replay an older request id after another turn completed', async () => {
    const f = fixture(), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'First' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    f.emit('run.completed')
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'two', message: 'Second' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(2))
    f.emit('run.completed')
    await expect(f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'First' })).rejects.toThrow(/not sent again/)
    await expect(f.call('cli/prompt', { ...f.auth(session), requestId: 'two', message: 'Different' })).rejects.toThrow(/not sent again/)
    expect(f.starts).toHaveLength(2)
  })

  it('fails a hung startup and cancels its late result without replaying it', async () => {
    vi.useFakeTimers()
    let resolveStart!: (result: CodexMissionStartResponse) => void
    const start = vi.fn(() => new Promise<CodexMissionStartResponse>(resolve => { resolveStart = resolve }))
    const f = fixture({ start, startTimeoutMs: 100, leaseMs: 10_000 }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Start' })
    await vi.advanceTimersByTimeAsync(101)
    expect((await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })).turn).toMatchObject({ phase: 'failed', message: expect.stringContaining('starting in time') })
    resolveStart(response)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.cancel).toHaveBeenCalledWith('run-one')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not start after close while the roster lookup is pending', async () => {
    let release!: (team: readonly CliTeammate[]) => void, reads = 0
    const pending = new Promise<readonly CliTeammate[]>(resolve => { release = resolve })
    const f = fixture({ teammates: async () => ++reads === 1 ? TEAM : pending }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Do not start' })
    await f.call('cli/close', f.auth(session))
    release(TEAM)
    await Promise.resolve(); await Promise.resolve()
    expect(f.starts).toEqual([])
    await expect(f.call('cli/poll', { ...f.auth(session), after: 0 })).rejects.toThrow(/no longer connected/)
  })

  it('stops abandoned work when its client lease expires', async () => {
    vi.useFakeTimers()
    const f = fixture({ leaseMs: 100 }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Start' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(101)
    expect(f.cancel).toHaveBeenCalledWith('run-one')
    await expect(f.call('cli/keepalive', f.auth(session))).rejects.toThrow(/no longer connected/)
  })

  it('continues only its own previous mission after completion', async () => {
    const f = fixture(), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'First', followUpOf: 'foreign' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    f.emit('run.completed')
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'two', message: 'Second', followUpOf: 'foreign' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(2))
    expect(f.starts[0]?.followUpOf).toBeUndefined()
    expect(f.starts[1]?.followUpOf).toBe('mission-one')
  })

  it('holds the next turn until a cancelled runtime actually reports its end', async () => {
    const f = fixture(), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'First' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    await f.call('cli/cancel', f.auth(session))
    await expect(f.call('cli/prompt', { ...f.auth(session), requestId: 'two', message: 'Second' })).rejects.toThrow(/still working/)
    f.emit('run.cancelled')
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'two', message: 'Second' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(2))
  })

  it('streams only message text and frees acknowledged output', async () => {
    const f = fixture(), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Hello' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    f.emit('message.delta', { itemId: 'a', operation: 'append', text: 'Hello', final: false })
    f.emit('step.started', { stepKind: 'reasoning', message: 'not sent to the editor' })
    const first = await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })
    expect(first.events).toEqual([{ sequence: 1, itemId: 'a', operation: 'append', text: 'Hello' }])
    f.emit('run.completed')
    const second = await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: first.cursor })
    expect(second.events).toEqual([])
    expect(second.turn?.phase).toBe('completed')
    await expect(f.call('cli/poll', { ...f.auth(session), after: 99 })).rejects.toThrow(/cursor/)
  })

  it('reports a startup refusal and permits a later explicit attempt', async () => {
    const start = vi.fn(async (): Promise<CodexMissionStartResponse> => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Monthly limit reached. Change the limit in Locust.' } }))
    const f = fixture({ start }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Start' })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    expect((await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })).turn).toMatchObject({ phase: 'failed', message: 'Monthly limit reached. Change the limit in Locust.' })
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'two', message: 'Try explicitly' })
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
  })

  it('does not silently use another folder or an ambiguous teammate', async () => {
    const f = fixture()
    await expect(f.call('cli/open', { cwd: '/not-the-open-project' })).rejects.toThrow(/folder/)
    await expect(f.call('cli/open', { teammate: 'missing' })).rejects.toThrow(/One/)
    expect(f.starts).toEqual([])
  })

  it('rechecks the chosen folder before starting a later prompt', async () => {
    let folder = WORKSPACE
    const f = fixture({ workspace: () => folder }), session = await f.open()
    folder = '/different-project'
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Do not use another folder' })
    await vi.waitFor(async () => expect((await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })).turn?.phase).toBe('failed'))
    expect(f.starts).toEqual([])
  })

  it('stops rather than silently dropping a slow editor’s output', async () => {
    const f = fixture(), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Start' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    f.emit('message.delta', { itemId: 'a', operation: 'append', text: 'x'.repeat(2 * 1024 * 1024 + 1), final: false })
    expect((await f.call<CliPoll>('cli/poll', { ...f.auth(session), after: 0 })).turn).toMatchObject({ phase: 'failed', message: expect.stringContaining('did not keep up') })
    expect(f.cancel).toHaveBeenCalledWith('run-one')
  })

  it('cancels only owned work on app shutdown, including a late start', async () => {
    let finish!: (result: CodexMissionStartResponse) => void
    const start = vi.fn(() => new Promise<CodexMissionStartResponse>(resolve => { finish = resolve }))
    const f = fixture({ start }), session = await f.open()
    await f.call('cli/prompt', { ...f.auth(session), requestId: 'one', message: 'Start' })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    f.host.dispose()
    finish(response)
    await vi.waitFor(() => expect(f.cancel).toHaveBeenCalledExactlyOnceWith('run-one'))
    await expect(f.call('cli/open')).rejects.toThrow(/closing/)
  })
})
