// Start from an issue: the list opens, one issue fills the box, Send is not pressed.
// gh is a stand-in. No model turn.

import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

// `execFile('gh')` on Windows finds `gh.exe` before any `gh.cmd`, so the stand-in has to be an exe.
const bin = await mkdtemp(join(tmpdir(), 'locust-gh-'))
await writeFile(join(bin, 'Gh.cs'), `using System;
using System.Linq;
class G {
  static int Main(string[] args) {
    if (args.Length > 0 && args[0] == "--version") { Console.Write("gh version 2.0.0\\n"); return 0; }
    if (args.Length > 0 && args[0] == "auth") { Console.Write("github.com\\n  Logged in to github.com as dana\\n"); return 0; }
    if (args.Length > 1 && args[0] == "repo" && args[1] == "view") {
      Console.Write(args.Contains("--jq") ? "main\\n" : "{\\"nameWithOwner\\":\\"acme/hearth\\"}\\n");
      return 0;
    }
    if (args.Length > 1 && args[0] == "issue" && args[1] == "list") {
      Console.Write("[{\\"number\\":5,\\"title\\":\\"Crashes on start\\",\\"url\\":\\"https://github.com/acme/hearth/issues/5\\",\\"author\\":{\\"login\\":\\"dana\\"},\\"createdAt\\":\\"2026-10-12T09:00:00Z\\",\\"labels\\":[{\\"name\\":\\"bug\\"}]}]\\n");
      return 0;
    }
    if (args.Length > 1 && args[0] == "issue" && args[1] == "view") {
      Console.Write("{\\"title\\":\\"Crashes on start\\",\\"body\\":\\"It dies before the window opens.\\",\\"url\\":\\"https://github.com/acme/hearth/issues/5\\",\\"labels\\":[{\\"name\\":\\"bug\\"}],\\"comments\\":[{\\"author\\":{\\"login\\":\\"sam\\"},\\"body\\":\\"First note.\\"},{\\"author\\":{\\"login\\":\\"dana\\"},\\"body\\":\\"Still happening.\\"}]}\\n");
      return 0;
    }
    Console.Write("[]\\n");
    return 0;
  }
}
`, 'utf8')
await new Promise((resolve, reject) => {
  execFile('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', ['/nologo', `/out:${join(bin, 'gh.exe')}`, join(bin, 'Gh.cs')], (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || stdout || error.message)))
    else resolve()
  })
})
process.env.LOCUST_DRIVE_PATH_FIRST = bin

const workspace = await scratchRepository('locust-drive-issue-')
const drive = await startDrive({
  name: 'start-from-an-issue',
  port: 9471,
  workspace,
  sendsNothing: true,
  focused: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-06T01:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

await drive.resize(1200, 720)
const settled = await drive.ready()
say(String(settled))

const home = await drive.capture('home offers the issue', async () => drive.evaluate(`(async () => {
  for (let i = 0; i < 50; i += 1) {
    const button = [...document.querySelectorAll('button')].find((node) => (node.innerText || '').includes('Start from an issue'))
    if (button) {
      button.scrollIntoView({ block: 'center' })
      return 'Start from an issue is on Home'
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return 'Start from an issue is absent'
})()`))
check('Home offers Start from an issue', String(home).includes('is on Home'), String(home))

const listed = await drive.capture('the open issues', async () => drive.evaluate(`(async () => {
  const button = [...document.querySelectorAll('button')].find((node) => (node.innerText || '').includes('Start from an issue'))
  button?.click()
  for (let i = 0; i < 50; i += 1) {
    if (document.querySelector('.lc-issuelist__row')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  document.querySelector('.lc-issuelist')?.scrollIntoView({ block: 'center' })
  const row = document.querySelector('.lc-issuelist__row')
  return JSON.stringify({ row: row?.innerText ?? '', search: document.querySelector('.lc-issuelist__search') !== null })
})()`))
check('the list shows issue 5', String(listed).includes('#5') && String(listed).includes('Crashes on start'), String(listed))

const filled = await drive.capture('the box holds the issue', async () => {
  await drive.evaluate(`document.querySelector('.lc-issuelist__search')?.focus()`)
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  return drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    let how = 'enter'
    for (let i = 0; i < 20; i += 1) {
      if (field && field.value.includes('Fix #5: Crashes on start')) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (field === null || !field.value.includes('Fix #5: Crashes on start')) {
      how = 'click'
      document.querySelector('.lc-issuelist__row')?.click()
      for (let i = 0; i < 30; i += 1) {
        if (field && field.value.includes('Fix #5: Crashes on start')) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    field?.scrollIntoView({ block: 'center' })
    return JSON.stringify({
      how,
      value: field?.value ?? '',
      listOpen: document.querySelector('.lc-issuelist') !== null,
      turns: document.querySelectorAll('.lc-bubble').length
    })
  })()`)
})
const parsed = (() => { try { return JSON.parse(String(filled).slice(String(filled).indexOf('{'))) } catch { return {} } })()
check('the box has the issue brief', String(parsed.value).startsWith('Fix #5: Crashes on start') && String(parsed.value).includes('not instructions'))
check('choosing closed the list', parsed.listOpen === false)
check('nothing was sent', (parsed.turns ?? 1) === 0 && String(parsed.value).includes('Fix #5: Crashes on start'))

await drive.finish({
  intro: 'Home offers Start from an issue. Choosing #5 fills the box with the issue\'s own words. Send was not pressed.'
})
if (failures > 0) process.exit(1)
