// The overnight polish (2026-10-12): a teammate in a window opened to spend runs the free drives itself.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { freeRoutesOnly } from './free-routes.js'

/*
 * The app a drive opens, as drive-lib.mjs's spendGuarded makes its environment. Importing drive-lib prunes the
 * drives' scratch folder, so the child gets an empty one of its own (a-drive-probe-and-copy-check-need-no-model).
 */
const guarded = (spends: boolean, environment: Record<string, string>): Record<string, string | undefined> => {
  const module = new URL('../../../../_tools/drive-lib.mjs', import.meta.url).href
  const scratch = mkdtempSync(join(tmpdir(), 'locust-spend-scratch-'))
  try {
    const script = `import { spendGuarded } from ${JSON.stringify(module)}; const environment = ${JSON.stringify(environment)}; process.stdout.write(JSON.stringify(spendGuarded({ ...environment, PATH: 'x' }, ${String(spends)}, environment)))`
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOCUST_SCRATCH: scratch } })) as Record<string, string | undefined>
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
const drivesWindow = ['Locust.exe', '--remote-debugging-port=9633']

describe('a drive may spend only when it says so', () => {
  it('holds a free drive to free routes under a LOCUST_SPEND=1 meant for another, and gives its app none to read', () => {
    const app = guarded(false, { LOCUST_SPEND: '1' })
    expect(app.LOCUST_FREE_ONLY).toBe('1')
    expect(app).not.toHaveProperty('LOCUST_SPEND')
    expect(freeRoutesOnly(drivesWindow, app)).toBe(true)
  })

  it('lifts it for a drive that says it spends, run with LOCUST_SPEND=1', () => {
    const app = guarded(true, { LOCUST_SPEND: '1', LOCUST_FREE_ONLY: '1' })
    expect(app).not.toHaveProperty('LOCUST_FREE_ONLY')
    expect(freeRoutesOnly(drivesWindow, app)).toBe(false)
  })

  it('and only then: saying it spends without LOCUST_SPEND=1 lifts nothing', () => {
    const app = guarded(true, {})
    expect(app.LOCUST_FREE_ONLY).toBe('1')
    expect(freeRoutesOnly(drivesWindow, app)).toBe(true)
  })
})
