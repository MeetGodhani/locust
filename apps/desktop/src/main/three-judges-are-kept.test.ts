import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { judgeMissionIds, newestJudgeMissionIds, rerunMissionIds } from '../shared/compare.js'
import { createCompareStore } from './compare-store.js'

/*
 * THREE JUDGES VOTING, KEPT (0.765): the newest ask's panel is stored with its judge and read back after a restart,
 * and every run a judge of a panel made stays the comparison's -- never a conversation of its own.
 */
describe('three judges, kept', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-panel-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('keeps the panel of the newest ask, and every panel run as the comparison\'s, across a restart', async () => {
    const route = { runtime: 'opencode', model: 'opencode/space-bunny-free', label: 'Space Bunny' }
    const routes = [route, { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', label: 'Muse Spark' }]
    const store = createCompareStore({ rootDirectory: folder })
    const made = await store.create({ prompt: 'Which CRM?', routes })
    const codex = { runtime: 'codex', model: 'account-default', label: 'Codex' }
    const ling = { runtime: 'opencode', model: 'opencode/ling-3.1-flash-free', label: 'Ling 3.1' }
    const nemo = { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', label: 'Nemotron' }
    await store.judge(made.compareId, codex, 'm_j1', 'Names a price', [{ route: ling, missionId: 'm_p1' }, { route: nemo, missionId: 'm_p2' }])
    const judged = await store.judge(made.compareId, codex, 'm_j2', 'Names a price', [{ route: ling, missionId: 'm_p3' }, { route: nemo, missionId: 'm_p4' }])
    expect(judged.judge?.panel?.map((member) => member.missionId)).toEqual(['m_p3', 'm_p4'])
    expect(newestJudgeMissionIds(judged.judge)).toEqual(['m_j2', 'm_p3', 'm_p4'])
    const reopened = await createCompareStore({ rootDirectory: folder }).get(made.compareId)
    expect(reopened?.judge?.panel).toEqual(judged.judge?.panel)
    // The first ask's panel is still the comparison's: never a conversation of its own.
    for (const id of ['m_j1', 'm_j2', 'm_p1', 'm_p2', 'm_p3', 'm_p4']) expect(judgeMissionIds([reopened!]).has(id)).toBe(true)
    // One judge asked again: the panel goes, its runs stay the comparison's.
    const alone = await store.judge(made.compareId, codex, 'm_j3', 'Names a price')
    expect(alone.judge?.panel).toBeUndefined()
    expect(judgeMissionIds([alone]).has('m_p4')).toBe(true)
    expect(rerunMissionIds([{ ...alone, rerunOf: 'cmp_x' }]).has('m_p1')).toBe(true)
  })
})
