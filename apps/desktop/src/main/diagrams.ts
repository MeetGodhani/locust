import { createHash } from 'node:crypto'

import { DIAGRAM_UNDRAWN, isDiagram, type DiagramResponse } from '../shared/diagram.js'

/** Draws one diagram from its Mermaid text (0.770): diagram-view.ts does it in a view no one sees. */
export type DrawDiagram = (source: string) => Promise<DiagramResponse>

/**
 * DIAGRAMS DRAWN, KEPT BY WHAT THEY SAY (0.770, shared/diagram.ts). A conversation opened again, or a reply shown
 * again, draws nothing twice: the same text is the same picture. One Mermaid could not read is kept too -- it
 * says the same next time -- unless the view was at fault, which a later try may not be.
 */
export function keptDiagrams(draw: DrawDiagram, keep = 64): DrawDiagram {
  const drawn = new Map<string, Promise<DiagramResponse>>()
  return (source) => {
    if (typeof source !== 'string' || !isDiagram(source, 'mermaid')) return Promise.resolve({ ok: false, message: 'it is not a diagram Locust draws' })
    const key = createHash('sha256').update(source, 'utf8').digest('hex')
    const held = drawn.get(key)
    if (held !== undefined) {
      // The most recently shown is the last to go.
      drawn.delete(key)
      drawn.set(key, held)
      return held
    }
    const job = draw(source).catch((): DiagramResponse => ({ ok: false, message: DIAGRAM_UNDRAWN, again: true }))
    drawn.set(key, job)
    void job.then((result) => {
      if (!result.ok && result.again === true && drawn.get(key) === job) drawn.delete(key)
    })
    for (const oldest of drawn.keys()) {
      if (drawn.size <= keep) break
      drawn.delete(oldest)
    }
    return job
  }
}
