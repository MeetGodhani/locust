import { describe, expect, it } from "vitest";

import { createOpenCodeEventNormalizer } from "../src/opencode-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

/*
 * 2026-10-12, 15:04Z: what OpenCode 1.18.27 wrote for `run --format json -m opencode/space-bunny-free`, while every
 * one of its free models answered so, for everyone (anomalyco/opencode#54833) -- trimmed only of the response
 * headers. Its server path hands the same record on (opencode-serve-run.ts, session.error). The card said "Its
 * sign-in may have expired -- `opencode auth login` in a terminal" to people who never signed in to anything.
 */
const MEASURED = JSON.stringify({
  type: "error",
  timestamp: 1791817472158,
  sessionID: "ses_ecf5c461affe7hz3Cz49cHA0hJ",
  error: {
    name: "APIError",
    data: {
      message: "Upstream request failed: Invalid credential",
      statusCode: 401,
      isRetryable: false,
      responseBody: JSON.stringify({ error: { type: "server_error", message: "Upstream request failed: Invalid credential" } }),
      metadata: { url: "https://opencode.ai/inference/v1/chat/completions" },
    },
  },
});

const NOW = "2026-10-12T15:04:32.000Z";
const completion: RuntimeProcessCompletion = {
  exitCode: 1,
  signal: null,
  stderr: "",
  stderrTruncated: false,
  recordCount: 1,
  cancelled: false,
  forcedTerminationAttempted: false,
  terminationUnconfirmed: false,
  inputDeliveryFailed: false,
  outputLimitExceeded: false,
  startedAt: NOW,
  finishedAt: NOW,
};

function said(model: string): { readonly diagnostic: string | undefined; readonly failed: string | undefined } {
  const opencode = createOpenCodeEventNormalizer({ runId: "run_1", model, now: () => new Date(NOW) });
  const events: NormalizedRuntimeEvent[] = [...opencode.accept({ sequence: 1, raw: MEASURED }), ...opencode.finish(completion)];
  const message = (type: string): string | undefined => {
    const event = events.find((one) => one.type === type);
    const payload = event === undefined ? undefined : (event.payload as { readonly message?: unknown });
    return typeof payload?.message === "string" ? payload.message : undefined;
  };
  return { diagnostic: message("adapter.diagnostic"), failed: message("run.failed") };
}

describe("a free model OpenCode's service refused", () => {
  it("says so, as OpenCode's side, while it happens and when the run ends -- never a sign-in", () => {
    const { diagnostic, failed } = said("opencode/space-bunny-free");
    const sentence = "OpenCode's service refused the free model, so OpenCode stopped: Upstream request failed: Invalid credential. Free models need no sign-in, so this is on OpenCode's side: pick another model, or try this one again later.";
    expect(diagnostic).toBe(sentence);
    expect(failed).toBe(sentence);
  });

  it("while a model of the person's own, refused the same way, is still pointed at its sign-in", () => {
    const { failed } = said("anthropic/claude-sonnet-5-5");
    expect(failed).toMatch(/Its sign-in may have expired -- `opencode auth login` in a terminal\.$/);
  });
});
