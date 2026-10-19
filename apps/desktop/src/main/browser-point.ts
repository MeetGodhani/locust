import { captureRectOf, PICK_WAIT_MS } from './page-pick.js'
import { POINT_BLOCKED, readBrowserPoint, type BrowserPointResponse } from '../shared/browser-point.js'

/**
 * THE BROWSER'S PICKER, run in the browser page's own WebContents.
 *
 * The window asks main to point. Main runs this script. The window never
 * receives the page's document, and it has no way to hand a script in.
 * The outline is gone, and two frames drawn, before the answer, so the
 * picture taken next is of the page alone.
 */
export const BROWSER_PICKER_SCRIPT = `(() => new Promise((resolve) => {
  const hook = '__locustBrowserPointCancel'
  if (typeof window[hook] === 'function') window[hook]()
  const root = document.documentElement
  const box = document.createElement('div')
  box.setAttribute('data-locust-browser-point', '')
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #8fb3ff;outline-offset:-1px;background:rgba(143,179,255,0.14);border-radius:2px;left:0;top:0;width:0;height:0'
  root.appendChild(box)
  const cursor = root.style.cursor
  root.style.cursor = 'crosshair'
  let current = null
  const under = (event) => {
    const found = document.elementFromPoint(event.clientX, event.clientY)
    return !found || found === box ? null : found
  }
  const move = (event) => {
    const found = under(event)
    if (!found) return
    current = found
    const r = found.getBoundingClientRect()
    box.style.left = r.left + 'px'
    box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
  }
  const swallow = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
  const pathOf = (element) => {
    const parts = []
    let node = element
    while (node && node.nodeType === 1 && node !== root && parts.length < 5) {
      let part = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(part + '#' + node.id)
        break
      }
      const classes = Array.from(node.classList).slice(0, 2)
      if (classes.length > 0) part += '.' + classes.join('.')
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  const scrub = (node) => {
    if (!node || node.nodeType !== 1) return
    const tag = node.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') node.removeAttribute('value')
    if (tag === 'option') node.removeAttribute('selected')
    if (tag === 'textarea') node.textContent = ''
    const kids = node.children
    for (let i = 0; i < kids.length; i += 1) scrub(kids[i])
  }
  const kindOf = (node) => {
    const type = (node.getAttribute('type') || '').toLowerCase()
    const auto = (node.getAttribute('autocomplete') || '').toLowerCase()
    const blob = [type, auto, node.getAttribute('name') || '', node.getAttribute('id') || '', node.getAttribute('placeholder') || '', node.getAttribute('aria-label') || ''].join(' ')
    if (type === 'password' || /password|passcode|passphrase/.test(blob)) return 'password'
    if (auto === 'one-time-code' || /one-time-code|\\botp\\b|verification/.test(blob)) return 'one-time-code'
    if (/cc-number|cc-csc|cc-exp|\\bcvv\\b|\\bcvc\\b/.test(blob)) return 'payment'
    return null
  }
  const sensitiveKind = (el) => {
    const nodes = []
    if (el.matches && el.matches('input, textarea, select')) nodes.push(el)
    if (el.querySelectorAll) nodes.push(...el.querySelectorAll('input, textarea, select'))
    let kind = null
    for (const node of nodes) kind = kind || kindOf(node)
    return kind
  }
  const attr = (node, name) => {
    const value = node.getAttribute(name)
    return value && value.trim() ? value.trim() : ''
  }
  const parsePacked = (raw) => {
    const match = /^(.*):([0-9]+)(?::[0-9]+)?$/.exec(raw)
    if (match && (/[\\\\/]/.test(match[1]) || /\\.[A-Za-z0-9]+$/.test(match[1])) && !/^[A-Za-z]$/.test(match[1])) return { file: match[1], line: Number(match[2]) }
    if (/[\\\\/]/.test(raw) || /\\.[A-Za-z0-9]+$/.test(raw)) return { file: raw }
    return null
  }
  const reactSource = (el) => {
    const keys = Object.keys(el)
    let fiber = null
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      if (key.indexOf('__reactFiber') === 0 || key.indexOf('__reactInternalInstance') === 0) { fiber = el[key]; break }
    }
    for (let i = 0; fiber && i < 12; i += 1) {
      const src = fiber._debugSource
      if (src && typeof src.fileName === 'string' && src.fileName) {
        const line = typeof src.lineNumber === 'number' && src.lineNumber > 0 ? src.lineNumber : undefined
        return line ? { file: src.fileName, line: line } : { file: src.fileName }
      }
      fiber = fiber.return
    }
    return null
  }
  const vueSource = (el) => {
    const inst = el.__vueParentComponent || el.__vue__
    if (!inst) return null
    const file = (inst.type && inst.type.__file) || (inst.$options && inst.$options.__file)
    return typeof file === 'string' && file ? { file: file } : null
  }
  const namedSource = (el) => {
    let node = el
    for (let depth = 0; node && node.nodeType === 1 && depth < 8; depth += 1) {
      const fileAttr = attr(node, 'data-inspector-file') || attr(node, 'data-source-file')
      if (fileAttr) {
        const lineRaw = attr(node, 'data-inspector-line') || attr(node, 'data-source-line')
        const line = /^[0-9]+$/.test(lineRaw) ? Number(lineRaw) : undefined
        return line ? { file: fileAttr, line: line } : { file: fileAttr }
      }
      const packed = attr(node, 'data-source') || attr(node, 'data-v-inspector') || attr(node, 'data-inspector')
      if (packed) {
        const parsed = parsePacked(packed)
        if (parsed) return parsed
      }
      const react = reactSource(node)
      if (react) return react
      const vue = vueSource(node)
      if (vue) return vue
      node = node.parentElement
    }
    return null
  }
  const styleNames = ['width','height','margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','display','flex-direction','flex-wrap','justify-content','align-items','gap','grid-template-columns','grid-template-rows','position','top','right','bottom','left','font-family','font-size','font-weight','line-height','color','background-color','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-top-color','border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','opacity']
  const events = [['mousemove', move], ['mousedown', swallow], ['mouseup', swallow], ['pointerdown', swallow], ['pointerup', swallow], ['click', null], ['keydown', null]]
  let done = false
  const finish = (value) => {
    if (done) return
    done = true
    for (const [name, handler] of events) removeEventListener(name, handler, true)
    box.remove()
    root.style.cursor = cursor
    delete window[hook]
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)))
  }
  const click = (event) => {
    swallow(event)
    const found = under(event) || current
    if (!found) return finish(null)
    box.remove()
    const clone = found.cloneNode(true)
    scrub(clone)
    const html = clone.outerHTML || ''
    const r = found.getBoundingClientRect()
    const computed = getComputedStyle(found)
    const styles = {}
    for (const name of styleNames) styles[name] = computed.getPropertyValue(name)
    const sensitive = sensitiveKind(found)
    const source = namedSource(found)
    finish({
      selector: pathOf(found),
      html: html.slice(0, 8000),
      htmlLength: html.length,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      styles: styles,
      ...(sensitive ? { sensitive: sensitive } : {}),
      ...(source ? { source: source } : {})
    })
  }
  const key = (event) => {
    if (event.key !== 'Escape') return
    swallow(event)
    finish(null)
  }
  events[5][1] = click
  events[6][1] = key
  window[hook] = () => finish(null)
  for (const [name, handler] of events) addEventListener(name, handler, true)
}))()`

