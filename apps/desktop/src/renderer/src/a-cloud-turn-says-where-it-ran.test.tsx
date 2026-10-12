import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicCloudTurn } from '../../shared/cloud-computer.js'
import { startPhaseLabel } from '../../shared/start-phase.js'
import { CloudChangeCard, CloudMarker } from './components/CloudTurn.js'
import { CloudSetupDialog } from './components/CloudSetupDialog.js'
import { relativePath } from './missionView.js'

/*
 * A TURN ON YOUR CLOUD COMPUTER, ON SCREEN (0.761). Its work streams in like any turn's; what is different is said
 * where it matters: under the person's words, where it ran; under its work, what became of its change -- which stays
 * on the cloud computer until the person brings it home.
 */
const turn = (state: PublicCloudTurn['state'], extra: Partial<PublicCloudTurn> = {}): PublicCloudTurn => ({
  missionId: 'mission_1',
  codespace: 'locust-hearth-x7q9',
  repo: 'acme/hearth',
  branch: 'main',
  taskId: 't_ab12cd34ef56',
  state,
  files: [{ path: 'src/dates.ts', added: 12, removed: 4 }, { path: 'tests/dates.test.ts', added: 6, removed: 2 }],
  ...extra
})
const card = (shown: PublicCloudTurn): string =>
  renderToStaticMarkup(<CloudChangeCard turn={shown} onPatch={async () => undefined} onApply={async () => undefined} onDiscard={async () => undefined} />)

describe('a turn on the cloud computer, in the thread', () => {
  it('says where it ran, between the words and the work', () => {
    const html = renderToStaticMarkup(<CloudMarker turn={turn('working')} />)
    expect(html).toContain('On your cloud computer')
    expect(html).toContain('hearth · main · 2 CPUs, 8 GB')
  })

  it('offers its change, still there, with what it touched', () => {
    const html = card(turn('there'))
    expect(html).toContain('The change is on your cloud computer')
    expect(html).toContain('2 files · ')
    expect(html).toContain('+18')
    expect(html).toContain('−6')
    expect(html).toContain('not here yet')
    expect(html).toContain('src/dates.ts')
    expect(html).toMatch(/>\s*Show the change</)
    expect(html).toContain('>Apply to this folder</button>')
    expect(html).toContain('>Discard…</button>')
    expect(html).toContain('the next turn carries on from it there')
  })

  it('says it was brought home, and says nothing more for a change a later turn carries', () => {
    expect(card(turn('home', { appliedAt: new Date().toISOString() }))).toContain('Brought into this folder')
    expect(card(turn('carried'))).toBe('')
    // Drawn only once the turn has ended: its change is being read.
    expect(card(turn('working'))).toContain('Reading what it changed on your cloud computer')
  })

  it('says so when nothing changed there, or when what changed could not be read', () => {
    expect(card(turn('none', { files: [] }))).toContain('No files changed on your cloud computer')
    expect(card(turn('failed', { problem: 'GitHub did not answer.' }))).toContain('GitHub did not answer.')
  })

  it("reads a path in the task's copy there as this folder's own", () => {
    expect(relativePath('/workspaces/.locust/t_ab12cd34ef56/src/dates.ts', 'C:\\work\\hearth')).toBe('src/dates.ts')
    expect(relativePath('/workspaces/.locust/t_ab12cd34ef56', 'C:\\work\\hearth')).toBe('.')
  })

  it('says each step of readying it on the live line', () => {
    expect(startPhaseLabel('cloud-making', 'OpenCode')).toBe('Making your cloud computer, about a minute')
    expect(startPhaseLabel('cloud-waking', 'OpenCode')).toBe('Waking your cloud computer, about a minute and a half')
    expect(startPhaseLabel('cloud-installing', 'OpenCode')).toBe('Setting up OpenCode on your cloud computer')
    expect(startPhaseLabel('cloud-bringing', 'OpenCode')).toBe('Bringing this folder to your cloud computer')
  })
})

describe('the first time, the dialog', () => {
  const dialog = (state: Parameters<typeof CloudSetupDialog>[0]['state']): string =>
    renderToStaticMarkup(<CloudSetupDialog state={state} teammateName="Wren" onSetUp={() => undefined} onAllow={() => undefined} onCheckAgain={() => undefined} onClose={() => undefined} />)

  it('says what it is and what it costs before anything is made', () => {
    const html = dialog({ phase: 'ask', repo: 'acme/hearth' })
    expect(html).toContain('Wren will work on a computer GitHub runs for you, with hearth on it, instead of on this PC.')
    expect(html).toContain('60 hours, from GitHub')
    expect(html).toContain('$0.18 an hour')
    expect(html).toContain('GitHub keeps the count and the bill')
    expect(html).toContain('it stops at the free hours instead of charging you')
    expect(html).toContain('>Set it up</button>')
    expect(html).toContain('>Not now</button>')
  })

  it('shows each step as it happens, the one under way marked', () => {
    const html = dialog({ phase: 'working', repo: 'acme/hearth', step: 'installing' })
    expect(html).toContain('Computer made')
    expect(html).toContain('Set up')
    expect(html).toContain('Installing OpenCode')
    expect(html).toContain('aria-current="step"')
  })

  it("asks for GitHub's permission in the person's own browser", () => {
    const html = dialog({ phase: 'permission', message: 'GitHub has not let Locust make codespaces yet. Allow it once in your browser, then send again.' })
    expect(html).toContain('>Allow it in GitHub</button>')
    expect(html).toContain('Locust never sees your GitHub sign-in')
  })
})
