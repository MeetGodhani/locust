import { useState } from 'react'
import type { ReactNode } from 'react'

import { SCOUT_EVERY_MINUTES, type ScoutApi, type ScoutEvery, type ScoutState, type ScoutWatches } from '../../../shared/scout.js'

/**
 * SCOUT IN SETTINGS (0.756, shared/scout.ts): on or off, what it watches, how often it looks, and whether a card that
 * needs the person now comes as a Windows notification. Its model is its teammate's, changed like any teammate's;
 * this line says which one it reads with and what that costs.
 */
export function ScoutSetting({ heading, state, model, route, onChangeModel, api = typeof window === 'undefined' ? undefined : window.desktop?.scout }: {
  /** Settings' own heading, so its search finds this line (settings-pages-are-real). */
  readonly heading: ReactNode
  readonly state: ScoutState | undefined
  /** The model Scout reads with now, as a person reads it; undefined before it has one. */
  readonly model?: string
  /** The free model a new Scout would read with; undefined when none is listed here. */
  readonly route?: { readonly runtime: string; readonly model: string }
  /** Opens Scout's own Edit teammate, where its Model row is: absent before Scout is on the team. */
  readonly onChangeModel?: () => void
  readonly api?: ScoutApi
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (api === undefined) return null
  const on = state?.settings.on === true
  const act = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setMessage('')
    try {
      const answer = await work()
      if (typeof answer === 'object' && answer !== null && 'refused' in answer) setMessage(String((answer as { refused: string }).refused))
    } catch {
      setMessage('Scout’s setting was not changed. Try again.')
    } finally { setBusy(false) }
  }
  const toggle = (): void => {
    if (on) { void act(() => api.set({ on: false })); return }
    if (state?.settings.teammateId === undefined && route === undefined) { setMessage('Scout needs a model to read with: install OpenCode for a free one, then turn it on.'); return }
    void act(() => api.turnOn(route))
  }
  const watch = (key: keyof ScoutWatches): void => {
    if (state === undefined) return
    void act(() => api.set({ watches: { ...state.settings.watches, [key]: !state.settings.watches[key] } }))
  }
  const switchOf = (label: string, checked: boolean, onClick: () => void) =>
    <button type="button" className={`lc-switch${checked ? ' is-on' : ''}`} role="switch" aria-label={label} aria-checked={checked} disabled={state === undefined || busy} onClick={onClick}><span /></button>
  return <section className="lc-settings__section lc-settings__section--line" data-setting="scout">
    <div className="lc-settingline">
      <div className="lc-settingline__text">
        {heading}
        <p className="lc-settings__lede">{on
          ? `On. Scout looks every ${String(state?.settings.everyMinutes ?? 10)} minutes while Locust runs, and tells you on Home what needs you, with the next step drafted. It never sends, merges or changes anything by itself.${model === undefined ? '' : ` It reads with ${model}.`}`
          : 'Off. Turn it on and Scout joins your team: it looks at your pull requests and their checks, the reviews asked of you and your teammates’ turns, and tells you on Home what needs you.'}</p>
        {state?.modelSaid !== undefined && on && <p className="lc-settings__note" role="status">{`Last look: ${state.modelSaid}`}</p>}
        {message && <p className="lc-settings__note" role="status">{message}</p>}
      </div>
      <span className="lc-talkkeys">
        {/* Its model is its teammate's (Colin, 2026-10-12: "allow the user to change the model of proactive teammate"). */}
        {on && onChangeModel !== undefined && <button type="button" className="lc-control lc-control--boxed" onClick={onChangeModel}>Change its model</button>}
        {switchOf('Scout keeps watch', on, toggle)}
      </span>
    </div>
    {on && state !== undefined && <>
      <div className="lc-settingline lc-settingline--sub">
        <div className="lc-settingline__text">
          <h3 className="lc-settings__heading">Pull requests and their checks</h3>
          <p className="lc-settings__lede">Yours, the reviews asked of you, and the default branch’s checks, through the GitHub CLI you signed in.</p>
        </div>
        {switchOf('Pull requests and their checks', state.settings.watches.github, () => { watch('github') })}
      </div>
      <div className="lc-settingline lc-settingline--sub">
        <div className="lc-settingline__text">
          <h3 className="lc-settings__heading">Your teammates’ turns</h3>
          <p className="lc-settings__lede">One waiting on you for more than 10 minutes, and one that failed.</p>
        </div>
        {switchOf('Your teammates’ turns', state.settings.watches.teammates, () => { watch('teammates') })}
      </div>
      <div className="lc-settingline lc-settingline--sub">
        <div className="lc-settingline__text">
          <h3 className="lc-settings__heading">How often it looks</h3>
          <p className="lc-settings__lede">Only while Locust is running. Its model is asked only when something is new.</p>
        </div>
        <select className="lc-control" aria-label="How often Scout looks" disabled={busy} value={state.settings.everyMinutes}
          onChange={(event) => { const next = Number(event.target.value) as ScoutEvery; void act(() => api.set({ everyMinutes: next })) }}>
          {SCOUT_EVERY_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{minutes === 60 ? 'Every hour' : `Every ${String(minutes)} minutes`}</option>)}
        </select>
      </div>
      <div className="lc-settingline lc-settingline--sub">
        <div className="lc-settingline__text">
          <h3 className="lc-settings__heading">Tell me in Windows</h3>
          <p className="lc-settings__lede">Only for a card that needs you now, while Locust is minimized, in the tray or behind another app.</p>
        </div>
        {switchOf('Tell me in Windows', state.settings.notify, () => { void act(() => api.set({ notify: !state.settings.notify })) })}
      </div>
    </>}
  </section>
}
