import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { browserPointControl, POINT_BLOCKED, type PagePointChip } from '../../shared/browser-point.js'
import { BrowserPointButton } from './components/BrowserPanel.js'
import { PagePointChips } from './components/PagePointChips.js'

/**
 * The chat box holds a pointed part until Send. The button says so when the
 * page will not run the picker. Tab can reach the note and the remove button.
 */
const button = {
  url: 'http://127.0.0.1:9786/',
  selector: 'button#save',
  html: '<button id="save">Save</button>',
  htmlLength: 31,
  styles: [
    { name: 'width', value: '180px' },
    { name: 'color', value: 'rgb(11, 22, 33)' }
  ],
  source: { file: 'src/SaveButton.tsx', line: 18 }
}

const chips: readonly PagePointChip[] = [
  { id: 'save', note: 'the spacing is tight', attachment: 'page-part-1.png', point: button },
  {
    id: 'pw',
    note: '',
    point: {
      url: 'http://127.0.0.1:9786/',
      selector: 'input#pw',
      html: '<input id="pw" type="password" value="s3cret-pass">',
      htmlLength: 52,
      styles: [{ name: 'width', value: '200px' }],
      pictureNote: 'No picture: a password field is not photographed with its contents.'
    }
  }
]

describe('a pointed part sits in the chat box', () => {
  it('a blocked page says it does not allow pointing', () => {
    const html = renderToStaticMarkup(
      <BrowserPointButton control={browserPointControl({ blocked: true, pointing: false, hasPage: true })} onClick={() => undefined} />
    )
    expect(html).toContain(POINT_BLOCKED)
    expect(html).toContain('disabled')
    expect(html).toContain('aria-keyshortcuts="Control+Shift+C"')
  })

  it('a pointed part is a chip with a note, its styles, and a way to remove it', () => {
    const html = renderToStaticMarkup(<PagePointChips points={chips} onNote={() => undefined} onRemove={() => undefined} />)
    expect(html).toContain('button#save')
    expect(html).toContain('src/SaveButton.tsx:18')
    expect(html).toContain('width: 180px')
    expect(html).toContain('value="the spacing is tight"')
    expect(html).toContain('data-picture="page-part-1.png"')
    expect(html).toContain('aria-label="Note on button#save"')
    expect(html).toContain('aria-label="Remove button#save"')
    expect(html).not.toContain('tabindex="-1"')
  })

  it("a password field's chip has no picture of its contents", () => {
    const html = renderToStaticMarkup(<PagePointChips points={chips} onNote={() => undefined} onRemove={() => undefined} />)
    expect(html).toContain('No picture: a password field is not photographed with its contents.')
    expect(html).toContain('data-picture=""')
    expect(html).not.toContain('s3cret-pass')
  })
})
