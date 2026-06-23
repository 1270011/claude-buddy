/**
 * Tests for memory-narrated milestones (game-feel FR-E3).
 *
 * historyCallback reads the event counters + streak, so it runs against a temp
 * CLAUDE_CONFIG_DIR. rng is injected for determinism.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { historyCallback, historyCandidates } from "./memory-callbacks.ts";
import { incrementEvent } from "./achievements.ts";

describe("historyCallback (FR-E3)", () => {
  let cfgDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-mc-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  test("returns null when history is too thin (fresh install)", () => {
    expect(historyCandidates()).toEqual([]);
    expect(historyCallback(() => 0)).toBeNull();
  });

  test("cites real counters once history exists", () => {
    incrementEvent("bugs_resolved", 3);
    const cands = historyCandidates();
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.some((c) => c.includes("3 bugs"))).toBe(true);
    expect(historyCallback(() => 0)).not.toBeNull();
  });

  test("does not repeat the same line back-to-back when alternatives exist", () => {
    incrementEvent("bugs_resolved", 3);
    incrementEvent("commits_made", 20);
    incrementEvent("errors_seen", 30);
    const a = historyCallback(() => 0);
    const b = historyCallback(() => 0);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
  });
});
