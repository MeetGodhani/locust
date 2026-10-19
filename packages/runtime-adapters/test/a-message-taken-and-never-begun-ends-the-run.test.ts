import { describe, expect, it, vi } from "vitest";

import type { AppServerRunProcess } from "../src/codex-app-server-run.js";
import { createOpenCodeServeCommand } from "../src/commands.js";
import { createOpenCodeEventNormalizer } from "../src/opencode-events.js";
import { startOpenCodeServeRun } from "../src/opencode-serve-run.js";
import type { OpenCodeServeRunOptions } from "../src/opencode-serve-run.js";

/*
 * A MESSAGE TAKEN AND NEVER BEGUN (0.763). OpenCode's server answers `prompt_async` at once and works on the message
 * after. On 2026-10-12 two comparison columns ran OpenCode in one folder at once; one's work failed inside the server
 * ("prompt_async failed ... SQLiteError: database is locked", in OpenCode's log) and nothing more came on its event
 * stream -- no error, no idle -- so the turn sat on "Starting" for eight minutes. A minute with no sign of the model
 * has the server asked; a session it lists as neither busy nor answered was dropped, and the run ends saying so.
 */
const SESSION = "ses_dropped";
const EXECUTABLE = { commandName: "opencode", discoveredPath: "C:/tools/opencode.exe", executablePath: "C:/tools/opencode.exe", prefixArgs: [] as readonly string[], kind: "native" as const };

