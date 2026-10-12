import { useEffect, useRef } from 'react'

/**
 * CHATGPT'S VOICE, AS AN ORB (0.752). Colin, 2026-10-12, with bookofshapes.com's radial patterns: "potentially use
 * one of them for the voice chat orb". A call with a teammate wears the teammate's face; a call on Home is with
 * ChatGPT's own voice, which had only five level bars. This is its face: a halftone sphere -- dots on a staggered grid,
 * largest at the middle and lit from the upper left -- after "Halftone Sphere" by Nikolaj Sokolowski on Book of
 * Shapes, drawn here rather than copied so that it can move: the dots swell with the voice, a ripple runs outward
 * while it speaks, and it breathes slowly while it listens. Mono like Locust's other marks: soft grey while it listens,
 * bright while it speaks.
 *
 * It draws on every frame only while a call is on (`active`), and stops with the call. Reduced motion keeps the
 * level -- redrawn when it changes -- and drops the ripple and the breathing.
 */
export function VoiceOrb({ size, level, speaking, active }: {
  readonly size: number
  /** 0 to 1: how loud the call is now (the voice's level while it speaks, yours while it listens). */
  readonly level: number
  readonly speaking: boolean
  readonly active: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const target = useRef({ level, speaking })
  target.current = { level, speaking }
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  // With reduced motion there is no frame loop: the orb is drawn again when the level moves a step.
  const step = reduced ? Math.round(level * 10) : 0

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d') ?? null
    if (element === null || context === null) return
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    element.width = Math.round(size * ratio)
    element.height = Math.round(size * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    // Soft while it listens and bright while it speaks: the change the level bars made (lc-call__bars.is-voice).
    const style = getComputedStyle(element)
    const soft = style.getPropertyValue('--lc-text-secondary').trim() || style.color
    const bright = style.getPropertyValue('--lc-lime').trim() || style.color
    // About nine dots across at strip size and fifteen when large, so the sphere reads at 28px as at 96.
    const across = size >= 64 ? 15 : 9
    const pitch = size / across
    // A staggered grid, every other row shifted half a dot: round at 28px, where a square grid reads as a patch (0.752,
    // rendered side by side). Rows are closer by the height of a hexagon's step.
    const rows = Math.round(across / 0.866) + 1
    const middle = size / 2
    const moving = active && !reduced
    let shown = reduced ? target.current.level : 0
    let frame = 0
    const draw = (now: number): void => {
      const { level: wanted, speaking: talking } = target.current
      // Up quickly, down slowly, as a level meter falls.
      shown = reduced ? wanted : shown + (wanted - shown) * (wanted > shown ? 0.35 : 0.12)
      const t = now / 1000
      const breath = moving ? 0.04 * Math.sin(t * 1.6) : 0
      const reach = middle * (0.8 + 0.2 * shown + breath)
      context.clearRect(0, 0, size, size)
      context.fillStyle = talking ? bright : soft
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column <= across; column += 1) {
          const x = (column + (row % 2 === 0 ? 0.5 : 0)) * pitch
          const y = middle + (row - (rows - 1) / 2) * pitch * 0.866
          const distance = Math.hypot(x - middle, y - middle) / reach
          if (distance >= 1) continue
          // Halftone: largest at the middle, nothing at the rim.
          let radius = pitch * 0.48 * Math.pow(1 - distance * distance, 0.9)
          // A ripple outward while it speaks.
          if (moving && talking) radius *= 1 + 0.22 * shown * Math.sin(t * 7 - distance * 6)
          radius *= 0.72 + 0.45 * shown
          // Lit from the upper left.
          const lit = 1 - Math.hypot(x - middle * 0.62, y - middle * 0.62) / (size * 1.05)
          context.globalAlpha = Math.max(0.18, Math.min(1, 0.35 + 0.75 * lit))
          context.beginPath()
          context.arc(x, y, Math.max(0.35, Math.min(pitch * 0.5, radius)), 0, Math.PI * 2)
          context.fill()
        }
      }
      context.globalAlpha = 1
      if (moving) frame = requestAnimationFrame(draw)
    }
    if (moving) frame = requestAnimationFrame(draw)
    else draw(performance.now())
    return () => { cancelAnimationFrame(frame) }
  }, [size, active, reduced, step])

  return <canvas ref={canvas} className="lc-voiceorb" width={size} height={size} style={{ width: size, height: size }} aria-hidden="true" />
}
