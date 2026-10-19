import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { leaveCommandMode } from '../../shared/own-commands.js'
import { CommandAsk, CommandEntry, CommandModeNote } from './components/OwnCommand.js'

const composer = readFileSync(fileURLToPath(new URL('./components/Composer.tsx', import.meta.url)), 'utf8')

it('shows command mode in the box, and Escape leaves it', () => {
  const html = renderToStaticMarkup(<CommandModeNote />)
  expect(html).toContain('Command mode')
  expect(html).toContain('Escape leaves it')
  expect(html).toContain('role="status"')
  expect(leaveCommandMode('!echo hello')).toBe('echo hello')
})

it('shows the person\'s command, its output and its exit code, and Stop only while it runs', () => {
  const running = renderToStaticMarkup(<CommandEntry command={{ id: 'c1', command: 'echo hello', output: '', exitCode: null, stopped: false, running: true }} onStop={() => undefined} />)
  expect(running).toContain('!echo hello')
  expect(running).toContain('Running')
  expect(running).toContain('aria-label="Stop this command"')
  const done = renderToStaticMarkup(<CommandEntry command={{ id: 'c1', command: 'echo hello', output: 'hello', exitCode: 0, stopped: false, running: false }} />)
  expect(done).toContain('hello')
  expect(done).toContain('Exit 0')
  expect(done).not.toContain('Stop this command')
})

it('asks before a project command runs, and choosing one fills the box instead of sending', () => {
  const html = renderToStaticMarkup(<CommandAsk lines={['echo project-bang']} onAllow={() => undefined} onNotNow={() => undefined} />)
  expect(html).toContain('echo project-bang')
  expect(html).toContain('Allow')
  expect(html).toContain('Not now')
  expect(html).not.toContain('<form')
  const branch = composer.slice(composer.indexOf("command.action.kind === 'own'"))
  expect(branch).toContain('onChooseOwnCommand')
  expect(branch.slice(0, branch.indexOf('return'))).not.toContain('onQueue')
  const submit = composer.slice(composer.indexOf('const submit ='))
  expect(submit.slice(0, submit.indexOf('const drafted'))).toContain('commandAsk !== undefined')
})
