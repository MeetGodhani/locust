import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

/** Where the picture sits in the pane and how big: `scale` of its own pixels, `x`/`y` its top-left corner. */
export interface ImageView { readonly scale: number; readonly x: number; readonly y: number }

const MAX_SCALE = 8

/**
 * Zoom by `factor` keeping the point under the pointer (`px`, `py`, in the pane's pixels) where it is, between the
 * scale that fits the pane and eight times the image's own pixels.
 */
export function zoomAround(view: ImageView, factor: number, px: number, py: number, minScale: number): ImageView {
  const scale = Math.min(MAX_SCALE, Math.max(minScale, view.scale * factor))
  const ratio = scale / view.scale
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
}

/**
 * Keep the picture in the pane: centred along an axis where it is smaller than the pane, and never pulled so far that
 * an edge comes away from the pane's edge where it is larger.
 */
export function keepInPane(view: ImageView, image: { readonly w: number; readonly h: number }, pane: { readonly w: number; readonly h: number }): ImageView {
  const clampAxis = (at: number, size: number, room: number): number => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, at)))
  return { scale: view.scale, x: clampAxis(view.x, image.w * view.scale, pane.w), y: clampAxis(view.y, image.h * view.scale, pane.h) }
}

/**
 * The scale a picture opens at: the pane's width, never larger than its own pixels -- as the viewer always showed it,
 * so a tall screenshot is read by scrolling down it, not squeezed into the pane.
 */
export function fitScale(image: { readonly w: number; readonly h: number }, pane: { readonly w: number; readonly h: number }): number {
  return Math.min(1, pane.w / image.w)
}

/** The smallest it zooms out to: the whole picture in the pane. */
export function wholeScale(image: { readonly w: number; readonly h: number }, pane: { readonly w: number; readonly h: number }): number {
  return Math.min(1, pane.w / image.w, pane.h / image.h)
}

/**
 * AN IMAGE YOU CAN LOOK INTO (OpenCode 2's previews, 2026-10-19). It opens at the pane's width, as before. Pinch on
 * a trackpad, or Ctrl+wheel, zooms around the pointer, out as far as the whole picture; the + and - buttons and keys
 * zoom around the middle; a plain wheel or dragging pans once it is larger than the pane; double-click, Fit or 0
 * fits it again, and 100% or 1 shows its own pixels. Nothing is redrawn: the picture is the file, scaled.
 */
export function ZoomableImage({ src, alt }: { readonly src: string; readonly alt: string }): ReactElement {
  const pane = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number }>()
  const [size, setSize] = useState<{ w: number; h: number }>()
  const [view, setView] = useState<ImageView>()
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined)

  useEffect(() => {
    const element = pane.current
    if (element === null) return undefined
    const measure = (): void => setSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitted = natural !== undefined && size !== undefined && size.w > 0 && size.h > 0
    ? keepInPane({ scale: fitScale(natural, size), x: 0, y: 0 }, natural, size)
    : undefined
  const shown = view ?? fitted
  const settle = useCallback((next: ImageView): void => {
    if (natural === undefined || size === undefined) return
    setView(keepInPane(next, natural, size))
  }, [natural, size])
  const zoom = useCallback((factor: number, px?: number, py?: number): void => {
    if (shown === undefined || natural === undefined || size === undefined) return
    settle(zoomAround(shown, factor, px ?? size.w / 2, py ?? size.h / 2, wholeScale(natural, size)))
  }, [shown, natural, size, settle])
  const fit = (): void => setView(undefined)
  const actual = (): void => { if (natural !== undefined && size !== undefined && shown !== undefined) settle(zoomAround(shown, 1 / shown.scale, size.w / 2, size.h / 2, wholeScale(natural, size))) }
  const larger = shown !== undefined && natural !== undefined && size !== undefined && (natural.w * shown.scale > size.w + 0.5 || natural.h * shown.scale > size.h + 0.5)

  // Chromium sends a trackpad pinch as a wheel event with ctrlKey set: that zooms. A plain wheel or two-finger
  // scroll pans a picture larger than the pane, as the viewer's own scroll did, and otherwise passes by.
  const onWheel = useRef<(event: WheelEvent) => void>(() => undefined)
  onWheel.current = (event: WheelEvent): void => {
    const element = pane.current
    if (element === null) return
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      zoom(Math.exp(-event.deltaY * 0.01), event.clientX - box.left, event.clientY - box.top)
      return
    }
    if (!larger || shown === undefined) return
    event.preventDefault()
    settle({ scale: shown.scale, x: shown.x - event.deltaX, y: shown.y - event.deltaY })
  }
  useEffect(() => {
    const element = pane.current
    if (element === null) return undefined
    const listener = (event: WheelEvent): void => onWheel.current(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [])

  const percent = shown === undefined ? undefined : Math.round(shown.scale * 100)
  // Panning at the opening scale is still "Fit": the label and double-click follow the scale, not the position.
  const atFit = shown !== undefined && fitted !== undefined && Math.abs(shown.scale - fitted.scale) < 1e-6
  return (
    <div className="lc-zoomimage">
      <div
        ref={pane}
        className={`lc-zoomimage__pane${larger ? ' is-pannable' : ''}`}
        tabIndex={0}
        role="group"
        aria-label={`${alt}, ${percent === undefined ? 'loading' : `${String(percent)}%`}`}
        onDoubleClick={() => (atFit ? actual() : fit())}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25) }
          else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom(0.8) }
          else if (event.key === '0') { event.preventDefault(); fit() }
          else if (event.key === '1') { event.preventDefault(); actual() }
        }}
        onPointerDown={(event) => {
          if (!larger || event.button !== 0 || shown === undefined) return
          drag.current = { id: event.pointerId, x: event.clientX - shown.x, y: event.clientY - shown.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const held = drag.current
          if (held === undefined || held.id !== event.pointerId || shown === undefined) return
          settle({ scale: shown.scale, x: event.clientX - held.x, y: event.clientY - held.y })
        }}
        onPointerUp={() => { drag.current = undefined }}
        onPointerCancel={() => { drag.current = undefined }}
      >
        <img
          className="lc-zoomimage__picture"
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth || 1, h: event.currentTarget.naturalHeight || 1 })}
          style={shown === undefined || natural === undefined ? { visibility: 'hidden' } : { width: natural.w, height: natural.h, transform: `translate(${String(shown.x)}px, ${String(shown.y)}px) scale(${String(shown.scale)})` }}
        />
      </div>
      <div className="lc-zoomimage__tools" role="toolbar" aria-label="Zoom">
        <button type="button" className="lc-viewer__action" aria-label="Zoom out" title="Zoom out (-)" disabled={shown === undefined || natural === undefined || size === undefined || shown.scale <= wholeScale(natural, size) + 1e-6} onClick={() => zoom(0.8)}>−</button>
        <button type="button" className="lc-zoomimage__percent" title="Fit to the pane (0, or double-click)" aria-label="Fit to the pane" onClick={fit}>{atFit || percent === undefined ? 'Fit' : `${String(percent)}%`}</button>
        <button type="button" className="lc-viewer__action" aria-label="Zoom in" title="Zoom in (+)" disabled={shown === undefined || shown.scale >= MAX_SCALE - 1e-6} onClick={() => zoom(1.25)}>+</button>
        <button type="button" className="lc-zoomimage__actual" title="Its own pixels (1)" aria-label="Actual size" onClick={actual}>100%</button>
      </div>
    </div>
  )
}
