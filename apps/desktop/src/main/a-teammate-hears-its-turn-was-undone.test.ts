import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MissionLedger, Workroom } from '@teammate/mission-store'
import type {
  RuntimeDiscovery,
  RuntimeProcessCompletion,
  RuntimeProcessRecordStream,
  RuntimeProcessRun
} from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBriefSessions } from './brief-sessions.js'
import type { TurnRecord, TurnRecords } from './checkpoints.js'
import { createCodexMissionService } from './codex-mission.js'
import { UNDONE_NOTE_MAX_PATHS, undoneNote } from './undone-note.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A TEAMMATE HEARS ITS LAST TURN WAS UNDONE (0.784).
 *
 * Clean-machine drive, packaged 0.783, 2026-10-17: after Undo removed the file a teammate had just made, it was asked
 * what it had undone and answered that the file "is still on disk". The session it resumes remembers writing it;
 * nothing told it otherwise. The follow-up now starts with what Undo put back.
 */
const NOW = '2026-10-17T15:00:00.000Z'
const PEER: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' },
  others: [{ teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }]
}
const SAID = 'Before this message, the person pressed Undo on your previous turn in Locust.'

describe('the note a follow-up starts with', () => {
  it('names what was put back, and what was left and why', () => {
    const note = undoneNote({ restored: ['laptop-setup.md'], leftAlone: [{ path: 'notes.txt', why: 'changed since the turn' }] })
    expect(note).toContain(SAID)
    expect(note).toContain('laptop-setup.md')
    expect(note).toContain('notes.txt (changed since the turn)')
    expect(note).toContain('Work from the folder as it is now')
  })

  it('says nothing when Undo put nothing back', () => {
    expect(undoneNote({ restored: [], leftAlone: [] })).toBeUndefined()
  })

  it('names a long list by count past its limit', () => {
    const many = Array.from({ length: UNDONE_NOTE_MAX_PATHS + 3 }, (_, index) => `f${String(index)}.md`)
    const note = undoneNote({ restored: many, leftAlone: [] }) ?? ''
    expect(note).toContain(`f${String(UNDONE_NOTE_MAX_PATHS - 1)}.md and 3 more`)
    expect(note).not.toContain(`f${String(UNDONE_NOTE_MAX_PATHS)}.md`)
  })
})

describe('a follow-up to an undone turn', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-undone-note-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  const runtime: RuntimeDiscovery = {
    id: 'codex',
    kind: 'agent-runtime',
    displayName: 'Codex CLI',
    optional: false,
    availability: 'available',
    readiness: 'ready',
    executable: {
      commandName: 'codex',
      discoveredPath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      executablePath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      prefixArgs: [],
      kind: 'native'
    },
    version: { raw: 'codex-cli 0.151.0', version: '0.151.0', major: 0, minor: 151, patch: 0 },
    supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    requiredFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    diagnostics: []
  }
  const completion = (): RuntimeProcessCompletion => ({
    exitCode: 0,
    signal: null,
    stderr: '',
    stderrTruncated: false,
    recordCount: 2,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    oversizedRecordsDropped: 0,
    startedAt: NOW,
    finishedAt: NOW
  })
  const stream = (values: readonly Record<string, unknown>[]): RuntimeProcessRecordStream => ({
    async *[Symbol.asyncIterator]() {
      for (const [index, value] of values.entries()) yield { sequence: index + 1, raw: JSON.stringify(value) }
    },
    drainAvailable: () => []
  })
  const workroom: Workroom = {
    post: async () => {
      throw new Error('not used')
    },
    unread: async () => ({ messages: [], remaining: 0 }),
    markDelivered: async () => undefined,
    read: async () => ({ messages: [], deliveries: [], issues: [] }),
    flush: async () => undefined
  }
  const prior = (missionId: string) => ({
    metadata: {
      missionId,
      runId: 'run_prior',
      prompt: 'Make laptop-setup.md and send it to me.',
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: null,
      workspaceId: 'ws_test',
      sandbox: 'workspace-write',
      mode: 'accept-edits',
      executionPolicyVersion: 1,
      createdAt: NOW
    },
    events: [
      { id: 'e1', runId: 'run_prior', missionId, sequence: 1, type: 'run.started', occurredAt: NOW, sourceAdapter: 'codex', payload: { runtimeThreadId: 'thread-1', evidence: { redacted: true } } }
    ],
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    editChecks: [], approvals: [],
    phase: 'completed',
    lastUpdatedAt: NOW,
    ledgerSequence: 1,
    issues: []
  })
  const recordOf = (undone?: TurnRecord['undone']): TurnRecord => ({
    workspace: folder, before: 'a', after: 'b', at: NOW, notKept: [], ...(undone === undefined ? {} : { undone })
  })

  const setUp = (records: Readonly<Record<string, TurnRecord>>) => {
    const ledger = {
      createMission: async () => undefined,
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => {
        throw new Error('not used')
      },
      appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined, appendApproval: async () => undefined,
      deleteMission: async () => true,
      listTrashedMissions: async () => [],
      restoreMission: async () => true,
      emptyTrash: async () => 0,
      storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
      pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async (missionId: string) => prior(missionId),
      listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    } as unknown as MissionLedger
    const turnRecords: TurnRecords = {
      put: async () => undefined,
      get: async (runId) => records[runId],
      state: async () => ({ kind: 'none' }),
      undo: async () => ({ kind: 'none' })
    }
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: stream([{ type: 'thread.started', thread_id: 'thread-1' }, { type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    }))
    let nextId = 0
    const service = createCodexMissionService({
      workspacePath: process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace',
      discover: async () => [runtime],
      runner: { start },
      ledger,
      workroom,
      turnRecords,
      briefSessions: createBriefSessions({ rootDirectory: folder }),
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: () => undefined
    })
    const sent = (call: number): string => start.mock.calls[call]?.[1] as string
    return { service, sent }
  }

  it('starts with what Undo put back, and still ends with what the person said', async () => {
    const { service, sent } = setUp({ run_prior: recordOf({ at: NOW, restored: ['laptop-setup.md'], leftAlone: [] }) })
    const started = await service.start('What did you just undo?', 'codex', 'accept-edits', {}, () => undefined, undefined, PEER, 'ms_prior')
    expect(started.ok, JSON.stringify(started)).toBe(true)
    expect(sent(0).startsWith(SAID)).toBe(true)
    expect(sent(0)).toContain('laptop-setup.md')
    expect(sent(0).trimEnd().endsWith('What did you just undo?')).toBe(true)
  })

  it('says nothing of Undo when the turn it follows was not undone', async () => {
    const { service, sent } = setUp({ run_prior: recordOf() })
    await service.start('And now?', 'codex', 'accept-edits', {}, () => undefined, undefined, PEER, 'ms_prior')
    expect(sent(0)).not.toContain('pressed Undo')
  })

  it('says nothing of Undo on a first turn', async () => {
    const { service, sent } = setUp({ run_prior: recordOf({ at: NOW, restored: ['laptop-setup.md'], leftAlone: [] }) })
    await service.start('Hello', 'codex', 'accept-edits', {}, () => undefined, undefined, PEER)
    expect(sent(0)).not.toContain('pressed Undo')
  })
})
