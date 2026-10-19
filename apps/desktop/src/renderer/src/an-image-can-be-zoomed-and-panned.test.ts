import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { fitScale, keepInPane, wholeScale, zoomAround } from './components/ZoomableImage.js'

/**
 * AN IMAGE CAN BE ZOOMED AND PANNED (2026-10-19, from OpenCode 2's previews: "pinch to zoom and use two-finger
 * scrolling to pan image and SVG previews. Select Fit to reset the view"). The viewer used to show a picture fitted to
 * the pane and nothing more, so a screenshot's small text could not be read in Locust at all.
 */
describe('an image in the viewer', () => {
  it('opens at the pane width, as it always did, and never larger than its own pixels', () => {
    expect(fitScale({ w: 2000, h: 1000 }, { w: 500, h: 800 })).toBe(0.25)
    // A tall screenshot keeps its readable width and is scrolled, not squeezed to fit the pane's height.
    expect(fitScale({ w: 1000, h: 4000 }, { w: 500, h: 800 })).toBe(0.5)
    expect(fitScale({ w: 100, h: 50 }, { w: 500, h: 800 })).toBe(1)
  })

  it('zooms out as far as the whole picture in the pane', () => {
    expect(wholeScale({ w: 1000, h: 4000 }, { w: 500, h: 800 })).toBe(0.2)
    expect(wholeScale({ w: 100, h: 50 }, { w: 500, h: 800 })).toBe(1)
  })

  it('opens a tall picture at its top, and a small one in the middle', () => {
    const pane = { w: 500, h: 800 }
    expect(keepInPane({ scale: fitScale({ w: 1000, h: 4000 }, pane), x: 0, y: 0 }, { w: 1000, h: 4000 }, pane)).toEqual({ scale: 0.5, x: 0, y: 0 })
    expect(keepInPane({ scale: 1, x: 0, y: 0 }, { w: 100, h: 50 }, pane)).toEqual({ scale: 1, x: 200, y: 375 })
  })

  it('zooms around the point under the pointer, which stays where it was', () => {
    const view = { scale: 0.5, x: 10, y: 20 }
    const pointer = { x: 210, y: 120 }
    const imagePoint = { x: (pointer.x - view.x) / view.scale, y: (pointer.y - view.y) / view.scale }
    const next = zoomAround(view, 2, pointer.x, pointer.y, 0.25)
    expect(next.scale).toBe(1)
    expect(next.x + imagePoint.x * next.scale).toBeCloseTo(pointer.x)
    expect(next.y + imagePoint.y * next.scale).toBeCloseTo(pointer.y)
  })

  it('stops at the fitted size going down and at eight times its pixels going up', () => {
    expect(zoomAround({ scale: 0.3, x: 0, y: 0 }, 0.1, 0, 0, 0.25).scale).toBe(0.25)
    expect(zoomAround({ scale: 6, x: 0, y: 0 }, 10, 0, 0, 0.25).scale).toBe(8)
  })

  it('stays centred where it is smaller than the pane, and keeps its edges at the pane where it is larger', () => {
    const pane = { w: 500, h: 400 }
    const small = keepInPane({ scale: 1, x: -300, y: 900 }, { w: 100, h: 100 }, pane)
    expect(small).toEqual({ scale: 1, x: 200, y: 150 })
    const large = keepInPane({ scale: 2, x: 50, y: -5000 }, { w: 1000, h: 1000 }, pane)
    expect(large.x).toBe(0)
    expect(large.y).toBe(400 - 2000)
  })

  it('is what the file viewer draws for a picture, with the zoom controls beside it', () => {
    const viewer = readFileSync(join(import.meta.dirname, 'components', 'FileViewer.tsx'), 'utf8')
    expect(viewer).toMatch(/<ZoomableImage src=\{text\}/)
    expect(viewer).not.toMatch(/className="lc-viewer__image"/)
    const image = readFileSync(join(import.meta.dirname, 'components', 'ZoomableImage.tsx'), 'utf8')
    for (const label of ['Zoom out', 'Zoom in', 'Fit to the pane', 'Actual size']) expect(image).toContain(`aria-label="${label}"`)
    // A trackpad pinch arrives as a wheel event with ctrlKey; it must not scroll the page while it zooms.
    expect(image).toMatch(/addEventListener\('wheel', listener, \{ passive: false \}\)/)
  })
})
