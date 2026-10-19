// Requested polish: "route: no route control" off stderr and "a deterministic Copy-on-hover drive" (executor plan, 2026-10-03).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Importing drive-lib.mjs prunes the drives' scratch folder (scratch-root.mjs: every locust-* folder older than two
 * days, synchronously). The 0.737 gate's import of it met folders that had just turned two days old -- some held a
 * whole npm install of Codex -- and took 7-13 s, past this test's 5 s, twice; on the same machine a minute later it
 * took 0.1 s. The child gets an empty scratch folder of its own, so what it measures is the probe, not the prune.
 */
const ownScratch = (): { readonly env: NodeJS.ProcessEnv; readonly done: () => void } => {
  const folder = mkdtempSync(join(tmpdir(), 'locust-probe-scratch-'))
  return { env: { ...process.env, LOCUST_SCRATCH: folder }, done: () => rmSync(folder, { recursive: true, force: true }) }
}

describe('the drive polish', () => {
  it('replaces the judge native arrow with a chevron that cannot intercept selection', () => {
    const css = readFileSync(new URL('../renderer/src/shell.css', import.meta.url), 'utf8')
    const glyph = readFileSync(new URL('../renderer/src/components/ChatGlyphs.tsx', import.meta.url), 'utf8')
    expect(css).toMatch(/\.lc-compare__select \.lc-select__button\s*\{[^}]*cursor: pointer/)
    expect(css).not.toMatch(/\.lc-compare__select select\b/)
    expect(glyph).toMatch(/className="lc-chevron"[^>]*aria-hidden="true"/)
  })
  it('prints the missing-control probe to stdout', () => {
    const module = new URL('../../../../_tools/drive-lib.mjs', import.meta.url).href
    const scratch = ownScratch()
    let stdout: string
    try {
      stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `import { reportRouteProbe } from ${JSON.stringify(module)}; reportRouteProbe(''); reportRouteProbe('OpenCode');`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: scratch.env })
    } finally {
      scratch.done()
    }
    expect(stdout).toBe('route: no route control on this screen\nroute: OpenCode\n')
    const source = readFileSync(new URL('../../../../_tools/drive-lib.mjs', import.meta.url), 'utf8')
    expect(source).toContain('      reportRouteProbe(route)')
  })

  it('opens a seeded conversation before asserting Copy and offers a mode that sends nothing', () => {
    const source = readFileSync(new URL('../../../../_tools/drive-a-turn-round-trip.mjs', import.meta.url), 'utf8')
    expect(source).toContain('const fixture = await seedCopyHoverConversation(workspace)')
    expect(source).toContain('profilePath: fixture.profilePath,')
    expect(source).toContain('...(copyOnly ? { sendsNothing: true } : {})')
    expect(source).toContain('if (!copyOnly) {')
    expect(source.indexOf('Copy hover fixture is missing')).toBeLessThan(source.indexOf('const copies ='))
    expect(source).toContain("type: 'mouseMoved', x: 5, y: 5")
  })
})
