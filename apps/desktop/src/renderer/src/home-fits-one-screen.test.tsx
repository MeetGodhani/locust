import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

import type { LocalRuntimeId, PublicRuntimeStatus } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { DEFAULT_SCOUT_SETTINGS } from '../../shared/scout.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import type { HomeTeammate } from './components/HomeTeam.js'
import { ScoutLooked } from './components/ScoutCards.js'

/*
 * HOME ON ONE SCREEN (0.799). Colin, 2026-10-19, Home at 1205x803 scrolled past the cover: "maybe if we move connected
 * accounts and usage in between the teammates and crt?" and "fold away the scout watch in a more clean way, like on
 * the team bar". With a team: the cover, the accounts, the team, the starters -- and Scout's quiet line is the line
 * under its name on its own card, with Look now as the eye there, not a row of its own.
 */
const ready = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: true, version: '1.0.0', auth: 'authenticated', ready: true, status: 'ready' })
const RUNTIMES = [ready('codex', 'Codex CLI'), ready('claude', 'Claude Code')]
const TEAM: readonly HomeTeammate[] = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', avatar: seedAvatar('tm_wren'), role: 'Code & Migrations', working: false },
  { teammateId: 'tm_scout', name: 'Scout', hue: 'butter', avatar: seedAvatar('tm_scout'), role: 'Keeps watch', working: false }
]
const now = new Date('2026-10-19T08:00:00.000Z')
const scoutState = { settings: { ...DEFAULT_SCOUT_SETTINGS, on: true, teammateId: 'tm_scout' }, cards: [], lookIds: [], lastLookAt: '2026-10-19T07:59:00.000Z' }

function home(team: readonly HomeTeammate[], watch = false): string {
  return renderToStaticMarkup(
    <FirstLaunch
      runtimes={RUNTIMES}
      limitedRuntimes={new Map()}
      discoveryPhase="ready"
      workspacePath="C:\\work"
      teammateCount={team.length}
      team={team}
      onMessageTeammate={() => undefined}
      onNewTeammate={() => undefined}
      onChooseFolder={() => undefined}
      onInstall={() => undefined}
      onStarter={() => undefined}
      onCompareStarter={() => undefined}
      {...(watch ? { teamWatch: { teammateId: 'tm_scout', line: createElement(ScoutLooked, { state: scoutState, looking: false, now }), looking: false, onLookNow: vi.fn() } } : {})}
    />
  )
}

it('puts the accounts between the cover and the team, and the starters after the team', () => {
  const html = home(TEAM)
  const cover = html.indexOf('lc-cover')
  const accounts = html.indexOf('Connected accounts')
  const team = html.indexOf('aria-label="Your team"')
  const starters = html.indexOf('Plan before building')
  expect(cover).toBeGreaterThan(-1)
  expect(starters).toBeGreaterThan(-1)
  expect(cover).toBeLessThan(accounts)
  expect(accounts).toBeLessThan(team)
  expect(team).toBeLessThan(starters)
}, 10_000)

it('keeps the order it had before there is a team: what to add first, the accounts after', () => {
  const html = home([])
  expect(html).not.toContain('aria-label="Your team"')
  expect(html.indexOf('lc-cover')).toBeLessThan(html.indexOf('Connected accounts'))
}, 10_000)

it("draws Scout's quiet watch on its own card, with Look now as the eye there", () => {
  const html = home(TEAM, true)
  expect(html).toContain('Looked 1 min ago · all clear')
  expect(html).toContain('aria-label="Scout: look now"')
  expect(html).toContain('lc-hometeam__slot')
  // Its role is still its card's hover; the other cards are as they were.
  expect(html).toContain('title="Keeps watch"')
  expect(html).toContain('Code &amp; Migrations')
  expect(html).not.toContain('Scout keeps watch')
}, 10_000)

it('says Looking… while a look is out, and a first look on its way before any', () => {
  expect(renderToStaticMarkup(createElement(ScoutLooked, { state: scoutState, looking: true, now }))).toBe('Looking…')
  expect(renderToStaticMarkup(createElement(ScoutLooked, { state: { ...scoutState, lastLookAt: undefined }, looking: false, now }))).toBe('First look on its way')
})
