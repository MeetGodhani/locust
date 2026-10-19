import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'

import { IssueList } from './components/IssueList.js'
import { StarterList } from './components/StarterList.js'

const composer = readFileSync(fileURLToPath(new URL('./components/Composer.tsx', import.meta.url)), 'utf8')

it('lists the issue and does not send by being chosen', () => {
  const html = renderToStaticMarkup(
    <IssueList
      issues={[{ number: 5, title: 'Crashes on start', url: 'https://github.com/acme/hearth/issues/5', author: 'dana', createdAt: '2026-10-12T09:00:00Z', labels: ['bug'] }]}
      onChoose={() => undefined}
      onClose={() => undefined}
    />
  )
  expect(html).toContain('#5')
  expect(html).toContain('Crashes on start')
  expect(html).toContain('dana')
  expect(html).toContain('bug')
  expect(html).not.toContain('<form')
  expect(html).toContain('type="button"')
  const branch = composer.slice(composer.indexOf("command.action.kind === 'issues'"))
  expect(branch.slice(0, branch.indexOf('return'))).toContain('onPickIssue')
  expect(branch.slice(0, branch.indexOf('return'))).not.toContain('onQueue')
  expect(branch.slice(0, branch.indexOf('return'))).not.toContain('onStart')
})

it('offers Start from an issue on Home only when the folder has issues to read', () => {
  const absent = renderToStaticMarkup(<StarterList onStart={() => undefined} onCompareStart={() => undefined} />)
  expect(absent).not.toContain('Start from an issue')
  const present = renderToStaticMarkup(<StarterList onStart={() => undefined} onCompareStart={() => undefined} onIssue={() => undefined} />)
  expect(present).toContain('Start from an issue')
  expect(present).not.toContain('Compare models on: Start from an issue')
})
