import { Icon } from './Icon.js'

export function BrowserToggle({
  open,
  refusal,
  onToggle
}: {
  readonly open: boolean
  readonly refusal?: string
  readonly onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`lc-button${open ? ' is-active' : ''}`}
      aria-label="Browser"
      aria-pressed={open}
      disabled={refusal !== undefined}
      title={refusal ?? 'Browser'}
      onClick={onToggle}
    >
      <Icon name="globe" size={13} />
      {refusal === undefined ? 'Browser' : 'Browser · Set by your organization'}
    </button>
  )
}