const assistant = { type: "message.updated", properties: { sessionID: SESSION, info: { id: "msg_answer", role: "assistant" } } };
const idle = { type: "session.idle", properties: { sessionID: SESSION } };
const PENDING = Symbol("pending");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeServer(options: {
  readonly events?: readonly (object | string)[];
  readonly status?: Record<string, unknown>;
  readonly closeEventStream?: boolean;
  readonly eventGate?: Promise<void>;
  readonly abortResponse?: () => Response | Promise<Response>;
  readonly closeBeforeSession?: boolean;
  readonly sessionGate?: Promise<void>;
  readonly readError?: Error;
  readonly stayOpen?: boolean;
  readonly onPrompt?: () => void;
  readonly promptResponse?: () => Response | Promise<Response>;
  readonly statuses?: readonly unknown[];
  readonly messages?: unknown;
  readonly onStatus?: () => void;
  readonly statusResponse?: (init?: RequestInit) => Response | Promise<Response>;
  readonly messagesResponse?: (init?: RequestInit) => Response | Promise<Response>;
} = {}) {
  const prompted = deferred();
  const calls: { path: string; method: string; authenticated: boolean }[] = [];
  const asked: string[] = [];
  const kill = vi.fn();
  let statusReads = 0;
  let exited: (() => void) | undefined;
  const spawn = (): AppServerRunProcess => ({
    write: () => undefined,
    kill,
    onData: (listener) => { queueMicrotask(() => listener("opencode server listening on http://127.0.0.1:4096\n")); },
    onExit: (listener) => { exited = listener; },
  });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    asked.push(path);
    calls.push({ path, method: init?.method ?? "GET", authenticated: new Headers(init?.headers).has("authorization") });
    if (path === "/event") {
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          let ended = false;
          init?.signal?.addEventListener("abort", () => {
            if (ended) return;
            ended = true;
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
          if (!options.closeBeforeSession) await prompted.promise;
          if (options.eventGate !== undefined) await options.eventGate;
          if (ended) return;
          for (const event of options.events ?? []) {
            controller.enqueue(new TextEncoder().encode(`data: ${(typeof event === "string" ? event : JSON.stringify(event))}\n\n`));
          }
          if (options.readError !== undefined) {
            ended = true;
            controller.error(options.readError);
          } else if (options.closeEventStream === true && !options.stayOpen) {
            ended = true;
            controller.close();
          }
        },
      }), { status: 200 });
    }
    if (path === "/session") {
      if (options.sessionGate !== undefined) await options.sessionGate;
      return Response.json({ id: SESSION });
    }
    if (path.endsWith("/prompt_async") || path.endsWith("/command")) {
      prompted.resolve();
      options.onPrompt?.();
      return options.promptResponse?.() ?? new Response(null, { status: 204 });
    }
    if (path === "/session/status") {
      options.onStatus?.();
      if (options.statusResponse !== undefined) return options.statusResponse(init);
      const statuses = options.statuses ?? [options.status ?? {}];
      return Response.json(statuses[Math.min(statusReads++, statuses.length - 1)]);
    }
    if (path === `/session/${SESSION}/message`) return options.messagesResponse !== undefined ? options.messagesResponse(init) : Response.json(options.messages ?? []);
    if (path.endsWith("/abort")) return options.abortResponse?.() ?? new Response(null, { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { spawn, fetcher, kill, calls, asked, exit: () => exited?.() };
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

function fakeClosedServer(options: Parameters<typeof fakeServer>[0] = {}) {
  return fakeServer({ events: [assistant], closeEventStream: true, ...options });
}

type Run = ReturnType<typeof startOpenCodeServeRun>;
type Server = ReturnType<typeof fakeServer>;

async function completionWithin(run: Run, milliseconds = 1_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const completion = await Promise.race([
      run.completion,
      new Promise<typeof PENDING>((resolve) => { timer = setTimeout(() => resolve(PENDING), milliseconds); }),
    ]);
    expect(completion, "the run must settle after its event stream ends").not.toBe(PENDING);
    if (completion === PENDING) throw new Error("Completion still pending");
    return completion;
  } finally {
    clearTimeout(timer);
  }
}

async function inspect(server: Server, check: (run: Run) => Promise<void>, options: Partial<OpenCodeServeRunOptions> = {}) {
  const run = startOpenCodeServeRun({
    spawn: server.spawn,
    fetch: server.fetcher,
    command: createOpenCodeServeCommand({ commandName: "opencode", discoveredPath: "fake-opencode", executablePath: "fake-opencode", prefixArgs: [], kind: "native" }, { workspacePath: "C:/work/stream-test" }),
    prompt: "Read the project summary",
    ...options,
  });
  try {
    await check(run);
  } finally {
    server.exit();
    await run.completion;
    run.records.drainAvailable();
  }
}

describe("an OpenCode event stream that closes before the turn finishes", () => {
  it("fails a begun run and ends its records when the stream closes without idle", async () => {
    const server = fakeClosedServer();
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion).toMatchObject({ exitCode: 1, cancelled: false });
      expect(completion.stderr).toContain("event stream closed before the turn finished");
      expect(server.kill).toHaveBeenCalledOnce();
      const normalizer = createOpenCodeEventNormalizer({ runId: "run_eof", missionId: "mission_eof", cliVersion: "1.18.27" });
      for await (const record of run.records) normalizer.accept(record);
      expect(normalizer.finish(completion).at(-1)?.type).toBe("run.failed");
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
      expect(server.calls.every((call) => call.authenticated)).toBe(true);
    });
  });

  it("flushes paced reply text before reporting the lost stream", async () => {
    const part = (text: string) => ({ type: "message.part.updated", properties: { sessionID: SESSION, part: { id: "part_1", type: "text", messageID: "msg_answer", text } } });
    const server = fakeClosedServer({ events: [assistant, part("Hello"), part("Hello there")] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      const records = run.records.drainAvailable().map((record) => JSON.parse(record.raw) as { type: string; part?: { text?: string } });
      expect(completion.exitCode).toBe(1);
      expect(records.filter((record) => record.type === "text_partial").at(-1)?.part?.text).toBe("Hello there");
    });
  });

  it("never sends a prompt after the stream was lost during session creation", async () => {
    const session = deferred();
    const server = fakeClosedServer({ closeBeforeSession: true, sessionGate: session.promise, events: [] });
    try {
      await inspect(server, async (run) => {
        await completionWithin(run);
        session.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(server.calls.some((call) => call.path.endsWith("/prompt_async") || call.path.endsWith("/command"))).toBe(false);
        expect(server.kill).toHaveBeenCalledOnce();
      });
    } finally {
      session.resolve();
    }
  });

  it("keeps a normal idle followed by EOF successful", async () => {
    const server = fakeClosedServer({ events: [assistant, idle] });
    await inspect(server, async (run) => {
      expect(await completionWithin(run)).toMatchObject({ exitCode: 0, cancelled: false, stderr: "" });
      expect(server.kill).toHaveBeenCalledOnce();
    });
  });

  it("fails an empty stream without waiting for the dropped-start watchdog", async () => {
    const server = fakeClosedServer({ events: [] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.calls.filter((call) => call.path === "/session/status")).toHaveLength(1);
    });
  });

  it("keeps an explicit stream read error as a failure", async () => {
    const server = fakeClosedServer({ readError: new Error("stream transport failed") });
    await inspect(server, async (run) => {
      expect(await completionWithin(run)).toMatchObject({ exitCode: 1, stderr: "stream transport failed", cancelled: false });
      expect(server.kill).toHaveBeenCalledOnce();
    });
  });

  it("preserves cancellation when EOF arrives after the person stops", async () => {
    const stopping = new AbortController();
    const server = fakeClosedServer({ onPrompt: () => stopping.abort() });
    await inspect(server, async (run) => {
      expect(await completionWithin(run, 3_000)).toMatchObject({ exitCode: null, cancelled: true, stderr: "" });
      expect(server.kill).toHaveBeenCalledOnce();
    }, { signal: stopping.signal });
  });

  it("fails a resumed conversation when its new stream closes prematurely", async () => {
    const server = fakeClosedServer();
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.calls.some((call) => call.path === "/session")).toBe(false);
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    }, { resumeSessionId: SESSION });
  });

  it("fails a command turn on EOF without replaying its command", async () => {
    const server = fakeClosedServer();
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.calls.filter((call) => call.path.endsWith("/command"))).toHaveLength(1);
      expect(server.calls.some((call) => call.path.endsWith("/prompt_async"))).toBe(false);
    }, { slashCommand: "review" });
  });
});

