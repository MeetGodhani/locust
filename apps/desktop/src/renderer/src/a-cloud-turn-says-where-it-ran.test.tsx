import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { cloudFilesHere, type PublicCloudTurn } from '../../shared/cloud-computer.js'
import { startPhaseLabel } from '../../shared/start-phase.js'
import { ActivityCard } from './components/ActivityCard.js'
import { CloudChangeCard, CloudMarker } from './components/CloudTurn.js'
import { CloudSetupDialog } from './components/CloudSetupDialog.js'
import { FilesElsewhere, RanOnTheCloud } from './filesElsewhere.js'
import { relativePath, type ActivityDetail } from './missionView.js'

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

  /*
   * 0.762, the canvas's third button: the change waiting there can go to a pull request on GitHub instead of this
   * folder -- or to the conversation's own pull request, by number, while that one is open.
   */
  it('offers a pull request beside Apply, and the open one by its number', () => {
    const offered = (shown: PublicCloudTurn): string =>
      renderToStaticMarkup(<CloudChangeCard turn={shown} onPatch={async () => undefined} onApply={async () => undefined} onDiscard={async () => undefined} onPullRequest={async () => undefined} asks={['Add a dates helper.']} teammate="Wren" />)
    expect(offered(turn('there'))).toMatch(/Open a pull request<\/button>/)
    expect(offered(turn('there', { openPullRequest: { number: 7, url: 'https://github.com/acme/hearth/pull/7' } }))).toMatch(/Add to pull request #7<\/button>/)
    // Not offered where the host cannot open one.
    expect(card(turn('there'))).not.toContain('pull request')
  })

  it('says a change went to a pull request, with a way to open it', () => {
    const html = card(turn('pr', { pullRequest: { number: 7, url: 'https://github.com/acme/hearth/pull/7', into: 'main' } }))
    expect(html).toContain('Sent to pull request #7')
    expect(html).toContain('into main')
    expect(html).toContain('>Open on GitHub</button>')
    expect(html).toContain('2 files · +18 −6')
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

/*
 * 0.762: a cloud turn's file rows offered Open, Copy and Show in the file manager -- each acting on this folder's
 * file of that name, which was not the one the turn made (on 0.761, an ADDED file that was not here at all). While
 * its change is not here, the rows open onto the change and offer nothing else.
 */
describe("a cloud turn's files, while they are not in this folder", () => {
  ;(globalThis as { window?: unknown }).window = { desktop: { platform: 'win32' } }
  const patch = ['--- /dev/null', '+++ b/greeting.txt', '@@ -0,0 +1 @@', '+hello from the cloud'].join('\n')
  const detail = { kind: 'edit', name: '/workspaces/.locust/t_ab12cd34ef56/greeting.txt', tool: 'write', settled: true, patch: { text: patch } } as unknown as ActivityDetail
  const rows = (where: string | undefined): string =>
    renderToStaticMarkup(
      <FilesElsewhere.Provider value={where}>
        <ActivityCard summary="" variant="files" oneRowPerFile details={[detail]} runtimeName="OpenCode" workspacePath="C:/work/hearth" openByDefault onOpenFile={() => undefined} />
      </FilesElsewhere.Provider>
    )

  it('offers Open, Copy and Show for a turn that ran here', () => {
    const html = rows(undefined)
    expect(html).toContain('lc-filerow__view')
    expect(html).toContain('lc-filerow__copy')
    expect(html).toContain('lc-filerow__reveal')
  })

  it('offers none of them while the change is on the cloud computer, and says where it is', () => {
    const html = rows('On your cloud computer, not in this folder yet')
    expect(html).toContain('greeting.txt')
    expect(html).not.toContain('lc-filerow__view')
    expect(html).not.toContain('lc-filerow__copy')
    expect(html).not.toContain('lc-filerow__reveal')
    expect(html).toContain('On your cloud computer, not in this folder yet')
  })

  /*
   * 0.763: OpenCode's `write` over a file reports no diff, and here the folder fills it in -- a cloud turn's never
   * was, so its row read "OpenCode did not report the change" right above the card that holds it (packaged 0.762).
   */
  it('says an edit reported without its diff changed on the cloud computer, not that the runtime failed to say', () => {
    const written = { kind: 'edit', name: '/workspaces/.locust/t_ab12cd34ef56/greeting.txt', tool: 'write', settled: true } as unknown as ActivityDetail
    const row = (ranThere: boolean): string =>
      renderToStaticMarkup(
        <RanOnTheCloud.Provider value={ranThere}>
          <ActivityCard summary="" variant="files" oneRowPerFile details={[written]} runtimeName="OpenCode" workspacePath="C:/work/hearth" openByDefault />
        </RanOnTheCloud.Provider>
      )
    expect(row(true)).toContain('changed on your cloud computer')
    expect(row(true)).not.toContain('did not report the change')
    expect(row(false)).toContain('OpenCode did not report the change')
  })

  it('knows when they are here: a turn that ran here, a change brought home, or one carried into a change that was', () => {
    expect(cloudFilesHere(undefined)).toBe(true)
    expect(cloudFilesHere(turn('home'))).toBe(true)
    expect(cloudFilesHere(turn('there'))).toBe(false)
    expect(cloudFilesHere(turn('working'))).toBe(false)
    expect(cloudFilesHere(turn('pr'))).toBe(false)
    expect(cloudFilesHere(turn('carried'))).toBe(false)
    expect(cloudFilesHere(turn('carried', { outcome: 'home' }))).toBe(true)
    expect(cloudFilesHere(turn('carried', { outcome: 'pr' }))).toBe(false)
  })
})

describe('the first time, the dialog', () => {
  const dialog = (state: Parameters<typeof CloudSetupDialog>[0]['state']): string =>
    renderToStaticMarkup(<CloudSetupDialog state={state} teammateName="Wren" onSetUp={() => undefined} onSignIn={() => undefined} onStopSignIn={() => undefined} onAllow={() => undefined} onCheckAgain={() => undefined} onClose={() => undefined} />)

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
