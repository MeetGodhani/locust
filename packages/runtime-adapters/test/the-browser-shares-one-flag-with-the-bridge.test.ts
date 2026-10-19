import { describe, expect, it } from "vitest";

import { createClaudePrintCommand } from "../src/commands.js";
import type { BrowserMcpSpec } from "../src/commands.js";
import type { ExecutableLaunch } from "../src/types.js";

/**
 * THE BROWSER SHARES ONE FLAG WITH THE BRIDGE (2026-10-19, merging the agent-browser handoff). Locust's browser came
 * to a Claude Code run as a SECOND `--mcp-config` after the permission bridge's, and a second `--allowedTools` after
 * the connectors' rules. Whether the CLI keeps both values or only the last was never measured; if only the last,
 * the bridge is gone and every connector's question to the person with it, silently, as in 0.60.1. So each flag is
 * given once, with every value it takes.
 */
const EXE: ExecutableLaunch = { commandName: "claude", discoveredPath: "C:\\tools\\claude.exe", executablePath: "C:\\tools\\claude.exe", prefixArgs: [], kind: "native" };
const BRIDGE = { configPath: "C:\\temp\\locust-permission\\mcp.json", toolName: "mcp__locust__approve" };
const BROWSER: BrowserMcpSpec = { configPath: "C:\\temp\\locust-browser\\mcp.json", command: "node", args: ["bridge.mjs"], env: {} };
const claude = (sandbox: "read-only" | "workspace-write" | "full-access", extra: { browser?: boolean; connectors?: readonly string[] } = {}) =>
  createClaudePrintCommand(EXE, {
    workspacePath: "C:\\workspace",
    sandbox,
    permissionBridge: BRIDGE,
    ...(extra.browser === true ? { browserMcp: BROWSER } : {}),
    ...(extra.connectors === undefined ? {} : { connectors: extra.connectors })
  }).args;
const count = (args: readonly string[], flag: string): number => args.filter((arg) => arg === flag).length;

describe("Locust's browser on a Claude Code command line", () => {
  it("is named in the same --mcp-config as the permission bridge, which stays with its prompt tool", () => {
    for (const sandbox of ["read-only", "workspace-write"] as const) {
      const args = claude(sandbox, { browser: true });
      expect(count(args, "--mcp-config"), sandbox).toBe(1);
      const at = args.indexOf("--mcp-config");
      expect(args.slice(at + 1, at + 3), sandbox).toEqual([BRIDGE.configPath, BROWSER.configPath]);
      expect(args[args.indexOf("--permission-prompt-tool") + 1], sandbox).toBe(BRIDGE.toolName);
    }
  });

  it("joins the connectors' rules in one --allowedTools", () => {
    const args = claude("workspace-write", { browser: true, connectors: ["claude.ai Gmail"] });
    expect(count(args, "--allowedTools")).toBe(1);
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__claude_ai_Gmail__*,mcp__locust_browser__*");
    expect(claude("workspace-write", { browser: true })).toContain("mcp__locust_browser__*");
  });

  it("is still the only --mcp-config in Auto, where there is no bridge and no rule is needed", () => {
    const args = claude("full-access", { browser: true });
    expect(count(args, "--mcp-config")).toBe(1);
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(BROWSER.configPath);
    expect(args).not.toContain("--permission-prompt-tool");
    expect(args).not.toContain("--allowedTools");
  });

  it("changes nothing for a run without it", () => {
    const args = claude("read-only");
    expect(count(args, "--mcp-config")).toBe(1);
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(BRIDGE.configPath);
    expect(args).not.toContain("mcp__locust_browser__*");
  });
});
