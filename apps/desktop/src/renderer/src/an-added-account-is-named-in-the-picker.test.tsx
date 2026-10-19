import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptAccounts } from './agentAccounts.js'
import { RoutePicker } from './components/RoutePicker.js'
import { AgentAccountsSettings } from './components/AgentAccountsSettings.js'
import { OrganizationPolicyContext } from './organizationPolicy.js'
import type { AgentAccount } from '../../shared/agent-accounts.js'
import type { PublicRuntimeStatus } from '../../shared/ipc.js'

const a: AgentAccount = { id: `account_${'a'.repeat(32)}`, runtime: 'codex', name: 'Work', state: 'new' }
const b: AgentAccount = { id: `account_${'b'.repeat(32)}`, runtime: 'codex', name: 'Personal', state: 'ready' }
const runtime: PublicRuntimeStatus = { id: 'codex', displayName: 'Codex CLI', installed: true, version: '0.163.0', auth: 'authenticated', ready: true, status: 'ready' }
afterEach(() => adoptAccounts([]))
const picker = () => <RoutePicker runtimes={[runtime]} models={[]} active={{ runtime: 'codex', model: 'account-default', account: a.id }} resolvedModels={new Map()} recentRoutes={[]} limitedRuntimes={new Map([['codex', 'The machine account is at its limit']])} onSelect={() => undefined} onClose={() => undefined} />

describe('the accounts a person can pick', () => {
  it('names both accounts alongside the machine sign-in and separates their limit status', () => {
    adoptAccounts([a, b])
    const html = renderToStaticMarkup(picker())
    expect(html).toContain('Work')
    expect(html).toContain('Personal')
    expect(html).toContain('AT LIMIT')
    expect(html).toContain('is-active')
  })

  it('hides added routes under organization policy while saying why Add is unavailable', () => {
    adoptAccounts([a])
    const state = { present: true, path: '/policy.json', policy: { accounts: false } }
    const html = renderToStaticMarkup(<OrganizationPolicyContext value={state}>{picker()}<AgentAccountsSettings runtime="codex" /></OrganizationPolicyContext>)
    expect(html).toContain('Set by your organization')
    const pickerHtml = renderToStaticMarkup(<OrganizationPolicyContext value={state}>{picker()}</OrganizationPolicyContext>)
    expect(pickerHtml).not.toContain('Work')
    expect(html).toContain('disabled=""')
  })

  it('shows the agent-owned sign-in card without starting a login on render', () => {
    adoptAccounts([a, { ...b, state: 'waiting' }])
    const html = renderToStaticMarkup(<AgentAccountsSettings runtime="codex" />)
    expect(html).toContain('Ready to sign in.')
    expect(html).toContain('Finish signing in in your browser.')
    expect(html).toContain('Cancel sign-in')
    expect(html).toContain('Rename')
    expect(html).toContain('Remove')
    expect(html).toContain('Add another account')
  })
})
