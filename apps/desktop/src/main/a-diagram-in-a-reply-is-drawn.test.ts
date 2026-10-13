import { afterEach, describe, expect, it, vi } from 'vitest'

import { diagramFrom, diagramImage, diagramKindWords, isDiagram, MAX_DIAGRAM_CHARS, type DiagramResponse } from '../shared/diagram.js'
import { createViewDiagramDrawer, type DrawingView } from './diagram-view.js'
import { keptDiagrams } from './diagrams.js'

vi.mock('electron', () => ({ WebContentsView: class {} }))

/*
 * A DIAGRAM IN A REPLY, DRAWN (0.770). A closed Mermaid block is drawn in a view no one sees, and its picture
 * comes back as SVG text the window shows as an image. The picture is taken only in that one shape; the same
 * text is drawn once; and the view goes when it has nothing to draw.
 */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><g/></svg>'

describe('what is a diagram', () => {
  it('is a block the model named Mermaid, with something in it, of a size Locust draws', () => {
    expect(isDiagram('graph TD\n  A --> B', 'mermaid')).toBe(true)
    expect(isDiagram('graph TD\n  A --> B', 'Mermaid ')).toBe(true)
    expect(isDiagram('graph TD\n  A --> B', 'mmd')).toBe(true)
    expect(isDiagram('graph TD\n  A --> B', 'js')).toBe(false)
    expect(isDiagram('graph TD\n  A --> B')).toBe(false)
    expect(isDiagram('   \n', 'mermaid')).toBe(false)
    expect(isDiagram(`graph TD\n${'  A --> B\n'.repeat(MAX_DIAGRAM_CHARS / 10)}`, 'mermaid')).toBe(false)
  })
})

