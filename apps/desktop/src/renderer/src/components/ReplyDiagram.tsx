import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { DIAGRAM_UNDRAWN, diagramImage, diagramKindWords, type DiagramResponse } from '../../../shared/diagram.js'
import { ColouredCode } from './ColouredCode.js'

/**
 * A DIAGRAM IN A REPLY, DRAWN (0.770, shared/diagram.ts).
 *
 * A closed Mermaid block is shown as its diagram, framed as a page in a reply is (ReplyPage), with its text a tab
 * away. The picture is drawn in a view no one sees and shown here as an image, at its own size: a wide one
 * scrolls inside its frame, as a wide table does, rather than shrinking its words. Text Mermaid cannot read
 * stays text, as it always was, with the reason under it.
 */
export function ReplyDiagram({ code, language }: { readonly code: string; readonly language: string }): ReactElement {
  const [tab, setTab] = useState<'diagram' | 'code'>('diagram')
  const [drawn, setDrawn] = useState<DiagramResponse>()
  useEffect(() => {
    let live = true
    setDrawn(undefined)
    const bridge = window.desktop
    if (bridge?.drawDiagram === undefined) {
      setDrawn({ ok: false, message: 'diagrams are drawn in the Locust app' })
      return
    }
    void bridge.drawDiagram(code).then((answer) => {
      if (live) setDrawn(answer)
    }).catch(() => {
      if (live) setDrawn({ ok: false, message: DIAGRAM_UNDRAWN })
    })
    return () => {
      live = false
    }
  }, [code])
  const text = (
    <pre className="lc-code lc-replypage__code">
      <span className="lc-code__lang lc-mono">{language}</span>
      <ColouredCode code={code} language={language} />
    </pre>
  )
  if (drawn !== undefined && !drawn.ok) {
    return (
      <figure className="lc-replydiagram lc-replydiagram--text">
        <pre className="lc-code">
          <span className="lc-code__lang lc-mono">{language}</span>
          <ColouredCode code={code} language={language} />
        </pre>
        <figcaption className="lc-replydiagram__why">{`Not drawn as a diagram (${drawn.message}). Its text is above, as written.`}</figcaption>
      </figure>
    )
  }
  const kind = drawn === undefined ? undefined : diagramKindWords(drawn.kind)
  return (
    <figure className="lc-replypage lc-replydiagram" aria-label="A diagram in this reply">
      <figcaption className="lc-replypage__bar">
        <span className="lc-replypage__tabs" role="tablist" aria-label="Show the diagram or its text">
          <button type="button" role="tab" aria-selected={tab === 'diagram'} className={`lc-replypage__tab${tab === 'diagram' ? ' is-on' : ''}`} onClick={() => setTab('diagram')}>
            Diagram
          </button>
          <button type="button" role="tab" aria-selected={tab === 'code'} className={`lc-replypage__tab${tab === 'code' ? ' is-on' : ''}`} onClick={() => setTab('code')}>
            Code
          </button>
        </span>
        {kind !== undefined && <span className="lc-replydiagram__kind">{kind}</span>}
      </figcaption>
      {tab === 'code' ? (
        text
      ) : drawn === undefined ? (
        <p className="lc-replypage__wait lc-replydiagram__wait">Drawing the diagram…</p>
      ) : (
        <div className="lc-replydiagram__stage">
          <img
            className="lc-replydiagram__picture"
            src={diagramImage(drawn.svg)}
            width={drawn.width}
            height={drawn.height}
            alt={drawn.title ?? kind ?? 'Diagram'}
            draggable={false}
            decoding="async"
          />
        </div>
      )}
    </figure>
  )
}
