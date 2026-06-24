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
  /** Game-feel intensity written into config.json (default unset → subtle). */
  gameFeel?: "off" | "subtle" | "full";
  /** A celebration with a seconds-ago age for the toast/flourish window. */
  celebration?: { text: string; secondsAgo: number } | null;
  /** Flourish frame set (game-feel FR-A3) written into status.json. */
  flourishFrames?: string[];
  flourishSequence?: number[];
  /** Idle-wander horizontal offset sequence (movement P3) in status.json. */
  wanderSequence?: number[];
  /** Idle-wander vertical (hop) offset sequence in status.json. */
  wanderRowSequence?: number[];
  /** Override the fixed reference "now" (default 1_700_000_000) so the sweep can
   *  index the wander/frame sequences at a chosen tick (offset = seq[now%len]). */
  fakeNow?: number;
  /** Override the server-rendered art frames (e.g. a tall frame to exercise the
   *  hop height-budget degrade). */
  frames?: string[];
  /** §7.B wide corridor flag, written into config.json. */
  wanderWide?: boolean;
  /** bubbleMargin in config.json (default 8) — drives the wander clamp/§7.C. */
  bubbleMargin?: number;
  /** Terminal width (default 125) — shrink it to exercise §7.C resize. */
  columns?: number;
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
    frames: overrides.frames ?? [
      "            \n    (··)    \n    (  )    \n            \n            ",
    ],
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
  // Fixed reference "now" so toast-age assertions are deterministic; the sweep
  // overrides it to land on a chosen wander offset.
  const fakeNow = overrides.fakeNow ?? 1_700_000_000;
  if (overrides.celebration) {
    status.celebration = {
      text: overrides.celebration.text,
      kind: "ascension",
      at: (fakeNow - overrides.celebration.secondsAgo) * 1000,
    };
  }
  if (overrides.flourishFrames) {
    status.flourishFrames = overrides.flourishFrames;
    status.flourishSequence = overrides.flourishSequence ?? [0];
  }
  if (overrides.wanderSequence) status.wanderSequence = overrides.wanderSequence;
  if (overrides.wanderRowSequence) {
    status.wanderRowSequence = overrides.wanderRowSequence;
  }
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
    overrides.showPrestigeBadge !== undefined ||
    overrides.gameFeel !== undefined ||
    overrides.wanderWide !== undefined ||
    overrides.bubbleMargin !== undefined
  ) {
    const cfg: Record<string, unknown> = {};
    if (overrides.showStats !== undefined) cfg.showStats = overrides.showStats;
    if (overrides.showPrestigeBadge !== undefined) {
      cfg.showPrestigeBadge = overrides.showPrestigeBadge;
    }
    if (overrides.gameFeel !== undefined) cfg.gameFeel = overrides.gameFeel;
    if (overrides.wanderWide !== undefined) cfg.wanderWide = overrides.wanderWide;
    if (overrides.bubbleMargin !== undefined) {
      cfg.bubbleMargin = overrides.bubbleMargin;
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
  env.COLUMNS = String(overrides.columns ?? 125);
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

  test("the toast does not shift or truncate the buddy (regression)", () => {
    // The "+N XP" toast widens only the Lv row; without folding it into the
    // shared stats-column width it pushed the art/name right on that line alone
    // (the buddy "shifted" and the name truncated). The art column position must
    // be identical with and without the toast.
    const nameCol = (s: string): number => {
      const line = stripAnsi(s)
        .split("\n")
        .find((l) => l.includes("Waffle"));
      return line ? line.indexOf("Waffle") : -1;
    };
    const withToast = renderStatus({
      showStats: true,
      lastXpGain: { amount: 1, secondsAgo: 2 },
    });
    const without = renderStatus({ showStats: true, lastXpGain: null });
    expect(withToast).toContain("+1 XP"); // toast actually present
    expect(nameCol(without)).toBeGreaterThan(0); // name rendered untruncated
    expect(nameCol(withToast)).toBe(nameCol(without)); // and did not move
  });

  test("a multi-digit toast also keeps the buddy aligned", () => {
    const nameCol = (s: string): number => {
      const line = stripAnsi(s)
        .split("\n")
        .find((l) => l.includes("Waffle"));
      return line ? line.indexOf("Waffle") : -1;
    };
    const big = renderStatus({
      showStats: true,
      lastXpGain: { amount: 250, secondsAgo: 1 },
    });
    const without = renderStatus({ showStats: true, lastXpGain: null });
    expect(big).toContain("+250 XP");
    expect(nameCol(big)).toBe(nameCol(without));
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

describe("buddy-status.sh ascension flourish (FR-A3)", () => {
  // Distinctive bodies so we can tell which frame set the script animated.
  const NEUTRAL = "            \n    (··)    \n    (  )    \n            \n            ";
  const FLOURISH = "            \n    (**)    \n    (  )    \n            \n            ";

  test("animates the flourish frames while the celebration is fresh", () => {
    const out = renderStatus({
      gameFeel: "full",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 2 },
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(out).toContain("(**)"); // flourish body
    expect(out).not.toContain("(··)"); // not the neutral body
    expect(out).toContain("🌟 PRESTIGE 1 🌟"); // toast shares the same window
  });

  test("reverts to the neutral frames after the celebration TTL expires", () => {
    const out = renderStatus({
      gameFeel: "full",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 30 }, // > 10s full TTL
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(out).toContain("(··)"); // neutral body restored
    expect(out).not.toContain("(**)"); // flourish no longer selected
    expect(out).not.toContain("🌟 PRESTIGE 1 🌟"); // toast also expired
  });

  test("never shows the flourish when gameFeel is off", () => {
    const out = renderStatus({
      gameFeel: "off",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 2 },
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(out).toContain("(··)");
    expect(out).not.toContain("(**)");
  });

  test("reverts at the shorter 6s window under subtle", () => {
    const fresh = renderStatus({
      gameFeel: "subtle",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 3 },
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(fresh).toContain("(**)");
    const stale = renderStatus({
      gameFeel: "subtle",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 8 }, // > 6s subtle TTL
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(stale).toContain("(··)");
    expect(stale).not.toContain("(**)");
  });

  test("old status.json without flourish fields animates the neutral frames", () => {
    const out = renderStatus({
      gameFeel: "full",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 2 },
      // no flourishFrames — simulates an older server / non-flourish write
    });
    expect(out).toContain("(··)");
    expect(out).not.toContain("(**)");
  });
});

// ─── Idle wander — the per-tick layout invariant (movement P3, design §9) ─────
//
// The keystone gate: as the buddy ambles right into the reclaimed margin, NOTHING
// left of the art may move a single column. We bake a wanderSequence [0..6] and
// sweep BUDDY_FAKE_NOW so NOW % 7 lands on each offset 0..6 in turn, then assert
// the left columns are byte-fixed while only the art (and its leading pad) shifts.
describe("buddy-status.sh idle wander (base horizontal)", () => {
  const SEQ = [0, 1, 2, 3, 4, 5, 6]; // offset == index == NOW for NOW in 0..6
  const REACTION = "hello friend"; // no dashes, so "|--" uniquely marks connector

  /** Render every offset 0..6 of the swept sequence, ANSI-stripped. */
  function sweep(): string[] {
    return SEQ.map((_, now) =>
      stripAnsi(
        renderStatus({
          reaction: REACTION,
          name: "Waffle",
          showStats: true,
          gameFeel: "full",
          wanderSequence: SEQ,
          fakeNow: now,
        }),
      ),
    );
  }

  /** indexOf a needle across the whole rendered block (first match wins). */
  function colOf(frame: string, needle: string): number {
    const line = frame.split("\n").find((l) => l.includes(needle));
    expect(line).toBeDefined();
    return line!.indexOf(needle);
  }

  test("columns left of the art are byte-identical across every offset", () => {
    const frames = sweep();
    // Stats labels (leftmost column) never move.
    for (const label of ["DEBUGGING", "SNARK"]) {
      const cols = frames.map((f) => colOf(f, label));
      expect(new Set(cols).size).toBe(1);
    }
    // The bubble (left of art) never moves.
    const bubbleCols = frames.map((f) => colOf(f, REACTION));
    expect(new Set(bubbleCols).size).toBe(1);
  });

  test("the buddy art translates right by exactly the offset", () => {
    const frames = sweep();
    const base = colOf(frames[0], "Waffle");
    for (let k = 0; k < SEQ.length; k++) {
      expect(colOf(frames[k], "Waffle")).toBe(base + k);
    }
  });

  test("the connector is attached only at home (offset 0)", () => {
    const frames = sweep();
    expect(frames[0].includes("|--")).toBe(true); // connector present at home
    for (let k = 1; k < SEQ.length; k++) {
      expect(frames[k].includes("|--")).toBe(false); // retracted while away
    }
  });

  test("gameFeel=subtle keeps the buddy planted (no wander)", () => {
    const planted = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "subtle",
        wanderSequence: SEQ,
        fakeNow: 5, // would be offset 5 if the gate allowed it
      }),
    );
    const home = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "subtle",
        wanderSequence: SEQ,
        fakeNow: 0,
      }),
    );
    // Gate closed ⇒ offset forced 0 regardless of NOW ⇒ identical to home, and
    // the connector stays attached.
    expect(planted).toBe(home);
    expect(planted.includes("|--")).toBe(true);
  });

  test("a fresh celebration pauses the wander (buddy comes home to talk)", () => {
    const base = {
      reaction: REACTION,
      name: "Waffle",
      showStats: true,
      gameFeel: "full" as const,
      wanderSequence: SEQ,
    };
    // NOW=5 would amble the buddy to offset 5…
    const wandered = stripAnsi(renderStatus({ ...base, fakeNow: 5 }));
    // …but a fresh celebration (2s ≤ the 10s full TTL) pulls it home to talk.
    const paused = stripAnsi(
      renderStatus({
        ...base,
        fakeNow: 5,
        celebration: { text: "🎉 LEVEL 5 🎉", secondsAgo: 2 },
      }),
    );
    const homeCol = colOf(sweep()[0], "Waffle"); // offset-0 art column
    expect(colOf(wandered, "Waffle")).toBe(homeCol + 5); // wander is live
    expect(paused).toContain("🎉 LEVEL 5 🎉"); // celebration is showing
    expect(colOf(paused, "Waffle")).toBe(homeCol); // forced home (offset 0)
    expect(paused.includes("|--")).toBe(true); // connector reattached
  });

  test("an old status.json without wanderSequence renders byte-identically", () => {
    const withField = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "full",
        wanderSequence: [0], // present but pinned to home
        fakeNow: 0,
      }),
    );
    const withoutField = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "full",
        // no wanderSequence — simulates an older server write (NFR3 degrade)
        fakeNow: 0,
      }),
    );
    expect(withoutField).toBe(withField);
  });
});

