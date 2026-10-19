import { styleSummary, type PagePointChip } from '../../../shared/browser-point.js'
import { AttachedImage } from './AttachedImage.js'
import { Icon } from './Icon.js'

/**
 * Parts of the browser page waiting in the chat box. Each one can take a
 * note. Nothing here is sent until Send. Tab reaches the note and the remove
 * button. Removing a chip drops its picture from the message.
 */
export function PagePointChips({
  points,
  onNote,
  onRemove
}: {
  readonly points: readonly PagePointChip[]
  readonly onNote: (id: string, note: string) => void
  readonly onRemove: (id: string) => void
}) {
  if (points.length === 0) return null
  return (
    <div className="lc-pagepoints" aria-label="Pointed parts of the page">
      {points.map((chip) => (
        <div className="lc-pagepoint" key={chip.id} data-selector={chip.point.selector} data-picture={chip.attachment ?? ''} data-picture-note={chip.point.pictureNote ?? ''} data-styles={chip.point.styles.map((style) => `${style.name}: ${style.value}`).join('\n')} data-source={chip.point.source === undefined ? '' : `${chip.point.source.file}${chip.point.source.line === undefined ? '' : `:${String(chip.point.source.line)}`}`}>
          {chip.attachment !== undefined && (
            <span className="lc-pagepoint__shot">
              <AttachedImage path={chip.attachment} />
            </span>
          )}
          <div className="lc-pagepoint__body">
            <span className="lc-pagepoint__where" title={chip.point.url}>{chip.point.selector}</span>
            {chip.point.source !== undefined && (
              <span className="lc-pagepoint__source">{chip.point.source.file}{chip.point.source.line === undefined ? '' : `:${String(chip.point.source.line)}`}</span>
            )}
            {chip.point.styles.length > 0 && <span className="lc-pagepoint__styles">{styleSummary(chip.point.styles)}</span>}
            {chip.point.pictureNote !== undefined && <span className="lc-pagepoint__picture-note">{chip.point.pictureNote}</span>}
            <input
              className="lc-pagepoint__note"
              aria-label={`Note on ${chip.point.selector}`}
              placeholder="Add a note"
              maxLength={500}
              value={chip.note}
              onChange={(event) => onNote(chip.id, event.target.value)}
            />
          </div>
          <button type="button" className="lc-pagepoint__remove" aria-label={`Remove ${chip.point.selector}`} title="Remove this part and its picture" onClick={() => onRemove(chip.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
