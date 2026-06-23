/**
 * Render tests for statusline/buddy-status.sh — Phase 6 prestige titles.
 *
 * Drives the real bash script under a temp CLAUDE_CONFIG_DIR with a hand-built
 * status.json fixture, then asserts on its stdout. Hermetic via the spawned
 * process's env (no shared module state), mirroring paths_sh.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const SCRIPT = resolve(import.meta.dir, "..", "statusline", "buddy-status.sh");

/** Strip ANSI SGR escape codes so assertions can match rendered text. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

interface StatusOverrides {
  title?: string | null;
  name?: string;
  level?: number;
  reaction?: string;
  /** When set, writes config.json with showStats and includes stats in status.json. */
  showStats?: boolean;
  /** Omit stats entirely from status.json (simulates an older server build). */
  omitStats?: boolean;
  /** When set, writes config.json with showPrestigeBadge (FR1.5). */
  showPrestigeBadge?: boolean;
  /** Prestige tier in status.json (default 0). */
  prestigeLevel?: number;
  /** Current streak in status.json (default 0). */
  streak?: number;
  /** Omit prestige/streak fields from status.json (simulates an older server). */
  omitBadgeFields?: boolean;
  /** Level-progress percent in status.json (default 50). */
  xpPct?: number;
  /** Most recent XP gain — amount + seconds-ago for the toast window. */
  lastXpGain?: { amount: number; secondsAgo: number } | null;
  /** Omit xpPct/lastXpGain entirely (simulates an older server). */
  omitXpFields?: boolean;
}

/** Write a minimal status.json into a temp config dir and run buddy-status.sh
 *  against it, returning the script's stdout. */
function renderStatus(overrides: StatusOverrides): string {
  const cfgDir = mkdtempSync(join(tmpdir(), "buddy-status-test-"));
  const stateDir = join(cfgDir, "buddy-state");
  mkdirSync(stateDir, { recursive: true });

  const status: Record<string, unknown> = {
    name: overrides.name ?? "Waffle",
    rarity: "common",
    shiny: false,
    reaction: overrides.reaction ?? "",
    achievement: "",
    level: overrides.level ?? 11,
    mood: "focused",
    muted: false,
    title: overrides.title ?? null,
    // One concrete frame so the cycler has something to pick.
    frames: ["            \n    (··)    \n    (  )    \n            \n            "],
    frameSequence: [0],
  };
  if (!overrides.omitStats) {
    status.stats = {
      DEBUGGING: 10,
      PATIENCE: 22,
      CHAOS: 28,
      WISDOM: 5,
      SNARK: 76,
    };
    status.peak = "SNARK";
    status.dump = "WISDOM";
  }
  if (!overrides.omitBadgeFields) {
    status.prestigeLevel = overrides.prestigeLevel ?? 0;
    status.streak = overrides.streak ?? 0;
  }
  // Fixed reference "now" so toast-age assertions are deterministic.
  const fakeNow = 1_700_000_000;
  if (!overrides.omitXpFields) {
    status.xpPct = overrides.xpPct ?? 50;
    status.lastXpGain = overrides.lastXpGain
      ? {
          amount: overrides.lastXpGain.amount,
          at: (fakeNow - overrides.lastXpGain.secondsAgo) * 1000,
        }
      : null;
  }
  writeFileSync(join(stateDir, "status.json"), JSON.stringify(status));

  if (
    overrides.showStats !== undefined ||
    overrides.showPrestigeBadge !== undefined
  ) {
    const cfg: Record<string, unknown> = {};
    if (overrides.showStats !== undefined) cfg.showStats = overrides.showStats;
    if (overrides.showPrestigeBadge !== undefined) {
      cfg.showPrestigeBadge = overrides.showPrestigeBadge;
    }
    writeFileSync(join(stateDir, "config.json"), JSON.stringify(cfg));
  }

  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: cfgDir };
  for (const k of ["HOME", "PATH", "USER", "LANG", "LC_ALL", "LC_CTYPE"]) {
    if (process.env[k]) env[k] = process.env[k]!;
  }
  // The script (like every real terminal it runs in) assumes a UTF-8 locale —
  // multibyte bar slicing depends on char-aware substrings. Ensure one even if
  // the host env didn't set it.
  if (!env.LC_ALL && !env.LANG && !env.LC_CTYPE) env.LC_ALL = "en_US.UTF-8";
  // Pin width so right-alignment padding is deterministic and the buddy renders.
  env.COLUMNS = "125";
  // Match the fixed reference "now" used to derive lastXpGain.at above.
  env.BUDDY_FAKE_NOW = String(fakeNow);

  try {
    const result = spawnSync("bash", [SCRIPT], {
      env,
      input: "",
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`bash exited ${result.status}: ${result.stderr}`);
    }
    return result.stdout;
  } finally {
    rmSync(cfgDir, { recursive: true, force: true });
  }
}

describe("buddy-status.sh prestige title", () => {
  test("renders an equipped title in guillemets under the name", () => {
    const out = renderStatus({ title: "Committer" });
    expect(out).toContain("«Committer»");
  });

  test("omits the title line entirely when no title is equipped", () => {
    const out = renderStatus({ title: null });
    expect(out).not.toContain("«");
    expect(out).not.toContain("»");
  });

  test("still shows the buddy name when a title is present", () => {
    const out = renderStatus({ title: "Architect", name: "Waffle" });
    expect(out).toContain("Waffle");
    expect(out).toContain("«Architect»");
  });
});

