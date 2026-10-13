/*! Locust's diagrams are drawn by Mermaid (https://mermaid.js.org), Copyright (c) 2014-2022 Knut Sveidqvist, under the MIT License: https://github.com/mermaid-js/mermaid/blob/develop/LICENSE */
import mermaid from 'mermaid'

import figtree from './assets/fonts/Figtree-Variable.woff2?inline'

/**
 * THE PAGE THAT DRAWS A DIAGRAM (0.770, shared/diagram.ts), loaded in a view no one sees (main/diagram-view.ts).
 *
 * The diagram's Mermaid text arrives as an argument and its picture leaves as SVG text, which Locust's window
 * shows as an image. Mermaid runs here, never in that window, because its input is text a model wrote: in
 * strict mode (no script, no links that run anything), on a page whose policy loads nothing from anywhere.
 *
 * THE PICTURE CARRIES ITS OWN TYPEFACE. An image cannot use the fonts of the page it sits on, so a diagram
 * measured in Locust's face and shown in a system one has labels that spill from their boxes. Figtree, the
 * face of Locust's own screens (27 KB), is measured with here and embedded in the picture.
 *
 * THE COLOURS ARE LOCUST'S (tokens.css): nodes a step above the reply's card, hairline borders, muted lines,
 * and the status colours for what a chart needs to tell apart.
 */
const FONT = 'Figtree, ui-sans-serif, system-ui, sans-serif'
const face = new FontFace('Figtree', `url(${figtree})`, { weight: '300 900' })
document.fonts.add(face)
const typeface = face.load().catch(() => undefined)

/** The palette a chart tells its parts apart with: Locust's status colours, then three more in their key. */
const PALETTE = ['#6ea8fe', '#7fc97f', '#e9b949', '#e4685d', '#b39ddb', '#4fc1c9', '#f29e6d', '#9aa3a2'] as const

const GROUND = '#191c1d' // --lc-bg-raised: the card a diagram sits on
const NODE = '#23282a' // a step above it
const BORDER = '#454b4c'
const TEXT = '#f2efe9' // --lc-text-primary
const SECONDARY = '#c7c3bc' // --lc-text-secondary
const LINE = '#8b9190' // --lc-text-muted
const INK = '#0b0d0e' // text on a coloured part

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  // A mistake in the text is said in words, beside the text; Mermaid's own error picture is never drawn.
  suppressErrorRendering: true,
  // What the text itself may never change, Mermaid's own list and the labels: SVG text, never HTML.
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels'],
  maxTextSize: 40_000,
  htmlLabels: false,
  theme: 'base',
  darkMode: true,
  fontFamily: FONT,
  flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis', padding: 12, nodeSpacing: 44, rankSpacing: 52 },
  sequence: { useMaxWidth: false, mirrorActors: false, actorMargin: 56, messageFontFamily: FONT, noteFontFamily: FONT, actorFontFamily: FONT },
  class: { useMaxWidth: false },
  state: { useMaxWidth: false },
  er: { useMaxWidth: false },
  gantt: { useMaxWidth: false },
  journey: { useMaxWidth: false },
  pie: { useMaxWidth: false },
  gitGraph: { useMaxWidth: false },
  mindmap: { useMaxWidth: false },
  timeline: { useMaxWidth: false },
  themeVariables: {
    darkMode: true,
    fontFamily: FONT,
    fontSize: '14px',
    background: GROUND,
    primaryColor: NODE,
    primaryTextColor: TEXT,
    primaryBorderColor: BORDER,
    secondaryColor: '#1f2425',
    secondaryTextColor: TEXT,
    secondaryBorderColor: BORDER,
    tertiaryColor: '#1d2122',
    tertiaryTextColor: TEXT,
    tertiaryBorderColor: BORDER,
    mainBkg: NODE,
    nodeBorder: BORDER,
    nodeTextColor: TEXT,
    textColor: SECONDARY,
    titleColor: TEXT,
    lineColor: LINE,
    edgeLabelBackground: GROUND,
    clusterBkg: '#1d2122',
    clusterBorder: '#33393a',
    // A note is Locust's blue tint, as a note beside the work is (--lc-blue-tint, --lc-blue-border on the card).
    noteBkgColor: '#232d38',
    noteBorderColor: '#344965',
    noteTextColor: TEXT,
    actorBkg: NODE,
    actorBorder: BORDER,
    actorTextColor: TEXT,
    actorLineColor: '#4f5556',
    signalColor: SECONDARY,
    signalTextColor: TEXT,
    labelBoxBkgColor: NODE,
    labelBoxBorderColor: BORDER,
    labelTextColor: TEXT,
    loopTextColor: SECONDARY,
    activationBkgColor: '#2c3133',
    activationBorderColor: '#5a6061',
    sequenceNumberColor: GROUND,
    attributeBackgroundColorOdd: '#1d2122',
    attributeBackgroundColorEven: GROUND,
    sectionBkgColor: '#1d2122',
    altSectionBkgColor: GROUND,
    sectionBkgColor2: '#1d2122',
    gridColor: '#33393a',
    taskBkgColor: '#2a4a73',
    taskBorderColor: PALETTE[0],
    taskTextColor: TEXT,
    taskTextLightColor: TEXT,
    taskTextOutsideColor: SECONDARY,
    taskTextDarkColor: TEXT,
    activeTaskBkgColor: '#3b6aa6',
    activeTaskBorderColor: '#9dc2fb',
    doneTaskBkgColor: '#2c3133',
    doneTaskBorderColor: '#5a6061',
    critBkgColor: '#5a2b27',
    critBorderColor: PALETTE[3],
    todayLineColor: PALETTE[2],
    excludeBkgColor: '#16191a',
    pieStrokeColor: GROUND,
    pieStrokeWidth: '2px',
    pieOuterStrokeColor: GROUND,
    pieOuterStrokeWidth: '0px',
    // Mermaid sets a pie's words at 25 and 17 px; a reply's own scale is 16 and 13.
    pieTitleTextSize: '16px',
    pieSectionTextSize: '13px',
    pieLegendTextSize: '13px',
    pieTitleTextColor: TEXT,
    pieSectionTextColor: INK,
    pieLegendTextColor: SECONDARY,
    pieOpacity: '1',
    commitLabelColor: TEXT,
    commitLabelBackground: NODE,
    ...Object.fromEntries(PALETTE.flatMap((colour, index) => [
      [`pie${String(index + 1)}`, colour],
      [`git${String(index)}`, colour],
      [`gitBranchLabel${String(index)}`, INK],
      [`cScale${String(index)}`, colour],
      [`cScaleLabel${String(index)}`, INK]
    ])),
    xyChart: { backgroundColor: GROUND, titleColor: TEXT, xAxisLabelColor: SECONDARY, xAxisTitleColor: SECONDARY, xAxisTickColor: LINE, xAxisLineColor: LINE, yAxisLabelColor: SECONDARY, yAxisTitleColor: SECONDARY, yAxisTickColor: LINE, yAxisLineColor: LINE, plotColorPalette: PALETTE.join(', ') }
  }
})

