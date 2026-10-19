import { useCallback, useEffect, useRef, useState } from 'react'
import {
  browserRuntimeUnsupportedNote,
  type BrowserPanelState
} from '../../../shared/browser.js'
import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import { Icon } from './Icon.js'

export default function BrowserPanel({
  visible,
  runtime,
  onClose
}: {
  readonly visible: boolean
  readonly runtime?: MissionRuntimeId
  readonly onClose: () => void
}) {
  const [state, setState] = useState<BrowserPanelState>({ open: visible, tabs: [] })
  const [addressInput, setAddressInput] = useState('')
  const [editingAddress, setEditingAddress] = useState(false)
  const [localError, setLocalError] = useState<string>()
  const viewportRef = useRef<HTMLDivElement>(null)

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0]
  const runtimeNote = runtime !== undefined ? browserRuntimeUnsupportedNote(runtime) : undefined

  useEffect(() => {
    if (!editingAddress) {
      setAddressInput(activeTab?.url ?? '')
    }
  }, [activeTab?.id, activeTab?.url, editingAddress])

  useEffect(() => {
    const api = window.desktop?.browser
    if (api === undefined) return
    const off = api.onState((next) => {
      setState(next)
    })
    void api
      .state()
      .then((initial) => {
        setState(initial)
      })
      .catch(() => undefined)
    return () => {
      off()
    }
  }, [])

  const reportBounds = useCallback(() => {
    const api = window.desktop?.browser
    if (api === undefined) return
    if (!visible || viewportRef.current === null) {
      void api.setBounds(null).catch(() => undefined)
      return
    }
    const rect = viewportRef.current.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      void api.setBounds(null).catch(() => undefined)
      return
    }
    void api
      .setBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
      .catch(() => undefined)
  }, [visible])

  useEffect(() => {
    reportBounds()
    if (!visible || viewportRef.current === null) return
    const observer = new ResizeObserver(() => reportBounds())
    observer.observe(viewportRef.current)
    window.addEventListener('resize', reportBounds)
    const frame = requestAnimationFrame(() => reportBounds())
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', reportBounds)
      void window.desktop?.browser?.setBounds(null).catch(() => undefined)
    }
  }, [visible, reportBounds, state.activity, state.error, localError, runtimeNote, state.tabs.length])

  const submitAddress = async (event: React.FormEvent) => {
    event.preventDefault()
    const api = window.desktop?.browser
    if (api === undefined) return
    const trimmed = addressInput.trim()
    if (!trimmed) return
    setLocalError(undefined)
    setEditingAddress(false)
    try {
      const res = await api.navigate(trimmed, activeTab?.id)
      setState(res.state)
      if (!res.ok && res.message) {
        setLocalError(res.message)
      }
    } catch {
      setLocalError('The address did not open. The current page stayed open.')
    }
  }

  const errorText = localError ?? state.error

  return (
    <aside className="lc-viewer lc-browser" aria-label="Browser panel" hidden={!visible}>
      <div className="lc-viewer__head">
        <span className="lc-viewer__name">Browser</span>
        <span
          className="lc-browser__partition"
          title="Isolated Chromium session (persist:locust-browser). Separate from your Chrome profile and cookies."
        >
          Isolated session
        </span>
        <span className="lc-viewer__spacer" />
        <button
          className="lc-viewer__action"
          type="button"
          aria-label="New browser tab"
          title="New tab"
          onClick={() => {
            setLocalError(undefined)
            void window.desktop?.browser
              ?.newTab()
              .then((next) => setState(next))
              .catch(() => undefined)
          }}
        >
          <Icon name="plus" size={13} />
        </button>
        <button
          className="lc-viewer__close"
          type="button"
          aria-label="Hide browser"
          title="Hide browser (tabs stay open)"
          onClick={onClose}
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      <div className="lc-browser__tabs" role="tablist" aria-label="Browser tabs">
        {state.tabs.map((tab) => (
          <div className="lc-browser__tab" key={tab.id}>
            <button
              role="tab"
              type="button"
              aria-selected={activeTab?.id === tab.id}
              title={tab.url || tab.title || 'New Tab'}
              onClick={() => {
                setLocalError(undefined)
                void window.desktop?.browser
                  ?.selectTab(tab.id)
                  .then((next) => setState(next))
                  .catch(() => undefined)
              }}
            >
              {tab.title || 'New Tab'}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title || 'New Tab'} tab`}
              title="Close tab"
              onClick={() => {
                setLocalError(undefined)
                void window.desktop?.browser
                  ?.closeTab(tab.id)
                  .then((next) => setState(next))
                  .catch(() => undefined)
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="lc-browser__bar">
        <button
          type="button"
          className="lc-viewer__action"
          aria-label="Back"
          title="Back"
          disabled={!activeTab?.canGoBack}
          onClick={() =>
            void window.desktop?.browser
              ?.back(activeTab?.id)
              .then((next) => setState(next))
              .catch(() => undefined)
          }
        >
          <Icon name="arrow-left" size={13} />
        </button>
        <button
          type="button"
          className="lc-viewer__action"
          aria-label="Forward"
          title="Forward"
          disabled={!activeTab?.canGoForward}
          onClick={() =>
            void window.desktop?.browser
              ?.forward(activeTab?.id)
              .then((next) => setState(next))
              .catch(() => undefined)
          }
        >
          <Icon name="arrow-right" size={13} />
        </button>
        <button
          type="button"
          className="lc-viewer__action"
          aria-label={activeTab?.loading ? 'Stop loading' : 'Reload'}
          title={activeTab?.loading ? 'Stop loading' : 'Reload'}
          onClick={() => {
            const api = window.desktop?.browser
            if (!api) return
            const p = activeTab?.loading ? api.stop(activeTab.id) : api.reload(activeTab?.id)
            void p.then((next) => setState(next)).catch(() => undefined)
          }}
        >
          <Icon name={activeTab?.loading ? 'close' : 'refresh'} size={13} />
        </button>
        <form className="lc-browser__form" onSubmit={(e) => void submitAddress(e)}>
          <input
            type="text"
            className="lc-browser__address"
            aria-label="Browser address"
            placeholder="https://example.com, localhost:3000, or ./index.html"
            value={addressInput}
            onFocus={() => setEditingAddress(true)}
            onBlur={() => setEditingAddress(false)}
            onChange={(e) => setAddressInput(e.target.value)}
          />
          <button type="submit" className="lc-button" aria-label="Go">
            Go
          </button>
        </form>
      </div>

      {state.activity !== undefined && (
        <div className="lc-browser__activity" role="status" aria-live="polite">
          <span className="lc-dot is-pulsing lc-tone-live" />
          <span>
            {state.activity.label} · {state.activity.action}
            {state.activity.detail ? ` — ${state.activity.detail}` : ''}
          </span>
        </div>
      )}

      {runtimeNote !== undefined && <p className="lc-browser__note">{runtimeNote}</p>}

      {errorText !== undefined && (
        <p role="alert" className="lc-browser__error">
          {errorText}
        </p>
      )}

      <div className="lc-browser__viewport" ref={viewportRef}>
        {activeTab?.previewDataUrl !== undefined && (
          <img className="lc-browser__preview" src={activeTab.previewDataUrl} alt="" />
        )}
        {(!activeTab || !activeTab.url) && (
          <div className="lc-browser__empty">
            <p>
              Open any <code>https:</code>, <code>http:</code>, <code>localhost</code>, or workspace <code>file:</code>{' '}
              page above, or ask a teammate to use the browser.
            </p>
            <p>
              This browser runs in Locust’s own Chromium partition (<code>persist:locust-browser</code>), separate from
              your Chrome profile and cookies. Before signing in, paying, sending, submitting a form, downloading, or
              leaving for a new site, teammates ask on an approval card in the conversation.
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
