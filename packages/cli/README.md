# The locust command

This workspace package talks to the Locust app already open on this computer.
It does not launch an agent directly, sign in, enable the server, install
anything globally, or change an editor's or agent's settings.

Build with `pnpm --filter @teammate/cli build`. The package's `bin` entry is
`locust`; without installing it, run `node packages/cli/bin/locust.mjs` from
the repository root. Node 22.22 or newer is required, as for the app.

In Locust, choose the project folder and enable Settings > General > Let your
other AI apps use Locust. Then:

```text
locust teammates
locust send "One" "Explain this project"
locust status
locust acp --teammate "One"
```

`send` streams text; Ctrl+C requests cancellation of that turn only. Approval
cards and questions for this terminal command are answered in Locust.
Status lists up to 50 recent turns, including running turns and cards waiting
on the person. A teammate is identified by name or id; ambiguous names require
the id shown by `teammates`.

The default profile is Electron's current application-name directory,
`@teammate/desktop`, beneath Windows' APPDATA, macOS' Library/Application
Support, or Linux's XDG_CONFIG_HOME (otherwise ~/.config). For a development
copy or an app started with `--user-data-dir`, pass `--profile <folder>`.
Only Locust's own `locust-mcp-connection.json` is read. Its token is neither
printed nor sent outside 127.0.0.1; redirects and automatic retries are refused.

## ACP editors

Configure the editor to start the command `locust` with args `acp`, optionally
followed by `--teammate` and a teammate's name/id. Configuration is manual;
this package never edits the editor. The editor's session cwd must be the
folder currently open in Locust. The teammate defaults to the first on the
team, and the session's Teammate config option can change it before the first
prompt. Later prompts continue that conversation; changing teammates then
requires a new session.

ACP v1 accepts text prompts and an empty editor MCP-server list. It advertises
no history loading, attachments, editor filesystem operations, or terminal
capabilities. The teammate still uses its own tools and connectors configured
in Locust. Turns default to Ask, or the teammate's saved mode when the person
has enabled Use each teammate's own mode. The app's Auto and monthly-limit
guards still apply; no automatic teammate handoffs are introduced.

Cards wait in Locust's window unless the person turns on Let editors answer
cards for their own turns in Locust's Settings, which appears there once an
editor has connected: every app connected to Locust holds the key a session is
opened with, so an editor answering is the person's choice. With it on, an
action's approval card becomes an ACP permission request offering Allow once
or Deny, never Always. Only the current turn this editor session started can
be answered or cancelled. Questions stay in Locust, rather than being
converted into authorization. The usual MCP bridge offers no approval or
cancellation tools and cannot adopt an editor session.

Cancel, stdin EOF and disconnect cleanup stop owned work, including a late
start. A killed client loses its 30-second heartbeat lease and the app requests
cancellation. Startup has a two-minute deadline; no prompt is automatically
replayed after a timeout or an uncertain result. ACP sessions are process-local
and are not loaded after the app restarts. Cancellation cannot undo actions
that already happened.

The tests use a fake authenticated app and fake editor. No live agent, paid
turn, sign-in, editor installation, or global configuration is needed.