interface Drawn {
  readonly svg: string
  readonly width: number
  readonly height: number
  readonly kind: string
  readonly title?: string
}

let count = 0

/** Draws one diagram: the picture at its own size, carrying its typeface, or why there is none. */
async function drawDiagram(source: string): Promise<Drawn | { readonly error: string }> {
  await typeface
  count += 1
  try {
    const { svg, diagramType } = await mermaid.render(`locust-diagram-${String(count)}`, source)
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = parsed.documentElement
    if (root.nodeName.toLowerCase() !== 'svg') return { error: 'Mermaid drew no picture of it' }
    const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
    const width = box.length === 4 && Number.isFinite(box[2]) ? Math.ceil(box[2]!) : Number.parseFloat(root.getAttribute('width') ?? '')
    const height = box.length === 4 && Number.isFinite(box[3]) ? Math.ceil(box[3]!) : Number.parseFloat(root.getAttribute('height') ?? '')
    if (!(width > 0) || !(height > 0)) return { error: 'Mermaid drew no picture of it' }
    // Its own size, not "100% of whatever it sits in": the window decides how it fits.
    root.setAttribute('width', String(width))
    root.setAttribute('height', String(height))
    root.removeAttribute('style')
    const style = parsed.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = `@font-face{font-family:'Figtree';src:url(${figtree}) format('woff2');font-weight:300 900;font-style:normal}`
    root.insertBefore(style, root.firstChild)
    const title = root.querySelector('title')?.textContent?.trim()
    return { svg: new XMLSerializer().serializeToString(root), width, height, kind: diagramType, ...(title === undefined || title.length === 0 ? {} : { title: title.slice(0, 200) }) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    // Whatever Mermaid left behind while it measured goes, so one diagram leaves nothing for the next.
    for (const left of [...document.body.children]) if (left.tagName !== 'SCRIPT') left.remove()
  }
}

;(window as { locustDrawDiagram?: typeof drawDiagram }).locustDrawDiagram = drawDiagram
