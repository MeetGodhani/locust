/**
 * CODEX'S WINDOWS SANDBOX DID NOT START (0.736).
 *
 * On Windows every sandboxed Codex command can fail before it starts, with
 * `Failed to create unified exec process: helper_unknown_error: setup refresh
 * had errors` as its whole output. Codex's own log (`~/.codex/.sandbox/`) says
 * why: its setup could not change the access list on one of its files because
 * another process held it -- on Colin's computer, the Codex desktop app's
 * `node_repl.exe` (2026-10-09 and again 2026-10-10) -- with the app's window closed: codex.exe and
 * codex-computer-use-swift.exe were still running at 18:40 and gone by 23:27, when `codex sandbox` worked again. The row said only
 * "failed", and Codex's answer said its "setup refresh returned an error".
 *
 * Auto skips the sandbox (Codex runs with full access there), which is why
 * the same computer ran Codex commands in Auto while this was happening.
 */
const DID_NOT_START = /helper_unknown_error|setup refresh had errors/i

export function codexSandboxDidNotStart(output: string | undefined): boolean {
  return output !== undefined && DID_NOT_START.test(output)
}

export const CODEX_SANDBOX_DID_NOT_START =
  'Codex’s Windows sandbox could not set itself up, so this command never started. That happens when another program holds one of the sandbox’s files, usually a Codex app process still running in the background (codex.exe or codex-computer-use-swift.exe in Task Manager). Once it has ended, ask again; or switch this teammate to Auto, which runs without the sandbox.'
