import { useEffect, useRef, useState } from 'react'
import { MAX_REFERENCES, referenceAccess, type ConversationReference, type ReferenceRequest } from '../../../shared/references.js'
import { Icon } from './Icon.js'

/** Lives beside the draft, not on a teammate. Switching conversations cannot apply a late picker result to another. */
export function ReferenceChips({ draftKey, missionId, openRequest, sent, runtime, mode, cwd, cloud, onChange, onBusy }: {
  readonly draftKey: string
  readonly missionId?: string
  readonly openRequest: number
  readonly sent: number
  readonly runtime: string
  readonly mode: string
  readonly cwd?: string
  readonly cloud?: boolean
  readonly onChange: (ids: readonly string[]) => void
  readonly onBusy: (busy: boolean) => void
}) {
  const [items, setItems] = useState<readonly ConversationReference[]>([])
  const [open, setOpen] = useState(false)
  const [github, setGithub] = useState(false)
  const [repository, setRepository] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [hostCwd, setHostCwd] = useState<string>()
  const context = useRef(draftKey)
  context.current = draftKey
  const drafts = useRef(new Map<string, readonly ConversationReference[]>())
  const callbacks = useRef({ onChange, onBusy })
  callbacks.current = { onChange, onBusy }
  useEffect(() => {
    let live = true
    setOpen(false)
    setError(undefined)
    setBusy(false)
    setLoadFailed(false)
    setHostCwd(undefined)
    const held = missionId === undefined ? drafts.current.get(draftKey) ?? [] : []
    setItems(held)
    callbacks.current.onChange(held.map((item) => item.id))
    if (missionId === undefined || window.desktop?.references === undefined) {
      callbacks.current.onBusy(false)
      return () => { live = false }
    }
    callbacks.current.onBusy(true)
    void window.desktop.references({ action: 'list', missionId }).then((reply) => {
      if (!live) return
      if (reply.ok) { setItems(reply.references); setHostCwd(reply.cwd); callbacks.current.onChange(reply.references.map((item) => item.id)) }
      else { setError(reply.message); setLoadFailed(true) }
      callbacks.current.onBusy(!reply.ok)
    }).catch(() => { if (live) { setError('References could not be read. Nothing was sent.'); setLoadFailed(true); callbacks.current.onBusy(true) } })
    return () => { live = false }
  }, [draftKey, missionId, retry])
  useEffect(() => { if (sent > 0) drafts.current.delete('new') }, [sent])
  useEffect(() => { if (openRequest > 0) { setOpen(true); setGithub(false) } }, [openRequest])

  const change = async (next: readonly ConversationReference[], key: string): Promise<void> => {
    if (missionId !== undefined) {
      const reply = await window.desktop?.references?.({ action: 'set', missionId, ids: next.map((item) => item.id) })
      if (reply === undefined || !reply.ok) throw new Error(reply?.message ?? 'References could not be saved. Nothing was sent.')
    } else drafts.current.set(key, next)
    if (context.current === key) { setItems(next); callbacks.current.onChange(next.map((item) => item.id)) }
  }
  const add = async (request: ReferenceRequest): Promise<void> => {
    if (busy || loadFailed || items.length >= MAX_REFERENCES) return
    const key = draftKey
    setBusy(true); callbacks.current.onBusy(true); setError(undefined)
    try {
      const reply = await window.desktop?.references?.(request)
      if (reply === undefined || !reply.ok) throw new Error(reply?.message ?? 'References are not available yet. Nothing was added.')
      if (reply.references.length > 0) await change([...items, ...reply.references].slice(0, MAX_REFERENCES), key)
      if (context.current === key) { setOpen(false); setRepository('') }
    } catch (cause) { if (context.current === key) setError(cause instanceof Error ? cause.message : 'The reference could not be added. Nothing was sent.') }
    finally { if (context.current === key) { setBusy(false); callbacks.current.onBusy(false) } }
  }
  const remove = async (item: ConversationReference): Promise<void> => {
    if (busy) return
    const key = draftKey
    setBusy(true); callbacks.current.onBusy(true)
    try {
      await change(items.filter((held) => held.id !== item.id), key)
      const reply = await window.desktop?.references?.({ action: 'discard', id: item.id })
      if (reply !== undefined && !reply.ok) throw new Error(reply.message)
    } catch (cause) { if (context.current === key) setError(cause instanceof Error ? cause.message : 'The reference could not be removed. Nothing was sent.') }
    finally { if (context.current === key) { setBusy(false); callbacks.current.onBusy(false) } }
  }
  return <div className="lc-references">
    {open && <div className="lc-referencepicker" role="group" aria-label="Add a reference">
      <div className="lc-referencepicker__head"><span>Add a reference</span><button type="button" aria-label="Close reference picker" onClick={() => setOpen(false)}><Icon name="close" size={12} /></button></div>
      <p>Another folder to read alongside this conversation. Your chosen mode stays the same.</p>
      {items.length >= MAX_REFERENCES ? <p>Five references are attached. Remove one to add another.</p> : <>
        <div className="lc-referencepicker__choices">
          <button type="button" className="lc-control lc-control--boxed lc-chipbutton" disabled={busy || loadFailed} onClick={() => { void add({ action: 'folder' }) }}><Icon name="folder" size={13} />Folder on this computer</button>
          <button type="button" className="lc-control lc-control--boxed lc-chipbutton" disabled={busy || loadFailed} onClick={() => setGithub(true)}>GitHub repository</button>
        </div>
        {github && <div className="lc-referencepicker__github"><label>GitHub repository<input autoFocus aria-label="GitHub reference repository" placeholder="owner/repo or https://github.com/owner/repo" maxLength={240} value={repository} onChange={(event) => setRepository(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void add({ action: 'github', repository }) } }} /></label><button type="button" className="lc-control lc-control--boxed lc-chipbutton" disabled={busy || repository.trim() === ''} onClick={() => { void add({ action: 'github', repository }) }}>Add repository</button><p>A shallow copy, up to 500 MB, kept on this computer. Private repositories use your gh sign-in; Locust never signs you in.</p></div>}
      </>}
    </div>}
    {busy && <p className="lc-references__note" role="status">Adding reference…</p>}
    {error !== undefined && <p className="lc-references__note" role="alert">{error}</p>}
    {loadFailed && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry references</button>}
    {items.length > 0 && <div className="lc-references__chips" aria-label="Conversation references">{items.map((item) => {
      const access = referenceAccess(runtime, mode, item.path, hostCwd ?? cwd, cloud)
      return <span className={`lc-reference${access.include ? '' : ' is-unavailable'}`} key={item.id} title={item.path} data-reference-path={item.path}>
        <Icon name="folder" size={12} /><span className="lc-reference__body"><span className="lc-reference__name">{item.name}</span><span className="lc-reference__note">{access.note}{item.problem === undefined ? '' : ` ${item.problem}`}</span></span>
        <button type="button" disabled={busy} aria-label={`Remove reference ${item.name}`} onClick={() => { void remove(item) }}><Icon name="close" size={12} /></button>
      </span>
    })}</div>}
  </div>
}
