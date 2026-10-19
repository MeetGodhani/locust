// `!` in the chat box, and a Markdown file as a slash command.
//
//   node _tools/drive-bang-and-commands.mjs
//
// No model turn. A command's output stays in the conversation. Choosing a
// command fills the box. A project command's ! block asks before it runs.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository()
const profile = await mkdtemp(join(tmpdir(), 'locust-bang-'))
await mkdir(join(profile, 'commands'), { recursive: true })
await writeFile(join(profile, 'commands', 'hello.md'), '---\ndescription: Say hello in the box\n---\nHello from your command.\n', 'utf8')
await mkdir(join(workspace, '.locust', 'commands'), { recursive: true })
await writeFile(join(workspace, '.locust', 'commands', 'status.md'), '---\ndescription: This folder\n---\nStatus:\n\n!`echo project-bang`\n', 'utf8')

const setBox = (text) => `(() => {
  const box = document.querySelector('textarea[aria-label="Message"]')
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  set.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  return box.value
})()`

const drive = await startDrive({
  name: 'bang-and-commands',
  port: 9463,
  workspace,
  profilePath: profile,
  sendsNothing: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-19T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, memoryMode: 'auto' }
  }
})

try {
  await drive.ready()
  await drive.resize(1200, 720)
  await drive.capture('command mode', async () => {
    await drive.evaluate(setBox('!echo hello'))
    return drive.waitForSelector('.lc-commandmode', { timeoutMs: 8000 })
  })
  const ran = await drive.capture('echo hello', async () => {
    await drive.evaluate(`(() => {
      const box = document.querySelector('textarea[aria-label="Message"]')
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      return 'enter'
    })()`)
    return drive.waitFor(`(() => {
      const out = document.querySelector('.lc-command__output')
      return out && out.textContent.includes('hello') ? out.textContent.trim() : false
    })()`, { what: 'hello in the conversation', timeoutMs: 15000 })
  })
  say(`command output: ${ran}`)
  await drive.capture('slash menu', async () => {
    await drive.evaluate(setBox('/'))
    return drive.waitFor(`(() => {
      const names = [...document.querySelectorAll('.lc-slash__name')].map((el) => el.textContent.trim())
      return names.some((name) => name.includes('/hello')) && names.some((name) => name.includes('/status')) ? names.filter((name) => name.includes('/hello') || name.includes('/status')).join(' | ') : false
    })()`, { what: 'hello and status in the menu', timeoutMs: 8000 })
  })
  const filled = await drive.capture('global command fills the box', async () => {
    await drive.evaluate(`(() => {
      const item = [...document.querySelectorAll('.lc-slash__item')].find((el) => el.querySelector('.lc-slash__name')?.textContent?.includes('/hello'))
      item.click()
      return 'clicked'
    })()`)
    return drive.waitFor(`(() => {
      const box = document.querySelector('textarea[aria-label="Message"]')
      return box && box.value.includes('Hello from your command.') ? box.value : false
    })()`, { what: 'the expanded prompt', timeoutMs: 8000 })
  })
  say(`box: ${filled}`)
  await drive.capture('project command asks', async () => {
    await drive.evaluate(setBox('/status'))
    await drive.waitForSelector('.lc-slash__item', { timeoutMs: 8000 })
    await drive.evaluate(`(() => {
      const item = [...document.querySelectorAll('.lc-slash__item')].find((el) => el.querySelector('.lc-slash__name')?.textContent?.includes('/status'))
      item.click()
      return 'clicked'
    })()`)
    return drive.waitForSelector('[aria-label="Allow this folder\'s commands"]', { timeoutMs: 8000 })
  })
  await drive.capture('settings chat', async () => {
    await drive.evaluate(`document.querySelector('button[title="Settings (Ctrl 3)"]').click()`)
    await drive.waitForSelector('.lc-settings__navitem', { timeoutMs: 8000 })
    await drive.evaluate(`(() => {
      const item = [...document.querySelectorAll('.lc-settings__navitem')].find((el) => el.textContent.trim().startsWith('Chat'))
      item.click()
      return 'chat'
    })()`)
    return drive.waitFor(`(() => {
      const heads = [...document.querySelectorAll('.lc-settings__heading')].map((el) => el.textContent.trim())
      return heads.includes('Your commands') && heads.includes('How to write one') ? heads.join(' | ') : false
    })()`, { what: 'the Chat page', timeoutMs: 8000 })
  })
} finally {
  await drive.finish({ intro: 'No model turn. `!echo hello` in the box, a global command and a project command in the / menu, and the project command asks before its ! block runs.' })
}
