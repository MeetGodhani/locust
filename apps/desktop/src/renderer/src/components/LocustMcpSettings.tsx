import { useEffect, useState, type ReactNode } from 'react'
import type { ClaudeAppConnection, LocustMcpApi, LocustMcpState } from '../../../shared/locust-mcp.js'
import { CopyButton } from './CopyButton.js'

export function LocustMcpSettings({ heading, api = typeof window === 'undefined' ? undefined : window.desktop?.locustMcp }: { readonly heading?: ReactNode; readonly api?: LocustMcpApi }) {
  const [state, setState] = useState<LocustMcpState>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  /** Locust in the Claude app's tools (0.740): where it stands, read when this opens. */
  const [claudeApp, setClaudeApp] = useState<ClaudeAppConnection>()
  const [claudeSaid, setClaudeSaid] = useState('')
  useEffect(() => {
    let alive = true
    void api?.settings().then(value => { if (alive) setState(value) }).catch(() => { if (alive) setFailure('The server setting could not be read. Its previous choice is unchanged.') })
    void api?.claudeApp?.().then(value => { if (alive) setClaudeApp(value) }).catch(() => undefined)
    return () => { alive = false }
  }, [api])
  const change = async (next: (current: LocustMcpState) => Promise<LocustMcpState>) => {
    if (!api || !state || busy) return
    setBusy(true); setFailure('')
    try { setState(await next(state)) }
    catch { setFailure('The server setting could not be changed. Its previous choice is unchanged.') }
    finally { setBusy(false) }
  }
  const toggle = () => change(current => api!.setEnabled(!current.enabled))
  const toggleOwnMode = () => change(current => api!.setOwnMode(!current.ownMode))
  /** One press: Add turns the server on and puts Locust in Claude's tools; Remove takes it out; Restart closes and reopens Claude. */
  const pressClaude = async (what: 'add' | 'remove' | 'restart') => {
    if (!api || busy) return
    setBusy(true); setClaudeSaid('')
    try {
      const result = what === 'restart' ? await api.restartClaudeApp?.() : await api.setClaudeApp?.(what === 'add')
      if (result !== undefined) {
        setClaudeApp(result.connection)
        if (result.state !== undefined) setState(result.state)
        setClaudeSaid(result.message ?? '')
      }
    } catch {
      setClaudeSaid('The Claude app was not changed.')
    } finally { setBusy(false) }
  }
  return <>
    <div className="lc-settingline">
      <div className="lc-settingline__text">
        {heading}
        <p className="lc-settings__lede">{state?.enabled
          ? `On. Other apps on this computer can ask teammates, run your routines and read replies. ${state.ownMode ? "New turns use each teammate's own mode" : 'New turns are Ask mode (read only)'}, with no automatic teammate handoffs. Locust must be running; your AI account usage and monthly limits still apply.`
          : 'Off. No local server is listening.'}</p>
      </div>
      <button type="button" className={`lc-switch${state?.enabled ? ' is-on' : ''}`} role="switch" aria-label="Let your other AI apps use Locust" aria-checked={state?.enabled === true} disabled={!state || busy} onClick={() => { void toggle() }}><span /></button>
    </div>
    {/* A sub-setting of the switch above (0.707): spaced and indented, so it does not read as that line's last sentence. */}
    {state?.enabled && <div className="lc-settingline lc-settingline--sub">
      <div className="lc-settingline__text">
        <h3 className="lc-settings__heading">Use each teammate's own mode</h3>
        <p className="lc-settings__lede">{state.ownMode
          ? 'On. A turn another app starts runs in the mode the teammate is set to here, so it can edit files. Approval cards appear in this window and only you can answer them; Auto runs only if Auto is on in Settings.'
          : 'Off. Every turn another app starts is Ask mode (read only), whatever mode the teammate is set to.'}</p>
      </div>
      <button type="button" className={`lc-switch${state.ownMode ? ' is-on' : ''}`} role="switch" aria-label="Use each teammate's own mode" aria-checked={state.ownMode} disabled={busy} onClick={() => { void toggleOwnMode() }}><span /></button>
    </div>}
    {/*
      * THE CLAUDE APP, IN ONE PRESS (0.740). Colin: "asking me to do the pythagorean theorem for a basic feature
      * isnt it". Shown only where the Claude app is installed; Add also turns the switch above on.
      */}
    {claudeApp !== undefined && claudeApp.kind !== 'no-app' && <div className="lc-settingline lc-claudeapp">
      <div className="lc-settingline__text">
        <h3 className="lc-settings__heading">The Claude app</h3>
        <p className="lc-settings__lede">{
          claudeApp.kind === 'unreadable' || claudeApp.kind === 'taken' ? claudeApp.message
            : claudeApp.kind === 'not-added'
              ? claudeApp.restart === true
                ? 'Removed. The Claude app keeps using Locust until it restarts; restarting closes everything running in it.'
                : 'Add Locust to the Claude app’s tools, so a Claude chat can ask your teammates and read their replies. One press; Locust keeps a copy of Claude’s settings first.'
              : claudeApp.stale === true ? 'Added, but for a copy of Locust that is not this one, or that has moved. Update points it here.'
                : claudeApp.restart === true ? 'Added. The Claude app reads it when it starts, and it is open now: restart it to finish. Restarting closes everything running in the Claude app.'
                  : 'Added. Ask a Claude chat about your Locust teammates; it asks before it uses them.'
        }</p>
        {claudeSaid && <p className="lc-settings__note" role="status">{claudeSaid}</p>}
      </div>
      <span className="lc-claudeapp__acts">
        {claudeApp.kind === 'not-added' && <button type="button" className="lc-control lc-control--boxed" disabled={busy} onClick={() => { void pressClaude('add') }}>Add to the Claude app</button>}
        {claudeApp.kind === 'added' && claudeApp.stale === true && <button type="button" className="lc-control lc-control--boxed" disabled={busy} onClick={() => { void pressClaude('add') }}>Update</button>}
        {(claudeApp.kind === 'added' || claudeApp.kind === 'not-added') && claudeApp.restart === true && <button type="button" className="lc-control lc-control--boxed" disabled={busy} onClick={() => { void pressClaude('restart') }}>Restart Claude</button>}
        {claudeApp.kind === 'added' && <button type="button" className="lc-control" disabled={busy} onClick={() => { void pressClaude('remove') }}>Remove</button>}
      </span>
    </div>}
    {state?.enabled && <div className="lc-settings__note">
      {/* A Copy on each (0.691): the lines run to three paths, and selecting a wrapped block by hand is fiddly. */}
      <p>Claude Code — run this in PowerShell:</p>
      <div className="lc-mcp-setupwrap"><pre className="lc-mcp-setup lc-mono">{state.claudeCommand}</pre>
        {state.claudeCommand !== undefined && <CopyButton className="lc-mcp-setup__copy" label="the Claude Code command" text={state.claudeCommand} />}</div>
      <p>Codex — add this to ~/.codex/config.toml:</p>
      <div className="lc-mcp-setupwrap"><pre className="lc-mcp-setup lc-mono">{state.codexConfig}</pre>
        {state.codexConfig !== undefined && <CopyButton className="lc-mcp-setup__copy" label="the Codex settings" text={state.codexConfig} />}</div>
      <p>Locust changes another app’s settings only when you press Add to the Claude app; it keeps a copy of the file first, and Remove takes its entry out again. Turning this off stops new requests, not turns already running.</p>
    </div>}
    {(failure || state?.message) && <p className="lc-settings__note" role="status">{failure || state?.message}</p>}
  </>
}
