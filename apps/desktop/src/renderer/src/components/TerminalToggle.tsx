import { Icon } from './Icon.js'

/** The terminal beside the conversation, as an icon in the header's row (0.797; see BrowserToggle). */
export function TerminalToggle({ open, refusal, onToggle }: { readonly open: boolean; readonly refusal?: string; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`lc-headicon${open ? ' is-active' : ''}`}
      aria-label={refusal === undefined ? 'Terminal' : 'Terminal, set by your organization'}
      aria-pressed={open}
      aria-keyshortcuts="Control+`"
      disabled={refusal !== undefined}
      title={refusal ?? 'Terminal (Ctrl+`)'}
      onClick={onToggle}
    >
      <Icon name="terminal" size={15} />
    </button>
  )
}
