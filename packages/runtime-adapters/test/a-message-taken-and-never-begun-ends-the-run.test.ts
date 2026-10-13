import { describe, expect, it } from "vitest";

import { createOpenCodeServeCommand } from "../src/commands.js";
import { startOpenCodeServeRun } from "../src/opencode-serve-run.js";
import type { AppServerRunProcess } from "../src/codex-app-server-run.js";

/*
 * A MESSAGE TAKEN AND NEVER BEGUN (0.763). OpenCode's server answers `prompt_async` at once and works on the message
 * after. On 2026-10-12 two comparison columns ran OpenCode in one folder at once; one's work failed inside the server
 * ("prompt_async failed ... SQLiteError: database is locked", in OpenCode's log) and nothing more came on its event
 * stream -- no error, no idle -- so the turn sat on "Starting" for eight minutes. A minute with no sign of the model
 * has the server asked; a session it lists as neither busy nor answered was dropped, and the run ends saying so.
 */
const SESSION = "ses_dropped";
const EXECUTABLE = { executablePath: "C:/tools/opencode.exe", prefixArgs: [] as readonly string[] };

function fakeServer(options: { readonly status: Record<string, unknown>; readonly events?: readonly string[]; readonly messages?: unknown[] }) {
  let prompted!: () => void;
  const promptSent = new Promise<void>((resolve) => { prompted = resolve; });
  const asked: string[] = [];
  const spawn = (): AppServerRunProcess => ({
    write: () => undefined,
    kill: () => undefined,
    onData: (listener) => { setTimeout(() => listener("opencode server listening on http://127.0.0.1:4096\n"), 0); },
    onExit: () => undefined,
  });
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url.replace("http://127.0.0.1:4096", ""));
    if (url.endsWith("/event")) {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          await promptSent;
          for (const line of options.events ?? []) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
          // And then nothing at all, as the dropped message's stream was.
        },
      }), { status: 200 });
    }
    if (url.endsWith("/session")) return Response.json({ id: SESSION });
    if (url.endsWith("/prompt_async")) {
      prompted();
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/session/status")) return Response.json(options.status);
    if (url.endsWith(`/session/${SESSION}/message`)) return Response.json(options.messages ?? []);
    if (url.endsWith("/abort")) return new Response(null, { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { spawn, fetcher, asked };
}

const started = (server: ReturnType<typeof fakeServer>, signal?: AbortSignal) =>
  startOpenCodeServeRun({
    spawn: server.spawn,
    command: createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/work/pebble" }),
    prompt: "Which CRM should a five-person team buy?",
    model: "opencode/muse-spark-1.3-contributor-free",
    fetch: server.fetcher,
    beginCheckMs: 20,
    ...(signal === undefined ? {} : { signal }),
  });

describe("a message OpenCode took and never began", () => {
  it("ends the run saying so, when the server lists it as neither busy nor answered", async () => {
    const server = fakeServer({ status: {}, messages: [{ info: { id: "msg_user", role: "user" }, parts: [] }] });
    const run = started(server);
    for await (const _record of run.records) void _record;
    const ended = await run.completion;
    expect(ended.exitCode).toBe(1);
    expect(ended.stderr).toMatch(/took the message but never began on it/);
    expect(server.asked).toContain("/session/status");
  }, 10_000);

  it("waits on while the server says it is busy, and ends as usual when it finishes", async () => {
    const server = fakeServer({ status: { [SESSION]: { type: "busy" } } });
    const stopping = new AbortController();
    const run = started(server, stopping.signal);
    // Busy for a while, by the server's own word: the check comes back and waits again.
    setTimeout(() => stopping.abort(), 200);
    for await (const _record of run.records) void _record;
    const ended = await run.completion;
    expect(ended.stderr).not.toMatch(/never began/);
    expect(server.asked.filter((path) => path === "/session/status").length).toBeGreaterThan(1);
  }, 10_000);

  it("asks nothing once the model has begun", async () => {
    const begun = [
      JSON.stringify({ type: "message.updated", properties: { sessionID: SESSION, info: { id: "msg_answer", role: "assistant", sessionID: SESSION } } }),
    ];
    const server = fakeServer({ status: {}, events: begun });
    const stopping = new AbortController();
    const run = started(server, stopping.signal);
    setTimeout(() => stopping.abort(), 200);
    for await (const _record of run.records) void _record;
    const ended = await run.completion;
    expect(ended.stderr).not.toMatch(/never began/);
    expect(server.asked).not.toContain("/session/status");
  }, 10_000);
});