// ─── Idle wander — vertical hop (movement P4 / §7.A, flag wanderHop) ──────────
//
// The hop reserves constant headroom (= the row-sequence max) and slides the art
// block up by the live WANDER_ROW. The invariant: bubble/stats rows are centered
// on the *floor baseline* (total height), so they hold their row while the art
// bobs. We sweep WANDER_ROW 0..2 via a baked wanderRowSequence + fakeNow.
describe("buddy-status.sh idle wander (vertical hop)", () => {
  const ROW_SEQ = [0, 1, 2]; // WANDER_ROW == index == fakeNow for 0..2
  const REACTION = "hello friend";

  function hopSweep(): string[] {
    return ROW_SEQ.map((_, now) =>
      stripAnsi(
        renderStatus({
          reaction: REACTION,
          name: "Waffle",
          showStats: true,
          gameFeel: "full",
          wanderRowSequence: ROW_SEQ, // hop only; no horizontal offset
          fakeNow: now,
        }),
      ),
    );
  }

  /** Output row index (line number) of the first line containing `needle`. */
  function rowOf(frame: string, needle: string): number {
    const lines = frame.split("\n");
    const idx = lines.findIndex((l) => l.includes(needle));
    expect(idx).toBeGreaterThanOrEqual(0);
    return idx;
  }

  test("bubble and stats hold their row while the buddy hops (no bob)", () => {
    const frames = hopSweep();
    for (const landmark of [REACTION, "DEBUGGING", "SNARK"]) {
      const rows = frames.map((f) => rowOf(f, landmark));
      expect(new Set(rows).size).toBe(1);
    }
  });

  test("the buddy art rises by exactly one row per hop step", () => {
    const frames = hopSweep();
    // ART_TOP = HOP_RESERVE - WANDER_ROW, so the name row decreases by 1 per step.
    const rows = frames.map((f) => rowOf(f, "Waffle"));
    expect(rows[0] - rows[1]).toBe(1);
    expect(rows[1] - rows[2]).toBe(1);
  });

  test("the connector retracts while hopping, reattaches on the floor", () => {
    const frames = hopSweep();
    expect(frames[0].includes("|--")).toBe(true); // WANDER_ROW=0 → on the floor
    expect(frames[1].includes("|--")).toBe(false);
    expect(frames[2].includes("|--")).toBe(false);
  });

  test("headroom collapses (hop ignored) when the block blows the height budget", () => {
    // A 12-line art frame ⇒ ART_COUNT (incl. name) exceeds the 12-row budget once
    // headroom is added, so the hop is dropped and renders identically to no-hop.
    const tall = [Array.from({ length: 12 }, () => "xxxxxxxxxxxx").join("\n")];
    const hopped = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        gameFeel: "full",
        frames: tall,
        wanderRowSequence: [2, 2, 2], // would hop 2 rows if budget allowed
        fakeNow: 0,
      }),
    );
    const planted = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        gameFeel: "full",
        frames: tall,
        // no wanderRowSequence — the baseline to match
        fakeNow: 0,
      }),
    );
    expect(hopped).toBe(planted);
  });
});