const finishedMessage = (id = "msg_answer") => ({
  info: { id, role: "assistant", sessionID: SESSION, finish: "stop", time: { created: 1, completed: 2 } },
  parts: [
    { id: `${id}_text`, type: "text", messageID: id, sessionID: SESSION, text: "Recovered final answer", time: { start: 1, end: 2 } },
    { id: `${id}_end`, type: "step-finish", messageID: id, sessionID: SESSION, reason: "stop", cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
  ],
});

describe("an OpenCode session polled after its event stream closes", () => {
  it("polls busy and retry states before recovering a verified completed answer", async () => {
    const server = fakeClosedServer({ statuses: [{ [SESSION]: { type: "busy" } }, { [SESSION]: { type: "retry" } }, {}], messages: [finishedMessage()] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion).toMatchObject({ exitCode: 0, cancelled: false, stderr: "" });
      expect(server.calls.filter((call) => call.path === "/session/status")).toHaveLength(3);
      expect(server.calls.filter((call) => call.path.endsWith("/message"))).toHaveLength(1);
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
      expect(server.calls.every((call) => call.authenticated)).toBe(true);
      const normalizer = createOpenCodeEventNormalizer({ runId: "run_recovered", missionId: "mission_recovered", cliVersion: "1.18.27" });
      const events = [];
      for await (const record of run.records) events.push(...normalizer.accept(record));
      events.push(...normalizer.finish(completion));
      expect(events.at(-1)?.type).toBe("run.completed");
      expect(events.some((event) => event.type === "message.delta" && (event.payload as { text?: string }).text === "Recovered final answer")).toBe(true);
      expect(server.kill).toHaveBeenCalledOnce();
    }, { streamClosePollMs: 1 });
  });

  it("does not emit already received final text twice during recovery", async () => {
    const message = finishedMessage();
    const server = fakeClosedServer({ events: [assistant, { type: "message.part.updated", properties: { sessionID: SESSION, part: message.parts[0] } }], messages: [message] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = run.records.drainAvailable().map((record) => JSON.parse(record.raw) as { type: string });
      expect(records.filter((record) => record.type === "text")).toHaveLength(1);
    });
  });

  it("does not treat an older unobserved answer as this turn's completion", async () => {
    const server = fakeClosedServer({ messages: [finishedMessage("msg_old_answer")] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    });
  });

  it("does not infer completion from idle with no final answer", async () => {
    const server = fakeClosedServer({ statuses: [{ [SESSION]: { type: "idle" } }], messages: [] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.kill).toHaveBeenCalledOnce();
    });
  });

  it("refuses recovery without a completed timestamp", async () => {
    const message = finishedMessage();
    const server = fakeClosedServer({ messages: [{ ...message, info: { ...message.info, time: { created: 1 } } }] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });

  it("refuses recovery without a terminal stop part", async () => {
    const message = finishedMessage();
    const server = fakeClosedServer({ messages: [{ ...message, parts: message.parts.slice(0, 1) }] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });

  it("refuses a foreign session's completed answer", async () => {
    const message = finishedMessage();
    const server = fakeClosedServer({ messages: [{ ...message, info: { ...message.info, sessionID: "ses_other" } }] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });

  it("does not infer a resumed turn's completion from historical messages", async () => {
    const server = fakeClosedServer({ messages: [finishedMessage()] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.calls.some((call) => call.path === "/session")).toBe(false);
    }, { resumeSessionId: SESSION });
  });

  it("bounds a session that remains busy after the stream closes", async () => {
    const server = fakeClosedServer({ statuses: [{ [SESSION]: { type: "busy" } }] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion.exitCode).toBe(1);
      expect(completion.stderr).toContain("session was still busy");
      expect(server.calls.filter((call) => call.path === "/session/status").length).toBeGreaterThan(1);
      expect(server.calls.some((call) => call.path.endsWith("/message"))).toBe(false);
      expect(server.kill).toHaveBeenCalledOnce();
    }, { streamCloseTimeoutMs: 30, streamClosePollMs: 1 });
  });

  it("bounds and aborts a status request that never answers", async () => {
    let aborted = false;
    const server = fakeClosedServer({ statusResponse: (init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    }) });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(aborted).toBe(true);
      expect(server.kill).toHaveBeenCalledOnce();
    }, { streamCloseTimeoutMs: 30 });
  });

  it("bounds a status response whose body never ends", async () => {
    const server = fakeClosedServer({ statusResponse: (init) => new Response(new ReadableStream<Uint8Array>({
      start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true }); },
    })) });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.kill).toHaveBeenCalledOnce();
    }, { streamCloseTimeoutMs: 30 });
  });

  it("keeps cancellation while polling as cancelled", async () => {
    const stopping = new AbortController();
    const server = fakeClosedServer({ onStatus: () => stopping.abort() });
    await inspect(server, async (run) => {
      expect(await completionWithin(run, 3_000)).toMatchObject({ exitCode: null, cancelled: true, stderr: "" });
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    }, { signal: stopping.signal });
  });

  it("fails a rejected status request", async () => {
    const server = fakeClosedServer({ statusResponse: async () => { throw new Error("connection lost"); } });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });

  it("fails an HTTP error from the status endpoint", async () => {
    const server = fakeClosedServer({ statusResponse: () => new Response(null, { status: 500 }) });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });

  it("fails a malformed status response", async () => {
    const server = fakeClosedServer({ statuses: ["unreadable"] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });

  it("fails an unknown session status without guessing success", async () => {
    const server = fakeClosedServer({ statuses: [{ [SESSION]: { type: "unknown" } }] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.calls.some((call) => call.path.endsWith("/message"))).toBe(false);
    });
  });

  it("fails an unreadable message response", async () => {
    const server = fakeClosedServer({ messagesResponse: () => new Response(null, { status: 503 }) });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });
});

describe("an OpenCode recovery that loses the server or its response", () => {
  it("bounds a message response whose body never ends", async () => {
    const server = fakeClosedServer({ messagesResponse: (init) => new Response(new ReadableStream<Uint8Array>({
      start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true }); },
    })) });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.kill).toHaveBeenCalledOnce();
    }, { streamCloseTimeoutMs: 30 });
  });

  it("does not recover a delayed answer after the server exits", async () => {
    const requested = deferred();
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { release = resolve; });
    const server = fakeClosedServer({ messagesResponse: () => { requested.resolve(); return response; } });
    try {
      await inspect(server, async (run) => {
        await requested.promise;
        server.exit();
        const completion = await completionWithin(run);
        expect(completion.exitCode).toBe(1);
        release(Response.json([finishedMessage()]));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(run.records.drainAvailable()).toEqual([]);
        expect(server.kill).toHaveBeenCalledOnce();
      });
    } finally {
      release(Response.json([]));
    }
  });

  it("does not recover a completed message that reports an error", async () => {
    const message = finishedMessage();
    const server = fakeClosedServer({ messages: [{ ...message, info: { ...message.info, error: { name: "APIError", data: { message: "provider failed" } } } }] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });
});

