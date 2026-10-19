import { describe, expect, it } from "vitest";

import { createClaudePrintCommand } from "../src/commands.js";
import type { ExecutableLaunch } from "../src/types.js";

/**
 * A RUN WITHOUT CONNECTORS LEAVES THEM OUT (0.798). Claude Code sends every tool of every connector on the account
 * with each call: MEASURED 2026-10-19, a second "say hello" turn held 191,214 tokens on Haiku, 190,424 on Sonnet and
 * 195,329 on Opus -- 235 of its 246 tools from ten connectors -- against 17,763 with them left out. A teammate has
 * them only once it has one ticked; the host says which with `accountConnectors`, and `false` is
 * `--strict-mcp-config`, which keeps only the servers Locust names itself.
 */
const EXE: ExecutableLaunch = { commandName: "claude", discoveredPath: "C:\\tools\\claude.exe", executablePath: "C:\\tools\\claude.exe", prefixArgs: [], kind: "native" };
const BRIDGE = { configPath: "C:\\temp\\locust-permission\\mcp.json", toolName: "mcp__locust__approve" };
const claude = (accountConnectors: boolean | undefined, sandbox: "read-only" | "workspace-write" | "full-access" = "workspace-write", model?: string) =>
  createClaudePrintCommand(EXE, {
    workspacePath: "C:\\workspace",
    sandbox,
    permissionBridge: BRIDGE,
    ...(model === undefined ? {} : { model }),
    ...(accountConnectors === undefined ? {} : { accountConnectors })
  }).args;

describe("the person's connectors on a Claude Code command line", () => {
  it("stay out when the run is told so, on every model and in every mode, and Locust's own servers stay in", () => {
    for (const sandbox of ["read-only", "workspace-write", "full-access"] as const) {
      for (const model of [undefined, "haiku", "sonnet", "opus"]) {
        expect(claude(false, sandbox, model), `${String(model)} ${sandbox}`).toContain("--strict-mcp-config");
      }
    }
    const args = claude(false);
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(BRIDGE.configPath);
  });

  it("come along for a teammate that has them on, and where nothing was said", () => {
    expect(claude(true)).not.toContain("--strict-mcp-config");
    expect(claude(undefined)).not.toContain("--strict-mcp-config");
  });
});