// ─── Idle wander — wide corridor (movement P5a / §7.B, flag wanderWide) ───────
//
// Wide mode opens a left lane by shifting the bubble+art block left by a CONSTANT
// WANDER_LEFT = WANDER_RANGE_WIDE − (MARGIN − WANDER_SAFETY) = 10 − (8 − 2) = 4.
// The shift is one-time (offset-independent) so the bubble holds its column on
// every tick.
describe("buddy-status.sh idle wander (wide corridor)", () => {
  const REACTION = "hello friend";
  const WANDER_LEFT = 10 - (8 - 2); // = 4 at the default margin

  function bubbleCol(opts: Partial<StatusOverrides>): number {
    const out = stripAnsi(
      renderStatus({ reaction: REACTION, name: "Waffle", ...opts }),
    );
    const line = out.split("\n").find((l) => l.includes(REACTION))!;
    return line.indexOf(REACTION);
  }

  test("enabling wanderWide shifts the bubble left by exactly WANDER_LEFT", () => {
    const narrow = bubbleCol({ gameFeel: "full", wanderSequence: [0], fakeNow: 0 });
    const wide = bubbleCol({
      gameFeel: "full",
      wanderWide: true,
      wanderSequence: [0],
      fakeNow: 0,
    });
    expect(narrow - wide).toBe(WANDER_LEFT);
  });

  test("the wide shift is identical on every tick (offset-independent)", () => {
    const seq = [0, 3, 6, 9]; // valid offsets in the wide corridor (max 10)
    const cols = seq.map((_, now) =>
      bubbleCol({
        gameFeel: "full",
        wanderWide: true,
        wanderSequence: seq,
        fakeNow: now,
      }),
    );
    expect(new Set(cols).size).toBe(1);
  });

  test("wanderWide is inert when the gate is below full", () => {
    // Below full the buddy is planted, so wide must not shift the bubble either.
    const plain = bubbleCol({ gameFeel: "subtle", wanderSequence: [0], fakeNow: 0 });
    const wideButGated = bubbleCol({
      gameFeel: "subtle",
      wanderWide: true,
      wanderSequence: [0],
      fakeNow: 0,
    });
    expect(wideButGated).toBe(plain);
  });
});

