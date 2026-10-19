import { describe, expect, it } from "vitest";

import { discoverInstalledRuntimes } from "../src/index.js";
import type { CommandResult, CommandRunner, ExecutableLaunch, ExecutableLocator, ProbeCommand } from "../src/index.js";

/**
 * OPENCODE 2 IS SAID PLAINLY UNTIL LOCUST RUNS IT (0.805). OpenCode 2 keeps the `opencode` command but has no
 * `opencode serve` and a new server API. With 2.0.32 first on PATH (MEASURED 2026-10-19), OpenCode read as ready
 * and every turn ended "OpenCode's event stream closed before the turn finished". Now it reads as unsupported, with
 * why and what to do; OpenCode 1 is untouched.
 */

const HELP = "opencode run [message..]  --format <format>  text | json  -m, --model  -s, --session";
const MODELS = "opencode/big-pickle\nopencode/deepseek-v4.1-flash-free\n";

const installed: ExecutableLaunch = {
  commandName: "opencode",
  discoveredPath: "C:\\tools\\opencode.exe",
  executablePath: "C:\\tools\\opencode.exe",
  prefixArgs: [],
  kind: "native",
};
const locator: ExecutableLocator = { find: async (command) => (command === "opencode" ? installed : undefined) };
const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
const runnerFor = (version: string): CommandRunner => ({
  run: async (command: ProbeCommand) => ok(command.purpose === "version" ? version : command.purpose === "capabilities" ? HELP : MODELS),
});
const opencode = async (version: string) =>
  (await discoverInstalledRuntimes({ runner: runnerFor(version), locator, only: new Set(["opencode"]) })).find((entry) => entry.id === "opencode");

describe("OpenCode's version", () => {
  it("2.x is installed but unsupported, and says why and what to do", async () => {
    const found = await opencode("opencode v2.0.32");
    expect(found).toMatchObject({ availability: "available", readiness: "unsupported" });
    const note = found?.diagnostics.find((entry) => entry.code === "version-unsupported");
    expect(note?.severity).toBe("error");
    expect(note?.message).toContain("OpenCode 2.0.32 is installed, and Locust runs OpenCode 1 for now");
    expect(note?.resolution).toContain("npm install -g opencode-ai");
  });

  it("1.x reads as it always has (control)", async () => {
    const found = await opencode("1.19.3");
    expect(found?.readiness).not.toBe("unsupported");
    expect(found?.diagnostics.map((entry) => entry.code)).not.toContain("version-unsupported");
  });
});