describe('what the drawing page answers', () => {
  it('is taken as a picture only when it is an SVG of a sensible size', () => {
    expect(diagramFrom({ svg: SVG, width: 319.4, height: 180, kind: 'flowchart-v2', title: '  How a deploy\n runs ' })).toEqual({ ok: true, svg: SVG, width: 320, height: 180, kind: 'flowchart-v2', title: 'How a deploy runs' })
    // Anything else is no picture at all.
    for (const answer of [undefined, null, 'svg', { svg: '<img src=x onerror=alert(1)>', width: 10, height: 10 }, { svg: SVG, width: 0, height: 10 }, { svg: SVG, width: 50_000, height: 10 }, { svg: SVG, width: Number.NaN, height: 10 }, { svg: 7, width: 10, height: 10 }]) {
      expect(diagramFrom(answer)).toEqual({ ok: false, message: 'Locust could not draw it' })
    }
    // A name that is not a plain word is left out, not passed on.
    expect(diagramFrom({ svg: SVG, width: 10, height: 10, kind: '<b>pie</b>' })).toEqual({ ok: true, svg: SVG, width: 10, height: 10 })
  })

  it("says Mermaid's reason as one short line", () => {
    expect(diagramFrom({ error: 'Parse error on line 3:\n...A --> \n-------^\nExpecting \'NODE_STRING\', got \'EOF\'' })).toEqual({ ok: false, message: 'Parse error on line 3' })
    expect(diagramFrom({ error: '' })).toEqual({ ok: false, message: 'Mermaid could not read it' })
    const long = diagramFrom({ error: 'x'.repeat(400) })
    expect(!long.ok && long.message.length).toBe(160)
  })

  it('names the kind as a person would, and shows the picture as data', () => {
    expect(diagramKindWords('flowchart-v2')).toBe('Flowchart')
    expect(diagramKindWords('sequence')).toBe('Sequence diagram')
    expect(diagramKindWords('somethingNew')).toBe('Diagram')
    expect(diagramKindWords(undefined)).toBe('Diagram')
    const src = diagramImage(SVG)
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe(true)
    expect(src).not.toMatch(/[<>#"]/)
  })
})

describe('the same diagram', () => {
  it('is drawn once, and a view that failed is tried again later', async () => {
    const answers: DiagramResponse[] = [{ ok: false, message: 'Locust could not draw it', again: true }, { ok: true, svg: SVG, width: 320, height: 180 }]
    const draw = vi.fn(async (): Promise<DiagramResponse> => answers.shift() ?? { ok: false, message: 'none left' })
    const kept = keptDiagrams(draw)
    expect((await kept('graph TD\n  A --> B')).ok).toBe(false)
    // The view was at fault, so the next showing tries again -- and is drawn, once.
    expect((await kept('graph TD\n  A --> B')).ok).toBe(true)
    expect((await kept('graph TD\n  A --> B')).ok).toBe(true)
    expect(draw).toHaveBeenCalledTimes(2)
  })

  it('keeps a mistake too, and draws nothing that is not a diagram', async () => {
    const draw = vi.fn(async (): Promise<DiagramResponse> => ({ ok: false, message: 'Parse error on line 2:' }))
    const kept = keptDiagrams(draw)
    await kept('graph TD\n  A -->')
    await kept('graph TD\n  A -->')
    expect(draw).toHaveBeenCalledTimes(1)
    expect(await kept('')).toEqual({ ok: false, message: 'it is not a diagram Locust draws' })
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('keeps only the most recently shown', async () => {
    const draw = vi.fn(async (): Promise<DiagramResponse> => ({ ok: true, svg: SVG, width: 1, height: 1 }))
    const kept = keptDiagrams(draw, 2)
    await kept('graph TD\n  A')
    await kept('graph TD\n  B')
    await kept('graph TD\n  A')
    await kept('graph TD\n  C')
    // A was shown again, so B went; A is still kept.
    await kept('graph TD\n  A')
    expect(draw).toHaveBeenCalledTimes(3)
    await kept('graph TD\n  B')
    expect(draw).toHaveBeenCalledTimes(4)
  })
})

describe('the view that draws', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const stand = (answer: (code: string) => Promise<unknown>, loads: (view: number) => Promise<void> = async () => undefined): { readonly open: () => DrawingView; readonly opened: () => number; readonly closed: () => number; readonly calls: string[] } => {
    let opened = 0
    let closed = 0
    const calls: string[] = []
    return {
      open: () => {
        opened += 1
        let gone = false
        return {
          contents: {
            isDestroyed: () => gone,
            close: () => { gone = true; closed += 1 },
            executeJavaScript: async (code) => { calls.push(code); return answer(code) }
          },
          loaded: loads(opened)
        }
      },
      opened: () => opened,
      closed: () => closed,
      calls
    }
  }

  it('draws a burst in one view, one at a time, and closes it once it has had nothing to draw', async () => {
    vi.useFakeTimers()
    const view = stand(async () => ({ svg: SVG, width: 320, height: 180, kind: 'pie' }))
    const draw = createViewDiagramDrawer({ open: view.open, idleMs: 20_000 })
    const drawn = await Promise.all([draw('pie\n  "a" : 1'), draw('pie\n  "b" : 2')])
    expect(drawn.every((one) => one.ok)).toBe(true)
    expect(view.opened()).toBe(1)
    // The text goes in as a string, never as code: quotes and all.
    expect(view.calls[0]).toBe('window.locustDrawDiagram("pie\\n  \\"a\\" : 1")')
    expect(view.closed()).toBe(0)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(view.closed()).toBe(1)
    // The next one gets a fresh view.
    await draw('pie\n  "c" : 3')
    expect(view.opened()).toBe(2)
  })

  it('draws again in a fresh view when one stalls, and gives up when that one stalls too', async () => {
    vi.useFakeTimers()
    // As seen once in a drive: a warm view sat on a diagram it draws in 100 ms.
    let first = true
    const stalls = stand(() => {
      if (first) {
        first = false
        return new Promise(() => undefined)
      }
      return Promise.resolve({ svg: SVG, width: 10, height: 10 })
    })
    const drawn = createViewDiagramDrawer({ open: stalls.open, timeoutMs: 5_000 })('graph TD\n  A')
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await drawn).ok).toBe(true)
    expect([stalls.opened(), stalls.closed()]).toEqual([2, 1])

    const always = stand(() => new Promise(() => undefined))
    const never = createViewDiagramDrawer({ open: always.open, timeoutMs: 5_000 })('graph TD\n  A')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await never).toEqual({ ok: false, message: 'it took too long to draw', again: true })
    expect([always.opened(), always.closed()]).toEqual([2, 2])
  })

  it('opens a view afresh, once, when its page did not load', async () => {
    // As seen in a drive: the first view of a launch failed to load its page, and the next loaded at once.
    const once = stand(async () => ({ svg: SVG, width: 10, height: 10 }), async (view) => {
      if (view === 1) throw new Error("ERR_FAILED (-2) loading 'file:///diagram.html'")
    })
    expect((await createViewDiagramDrawer({ open: once.open })('graph TD\n  A')).ok).toBe(true)
    expect([once.opened(), once.closed()]).toEqual([2, 1])
    // A page that never loads is given up on after the second view, to be tried again another time.
    const never = stand(async () => ({ svg: SVG, width: 10, height: 10 }), async () => {
      throw new Error('ERR_FAILED (-2)')
    })
    expect(await createViewDiagramDrawer({ open: never.open })('graph TD\n  A')).toEqual({ ok: false, message: 'Locust could not draw it', again: true })
    expect([never.opened(), never.closed()]).toEqual([2, 2])
  })

  it("passes on Mermaid's reason for text it cannot read, keeping the view", async () => {
    const view = stand(async () => ({ error: 'Lexical error on line 1. Unrecognized text.' }))
    const draw = createViewDiagramDrawer({ open: view.open })
    expect(await draw('graph TD\n  A -->> ??')).toEqual({ ok: false, message: 'Lexical error on line 1. Unrecognized text' })
    expect(view.closed()).toBe(0)
  })
})
