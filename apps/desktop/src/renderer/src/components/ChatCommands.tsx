import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { ListedCommand } from '../../../shared/own-commands.js'

/** Settings > Chat: the commands on this computer and in this folder, and where their files are. */
export function ChatCommands(): ReactElement {
  const [commands, setCommands] = useState<readonly ListedCommand[]>([])
  const [note, setNote] = useState<string>()
  useEffect(() => {
    let gone = false
    void window.desktop?.ownCommands?.list({}).then((answer) => {
      if (!gone && answer.ok) setCommands(answer.commands)
    }).catch(() => undefined)
    return () => { gone = true }
  }, [])
  const open = (which: 'global' | 'project'): void => {
    void window.desktop?.ownCommands?.openFolder(which, {}).then((answer) => {
      if (answer !== undefined && !answer.ok) setNote(answer.message)
    }).catch(() => setNote('That folder could not be opened. Your commands are where they were.'))
  }
  const global = commands.filter((command) => command.source === 'global')
  const project = commands.filter((command) => command.source === 'project')
  const rows = (list: readonly ListedCommand[], empty: string) => list.length === 0
    ? <p className="lc-settings__note">{empty}</p>
    : list.map((command) => (
        <p key={`${command.source}:${command.name}`} className="lc-commandlist__name">
          <span className="lc-mono">/{command.name}</span>
          {command.description !== undefined && <span className="lc-settings__note">{command.description}</span>}
        </p>
      ))
  return (
    <div className="lc-commandlist">
      <div className="lc-commandlist__item">
        <span className="lc-mono">On this computer</span>
        {rows(global, 'No commands yet. Open the folder and add a Markdown file.')}
        <button type="button" className="lc-button" aria-label="Open your commands folder" onClick={() => open('global')}>Open folder</button>
      </div>
      <div className="lc-commandlist__item">
        <span className="lc-mono">This folder</span>
        {rows(project, 'No commands in this folder yet.')}
        <button type="button" className="lc-button" aria-label="Open this folder's commands" onClick={() => open('project')}>Open folder</button>
      </div>
      {note !== undefined && <p className="lc-settings__note">{note}</p>}
    </div>
  )
}
