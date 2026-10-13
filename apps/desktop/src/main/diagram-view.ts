import { WebContentsView } from 'electron'
import type { WebContents } from 'electron'

import { DIAGRAM_UNDRAWN, diagramFrom, type DiagramResponse } from '../shared/diagram.js'
import type { DrawDiagram } from './diagrams.js'

/**
 * THE VIEW THAT DRAWS A DIAGRAM (0.770, shared/diagram.ts): Locust's own page (renderer/diagram.html), in a web
 * view that belongs to no window, as a PDF is read (pdf-window.ts): nothing appears, the taskbar shows nothing,
 * and no "every window" loop in the host finds it. Sandboxed, no preload, no Node, and its page loads nothing:
 * the diagram's text goes in as an argument and its picture comes out as SVG text.
 *
 * One view draws a burst -- a conversation opened with five diagrams in it -- one at a time, and closes once it
 * has had nothing to draw for a while, so it holds no process at rest. A view that broke or stalled is closed at
 * once and the diagram drawn again in a fresh one, once: drives saw a launch's first view fail to load its page
 * (ERR_FAILED) in about half their runs, offscreen or not, and once a warm view sat on a 100 ms diagram past its
 * timeout; each time, the next view drew at once.
 */
export interface DrawingView {
  readonly contents: { isDestroyed(): boolean; close(): void; executeJavaScript(code: string): Promise<unknown> }
  /** Settles once the page is ready to draw. */
  readonly loaded: Promise<void>
}

export interface DiagramViewOptions {
  /** A fresh view on the diagram page: `diagramViewOn` in the app, a stand-in in a test. */
  readonly open: () => DrawingView
  readonly timeoutMs?: number
  /** How long a view with nothing to draw is kept for the next one. */
  readonly idleMs?: number
}

const SLOW = 'it took too long to draw'

/** The app's view: sandboxed, offscreen (a view with no window never lays out a frame), going nowhere. */
export function diagramViewOn(load: (contents: WebContents) => Promise<void>): () => DrawingView {
  return () => {
    const made = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, webgl: false, offscreen: true }
    })
    const contents = made.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    return { contents, loaded: load(contents) }
  }
}

export function createViewDiagramDrawer(options: DiagramViewOptions): DrawDiagram {
  // A diagram is drawn in well under a second; ten is a view that has stalled.
  const timeoutMs = options.timeoutMs ?? 10_000
  const idleMs = options.idleMs ?? 20_000
  let queue: Promise<unknown> = Promise.resolve()
  let held: DrawingView | undefined
  let idle: ReturnType<typeof setTimeout> | undefined

  const close = (): void => {
    if (held !== undefined && !held.contents.isDestroyed()) held.contents.close()
    held = undefined
  }
  const view = (): DrawingView => {
    if (held === undefined || held.contents.isDestroyed()) held = options.open()
    return held
  }

  const drawIn = async (source: string): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const { contents, loaded } = view()
      const work = (async () => {
        await loaded
        return contents.executeJavaScript(`window.locustDrawDiagram(${JSON.stringify(source)})`)
      })()
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(SLOW)), timeoutMs)
        })
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const drawOnce = async (source: string): Promise<DiagramResponse> => {
    if (idle !== undefined) clearTimeout(idle)
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return diagramFrom(await drawIn(source))
        } catch (error) {
          close()
          if (attempt >= 2) return { ok: false, message: error instanceof Error && error.message === SLOW ? SLOW : DIAGRAM_UNDRAWN, again: true }
        }
      }
    } finally {
      if (idle !== undefined) clearTimeout(idle)
      idle = setTimeout(close, idleMs)
    }
  }

  return (source) => {
    const job = queue.then(() => drawOnce(source))
    queue = job.catch(() => undefined)
    return job
  }
}