export const BROWSER_POINT_CANCEL = `(() => { if (typeof window.__locustBrowserPointCancel === 'function') window.__locustBrowserPointCancel() })()`

export const BROWSER_POINT_RESTORE = `(() => { document.querySelectorAll('[data-locust-browser-target]').forEach((node) => node.removeAttribute('data-locust-browser-target')) })()`

/** A page that will not run script answers with anything but true. */
export const BROWSER_POINT_PROBE = `(() => true)()`

export const BROWSER_POINT_SCRIPTS = [BROWSER_POINT_PROBE, BROWSER_PICKER_SCRIPT, BROWSER_POINT_CANCEL, BROWSER_POINT_RESTORE] as const

export interface BrowserPointPage {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  capturePage(rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): Promise<{ isEmpty(): boolean; toPNG(): Uint8Array }>
  getURL(): string
  isDestroyed(): boolean
  getZoomFactor(): number
}

function zoomOf(page: BrowserPointPage): number {
  try {
    const zoom = page.getZoomFactor()
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  } catch {
    return 1
  }
}

/**
 * Runs the picker in the browser page. The only scripts it runs are the ones
 * named above. A cancelled pick, or one that never comes, adds nothing.
 */
export async function pointInBrowser(page: BrowserPointPage, wait: number = PICK_WAIT_MS): Promise<BrowserPointResponse> {
  if (page.isDestroyed()) return { ok: false, message: 'The page is gone. It was not pointed at.' }
  try {
    const probe = await page.executeJavaScript(BROWSER_POINT_PROBE, true)
    if (probe !== true) return { ok: false, message: POINT_BLOCKED, blocked: true }
  } catch {
    return { ok: false, message: POINT_BLOCKED, blocked: true }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      void page.executeJavaScript(BROWSER_POINT_CANCEL).catch(() => undefined)
      resolve(undefined)
    }, wait)
  })
  try {
    let raw: unknown
    try {
      raw = await Promise.race([page.executeJavaScript(BROWSER_PICKER_SCRIPT, true), late])
    } catch {
      if (page.isDestroyed()) return { ok: false, message: 'The page closed before a part was chosen. Nothing was added.' }
      return { ok: false, message: POINT_BLOCKED, blocked: true }
    }
    if (raw == null) return { ok: true }
    const read = readBrowserPoint(raw, page.getURL())
    if (read === undefined) return { ok: true }
    if (read.point.pictureNote !== undefined) return { ok: true, picked: read.point }
    const where = captureRectOf({ x: 0, y: 0, width: read.viewport.width, height: read.viewport.height }, read.rect, zoomOf(page))
    if (where === undefined) return { ok: true, picked: read.point }
    const image = await page.capturePage(where).catch(() => undefined)
    const png = image === undefined || image.isEmpty() ? undefined : new Uint8Array(image.toPNG())
    return { ok: true, picked: read.point, ...(png === undefined ? {} : { png }) }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    await page.executeJavaScript(BROWSER_POINT_RESTORE).catch(() => undefined)
  }
}