describe("the shared OpenCode session check", () => {
  it("keeps polling when the prompt receipt arrives during an EOF status query", async () => {
    const queried = deferred();
    let releasePrompt!: (response: Response) => void;
    let releaseStatus!: (response: Response) => void;
    const prompt = new Promise<Response>((resolve) => { releasePrompt = resolve; });
    const status = new Promise<Response>((resolve) => { releaseStatus = resolve; });
    let queries = 0;
    const server = fakeClosedServer({
      promptResponse: () => prompt,
      statusResponse: () => { queried.resolve(); return ++queries === 1 ? status : Response.json({}); },
      messages: [finishedMessage()],
    });
    try {
      await inspect(server, async (run) => {
        await queried.promise;
        releasePrompt(new Response(null, { status: 204 }));
        // Let the scheduled poll fire while the first status read is still pending.
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        releaseStatus(Response.json({ [SESSION]: { type: "busy" } }));
        expect((await completionWithin(run)).exitCode).toBe(0);
        expect(queries).toBe(2);
        expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
      }, { streamCloseTimeoutMs: 500, streamClosePollMs: 1 });
    } finally {
      releasePrompt(new Response(null, { status: 204 }));
      releaseStatus(Response.json({}));
    }
  });

  it("reuses an in-flight watchdog query when the stream closes", async () => {
    const stream = deferred();
    const queried = deferred();
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { release = resolve; });
    const server = fakeClosedServer({ events: [], eventGate: stream.promise, statusResponse: () => { queried.resolve(); return response; } });
    try {
      await inspect(server, async (run) => {
        await queried.promise;
        stream.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(server.calls.filter((call) => call.path === "/session/status")).toHaveLength(1);
        release(Response.json({}));
        const completion = await completionWithin(run);
        expect(completion.exitCode).toBe(1);
        expect(completion.stderr).toContain("event stream closed before the turn finished");
        expect(server.calls.filter((call) => call.path.endsWith("/message"))).toHaveLength(1);
      }, { beginCheckMs: 1 });
    } finally {
      stream.resolve();
      release(Response.json({}));
    }
  });

  it("retries a failed watchdog query while its event stream remains open", async () => {
    let attempts = 0;
    const server = fakeServer({ events: [], statusResponse: () => ++attempts === 1 ? new Response(null, { status: 500 }) : Response.json({}) });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion.exitCode).toBe(1);
      expect(completion.stderr).toContain("took the message but never began");
      expect(attempts).toBe(2);
    }, { beginCheckMs: 1 });
  });

  it("ends cancellation even when the server never answers abort", async () => {
    const stopping = new AbortController();
    const server = fakeClosedServer({ onStatus: () => stopping.abort(), abortResponse: () => new Promise<Response>(() => undefined) });
    await inspect(server, async (run) => {
      expect(await completionWithin(run, 3_000)).toMatchObject({ exitCode: null, cancelled: true, stderr: "" });
      expect(server.calls.filter((call) => call.path.endsWith("/abort"))).toHaveLength(1);
      expect(server.kill).toHaveBeenCalledOnce();
    }, { signal: stopping.signal });
  });
});

const promptMessage = (id = "msg_current_prompt", sessionID = SESSION) => ({
  type: "message.updated", properties: { sessionID, info: { id, sessionID, role: "user" } },
});
const answerTo = (parentID = "msg_current_prompt", id = "msg_current_answer") => {
  const message = finishedMessage(id);
  return { ...message, info: { ...message.info, parentID } };
};