// ─── Idle wander — resize robustness (movement P5b / §7.C, no flag) ───────────
//
// The clamp runs against the LIVE MARGIN/COLS every tick, so a narrow terminal
// caps the offset and the buddy never clips. WANDER_MAX = MARGIN − WANDER_SAFETY.
describe("buddy-status.sh idle wander (resize robustness)", () => {
  function nameCol(margin: number, seq: number[], now: number): number {
    const out = stripAnsi(
      renderStatus({
        reaction: "hi",
        name: "Waffle",
        gameFeel: "full",
        bubbleMargin: margin,
        wanderSequence: seq,
        fakeNow: now,
      }),
    );
    const line = out.split("\n").find((l) => l.includes("Waffle"))!;
    return line.indexOf("Waffle");
  }

  test("a baked offset beyond the corridor is clamped to WANDER_MAX", () => {
    // margin 3 ⇒ WANDER_MAX = 3 − 2 = 1, so a baked 6 must render as 1.
    const home = nameCol(3, [0, 6], 0); // offset 0
    const clamped = nameCol(3, [0, 6], 1); // baked 6 → clamped to 1
    expect(clamped - home).toBe(1);
  });

  test("WANDER_MAX=0 parks the buddy (degrade)", () => {
    // margin 2 ⇒ WANDER_MAX = 0, so every tick is home regardless of the bake.
    const a = nameCol(2, [0, 6], 0);
    const b = nameCol(2, [0, 6], 1);
    expect(a).toBe(b);
  });
});
