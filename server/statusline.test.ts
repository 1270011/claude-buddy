/**
 * Tests for the Claude Code settings.json patching helpers used by the
 * buddy_statusline MCP tool. Uses a temp directory per test so runs are
 * isolated from the real ~/.claude/settings.json.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setBuddyStatusLine, unsetBuddyStatusLine } from "./state.ts";

describe("buddy statusline settings patch", () => {
  let settingsPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "buddy-statusline-test-"));
    settingsPath = join(dir, "settings.json");
  });

  test("enable writes statusLine pointing to buddy-status.sh and preserves other keys", () => {
    writeFileSync(settingsPath, JSON.stringify({ other: "value" }));

    const ok = setBuddyStatusLine("/opt/buddy/statusline/buddy-status.sh", settingsPath);

    expect(ok).toBe(true);
    const result = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(result.statusLine.type).toBe("command");
    expect(result.statusLine.command).toContain("buddy-status.sh");
    expect(result.statusLine.padding).toBe(1);
    expect(result.statusLine.refreshInterval).toBe(1);
    expect(result.other).toBe("value");
  });

  test("disable removes buddy statusLine but keeps other keys", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        statusLine: { type: "command", command: "/opt/buddy/statusline/buddy-status.sh" },
        other: "value",
      }),
    );

    const ok = unsetBuddyStatusLine(settingsPath);

    expect(ok).toBe(true);
    const result = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(result.statusLine).toBeUndefined();
    expect(result.other).toBe("value");
  });

  test("disable does NOT touch a foreign statusLine", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        statusLine: { type: "command", command: "/usr/local/bin/my-status.sh" },
      }),
    );

    const ok = unsetBuddyStatusLine(settingsPath);

    expect(ok).toBe(false);
    const result = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(result.statusLine.command).toBe("/usr/local/bin/my-status.sh");
  });

  test("enable returns false if settings.json is missing", () => {
    const missing = join(tmpdir(), `buddy-nonexistent-${Date.now()}.json`);
    const ok = setBuddyStatusLine("/opt/buddy/statusline/buddy-status.sh", missing);
    expect(ok).toBe(false);
  });
});