describe("an OpenCode follow-up recovered by its prompt ID", () => {
  it("recovers a resumed turn by parentID even when its assistant event was lost", async () => {
    const server = fakeClosedServer({ events: [promptMessage()], messages: [answerTo()] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion).toMatchObject({ exitCode: 0, cancelled: false, stderr: "" });
      const normalizer = createOpenCodeEventNormalizer({ runId: "run_followup", missionId: "mission_followup", cliVersion: "1.18.27" });
      const events = [];
      for await (const record of run.records) events.push(...normalizer.accept(record));
      events.push(...normalizer.finish(completion));
      expect(events.at(-1)?.type).toBe("run.completed");
      expect(events.some((event) => event.type === "message.delta" && (event.payload as { text?: string }).text === "Recovered final answer")).toBe(true);
      expect(server.calls.some((call) => call.path === "/session")).toBe(false);
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
      expect(server.calls.every((call) => call.authenticated)).toBe(true);
      expect(server.kill).toHaveBeenCalledOnce();
    }, { resumeSessionId: SESSION });
  });

  it("selects the current answer instead of an observed historical answer", async () => {
    const historical = answerTo("msg_previous_prompt", "msg_previous_answer");
    const current = answerTo();
    const server = fakeClosedServer({
      events: [promptMessage(), { ...assistant, properties: { sessionID: SESSION, info: historical.info } }],
      messages: [historical, current],
    });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = run.records.drainAvailable().map((record) => JSON.parse(record.raw) as { part: { messageID: string } });
      expect(records.map((record) => record.part.messageID)).toEqual([current.info.id, current.info.id]);
    }, { resumeSessionId: SESSION });
  });

  it.each(["msg_previous_prompt", "", undefined])("rejects a resumed answer with parentID %s", async (parentID) => {
    const message = answerTo();
    const server = fakeClosedServer({
      events: [promptMessage(), { ...assistant, properties: { sessionID: SESSION, info: message.info } }],
      messages: [{ ...message, info: { ...message.info, parentID } }],
    });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(run.records.drainAvailable()).toEqual([]);
    }, { resumeSessionId: SESSION });
  });

  it("requires the current prompt receipt before recovering a resumed answer", async () => {
    const message = answerTo();
    const server = fakeClosedServer({ events: [{ ...assistant, properties: { sessionID: SESSION, info: message.info } }], messages: [message] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); }, { resumeSessionId: SESSION });
  });

  it("ignores a prompt receipt belonging to another session", async () => {
    const server = fakeClosedServer({ events: [promptMessage("msg_current_prompt", "ses_other")], messages: [answerTo()] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); }, { resumeSessionId: SESSION });
  });

  it("rejects a prompt whose message session conflicts with its event session", async () => {
    const prompt = promptMessage("msg_current_prompt", "ses_other");
    const server = fakeClosedServer({ events: [{ ...prompt, properties: { ...prompt.properties, sessionID: SESSION } }], messages: [answerTo()] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); }, { resumeSessionId: SESSION });
  });

  it("keeps the first prompt receipt when later user events arrive", async () => {
    const server = fakeClosedServer({ events: [promptMessage(), promptMessage("msg_other_prompt")], messages: [answerTo("msg_other_prompt")] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); }, { resumeSessionId: SESSION });
  });

  it("does not fall back to an observed first-turn answer with a mismatched parentID", async () => {
    const message = answerTo("msg_previous_prompt", "msg_answer");
    const server = fakeClosedServer({ events: [promptMessage(), assistant], messages: [message] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); });
  });

  it("still requires a completed answer and a terminal stop part after matching parentID", async () => {
    const message = answerTo();
    const server = fakeClosedServer({ events: [promptMessage()], messages: [{ ...message, parts: message.parts.slice(0, 1) }] });
    await inspect(server, async (run) => { expect((await completionWithin(run)).exitCode).toBe(1); }, { resumeSessionId: SESSION });
  });

  it("does not duplicate a resumed answer that already streamed its final text", async () => {
    const message = answerTo();
    const server = fakeClosedServer({
      events: [promptMessage(), { ...assistant, properties: { sessionID: SESSION, info: message.info } },
        { type: "message.part.updated", properties: { sessionID: SESSION, part: message.parts[0] } }],
      messages: [message],
    });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = run.records.drainAvailable().map((record) => JSON.parse(record.raw) as { type: string });
      expect(records.filter((record) => record.type === "text")).toHaveLength(1);
    }, { resumeSessionId: SESSION });
  });
});

