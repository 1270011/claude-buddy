/**
 * Tests for self-announcing discovery (game-feel FR-E4).
 *
 * announceOnce persists to discovery.json, so it runs against a temp
 * CLAUDE_CONFIG_DIR.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { announceOnce, alreadyAnnounced } from "./discovery.ts";

describe("announceOnce (FR-E4)", () => {
  let cfgDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-disc-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  test("returns true exactly once per id, then false", () => {
    expect(announceOnce("whim")).toBe(true);
    expect(announceOnce("whim")).toBe(false);
    expect(announceOnce("whim")).toBe(false);
    expect(announceOnce("loot")).toBe(true); // a different id is independent
  });

  test("alreadyAnnounced reflects state without mutating", () => {
    expect(alreadyAnnounced("sets")).toBe(false);
    expect(alreadyAnnounced("sets")).toBe(false); // still false — no mutation
    announceOnce("sets");
    expect(alreadyAnnounced("sets")).toBe(true);
  });
});
