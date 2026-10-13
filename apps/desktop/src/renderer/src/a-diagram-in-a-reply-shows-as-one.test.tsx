import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AgentText } from './components/ThreadItems.js'

/*
 * A DIAGRAM IN A REPLY SHOWS AS ONE (0.770). A closed ```mermaid block is framed as a diagram, with its text a
 * tab away; one still being written is text until its fence closes; and every other block is the code it was.
 */
const lines = (...rows: readonly string[]): string => rows.join(String.fromCharCode(10))
const FLOW = lines('Here is how a deploy runs:', '', '```mermaid', 'graph LR', '  A[Push] --> B[Tests] --> C[Staging]', '```', '', 'Staging goes first.')

describe('a diagram in a reply', () => {
  it('is framed as a diagram once its block has closed, its text a tab away', () => {
    const html = renderToStaticMarkup(<AgentText text={FLOW} streaming={false} />)
    expect(html).toContain('class="lc-replypage lc-replydiagram"')
    expect(html).toContain('aria-label="Show the diagram or its text"')
    expect(html).toContain('>Diagram</button>')
    expect(html).toContain('>Code</button>')
    // Before the picture comes back, it says so; the prose around it is untouched.
    expect(html).toContain('Drawing the diagram…')
    expect(html).toContain('Here is how a deploy runs:')
    expect(html).toContain('Staging goes first.')
  })

  it('is text while it is still being written', () => {
    const html = renderToStaticMarkup(<AgentText text={lines('Here it comes:', '', '```mermaid', 'graph LR', '  A --> B')} streaming />)
    expect(html).not.toContain('lc-replydiagram')
    expect(html).toContain('graph LR')
  })

  it('leaves every other block as the code it was', () => {
    const html = renderToStaticMarkup(<AgentText text={lines('```js', 'const a = 1', '```')} streaming={false} />)
    expect(html).not.toContain('lc-replydiagram')
    expect(html).toContain('class="lc-code"')
  })
})