describe("an OpenCode recovery that is still active after ten seconds", () => {
  it.each(["busy", "retry"])("keeps polling %s beyond ten seconds and then recovers", async (type) => {
    vi.useFakeTimers();
    let active = true;
    const server = fakeClosedServer({ events: [promptMessage()], statusResponse: () => Response.json(active ? { [SESSION]: { type } } : {}), messages: [answerTo()] });
    try {
      await inspect(server, async (run) => {
        const completed = vi.fn();
        void run.completion.then(completed);
        await vi.advanceTimersByTimeAsync(10_001);
        expect(completed).not.toHaveBeenCalled();
        expect(server.kill).not.toHaveBeenCalled();
        expect(server.calls.filter((call) => call.path === "/session/status").length).toBeGreaterThan(2);
        active = false;
        await vi.advanceTimersByTimeAsync(250);
        expect(await run.completion).toMatchObject({ exitCode: 0, stderr: "" });
        expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
      }, { resumeSessionId: SESSION });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a perpetually busy recovery at the five-minute overall boundary", async () => {
    vi.useFakeTimers();
    const server = fakeClosedServer({ status: { [SESSION]: { type: "busy" } } });
    try {
      await inspect(server, async (run) => {
        const completed = vi.fn();
        void run.completion.then(completed);
        await vi.advanceTimersByTimeAsync(299_999);
        expect(completed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(completed).toHaveBeenCalledOnce();
        expect(await run.completion).toMatchObject({ exitCode: 1, cancelled: false });
        expect((await run.completion).stderr).toContain("recovery deadline");
        expect(server.kill).toHaveBeenCalledOnce();
        const calls = server.calls.length;
        await vi.advanceTimersByTimeAsync(5_000);
        expect(server.calls).toHaveLength(calls);
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds an unresponsive poll at ten seconds even after earlier busy responses", async () => {
    vi.useFakeTimers();
    let reads = 0;
    let aborted = false;
    const server = fakeClosedServer({ statusResponse: (init) => {
      if (++reads === 1) return Response.json({ [SESSION]: { type: "busy" } });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    } });
    try {
      await inspect(server, async (run) => {
        const completed = vi.fn();
        void run.completion.then(completed);
        await vi.advanceTimersByTimeAsync(10_249);
        expect(completed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(completed).toHaveBeenCalledOnce();
        expect((await run.completion).exitCode).toBe(1);
        expect(aborted).toBe(true);
        expect(reads).toBe(2);
        expect(server.kill).toHaveBeenCalledOnce();
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a hard status error after extended busy polling", async () => {
    vi.useFakeTimers();
    let failed = false;
    const server = fakeClosedServer({ statusResponse: () => failed ? new Response(null, { status: 503 }) : Response.json({ [SESSION]: { type: "busy" } }) });
    try {
      await inspect(server, async (run) => {
        await vi.advanceTimersByTimeAsync(10_001);
        expect(server.kill).not.toHaveBeenCalled();
        failed = true;
        await vi.advanceTimersByTimeAsync(250);
        expect(await run.completion).toMatchObject({ exitCode: 1, cancelled: false });
        expect(server.calls.some((call) => call.path.endsWith("/message"))).toBe(false);
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a timed-out check even if the fetch implementation ignores abort", async () => {
    vi.useFakeTimers();
    const server = fakeClosedServer({ statusResponse: () => new Promise<Response>(() => undefined) });
    try {
      await inspect(server, async (run) => {
        const completed = vi.fn();
        void run.completion.then(completed);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(completed).toHaveBeenCalledOnce();
        expect((await run.completion).exitCode).toBe(1);
        expect(server.kill).toHaveBeenCalledOnce();
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

type ReplayPart = Record<string, unknown>;
type ReplayRecord = { type: string; part: ReplayPart };

function toolStep(id: string, created: number, toolId = `${id}_002`) {
  return {
    info: { id, role: "assistant", sessionID: SESSION, parentID: "msg_current_prompt", finish: "tool-calls", time: { created, completed: created + 1 } },
    parts: [
      { id: `${id}_001`, type: "step-start", messageID: id, sessionID: SESSION },
      { id: toolId, type: "tool", messageID: id, sessionID: SESSION, tool: "bash", callID: `call_${id}`, state: { status: "completed", input: { command: `echo ${id}` }, output: `output ${id}`, time: { start: created, end: created + 1 } } },
      { id: `${id}_003`, type: "step-finish", messageID: id, sessionID: SESSION, reason: "tool-calls", cost: 0, tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
    ] satisfies ReplayPart[],
  };
}

function finalStep(created = 100) {
  const message = answerTo();
  return {
    ...message,
    info: { ...message.info, time: { created, completed: created + 1 } },
    parts: message.parts.map((part, index) => ({ ...part, id: `prt_final_00${String(index + 1)}` })),
  };
}

const messageEvent = (info: object) => ({ type: "message.updated", properties: { sessionID: SESSION, info } });
const partEvent = (part: ReplayPart) => ({ type: "message.part.updated", properties: { sessionID: SESSION, part } });
const rawReplay = (run: Run) => run.records.drainAvailable().map((record) => JSON.parse(record.raw) as ReplayRecord);

describe("an OpenCode recovery that replays the current turn's tool steps", () => {
  it("replays both disconnected tool steps in order before the final answer and completion", async () => {
    const first = toolStep("msg_step_1", 10);
    const second = toolStep("msg_step_2", 20);
    const final = finalStep();
    const server = fakeClosedServer({ events: [promptMessage()], messages: [first, second, final] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion).toMatchObject({ exitCode: 0, cancelled: false, stderr: "" });
      const records = run.records.drainAvailable();
      const raw = records.map((record) => JSON.parse(record.raw) as ReplayRecord);
      expect(raw.map((record) => [record.type, record.part.messageID])).toEqual([
        ["step_start", first.info.id], ["tool_use", first.info.id], ["step_finish", first.info.id],
        ["step_start", second.info.id], ["tool_use", second.info.id], ["step_finish", second.info.id],
        ["text", final.info.id], ["step_finish", final.info.id],
      ]);
      const normalizer = createOpenCodeEventNormalizer({ runId: "run_replay", missionId: "mission_replay", cliVersion: "1.18.27" });
      const events = records.flatMap((record) => normalizer.accept(record));
      events.push(...normalizer.finish(completion));
      expect(events.filter((event) => event.type === "tool.completed").map((event) => event.payload.itemId)).toEqual([`call_${first.info.id}`, `call_${second.info.id}`]);
      const finalTextAt = events.findIndex((event) => event.type === "message.delta");
      expect(finalTextAt).toBeGreaterThan(events.map((event) => event.type).lastIndexOf("tool.completed"));
      expect(events.at(-1)?.type).toBe("run.completed");
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    }, { resumeSessionId: SESSION });
  });

  it("does not replay a tool step already settled on the live stream", async () => {
    const first = toolStep("msg_streamed_step", 10);
    const second = toolStep("msg_missing_step", 20);
    const final = finalStep();
    const server = fakeClosedServer({
      events: [promptMessage(), messageEvent(first.info), ...first.parts.map(partEvent)],
      messages: [first, second, final],
    });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = rawReplay(run);
      expect(records.map((record) => [record.type, record.part.messageID])).toEqual([
        ["step_start", first.info.id], ["tool_use", first.info.id], ["step_finish", first.info.id],
        ["step_start", second.info.id], ["tool_use", second.info.id], ["step_finish", second.info.id],
        ["text", final.info.id], ["step_finish", final.info.id],
      ]);
      expect(records.filter((record) => record.type === "tool_use").map((record) => record.part.callID)).toEqual([`call_${first.info.id}`, `call_${second.info.id}`]);
    }, { resumeSessionId: SESSION });
  });

  it("replays a tool that was still running when the stream disconnected exactly once", async () => {
    const step = toolStep("msg_running_step", 10);
    const completed = step.parts[1]!;
    const running = { ...completed, state: { status: "running", input: { command: "echo msg_running_step" }, time: { start: 10 } } };
    const server = fakeClosedServer({
      events: [promptMessage(), messageEvent(step.info), partEvent(step.parts[0]!), partEvent(running), partEvent(running)],
      messages: [step, finalStep()],
    });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = rawReplay(run);
      expect(records.filter((record) => record.type === "tool_use").map((record) => record.part)).toEqual([completed]);
      expect(records.filter((record) => record.type === "step_start")).toHaveLength(1);
      expect(records.map((record) => record.type)).toEqual(["step_start", "tool_use", "step_finish", "text", "step_finish"]);
    }, { resumeSessionId: SESSION });
  });

  it("orders recovered messages by creation time and then message ID instead of response order", async () => {
    const first = toolStep("msg_earliest", 10);
    const second = toolStep("msg_same_time_a", 20);
    const third = toolStep("msg_same_time_b", 20);
    const server = fakeClosedServer({ events: [promptMessage()], messages: [finalStep(), third, first, second] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = rawReplay(run);
      expect(records.filter((record) => record.type === "tool_use").map((record) => record.part.messageID)).toEqual([first.info.id, second.info.id, third.info.id]);
      expect(records.at(-2)?.type).toBe("text");
      expect(records.at(-1)?.part.reason).toBe("stop");
    }, { resumeSessionId: SESSION });
  });

  it("orders shuffled step markers and tools by their chronological part IDs", async () => {
    const step = toolStep("msg_shuffled_parts", 10);
    const start = { ...step.parts[0]!, id: "prt_001" };
    const tool = { ...step.parts[1]!, id: "prt_002" };
    const end = { ...step.parts[2]!, id: "prt_003" };
    const server = fakeClosedServer({ events: [promptMessage()], messages: [{ ...step, parts: [end, tool, start] }, finalStep()] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      expect(rawReplay(run).slice(0, 3).map((record) => [record.type, record.part.id])).toEqual([
        ["step_start", "prt_001"], ["tool_use", "prt_002"], ["step_finish", "prt_003"],
      ]);
    }, { resumeSessionId: SESSION });
  });

  it("uses tool timestamps to order recovered parts when their IDs are absent", async () => {
    const step = toolStep("msg_no_part_ids", 10);
    const { id: _id, ...first } = step.parts[1]!;
    const second = { ...first, callID: "call_second_no_id", state: { status: "completed", input: { command: "echo second" }, output: "second output", time: { start: 20, end: 21 } } };
    const server = fakeClosedServer({ events: [promptMessage()], messages: [{ ...step, parts: [second, first] }, finalStep()] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      expect(rawReplay(run).filter((record) => record.type === "tool_use").map((record) => record.part.callID)).toEqual([first.callID, second.callID]);
    }, { resumeSessionId: SESSION });
  });

  it("keeps multiple imported step boundaries in order while recovering one assistant message", async () => {
    const step = toolStep("msg_imported_steps", 10);
    const firstStart = { ...step.parts[0]!, id: "imported_start_1" };
    const firstTool = { ...step.parts[1]!, id: "imported_tool_1" };
    const firstEnd = { ...step.parts[2]!, id: "imported_finish_1", tokens: { input: 2, output: 3, reasoning: 0, cache: { read: 0, write: 0 } } };
    const secondStart = { ...step.parts[0]!, id: "imported_start_2" };
    const secondTool = { ...step.parts[1]!, id: "imported_tool_2", callID: "call_second_imported", state: { status: "completed", input: { command: "echo second" }, output: "second output", time: { start: 20, end: 21 } } };
    const secondEnd = { ...step.parts[2]!, id: "imported_finish_2", tokens: { input: 5, output: 7, reasoning: 0, cache: { read: 0, write: 0 } } };
    const ordered = [firstStart, firstTool, firstEnd, secondStart, secondTool, secondEnd];
    const server = fakeClosedServer({ events: [promptMessage()], messages: [{ ...step, parts: ordered }, finalStep()] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion.exitCode).toBe(0);
      const records = run.records.drainAvailable();
      const raw = records.map((record) => JSON.parse(record.raw) as ReplayRecord);
      expect(raw.slice(0, 6).map((record) => [record.type, record.part.id])).toEqual([
        ["step_start", firstStart.id], ["tool_use", firstTool.id], ["step_finish", firstEnd.id],
        ["step_start", secondStart.id], ["tool_use", secondTool.id], ["step_finish", secondEnd.id],
      ]);
      const normalizer = createOpenCodeEventNormalizer({ runId: "run_imported_steps", cliVersion: "1.18.27" });
      const events = records.flatMap((record) => normalizer.accept(record));
      events.push(...normalizer.finish(completion));
      expect(events.filter((event) => event.type === "step.started")).toHaveLength(2);
      expect(events.filter((event) => event.type === "step.completed")).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({ type: "run.completed", payload: { usage: { inputTokens: 8, outputTokens: 11 } } });
    }, { resumeSessionId: SESSION });
  });

  it("replays a failed tool with its complete diagnostics before the final answer", async () => {
    const step = toolStep("msg_failed_tool", 10);
    const error = `Build failed: src/widgets.ts:27\nTypeError: unexpected response\n${"diagnostic detail ".repeat(100)}`;
    const failed = { ...step.parts[1]!, state: { status: "error", input: { command: "npm run build" }, error, metadata: { exit: 2 }, time: { start: 10, end: 11 } } };
    const server = fakeClosedServer({ events: [promptMessage()], messages: [{ ...step, parts: [step.parts[0], failed, step.parts[2]] }, finalStep()] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion.exitCode).toBe(0);
      const records = run.records.drainAvailable();
      const raw = records.map((record) => JSON.parse(record.raw) as ReplayRecord);
      expect(raw.find((record) => record.type === "tool_use")?.part).toEqual(failed);
      expect(raw.findIndex((record) => record.type === "tool_use")).toBeLessThan(raw.findIndex((record) => record.type === "text"));
      const normalizer = createOpenCodeEventNormalizer({ runId: "run_failed_tool_replay", cliVersion: "1.18.27" });
      const events = records.flatMap((record) => normalizer.accept(record));
      events.push(...normalizer.finish(completion));
      expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("run.completed");
    }, { resumeSessionId: SESSION });
  });

  it("excludes historical turns, foreign sessions and mismatched parts from tool replay", async () => {
    const current = toolStep("msg_current_tool", 10);
    const historical = toolStep("msg_old_tool", 1);
    const foreign = toolStep("msg_foreign_tool", 2);
    const final = finalStep();
    const server = fakeClosedServer({ events: [promptMessage(), messageEvent({ id: "msg_other", role: "assistant", sessionID: SESSION, parentID: "msg_previous_prompt" })], messages: [
      { ...historical, info: { ...historical.info, parentID: "msg_previous_prompt" } },
      { ...foreign, info: { ...foreign.info, sessionID: "ses_other" } },
      { ...historical, info: { ...historical.info, role: "user" } },
      { ...current, parts: [...current.parts, { ...current.parts[1], id: "foreign_session_part", sessionID: "ses_other" }, { ...current.parts[1], id: "foreign_message_part", messageID: "msg_other" }] },
      null, 42, { info: null, parts: [] }, { info: { ...current.info, id: undefined }, parts: current.parts },
      final,
    ] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = rawReplay(run);
      expect(records.filter((record) => record.type === "tool_use").map((record) => record.part)).toEqual([current.parts[1]]);
      expect(records.map((record) => record.part.messageID)).toEqual([current.info.id, current.info.id, current.info.id, final.info.id, final.info.id]);
    }, { resumeSessionId: SESSION });
  });

  it("emits duplicate recovered messages and parts only once", async () => {
    const step = toolStep("msg_duplicated_tool", 10);
    const final = finalStep();
    const repeated = { ...step, parts: [...step.parts, ...step.parts] };
    const server = fakeClosedServer({ events: [promptMessage()], messages: [repeated, step, final, final] });
    await inspect(server, async (run) => {
      const completion = await completionWithin(run);
      expect(completion.exitCode).toBe(0);
      const records = run.records.drainAvailable();
      expect(records.map((record) => JSON.parse(record.raw) as ReplayRecord).map((record) => [record.type, record.part.id])).toEqual([
        ["step_start", step.parts[0]!.id], ["tool_use", step.parts[1]!.id], ["step_finish", step.parts[2]!.id],
        ["text", final.parts[0]!.id], ["step_finish", final.parts[1]!.id],
      ]);
      const normalizer = createOpenCodeEventNormalizer({ runId: "run_duplicate_steps", cliVersion: "1.18.27" });
      for (const record of records) normalizer.accept(record);
      expect(normalizer.finish(completion).at(-1)).toMatchObject({ type: "run.completed", payload: { usage: { inputTokens: 3, outputTokens: 2 } } });
    }, { resumeSessionId: SESSION });
  });

  it("keeps distinct no-ID tool payloads beyond the old 80-character prefix and deduplicates equivalent payloads", async () => {
    const step = toolStep("msg_payload_fallback", 10);
    const command = `echo ${"shared long prefix ".repeat(20)}`;
    const first = { type: "tool", messageID: step.info.id, sessionID: SESSION, tool: "bash", state: { status: "completed", input: { command }, output: "first output", time: { start: 10, end: 11 } }, callID: "call_no_id_first" };
    const second = { ...first, state: { ...first.state, output: "second output", time: { start: 20, end: 21 } }, callID: "call_no_id_second" };
    const duplicate = { callID: first.callID, state: { time: first.state.time, output: first.state.output, input: first.state.input, status: first.state.status }, tool: first.tool, sessionID: first.sessionID, messageID: first.messageID, type: first.type };
    const server = fakeClosedServer({ events: [promptMessage(), messageEvent(step.info), partEvent(first)], messages: [{ ...step, parts: [duplicate, second, first] }, finalStep()] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(0);
      const records = rawReplay(run);
      expect(records.filter((record) => record.type === "tool_use").map((record) => record.part.callID)).toEqual([first.callID, second.callID]);
      expect(records.filter((record) => record.type === "tool_use").map((record) => (record.part.state as { output: string }).output)).toEqual(["first output", "second output"]);
    }, { resumeSessionId: SESSION });
  });

  it("rejects the unsupported working status instead of polling it as active", async () => {
    const server = fakeClosedServer({ events: [promptMessage()], status: { [SESSION]: { type: "working" } }, messages: [finalStep()] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.calls.filter((call) => call.path === "/session/status")).toHaveLength(1);
      expect(server.calls.some((call) => call.path.endsWith("/message"))).toBe(false);
      expect(run.records.drainAvailable()).toEqual([]);
    }, { resumeSessionId: SESSION, streamCloseTimeoutMs: 100, streamClosePollMs: 1 });
  });

  it("does not settle on an earlier stop while the latest matching message is unfinished", async () => {
    const earlier = finalStep(10);
    const latest = toolStep("msg_newer_incomplete", 20);
    const server = fakeClosedServer({ events: [promptMessage()], messages: [latest, earlier] });
    await inspect(server, async (run) => {
      expect((await completionWithin(run)).exitCode).toBe(1);
      expect(server.kill).toHaveBeenCalledOnce();
      expect(server.calls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    }, { resumeSessionId: SESSION });
  });
});
