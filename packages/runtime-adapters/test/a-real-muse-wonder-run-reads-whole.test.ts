import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createMuseEventNormalizer } from "../src/muse-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

/*
 * The first paid Muse Code run Locust has read (2026-10-12, Muse Code 1.4.6, Muse Wonder 1.0 on the day it came out):
 * every earlier fixture was `--provider echo`, which never calls a model or a tool, so a real run's model record, its
 * tool results and three of its task states were "Unhandled Muse ..." lines -- sixteen on one short run -- and its
 * tool was named `tool.search`.
 */
const NOW = "2026-10-12T17:30:00.000Z";
const completion: RuntimeProcessCompletion = {
  exitCode: 0,
  signal: null,
  stderr: "",
  stderrTruncated: false,
  recordCount: 95,
  cancelled: false,
  forcedTerminationAttempted: false,
  terminationUnconfirmed: false,
  inputDeliveryFailed: false,
  outputLimitExceeded: false,
  startedAt: NOW,
  finishedAt: NOW,
};

function run(lines: readonly string[]): readonly NormalizedRuntimeEvent[] {
  const muse = createMuseEventNormalizer({ runId: "run_muse", now: () => new Date(NOW) });
  const events: NormalizedRuntimeEvent[] = [];
  lines.forEach((raw, index) => events.push(...muse.accept({ sequence: index + 1, raw })));
  events.push(...muse.finish(completion));
  return events;
}

const captured = (): readonly string[] =>
  readFileSync(new URL("./fixtures/muse/wonder-tool-run-1.4.6.jsonl", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line.length > 0);

/** A task record shaped as the capture's are. */
const task = (taskId: string, event: Record<string, unknown>): string =>
  JSON.stringify({ schema_version: 1, record_type: "event", payload_type: `task.lifecycle.${String(event.kind)}`, payload: { kind: "task_lifecycle", task_id: taskId, event: { task_id: taskId, ...event } } });

const message = (event: NormalizedRuntimeEvent): string | undefined => {
  const payload = event.payload as { readonly code?: unknown; readonly message?: unknown };
  return typeof payload.message === "string" ? `${String(payload.code)}: ${payload.message}` : undefined;
};

describe("a real Muse Wonder run", () => {
  it("reads whole: its tool by name, its answer, its end, and nothing left unread", () => {
    const events = run(captured());
    expect(events.filter((event) => event.type === "adapter.diagnostic").map(message)).toEqual([]);
    const tools = events.filter((event) => event.type === "tool.started").map((event) => (event.payload as { readonly name?: string }).name);
    expect(tools).toEqual(["search", "search", "search"]);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(3);
    const final = events.find((event) => event.type === "message.delta" && (event.payload as { readonly final?: boolean }).final === true);
    expect((final?.payload as { readonly text?: string } | undefined)?.text).toMatch(/^There are 2 files in this folder/);
    expect(events.at(-1)?.type).toBe("run.completed");
  });

  it("says once that Meta's model is being tried again, and nothing for its first try", () => {
    const status = (attempt: number): string => task("model_1", {
      kind: "status",
      message: `opening meta model stream attempt ${String(attempt)}/10`,
      details: { phase: "opening_stream", facets: [{ kind: "external_attempt", system: "meta", operation: "model.response", attempt, max_attempts: 10 }] },
    });
    const said = run([task("model_1", { kind: "proposed", task_kind: "model.meta.response" }), status(1), status(2), status(2), status(3)])
      .filter((event) => event.type === "adapter.diagnostic")
      .map(message);
    expect(said).toEqual([
      "muse.provider_busy: Meta's model did not answer at once, and Muse Code is trying again on its own (attempt 2 of 10).",
      "muse.provider_busy: Meta's model did not answer at once, and Muse Code is trying again on its own (attempt 3 of 10).",
    ]);
  });

  it("fails a tool it would not run on that tool's row, and lets its own reminder go quietly", () => {
    const events = run([
      task("tool_1", { kind: "proposed", task_kind: "tool.edit" }),
      task("tool_1", { kind: "rejected", reason: "policy_denied" }),
      task("reminder_1", { kind: "proposed", task_kind: "reminder.agent.skill-reminder" }),
      task("reminder_1", { kind: "rejected", reason: "skip_if_running" }),
    ]);
    const failed = events.filter((event) => event.type === "tool.failed");
    expect(failed.map((event) => event.payload)).toMatchObject([{ name: "edit", status: "Muse Code did not run it (policy_denied)" }]);
    expect(events.filter((event) => event.type === "adapter.diagnostic")).toEqual([]);
  });
});