describe("buddy-status.sh stats panel", () => {
  test("renders the stat panel when showStats is on", () => {
    const out = renderStatus({ showStats: true });
    for (const label of ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"]) {
      expect(out).toContain(label);
    }
    // Bars + values from the fixture (strip ANSI: color codes sit between
    // the bar and the number in raw output).
    const plain = stripAnsi(out);
    expect(plain).toMatch(/SNARK\s+█+░+\s+76/);
    expect(plain).toMatch(/WISDOM\s+█+░+\s+5/);
  });

  test("marks the peak with ▲ and the dump with ▼", () => {
    const out = renderStatus({ showStats: true });
    expect(out).toMatch(/SNARK[^\n]*▲/); // peak
    expect(out).toMatch(/WISDOM[^\n]*▼/); // dump
  });

  test("hides the panel when showStats is off", () => {
    const out = renderStatus({ showStats: false });
    expect(out).not.toContain("DEBUGGING");
    expect(out).not.toContain("▲");
  });

  test("hides the panel by default (no config.json)", () => {
    const out = renderStatus({});
    expect(out).not.toContain("DEBUGGING");
  });

  test("skips the panel gracefully when status.json has no stats (old server)", () => {
    const out = renderStatus({ showStats: true, omitStats: true });
    expect(out).not.toContain("DEBUGGING");
    // The buddy itself must still render.
    expect(out).toContain("Waffle");
  });

  test("shows stats and the speech bubble together (three columns)", () => {
    const out = renderStatus({ showStats: true, reaction: "nice commit" });
    expect(out).toContain("DEBUGGING");
    expect(out).toContain("nice commit");
    expect(out).toContain("Waffle");
  });
});

describe("buddy-status.sh XP progress row", () => {
  test("renders level, bar, and percent below the stat bars", () => {
    const out = renderStatus({ showStats: true, level: 7, xpPct: 68 });
    const plain = stripAnsi(out);
    expect(plain).toMatch(/Lv7\s+█+░+\s+68%/);
  });

  test("shows the blue +N XP toast within the 10s window", () => {
    const out = renderStatus({
      showStats: true,
      lastXpGain: { amount: 15, secondsAgo: 3 },
    });
    expect(out).toContain("+15 XP");
  });

  test("omits the toast once it ages past 10s", () => {
    const out = renderStatus({
      showStats: true,
      lastXpGain: { amount: 15, secondsAgo: 30 },
    });
    expect(out).not.toContain("+15 XP");
  });

  test("omits the toast when there has been no gain", () => {
    const out = renderStatus({ showStats: true, lastXpGain: null });
    expect(out).not.toContain("XP");
  });

  test("degrades gracefully when status.json predates xpPct/lastXpGain", () => {
    const out = renderStatus({ showStats: true, omitXpFields: true });
    const plain = stripAnsi(out);
    expect(plain).toMatch(/Lv\d+\s+░+\s+0%/);
    expect(out).toContain("Waffle");
  });

  test("hides the row entirely when showStats is off", () => {
    const out = renderStatus({ showStats: false, xpPct: 68 });
    expect(out).not.toMatch(/Lv\d+/);
  });
});

describe("buddy-status.sh prestige/streak badge (FR1.5)", () => {
  test("renders prestige + streak when the badge is on", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 2,
      streak: 7,
    });
    expect(out).toContain("P2");
    expect(out).toContain("🔥7");
  });

  test("shows only the streak when never ascended (no P0)", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 0,
      streak: 5,
    });
    expect(out).toContain("🔥5");
    expect(out).not.toContain("P0");
  });

  test("shows only the prestige tier when no active streak", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 3,
      streak: 0,
    });
    expect(out).toContain("P3");
    expect(out).not.toContain("🔥");
  });

  test("skips the badge entirely when both are zero, even if enabled", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 0,
      streak: 0,
    });
    expect(out).not.toContain("🔥");
    expect(out).not.toMatch(/P\d/);
    expect(out).toContain("Waffle"); // buddy still renders
  });

  test("hidden by default — common case is visually unchanged (G5)", () => {
    const out = renderStatus({ prestigeLevel: 4, streak: 9 });
    expect(out).not.toContain("🔥");
    expect(out).not.toContain("P4");
  });

  test("hidden when explicitly off", () => {
    const out = renderStatus({
      showPrestigeBadge: false,
      prestigeLevel: 2,
      streak: 7,
    });
    expect(out).not.toContain("🔥");
    expect(out).not.toContain("P2");
  });

  test("renders gracefully when status.json lacks the fields (old server)", () => {
    const out = renderStatus({ showPrestigeBadge: true, omitBadgeFields: true });
    // Defaults to 0/0 → no badge, buddy still renders.
    expect(out).not.toContain("🔥");
    expect(out).toContain("Waffle");
  });

  test("coexists with an equipped title (badge sits under it)", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 1,
      streak: 3,
      title: "Legend",
    });
    expect(out).toContain("«Legend»");
    expect(out).toContain("P1");
    expect(out).toContain("🔥3");
  });
});
