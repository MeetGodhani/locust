import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OrganizationPolicyContext, OrganizationPolicyNotice, OrganizationPolicySettings } from './organizationPolicy.js'
import type { OrganizationPolicyState } from '../../shared/organization-policy.js'
import { LocustMcpSettings } from './components/LocustMcpSettings.js'
import { PhoneSettings } from './components/PhoneSettings.js'
import { RoutePicker } from './components/RoutePicker.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { matchedHeadings, pageMatches, SETTINGS_PAGES } from './settingsPages.js'

const policy: OrganizationPolicyState = { path: '/admin/Locust/policy.json', present: true, policy: { allowedAgents: ['codex'], allowedModels: { codex: ['safe'] }, highestMode: 'plan', monthlyLimitUsd: 10, otherApps: false, phone: false, cloud: false } }

describe('managed controls', () => {
  it('finds organization policy in the General settings search', () => {
    const general = SETTINGS_PAGES.find((page) => page.id === 'app')!
    expect(pageMatches(general, 'policy')).toBe(true)
    expect(matchedHeadings(general, 'policy')).toContain('Managed by your organization')
  })
  it('names the file and every setting in Settings', () => {
    const html = renderToStaticMarkup(<OrganizationPolicyContext.Provider value={policy}><OrganizationPolicySettings /></OrganizationPolicyContext.Provider>)
    expect(html).toContain('Managed by your organization')
    expect(html).toContain('/admin/Locust/policy.json')
    for (const phrase of ['Allowed AI agents', 'Allowed models', 'Highest permission mode', 'Maximum monthly limit', 'Phone pairing', 'Cloud computers and tasks', 'Access from other AI apps']) expect(html).toContain(phrase)
    expect(renderToStaticMarkup(<OrganizationPolicySettings />)).toBe('')
  })

  it('shows a broken policy as an alert with its path', () => {
    const html = renderToStaticMarkup(<OrganizationPolicyContext.Provider value={{ ...policy, error: 'Fix /admin/Locust/policy.json. Nothing starts.' }}><OrganizationPolicyNotice /></OrganizationPolicyContext.Provider>)
    expect(html).toContain('role="alert"')
    expect(html).toContain('/admin/Locust/policy.json')
  })

  it('leaves the phone and other-app switches visible, off, disabled and attributed', () => {
    const html = renderToStaticMarkup(<OrganizationPolicyContext.Provider value={policy}><LocustMcpSettings /><PhoneSettings /></OrganizationPolicyContext.Provider>)
    expect(html.match(/Set by your organization/g)).toHaveLength(2)
    for (const label of ['Let your other AI apps use Locust', 'Use Locust from your phone']) expect(html).toMatch(new RegExp(`aria-label="${label}"[^>]*aria-checked="false"[^>]*disabled=""`))
  })

  it('filters the picker including account-default fallbacks', () => {
    const html = renderToStaticMarkup(<OrganizationPolicyContext.Provider value={policy}><RoutePicker runtimes={[{ id: 'codex', displayName: 'Codex', installed: true, ready: true, auth: 'authenticated', status: 'ready', version: '1' }, { id: 'claude', displayName: 'Claude', installed: true, ready: true, auth: 'authenticated', status: 'ready', version: '1' }]} models={[{ id: 'safe', runtime: 'codex', displayName: 'Allowed model', description: '', supportedEfforts: [] }, { id: 'blocked', runtime: 'codex', displayName: 'Blocked model', description: '', supportedEfforts: [] }]} active={{ runtime: 'codex', model: 'safe' }} resolvedModels={new Map()} recentRoutes={[]} limitedRuntimes={new Map()} onSelect={() => undefined} onClose={() => undefined} /></OrganizationPolicyContext.Provider>)
    expect(html).toContain('Allowed model')
    expect(html).not.toContain('Blocked model')
    expect(html).not.toContain('account-default')
    expect(html).not.toContain('Claude · your account')
  })

  it('shows the maximum monthly limit while allowing a lower personal amount', () => {
    const html = renderToStaticMarkup(<OrganizationPolicyContext.Provider value={policy}><NewTeammateDialog mode="ask" error={undefined} onCancel={() => undefined} onCreate={() => undefined} /></OrganizationPolicyContext.Provider>)
    expect(html).toContain('Set by your organization')
    expect(html).toContain('Maximum 10.00 USD. You can set a lower amount.')
    expect(html).toContain('value="10.00"')
    expect(html).not.toContain('placeholder="No limit"')
  })

  it('applies the ceiling to the mode menu, slash commands and the keyboard cycle', () => {
    const composer = readFileSync(new URL('./components/Composer.tsx', import.meta.url), 'utf8')
    expect(composer).toContain('MODES.filter((option) => policyModeAllowed(policy, option.mode)).map(')
    expect(composer).toContain('modes: modesFor(route.runtime, platform).filter((value) => policyModeAllowed(policy, value))')
    expect(composer).toContain('(option) => policyModeAllowed(policy, option.mode) && modeUnavailableReason(')
    const settings = readFileSync(new URL('./components/Screens.tsx', import.meta.url), 'utf8')
    expect(settings).toContain('disabled={autoManaged}')
  })
})
