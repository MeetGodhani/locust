import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { LocalRuntimeId, PublicRuntimeStatus } from '../../shared/ipc.js'
import { FirstLaunch } from './components/FirstLaunch.js'

/*
 * WITH NOTHING INSTALLED, THE INSTALL COMES FIRST (0.780). A clean-machine drive of packaged 0.779 (2026-10-16):
 * the free agent's Install row sat under the three team templates and the folder card, below the fold in the
 * app's own 1215x800 window, so the first screen offered teams that could not run and hid the press that makes
 * them run. Until something is installed the accounts lead; once anything is installed -- ready or still being
 * checked -- Home keeps the order it always had, so a returning Home never reorders while its agents answer.
 */
const missing = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: false, version: null, auth: 'unknown', ready: false, status: 'not-installed' })
const ready = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: true, version: '1.0.0', auth: 'authenticated', ready: true, status: 'ready' })
const checking = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ ...ready(id, name), ready: false, status: 'probe-failed', checking: true })

function home(runtimes: readonly PublicRuntimeStatus[]): string {
  return renderToStaticMarkup(
    <FirstLaunch
      runtimes={runtimes}
      limitedRuntimes={new Map()}
      discoveryPhase="ready"
      workspacePath="C:\\Users\\someone\\Documents\\Locust"
      workspaceMade
      teammateCount={0}
      team={[]}
      onMessageTeammate={() => undefined}
      onNewTeammate={() => undefined}
      onUseTemplate={async () => undefined}
      onChooseFolder={() => undefined}
      onInstall={() => undefined}
    />
  )
}

const order = (html: string): { readonly install: number; readonly team: number; readonly folder: number } => ({
  install: html.indexOf('lc-runtimepanel'),
  team: html.indexOf('lc-teamtemplates'),
  folder: html.indexOf('Locust made a folder to work in')
})

const others = [missing('codex', 'Codex CLI'), missing('claude', 'Claude Code'), missing('cursor', 'Cursor Agent')]

describe('Home on a machine with nothing installed', () => {
  it('puts the Install row before the team templates and the folder card', () => {
    const at = order(home([missing('opencode', 'OpenCode'), ...others]))
    expect(at.install).toBeGreaterThan(-1)
    expect(at.team).toBeGreaterThan(at.install)
    expect(at.folder).toBeGreaterThan(at.install)
  }, 10_000)

  it('still offers the teams and the folder, after it', () => {
    const html = home([missing('opencode', 'OpenCode'), ...others])
    expect(html).toContain('Start with a team')
    expect(html).toContain('Choose folder')
  }, 10_000)
})

describe('Home once anything is installed', () => {
  it('leads with the team templates again', () => {
    const at = order(home([ready('opencode', 'OpenCode'), ...others]))
    expect(at.install).toBeGreaterThan(-1)
    expect(at.team).toBeGreaterThan(-1)
    expect(at.team).toBeLessThan(at.install)
    expect(at.folder).toBeLessThan(at.install)
  }, 10_000)

  it('does not reorder while an installed agent is still being checked', () => {
    const at = order(home([checking('codex', 'Codex CLI'), missing('opencode', 'OpenCode')]))
    expect(at.install).toBeGreaterThan(-1)
    expect(at.team).toBeLessThan(at.install)
  }, 10_000)
})
