/**
 * A DIAGRAM IN A REPLY, DRAWN (0.770).
 *
 * From the 2026-10-13 look through t3code (Colin: "sounds good ill run with all your recs"). A model draws a
 * diagram by writing Mermaid in a fenced block -- a flowchart, the calls between two services, a timeline -- and
 * Claude, ChatGPT and t3code show the diagram. Locust showed its text. Now a closed ```mermaid block is drawn,
 * with its text a tab away.
 *
 * WHERE IT IS DRAWN is what keeps it safe. Mermaid reads text a model wrote, which a prompt injection may have
 * written, and it has had more than one bug that let such text run script. So it never runs in Locust's window.
 * It runs on Locust's own page, renderer/diagram.html, in a view that belongs to no window (main/diagram-view.ts,
 * as a PDF is read): sandboxed, no preload, no Node, and a policy that loads nothing from anywhere. What comes
 * back is the picture, as SVG text, and the window shows it as an image, which never runs anything.
 */

/** A reply's diagram, drawn in the view no one sees (0.770): the window asks, the host answers with the picture. */
export const DIAGRAM_DRAW_CHANNEL = 'reply:diagram'

/** Why a diagram is text when Locust itself is at fault, not the diagram. */
export const DIAGRAM_UNDRAWN = 'Locust could not draw it'

/** The words after a fence that mean Mermaid. */
const LANGUAGES: ReadonlySet<string> = new Set(['mermaid', 'mmd'])

/** The longest diagram Locust draws: a big flowchart is a few kilobytes of text. */
export const MAX_DIAGRAM_CHARS = 40_000

/** The largest picture it keeps: a big diagram, and the typeface it carries (about 37 KB). */
export const MAX_DIAGRAM_SVG_CHARS = 3_000_000

/** The largest side a picture may claim, in pixels. */
const MAX_SIDE = 20_000

/** Whether a code block is a diagram to draw. */
export function isDiagram(code: string, language?: string): boolean {
  return language !== undefined && LANGUAGES.has(language.trim().toLowerCase()) && code.trim().length > 0 && code.length <= MAX_DIAGRAM_CHARS
}

export type DiagramResponse =
  | {
      readonly ok: true
      /** The picture, an SVG document carrying its own typeface. */
      readonly svg: string
      readonly width: number
      readonly height: number
      /** What Mermaid called it: `flowchart-v2`, `sequence`, `pie`... */
      readonly kind?: string
      /** The title the diagram gave itself (Mermaid's accTitle), for the picture's words. */
      readonly title?: string
    }
  /** `again`: the view failed, not the diagram, so a later try may draw it. */
  /** `message`: why, as a short phrase -- Mermaid's own reason, or Locust's -- for "Not drawn as a diagram (...)". */
  | { readonly ok: false; readonly message: string; readonly again?: true }

/**
 * What the drawing page answered, checked (0.770). The page has read text a model wrote, so its answer is taken
 * only in the one shape it may have: an SVG of a sensible size, or a short reason in words.
 */
export function diagramFrom(returned: unknown): DiagramResponse {
  if (typeof returned !== 'object' || returned === null) return { ok: false, message: DIAGRAM_UNDRAWN }
  const { svg, width, height, kind, title, error } = returned as Record<string, unknown>
  if (typeof error === 'string') return { ok: false, message: reasonOf(error) }
  const side = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_SIDE
  if (typeof svg !== 'string' || svg.length > MAX_DIAGRAM_SVG_CHARS || !/^<svg[\s>]/.test(svg.trimStart()) || !side(width) || !side(height)) {
    return { ok: false, message: DIAGRAM_UNDRAWN }
  }
  const named = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  return {
    ok: true,
    svg,
    width: Math.ceil(width),
    height: Math.ceil(height),
    ...(typeof kind === 'string' && /^[\w-]{1,40}$/.test(kind) ? { kind } : {}),
    ...(named.length > 0 ? { title: named } : {})
  }
}

/** Mermaid's reason, as one plain phrase: the first line of its own ("Parse error on line 3:"), and short. */
function reasonOf(error: string): string {
  const line = error.split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0) ?? ''
  // Its first line ends where Mermaid's quote of the text begins: "Parse error on line 3:".
  const plain = line.replace(/\s+/g, ' ').trim().replace(/[:.]$/, '')
  if (plain.length === 0) return 'Mermaid could not read it'
  return plain.length > 160 ? `${plain.slice(0, 157)}...` : plain
}

/** What to call a drawn diagram, from Mermaid's name for it: "Flowchart", "Sequence diagram"... */
const KINDS: Readonly<Record<string, string>> = {
  flowchart: 'Flowchart', 'flowchart-v2': 'Flowchart', 'flowchart-elk': 'Flowchart', graph: 'Flowchart',
  sequence: 'Sequence diagram', class: 'Class diagram', classDiagram: 'Class diagram', state: 'State diagram',
  stateDiagram: 'State diagram', er: 'Entity relationships', gantt: 'Gantt chart', pie: 'Pie chart',
  journey: 'User journey', gitGraph: 'Git graph', mindmap: 'Mind map', timeline: 'Timeline',
  quadrantChart: 'Quadrant chart', xychart: 'Chart', sankey: 'Sankey diagram', block: 'Block diagram',
  architecture: 'Architecture', packet: 'Packet diagram', kanban: 'Kanban board', radar: 'Radar chart',
  treemap: 'Treemap', requirement: 'Requirements', c4: 'C4 diagram', info: 'Diagram'
}
export function diagramKindWords(kind: string | undefined): string {
  return (kind === undefined ? undefined : KINDS[kind]) ?? 'Diagram'
}

/** The picture as an image's address: data, so nothing is fetched to show it. */
export function diagramImage(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
