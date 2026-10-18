// The light theme, looked at screen by screen (0.790).
//
//   node _tools/drive-light-mode.mjs [--packaged <Locust.exe>]
//
// Settings > Appearance > Theme is set the way a person sets it -- the
// control itself -- and each screen a first hour opens is photographed in
// light, at the three window sizes the layout passes use, with a turn on the
// free model on screen so the thread, a tool step, a file the turn wrote and
// its code are all drawn. Then the same screens in dark, so a change to a
// shared token can be read against what dark looked like. Spends nothing.

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-light-ws-', 'A small project for a look at the light theme.\n')
const drive = await startDrive({
  name: 'light-mode',
  port: 9831,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Code & Migrations', createdAt: '2026-10-18T00:00:00.000Z', route: FREE_ROUTE },
      { teammateId: 'tm_iris', name: 'Iris', hue: 'violet', role: 'Research & Briefs', createdAt: '2026-10-18T00:01:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
await drive.ready()
try {

  const theme = () => drive.evaluate(`document.documentElement.dataset.theme ?? 'none'`)
  const press = (label) => `(async () => {
    const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
    const button = [...document.querySelectorAll('button, a, [role="tab"]')].find((b) => flat(b) === ${JSON.stringify(label)})
    if (!button) return 'no ${label}'
    button.click()
    await new Promise((r) => setTimeout(r, 900))
    return 'pressed ${label}'
  })()`
  const openSettings = press('Settings')
  const escape = `(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    return 'escaped'
  })()`
  const SIZES = [[1280, 800], [1440, 900], [1024, 700]]

  await drive.capture('home in dark, as it starts', async () => `theme: ${await theme()}`)

  // The control a person uses: Settings, Appearance, Light.
  await drive.capture('settings appearance in dark', async () => {
    await drive.evaluate(openSettings)
    return drive.evaluate(press('Appearance'))
  })
  await drive.capture('light pressed', async () => {
    const pressed = await drive.evaluate(press('Light'))
    await drive.waitFor(`document.documentElement.dataset.theme === 'light'`, { what: 'the root to be light' })
    const lede = await drive.evaluate(`[...document.querySelectorAll('.lc-settings__lede')].map((p) => p.innerText).find((t) => t.startsWith('Light.')) ?? 'no lede'`)
    return `${pressed}; theme: ${await theme()}; lede: ${lede}`
  })
  await drive.evaluate(escape)

  // A turn on screen: a reply with a list and code, and a file it wrote.
  await drive.capture('ash opened', async () => drive.evaluate(openTeammateScript('Ash')))
  await drive.capture('a turn on the free model, in light', async () => drive.evaluate(sendAndWaitScript(
    'Create a file notes.md with a heading "Plan" and a three-item list. Then reply with a short summary and a five-line JavaScript function that adds two numbers, in a code block.',
    { waitSeconds: 240 }
  )))

  for (const [width, height] of SIZES) {
    await drive.resize(width, height)
    await drive.capture(`thread in light at ${String(width)}x${String(height)}`, async () => `theme: ${await theme()}`)
  }
  await drive.resize(1280, 800)
  const home = `(async () => {
    document.querySelector('button[aria-label="Home"]')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return 'home'
  })()`
  await drive.capture('changes panel in light', async () => drive.evaluate(press('Changes')))
  await drive.evaluate(press('Changes'))
  await drive.capture('activity in light', async () => drive.evaluate(press('Activity')))
  await drive.evaluate(press('Activity'))
  await drive.capture('route picker in light', async () => drive.evaluate(`(async () => {
    const chip = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    chip?.click()
    await new Promise((r) => setTimeout(r, 900))
    return chip ? 'opened the picker' : 'no picker'
  })()`))
  await drive.evaluate(escape)
  await drive.capture('home in light', async () => drive.evaluate(home))
  await drive.capture('team in light', async () => drive.evaluate(press('Team')))
  await drive.capture('board in light', async () => drive.evaluate(press('Board')))
  await drive.evaluate(escape)
  await drive.capture('settings in light', async () => drive.evaluate(openSettings))
  await drive.capture('settings appearance in light', async () => drive.evaluate(press('Appearance')))

  // Match computer: what it comes to here, and back to Dark, which is where a person starts.
  await drive.capture('match computer', async () => {
    await drive.evaluate(press('Match computer'))
    return `theme now: ${await theme()}; ${await drive.evaluate(`[...document.querySelectorAll('.lc-settings__lede')].map((p) => p.innerText).find((t) => t.startsWith('Matches')) ?? 'no lede'`)}`
  })
  await drive.capture('dark again', async () => {
    await drive.evaluate(press('Dark'))
    await drive.waitFor(`document.documentElement.dataset.theme === 'dark'`, { what: 'the root to be dark' })
    return `theme: ${await theme()}`
  })
  await drive.evaluate(escape)
  await drive.capture('thread in dark, to compare', async () => drive.evaluate(openTeammateScript('Ash')))

} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The light theme, screen by screen, then dark again to compare (0.790).' })
}
say('done')
