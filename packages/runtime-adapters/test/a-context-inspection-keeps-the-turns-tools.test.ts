import { describe, expect, it } from 'vitest'
import { claudeReferenceDenyRule, createClaudeContextCommand, createClaudePrintCommand } from '../src/commands.js'

const executable = { executablePath: 'claude', prefixArgs: [] }
const session = '12345678-1234-1234-1234-123456789012'
describe('a context inspection keeps the turn\'s tools', () => {
  it('keeps the turn\'s connectors-off flag, settings, plugins, references, tools, model and approval bridge', () => {
    const turn = createClaudePrintCommand(executable, {
      workspacePath: 'C:/project', sandbox: 'workspace-write', accountConnectors: false,
      referenceFolders: ['C:/design kit'], skillPlugins: ['C:/plugin/project'], model: 'sonnet', effort: 'high',
      commandGuard: { settingsPath: 'C:/guard/settings.json' },
      permissionBridge: { configPath: 'C:/bridge/mcp.json', toolName: 'mcp__permission__ask' },
      resumeThreadId: 'previous_session', forkSession: true
    })
    const context = createClaudeContextCommand(turn, session)
    for (const flag of ['--restricted', '--strict-mcp-config', '--settings', '--plugin-dir', '--add-dir', '--tools', '--permission-mode', '--mcp-config', '--permission-prompt-tool', '--disallowedTools', '--model', '--effort']) {
      expect(context.args).toContain(flag)
      expect(context.args[context.args.indexOf(flag) + 1]).toBe(turn.args[turn.args.indexOf(flag) + 1])
    }
    expect(context.args).toContain('--no-session-persistence')
    expect(context.args.slice(-7)).toEqual(['--output-format', 'json', '--no-session-persistence', '--resume', session, '--', '/context'])
    expect(context.args[context.args.indexOf('--output-format') + 1]).toBe('json')
    expect(context.args).not.toContain('--input-format')
    expect(context.args).not.toContain('--fork-session')
    expect(context.args).not.toContain('previous_session')
    expect(context.stdin).toBe('none')
    expect(context.cwd).toBe(turn.cwd)
  })
  it('does not turn on strict MCP or add reference denials to an Auto invocation that did not have them', () => {
    const turn = createClaudePrintCommand(executable, { workspacePath: 'C:/project', sandbox: 'full-access', accountConnectors: true, referenceFolders: ['C:/reference'] })
    const context = createClaudeContextCommand(turn, session)
    expect(context.args).not.toContain('--strict-mcp-config')
    expect(context.args).not.toContain('--disallowedTools')
    expect(context.args).toContain('bypassPermissions')
  })
  it('refuses a lost or truncated launch, a non-Claude command, or disabled slash commands instead of guessing', () => {
    const turn = createClaudePrintCommand(executable, { workspacePath: 'C:/project' })
    for (const bad of [{ ...turn, runtime: 'codex' as const }, { ...turn, args: [...turn.args, '--disable-slash-commands'] }, { ...turn, args: [...turn.args, 'truncated…'] }]) expect(() => createClaudeContextCommand(bad, session)).toThrow()
  })
})
describe('Claude references in Edit use the effective absolute path deny', () => {
  it('uses the documented Windows POSIX drive spelling and the Edit rule that also governs Write and NotebookEdit', () => {
    expect(claudeReferenceDenyRule('C:\\References\\Design kit\\')).toBe('Edit(//c/References/Design kit/**)')
    expect(claudeReferenceDenyRule('/opt/design kit')).toBe('Edit(//opt/design kit/**)')
    const command = createClaudePrintCommand(executable, { workspacePath: 'C:/project', sandbox: 'workspace-write', referenceFolders: ['C:/reference', 'D:/other'] })
    expect(command.args.slice(command.args.indexOf('--disallowedTools') + 1)).toEqual(['Edit(//c/reference/**)', 'Edit(//d/other/**)'])
    expect(command.args).not.toContain('Write(//c/reference/**)')
    expect(command.args[command.args.indexOf('--tools') + 1]).toContain('Bash')
    expect(command.args).not.toContain('Bash')
  })
  it('adds no path denials in Ask or Auto and refuses ambiguous patterns before granting access', () => {
    for (const sandbox of ['read-only', 'full-access'] as const) expect(createClaudePrintCommand(executable, { workspacePath: 'C:/project', sandbox, referenceFolders: ['C:/reference'] }).args).not.toContain('--disallowedTools')
    for (const folder of ['C:/foo*', 'C:/foo[old]', 'C:/foo,bar', '//server/share', 'relative']) expect(() => claudeReferenceDenyRule(folder)).toThrow('cannot be protected')
  })
})
