import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import qrcode from 'qrcode-generator'

import type { PhoneApi, PhoneSettings as PhoneState } from '../../../shared/phone.js'
import { policyFeatureRefusal } from '../../../shared/organization-policy.js'
import { ManagedPolicyNote, useOrganizationPolicy } from '../organizationPolicy.js'

/** The code as one SVG path of dark squares, drawn here: no HTML from the library goes into the page. */
export function QrCode({ text, label }: { readonly text: string; readonly label: string }): ReactElement {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(text)
    code.make()
    const count = code.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) if (code.isDark(row, col)) d += `M${String(col + 4)} ${String(row + 4)}h1v1h-1z`
    }
    return { size: count + 8, path: d }
  }, [text])
  // Dark on white whatever the theme: a phone's camera reads it, the window's colours do not matter to it.
  return (
    <svg className="lc-phone__qr" viewBox={`0 0 ${String(size)} ${String(size)}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}

/*
 * YOUR PHONE (0.775, shared/phone.ts). One switch; on, the code to scan. Turning it off unpairs every phone, and
 * New code does that while it stays on.
 */
export function PhoneSettings({ heading, more, api = typeof window === 'undefined' ? undefined : window.desktop?.phone }: {
  readonly heading?: ReactNode
  readonly more?: ReactNode
  readonly api?: PhoneApi
}): ReactElement {
  const [state, setState] = useState<PhoneState>()
  const managed = policyFeatureRefusal(useOrganizationPolicy(), 'phone') !== undefined
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    let alive = true
    void api?.settings().then((value) => { if (alive) setState(value) }).catch(() => { if (alive) setFailure('This setting could not be read. It is unchanged.') })
    return () => { alive = false }
  }, [api])
  const change = async (next: () => Promise<PhoneState>): Promise<void> => {
    if (!api || busy) return
    setBusy(true); setFailure('')
    try { setState(await next()) } catch { setFailure('This setting could not be changed. It is unchanged.') } finally { setBusy(false) }
  }
  const on = !managed && state?.enabled === true
  return (
    <>
      <div className="lc-settingline">
        <div className="lc-settingline__text">
          {heading}
          {managed && <ManagedPolicyNote />}
          <p className="lc-settings__lede">{on
            ? state.url === undefined
              ? 'On, but this computer is not on a network Locust can find. Connect it to your Wi-Fi, then turn this off and on again.'
              : 'On. Scan the code with your phone’s camera to see your conversations, answer approval cards and send the next message. Your phone must be on the same Wi-Fi as this computer.'
            : 'Off. Turn it on to check on your teammates from your phone, on the same Wi-Fi as this computer.'}</p>
          {state?.message !== undefined && <p className="lc-settings__note" role="status">{state.message}</p>}
          {failure && <p className="lc-settings__note" role="status">{failure}</p>}
        </div>
        <button type="button" className={`lc-switch${on ? ' is-on' : ''}`} role="switch" aria-label="Use Locust from your phone" aria-checked={on} disabled={managed || !state || busy} onClick={() => { void change(() => api!.setEnabled(!on)) }}><span /></button>
      </div>
      {on && state.url !== undefined && (
        <div className="lc-phone" data-phone-code="">
          <QrCode text={state.url} label="A code for your phone’s camera. It opens Locust on your phone." />
          <div className="lc-phone__side">
            <p className="lc-settings__note">The first time, Windows may ask whether Locust can use your network. Choose Allow, on private networks only.</p>
            <p className="lc-settings__note">Anyone who scans this code can do what you can from your phone. Lost a phone, or shared the code? Make a new one: every phone has to scan again.</p>
            <span><button type="button" className="lc-control lc-control--boxed" disabled={busy} onClick={() => { void change(() => api!.forget()) }}>New code</button></span>
          </div>
        </div>
      )}
      {more}
    </>
  )
}
