// A company's policy file, as the person on that computer sees it (0.791, 0.792).
//
//   node _tools/drive-an-organization-policy.mjs
//
// The development build reads a policy from LOCUST_POLICY_FILE (a packaged copy reads only the machine-wide path):
// OpenCode only, nothing above Accept edits, a $20 cap, other apps off. Then Settings must say "Managed by your
// organization" with each setting in words, and the other-apps switch must be set and say who set it. A second
// launch with a broken file must say so and name it. Sends nothing.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const folder = await mkdtemp(join(tmpdir(), 'locust-policy-'))
const policyFile = join(folder, 'policy.json')
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Code & Migrations', createdAt: '2026-10-18T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}
const press = (label) => `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const button = [...document.querySelectorAll('button, a, [role="tab"]')].find((b) => flat(b) === ${JSON.stringify(label)})
  if (!button) return 'no ${label}'
  button.click()
  await new Promise((r) => setTimeout(r, 900))
  return 'pressed ${label}'
})()`
const sectionText = `(() => { const heading = [...document.querySelectorAll('h2')].find((h) => h.innerText.trim() === 'Managed by your organization'); return heading?.closest('section')?.innerText.replace(/\\s+/g, ' ') ?? '' })()`

await writeFile(policyFile, JSON.stringify({ version: 1, allowedAgents: ['opencode'], highestMode: 'accept-edits', monthlyLimitUsd: 20, otherApps: false }), 'utf8')
const workspace = await scratchRepository('locust-policy-ws-', 'A small project for a look at a managed computer.\n')
const drive = await startDrive({ name: 'organization-policy', port: 9835, workspace, seed, sendsNothing: true, env: { LOCUST_POLICY_FILE: policyFile } })
await drive.ready()
try {
  await drive.capture('settings on a managed computer', async () => {
    say(`  ${String(await drive.evaluate(press('Settings')))}`)
    await drive.waitFor(`${sectionText}.length > 0`, { what: 'the managed section', timeoutMs: 15_000 }).catch(() => undefined)
    const words = String(await drive.evaluate(sectionText))
    check('Settings says the computer is managed, and by which file', words.includes('Managed by your organization') && words.includes(policyFile), words.slice(0, 160))
    for (const line of ['Allowed AI agents: OpenCode', 'Highest permission mode: Accept edits', 'Maximum monthly limit per teammate (USD): $20 a month', 'Access from other AI apps, the locust command and editors: Off']) check(`it says "${line}"`, words.includes(line), words.slice(0, 400))
    check('in words, not the file\'s JSON', !/[[{]"|accept-edits/.test(words), words.slice(0, 200))
    const other = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => { const s = document.querySelector('button[aria-label="Let your other AI apps use Locust"]'); return { found: !!s, disabled: s?.disabled ?? null, checked: s?.getAttribute('aria-checked') ?? null, said: s?.closest('.lc-settingline')?.innerText.replace(/\\s+/g, ' ') ?? '' } })())`)))
    check('the other-apps switch is off, cannot be changed, and says who set it', other.found && other.disabled === true && other.checked === 'false' && other.said.includes('Set by your organization'), JSON.stringify(other).slice(0, 240))
    // Nothing offered that the policy forbids, and no refusal before anything was pressed (0.792).
    const page = String(await drive.evaluate(`document.body.innerText.replace(/\\s+/g, ' ')`))
    check('no Add to the Claude app to press, and no refusal at rest', !page.includes('Add to the Claude app') && !page.includes('Nothing was started'), page.slice(page.indexOf('Let your other AI apps'), page.indexOf('Let your other AI apps') + 300))
    return words.slice(0, 300)
  })
} finally {
  await drive.finish({ intro: 'A company policy file, as Settings shows it.', last: false })
}

await writeFile(policyFile, '{ "version": 1, "highestMode": "everything" ', 'utf8')
const broken = await startDrive({ name: 'organization-policy-broken', port: 9836, workspace, seed, sendsNothing: true, env: { LOCUST_POLICY_FILE: policyFile } })
await broken.ready()
try {
  await broken.capture('a broken policy file', async () => {
    say(`  ${String(await broken.evaluate(press('Settings')))}`)
    await broken.waitFor(`${sectionText}.length > 0`, { what: 'the managed section', timeoutMs: 15_000 }).catch(() => undefined)
    const words = String(await broken.evaluate(sectionText))
    check('a broken file is said, with its name, and nothing will start', words.includes('cannot use the organization policy') && words.includes(policyFile) && words.includes('No turns or connections will start'), words.slice(0, 300))
    return words.slice(0, 300)
  })
} finally {
  await broken.finish({ intro: 'A broken company policy file.' })
}
say(failures === 0 ? 'ORGANIZATION POLICY DRIVE PASSED' : `${String(failures)} ORGANIZATION POLICY DRIVE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
