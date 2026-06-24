/**
 * Integration smoke tests for the idle-wander plumbing in writeStatusState (P2).
 *
 * state.ts freezes STATE_DIR / CONFIG_FILE at module load, so these cases run in
 * a *fresh bun subprocess* with its own CLAUDE_CONFIG_DIR — hermetic via the
 * child's env, no shared module state mutated in the test process. This mirrors
 * statusline_render.test.ts and the achievements.ts fresh-process precedent (the
 * existing state.test.ts deliberately leaves FS cases to a separate suite).
 *
 * Covers: the gate (off/subtle ⇒ absent, full ⇒ present), the wanderEnabled
 * opt-out, the wanderHop row track, DEFAULT_CONFIG backfill of an old
 * config.json, and the best-effort guarantee that a throwing generator never
 * breaks the write (NFR4).
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SERVER_DIR = import.meta.dir;
const STATE_TS = JSON.stringify(join(SERVER_DIR, "state.ts"));
const ENGINE_TS = JSON.stringify(join(SERVER_DIR, "engine.ts"));

interface RenderCase {
  config: Record<string, unknown>;
  /** Force buildWanderSequence to throw (via a child-local loader plugin). */
  throwWander?: boolean;
}

/** Run writeStatusState in a fresh subprocess under a temp config dir and return
 *  the parsed status.json it wrote (or null if none was written). */
function render(c: RenderCase): Record<string, unknown> | null {
  const cfgDir = mkdtempSync(join(tmpdir(), "buddy-wander-"));
  const stateDir = join(cfgDir, "buddy-state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "config.json"), JSON.stringify(c.config));

  // A child-local Bun loader plugin swaps wander.ts for a throwing stub — fully
  // isolated to this process, so it can't leak into other test files.
  const throwBlock = c.throwWander
    ? `
import { plugin } from "bun";
plugin({ name: "throw-wander", setup(b) {
  b.onLoad({ filter: /wander\\.ts$/ }, () => ({
    loader: "js",
    contents: "export function buildWanderSequence(){throw new Error('boom')}\\nexport function moodWalkOpts(){return {range:6,length:180,dwellMin:3,dwellMax:9,stepEvery:1,hopHeight:0,seed:1}}",
  }));
}});
`
    : "";

  const childSrc = `${throwBlock}
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
const companion = {
  bones: generateBones("smoke", "salt"),
  name: "Waffle",
  personality: "x",
  hatchedAt: Date.now(),
  userId: "smoke",
};
writeStatusState(companion);
`;
  const childPath = join(cfgDir, "child.mjs");
  writeFileSync(childPath, childSrc);

  const res = spawnSync("bun", [childPath], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
    encoding: "utf8",
  });

  const statusPath = join(stateDir, "status.json");
  const out = existsSync(statusPath)
    ? (JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>)
    : null;
  rmSync(cfgDir, { recursive: true, force: true });

  if (!out && res.status !== 0) {
    throw new Error(`child failed (status ${res.status}): ${res.stderr}`);
  }
  return out;
}

describe("writeStatusState — wander gate", () => {
  test("gameFeel=subtle ⇒ no wander sequences", () => {
    const state = render({ config: { gameFeel: "subtle", wanderEnabled: true } });
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=off ⇒ no wander sequences", () => {
    const state = render({ config: { gameFeel: "off", wanderEnabled: true } });
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=full + wanderEnabled ⇒ horizontal sequence present", () => {
    const state = render({ config: { gameFeel: "full", wanderEnabled: true } });
    expect(Array.isArray(state!.wanderSequence)).toBe(true);
    expect((state!.wanderSequence as number[]).length).toBeGreaterThan(0);
    // Hop off by default ⇒ no row track.
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=full + wanderEnabled=false ⇒ no sequences (opt-out)", () => {
    const state = render({ config: { gameFeel: "full", wanderEnabled: false } });
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=full + wanderHop ⇒ row sequence present too", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true, wanderHop: true },
    });
    expect(Array.isArray(state!.wanderSequence)).toBe(true);
    expect(Array.isArray(state!.wanderRowSequence)).toBe(true);
    const rows = state!.wanderRowSequence as number[];
    expect(rows.length).toBe((state!.wanderSequence as number[]).length);
    expect(Math.max(...rows)).toBeGreaterThan(0);
  });
});

describe("writeStatusState — wander backfill (NFR3)", () => {
  test("old config.json (no wander keys) ⇒ DEFAULT_CONFIG enables wander", () => {
    // Pre-wander config: only gameFeel set. loadConfig merges DEFAULT_CONFIG,
    // so wanderEnabled defaults true ⇒ a sequence is written.
    const state = render({ config: { gameFeel: "full" } });
    expect(Array.isArray(state!.wanderSequence)).toBe(true);
  });
});

describe("writeStatusState — mood-expressive walk is read-only (P5c / NFR1)", () => {
  test("a full + wander write never mutates mood.json", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-wander-"));
    const stateDir = join(cfgDir, "buddy-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "config.json"),
      JSON.stringify({ gameFeel: "full", wanderEnabled: true }),
    );
    const moodPath = join(stateDir, "mood.json");
    const moodJson = JSON.stringify(
      {
        current: "excited",
        since: 1_700_000_000_000,
        intensity: 2,
        recentErrors: 0,
        recentTests: 0,
        recentDiffs: 0,
      },
      null,
      2,
    );
    writeFileSync(moodPath, moodJson);

    const childSrc = `
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
writeStatusState({
  bones: generateBones("smoke", "salt"),
  name: "Waffle",
  personality: "x",
  hatchedAt: Date.now(),
  userId: "smoke",
});
`;
    const childPath = join(cfgDir, "child.mjs");
    writeFileSync(childPath, childSrc);
    const res = spawnSync("bun", [childPath], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
      encoding: "utf8",
    });
    expect(res.status).toBe(0);

    // The walk *reads* mood to shape the animation; it must write nothing back.
    expect(readFileSync(moodPath, "utf8")).toBe(moodJson);
    rmSync(cfgDir, { recursive: true, force: true });
  });
});

describe("writeStatusState — generator failure is swallowed (NFR4)", () => {
  test("a throwing wander generator never breaks the write", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      throwWander: true,
    });
    // Write still completes, just without wander fields — buddy stays planted.
    expect(state).not.toBeNull();
    expect(state!.name).toBe("Waffle");
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });
});
