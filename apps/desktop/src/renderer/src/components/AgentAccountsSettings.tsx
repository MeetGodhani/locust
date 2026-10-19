import { useEffect, useState } from 'react'
import { supportsAccounts, accountUsageKey, type AccountAction, type AgentAccount } from '../../../shared/agent-accounts.js'
import { policyFeatureRefusal } from '../../../shared/organization-policy.js'
import { accountAction, refreshAccounts, useAgentAccounts } from '../agentAccounts.js'
import { useOrganizationPolicy, ManagedPolicyNote } from '../organizationPolicy.js'
import { UsageMeters } from './UsageMeters.js'

export function AgentAccountsSettings({ runtime, usage }: { readonly runtime: string; readonly usage?: ReadonlyMap<string, string> }) {
  const accounts = useAgentAccounts()
  const policy = useOrganizationPolicy()
  const blocked = policyFeatureRefusal(policy, 'accounts') !== undefined
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string>()
  const [removing, setRemoving] = useState<AgentAccount>()
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const own = accounts.filter(a => a.runtime === runtime)
  const waiting = own.some(a => a.state === 'waiting')
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => { void refreshAccounts() }, 1_000)
    return () => clearInterval(timer)
  }, [waiting])
  if (!supportsAccounts(runtime)) return null
  const act = async (action: AccountAction) => {
    setBusy(true); setMessage(undefined)
    try { const answer = await accountAction(action); if (!answer.ok) setMessage(answer.message); return answer.ok }
    catch { setMessage('The account could not be changed. Your other accounts are unchanged.'); return false }
    finally { setBusy(false) }
  }
  return <div className="lc-agentaccounts" data-runtime={runtime} aria-label={`${runtime} accounts`}>
    <p className="lc-settings__note">This PC&apos;s sign-in</p>
    {own.map(a => <div className="lc-agentaccounts__account" key={a.id}>
      {editing === a.id ? <form onSubmit={event => { event.preventDefault(); void act({ kind: 'rename', id: a.id, name }).then(ok => { if (ok) setEditing(undefined) }) }}>
        <label>Account name <input value={name} maxLength={80} onChange={e => setName(e.target.value)} autoFocus /></label>
        <button className="lc-button" disabled={busy || blocked}>Save name</button>
        <button type="button" className="lc-button" onClick={() => setEditing(undefined)}>Cancel</button>
      </form> : <>
        <strong>{a.name}</strong>
        <span className="lc-settings__note" role="status">{a.state === 'waiting' ? 'Finish signing in in your browser. This card waits for the agent.' : a.state === 'ready' ? 'Sign-in finished.' : a.state === 'failed' ? 'Sign-in did not finish. Your other accounts are unchanged.' : 'Ready to sign in.'}</span>
        {a.state === 'waiting'
          ? <button type="button" className="lc-button" disabled={busy} onClick={() => void act({ kind: 'cancel', id: a.id })}>Cancel sign-in</button>
          : <button type="button" className="lc-button" disabled={busy || blocked} onClick={() => void act({ kind: 'login', id: a.id })}>{a.state === 'ready' ? 'Sign in again' : 'Sign in'}</button>}
        <button type="button" className="lc-button" disabled={busy || blocked} onClick={() => { setEditing(a.id); setName(a.name) }}>Rename</button>
        <button type="button" className="lc-button" disabled={busy || a.state === 'waiting'} onClick={() => setRemoving(a)}>Remove</button>
        {usage?.get(accountUsageKey(runtime, a.id)) !== undefined && <UsageMeters said={usage.get(accountUsageKey(runtime, a.id))!} />}
      </>}
    </div>)}
    {adding ? <form onSubmit={event => {
      event.preventDefault()
      void act({ kind: 'add', runtime, name }).then(ok => { if (ok) { setAdding(false); setName('') } })
    }}>
      <label>Account name <input value={name} placeholder="Work" maxLength={80} autoFocus onChange={event => setName(event.target.value)} /></label>
      <p className="lc-settings__note">Add a name, then Sign in to open the agent&apos;s own browser sign-in.</p>
      <button className="lc-button" disabled={busy || blocked || !name.trim()}>Add account</button>
      <button type="button" className="lc-button" onClick={() => setAdding(false)}>Cancel</button>
    </form> : <button type="button" className="lc-button" disabled={blocked || busy} onClick={() => { setAdding(true); setName('') }}>Add another account</button>}
    {blocked && <ManagedPolicyNote />}
    {message !== undefined && <p className="lc-settings__note" role="alert">{message}</p>}
    {removing !== undefined && <div className="lc-agentaccounts__confirm" role="alertdialog" aria-label={`Remove ${removing.name}?`}>
      <strong>Remove {removing.name}?</strong>
      <p>This deletes only {removing.name}&apos;s agent home that Locust created: its sign-in, settings, session history and plugins. This PC&apos;s sign-in and your project files stay where they are. Teammates using this account will need another account selected.</p>
      {removing.home !== undefined && <p className="lc-settings__note lc-mono">{removing.home}</p>}
      <button type="button" className="lc-button" disabled={busy} onClick={() => void act({ kind: 'remove', id: removing.id }).then(ok => { if (ok) setRemoving(undefined) })}>Delete this account</button>
      <button type="button" className="lc-button" onClick={() => setRemoving(undefined)}>Keep account</button>
    </div>}
  </div>
}
