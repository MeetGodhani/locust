// Home on one screen (0.799): with a team of six and Scout keeping watch, the cover, the accounts, the team and the
// starters fit without scrolling, and Scout's quiet line is on its own card.
//
//   node _tools/drive-home-on-one-screen.mjs [--packaged <exe>]
//
// Colin, 2026-10-19, Home at 1205x803 scrolled past the cover: "is there a way to fit all this in one screen with no
// scrolling", "maybe if we move connected accounts and usage in between the teammates and crt?" and "fold away the
// scout watch in a more clean way, like on the team bar". Free models only: Scout's look reads with the free route.

import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const workspace = await scratchRepository('locust-drive-home-one-screen-ws-')
const at = '2026-10-19T05:00:00.000Z'
const mate = (teammateId, name, hue, role) => ({ teammateId, name, hue, role, createdAt: at, route: FREE_ROUTE })
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'home-on-one-screen',
  port: 9641,
  workspace,
  outPath: join(recordRoot('home-on-one-screen-2026-10-19'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [
      mate('tm_codex', 'Codex', 'blue', 'Code & Migrations'),
      mate('tm_bro', 'Bro', 'clay', 'Research & Briefs'),
      mate('tm_claude', 'Claude', 'clay', 'Ops & Scheduling'),
      mate('tm_casper', 'Casper', 'violet', 'Code & Migrations'),
      mate('tm_toaster', 'Toaster', 'lime', 'Code & Migrations')
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}

const MEASURE = `(() => {
  const pane = document.querySelector('.lc-empty')
  if (pane === null) return JSON.stringify({ pane: false })
  pane.scrollTop = 0
  const top = (selector) => { const el = pane.querySelector(selector); return el === null ? null : Math.round(el.getBoundingClientRect().top) }
  const scoutCard = [...pane.querySelectorAll('.lc-hometeam__slot')].map((slot) => slot.innerText.replace(/\\s+/g, ' ').trim())
  return JSON.stringify({
    window: innerWidth + 'x' + innerHeight,
    overflowPx: Math.round(pane.scrollHeight - pane.clientHeight),
    cover: top('.lc-cover'),
    accounts: top('.lc-agenthead'),
    team: top('.lc-hometeam'),
    starters: top('.lc-homestarts'),
    scoutLine: document.querySelector('section[aria-label="Scout keeps watch"]') !== null,
    scoutCard,
    look: document.querySelector('.lc-hometeam__slot .lc-hometeam__look') !== null,
    tight: pane.classList.contains('is-tight'),
    coverK: getComputedStyle(pane.querySelector('.lc-cover') ?? pane).getPropertyValue('--lc-cover-k'),
    coverGrow: getComputedStyle(pane.querySelector('.lc-cover') ?? pane).getPropertyValue('--lc-cover-grow'),
    coverBox: (() => { const c = pane.querySelector('.lc-cover'); return c === null ? null : Math.round(c.getBoundingClientRect().height) + 'x' + Math.round(c.clientWidth) })(),
    paneTop: Math.round(pane.getBoundingClientRect().top), padTop: getComputedStyle(pane).paddingTop
  })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  // Before Scout is decided Home offers it (0.808): the offer stood four lines tall above the team and Home scrolled at
  // 1205x803, which this drive never saw -- it turned Scout on first. Now it is a card in Scout's place on the team.
  await drive.waitFor(`document.querySelector('.lc-hometeam__card.is-invite') !== null`, { timeoutMs: 20_000, what: 'Scout offered on the team' })
  for (const [width, height] of [[1205, 803], [1366, 768], [1440, 900]]) {
    await drive.resize(width, height)
    await sleep(1500)
    const measured = JSON.parse(String(await drive.capture(`Home offering Scout at ${width}x${height}`, () => drive.evaluate(MEASURE))))
    say(JSON.stringify(measured))
    check(`${width}x${height}, offering Scout: no scrolling`, measured.overflowPx <= 0, `overflow ${measured.overflowPx}px`)
  }
  // The offered seat in light, where a dashed edge on paper is the faintest it gets.
  await drive.evaluate(`window.desktop.setTheme('light')`)
  await drive.resize(1205, 803)
  await sleep(800)
  const light = JSON.parse(String(await drive.capture('Home offering Scout, light, at 1205x803', () => drive.evaluate(MEASURE))))
  check('1205x803 light, offering Scout: no scrolling', light.overflowPx <= 0, `overflow ${light.overflowPx}px`)
  await drive.evaluate(`window.desktop.setTheme('dark')`)
  // Turned on the way Home's Meet Scout does: Scout joins the team as its sixth, on the free route.
  const turned = String(await drive.evaluate(`window.desktop.scout.turnOn(${JSON.stringify(FREE_ROUTE)}).then((s) => JSON.stringify(s.settings))`))
  check('Scout is on, on the team', /"on":true/.test(turned) && /"teammateId":"/.test(turned), turned)
  // Home's own button refreshes the roster after it; a call from here does not, so the window reads it again.
  await drive.evaluate('location.reload()').catch(() => undefined)
  await sleep(4000)
  await drive.waitFor(`document.querySelector('.lc-hometeam__slot') !== null`, { timeoutMs: 20_000 }).catch(() => undefined)
  for (const [width, height] of [[1205, 803], [1366, 768], [1440, 900], [1280, 720]]) {
    await drive.resize(width, height)
    await sleep(1500)
    const measured = JSON.parse(String(await drive.capture(`Home at ${width}x${height}`, () => drive.evaluate(MEASURE))))
    say(JSON.stringify(measured))
    // 720 tall is under every size this promises; it is measured and said, and scrolls with its top faded.
    if (height >= 768) check(`${width}x${height}: no scrolling`, measured.overflowPx <= 0, `overflow ${measured.overflowPx}px`)
    else say(`  [INFO] ${width}x${height}: overflow ${measured.overflowPx}px`)
    check(`${width}x${height}: cover, accounts, team, starters in that order`, measured.cover < measured.accounts && measured.accounts < measured.team && (measured.starters === null || measured.team < measured.starters), JSON.stringify(measured))
    check(`${width}x${height}: Scout's line is on its card, not a row of its own`, !measured.scoutLine && measured.look && measured.scoutCard.some((text) => /Scout/.test(text) && /(Looked|Looking|First look)/.test(text)), JSON.stringify(measured.scoutCard))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Home with a team of six and Scout on, at four sizes: no scrolling, accounts between the cover and the team, Scout's line on its card.` })
}
say(failures === 0 ? 'ALL PASSED' : `${String(failures)} FAILED`)
process.exit(failures === 0 ? 0 : 1)
