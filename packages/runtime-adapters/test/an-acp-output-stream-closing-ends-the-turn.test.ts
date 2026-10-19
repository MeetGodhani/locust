import { afterEach, describe, expect, it, vi } from "vitest";

import { ACP_PROMPT_RESULT } from "../src/acp-events.js";
import { startAcpRun } from "../src/acp-run.js";
import type { AcpRunOptions } from "../src/acp-run.js";

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };

function fixture(options: Partial<AcpRunOptions> = {}, holdSession = false) {
  let receive: (chunk: string) => void = () => undefined;
  let exited: () => void = () => undefined;
  let closed: (error?: Error) => void = () => undefined;
  const sent: Message[] = [];
  const kill = vi.fn();
  const reply = (message: Message, result: unknown): void => receive(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  const run = startAcpRun({
    spawn: () => ({
      write: (line) => {
        const message = JSON.parse(line) as Message;
        sent.push(message);
        if (message.method === "initialize" && options.handshakeTimeoutMs === undefined) {
          queueMicrotask(() => reply(message, { protocolVersion: 1, agentCapabilities: { loadSession: true } }));
        } else if (message.method === "session/new" && !holdSession) {
          queueMicrotask(() => reply(message, { sessionId: "session-one" }));
        }
      },
      kill,
      onData: (listener) => { receive = listener; },
      onExit: (listener) => { exited = listener; },
      onStdoutClose: (listener) => { closed = listener; },
    }),
    command: { executablePath: "agent", args: ["acp"], cwd: "folder", stdin: "protocol", sandbox: "workspace-write" },
    prompt: "Run the tests",
    ...options,
  });
  return { run, sent, kill, reply, close: (error?: Error) => closed(error), exit: () => exited(), receive: (message: Message) => receive(`${JSON.stringify(message)}\n`) };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("an ACP output stream closing", () => {
  it("fails a live child once rather than waiting for the prompt timeout", async () => {
    const f = fixture();
    await flush();
    expect(f.sent.filter((message) => message.method === "session/prompt")).toHaveLength(1);
    f.close();
    const result = await f.run.completion;
    expect(result).toMatchObject({ exitCode: null, cancelled: false });
    expect(result.stderr).toContain("output stream closed");
    f.close();
    f.exit();
    expect(f.kill).toHaveBeenCalledTimes(1);
    await expect(f.run.steer("Try again")).resolves.toBe(false);
  });

  it("reports an output error without needing a process exit", async () => {
    const f = fixture();
    await flush();
    f.close(new Error("broken pipe"));
    await expect(f.run.completion).resolves.toMatchObject({ exitCode: null, stderr: "The agent's output stream failed before its turn finished." });
    expect(f.kill).toHaveBeenCalledTimes(1);
  });

  it("keeps the final prompt answer in the last chunk before EOF", async () => {
    const f = fixture();
    await flush();
    const prompt = f.sent.find((message) => message.method === "session/prompt")!;
    f.reply(prompt, { stopReason: "end_turn", usage: { outputTokens: 3 } });
    f.close();
    await expect(f.run.completion).resolves.toMatchObject({ exitCode: 0, stderr: "" });
    const records = [];
    for await (const record of f.run.records) records.push(JSON.parse(record.raw));
    expect(records.filter((record) => record.method === ACP_PROMPT_RESULT)).toEqual([
      { method: ACP_PROMPT_RESULT, params: { stopReason: "end_turn", usage: { outputTokens: 3 } } },
    ]);
    expect(f.kill).toHaveBeenCalledTimes(1);
  });

  it("does not begin a session from an initialize answer followed by EOF", async () => {
    const f = fixture({ handshakeTimeoutMs: 50 });
    f.reply(f.sent[0]!, { protocolVersion: 1 });
    f.close();
    await expect(f.run.completion).resolves.toMatchObject({ exitCode: null });
    expect(f.sent.map((message) => message.method)).toEqual(["initialize"]);
  });

  it("does not resurrect a handshake after cancellation or its late answer", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const f = fixture({ signal: controller.signal, handshakeTimeoutMs: 50 });
    controller.abort();
    await expect(f.run.completion).resolves.toMatchObject({ exitCode: null, cancelled: true });
    f.reply(f.sent[0]!, { protocolVersion: 1 });
    await flush();
    expect(f.sent.map((message) => message.method)).toEqual(["initialize"]);
    expect(f.kill).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not send a prompt if cancellation races the session answer", async () => {
    const controller = new AbortController();
    const f = fixture({ signal: controller.signal }, true);
    await flush();
    const session = f.sent.find((message) => message.method === "session/new")!;
    expect(session).toBeDefined();
    f.reply(session, { sessionId: "session-one" });
    controller.abort();
    await f.run.completion;
    await flush();
    expect(f.sent.map((message) => message.method)).toEqual(["initialize", "session/new"]);
    expect(f.kill).toHaveBeenCalledTimes(1);
  });

  it("does not begin a session after the capabilities callback cancels the run", async () => {
    const controller = new AbortController();
    const f = fixture({ signal: controller.signal, onCapabilities: () => controller.abort() });
    await expect(f.run.completion).resolves.toMatchObject({ cancelled: true });
    expect(f.sent.map((message) => message.method)).toEqual(["initialize"]);
  });

  it("does not start a session after timeout, exit, or an already aborted signal", async () => {
    vi.useFakeTimers();
    const timed = fixture({ handshakeTimeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(timed.run.completion).resolves.toMatchObject({ exitCode: null, stderr: "The agent did not answer in time." });
    timed.reply(timed.sent[0]!, { protocolVersion: 1 });
    const gone = fixture({ handshakeTimeoutMs: 50 });
    gone.exit();
    gone.reply(gone.sent[0]!, { protocolVersion: 1 });
    await expect(gone.run.completion).resolves.toMatchObject({ exitCode: null });
    const controller = new AbortController();
    controller.abort();
    const stopped = fixture({ signal: controller.signal });
    await expect(stopped.run.completion).resolves.toMatchObject({ cancelled: true });
    await flush();
    expect(timed.sent.map((message) => message.method)).toEqual(["initialize"]);
    expect(gone.sent.map((message) => message.method)).toEqual(["initialize"]);
    expect(stopped.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases queued permission waits when EOF ends the run", async () => {
    const permission = vi.fn(() => new Promise<"allow_once">(() => undefined));
    const f = fixture({ onPermission: permission });
    await flush();
    for (const id of [80, 81]) f.receive({ id, method: "session/request_permission", params: {
      sessionId: "session-one", toolCall: { toolCallId: String(id), kind: "execute", rawInput: { command: "publish" } },
      options: [{ optionId: "yes", kind: "allow_once", name: "Allow" }],
    } });
    await flush();
    expect(permission).toHaveBeenCalledTimes(1);
    f.close();
    await f.run.completion;
    await flush();
    expect(permission).toHaveBeenCalledTimes(1);
    expect(f.sent.filter((message) => message.id === 80 || message.id === 81)).toEqual([]);
    expect(f.kill).toHaveBeenCalledTimes(1);
  });

  it("clears the cancellation grace timer when the prompt answers", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const f = fixture({ signal: controller.signal, cancelGraceMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    const prompt = f.sent.find((message) => message.method === "session/prompt")!;
    controller.abort();
    expect(f.sent.some((message) => message.method === "session/cancel")).toBe(true);
    f.reply(prompt, { stopReason: "cancelled" });
    await f.run.completion;
    expect(vi.getTimerCount()).toBe(0);
    expect(f.kill).toHaveBeenCalledTimes(1);
  });
});
