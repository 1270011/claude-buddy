import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { handleBuddyComment } from "./buddy-comment.ts";

function makeStateDir(): string {
  return mkdtempSync(join(tmpdir(), "coding-buddy-comment-"));
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("buddy comment Stop hook", () => {
  test("writes the latest hidden comment, records a turn, and spawns slow work", () => {
    const stateDir = makeStateDir();
    dirs.push(stateDir);
    writeFileSync(join(stateDir, "status.json"), "{}");
    writeFileSync(join(stateDir, "events.json"), JSON.stringify({ turns: 2, kept: true }));

    const spawned: Array<{ script: string; args: string[] }> = [];
    const result = handleBuddyComment(
      JSON.stringify({
        last_assistant_message: "first <!-- buddy: old --> second <!-- buddy: ship it -->",
        last_user_message: "please finish",
      }),
      {
        now: () => 1_700_000_000_123,
        sessionId: "session1",
        spawnDetached: (script, args) => spawned.push({ script, args }),
        stateDir,
      },
    );

    expect(result).toEqual({ comment: "ship it", source: "comment", updated: true });
    expect(JSON.parse(readFileSync(join(stateDir, "reaction.session1.json"), "utf8"))).toEqual({
      reaction: "ship it",
      timestamp: 1_700_000_000_123,
      reason: "turn",
      source: "comment",
    });
    expect(JSON.parse(readFileSync(join(stateDir, "events.json"), "utf8"))).toMatchObject({
      turns: 3,
      kept: true,
    });
    expect(spawned).toEqual([
      { script: "server/award-xp.ts", args: ["turn"] },
      { script: "server/consolidate.ts", args: ["first <!-- buddy: old --> second <!-- buddy: ship it -->", "please finish"] },
    ]);
  });

  test("ignores malformed stdin", () => {
    const stateDir = makeStateDir();
    dirs.push(stateDir);
    writeFileSync(join(stateDir, "status.json"), "{}");

    const result = handleBuddyComment("{nope", {
      spawnDetached: () => {
        throw new Error("should not spawn");
      },
      stateDir,
    });

    expect(result).toEqual({ source: "none", updated: false });
    expect(existsSync(join(stateDir, "reaction.default.json"))).toBe(false);
  });

  test("exits silently when the state directory is missing", () => {
    const stateDir = join(tmpdir(), `coding-buddy-missing-${Date.now()}`);

    const result = handleBuddyComment(
      JSON.stringify({ last_assistant_message: "<!-- buddy: hidden -->" }),
      { stateDir },
    );

    expect(result).toEqual({ source: "none", updated: false });
    expect(existsSync(stateDir)).toBe(false);
  });
  test("leaves a fresh buddy_react tool reaction alone (do not clobber)", () => {
    const stateDir = makeStateDir();
    dirs.push(stateDir);
    writeFileSync(join(stateDir, "status.json"), "{}");
    writeFileSync(join(stateDir, "events.json"), "{}");
    // Tool call fired 5s before this Stop hook — fresh, authoritative.
    const toolTs = 1_700_000_000_000;
    writeFileSync(
      join(stateDir, "reaction.session1.json"),
      JSON.stringify({
        reaction: "*tool wrote this*",
        timestamp: toolTs,
        reason: "turn",
        source: "tool",
      }),
    );
    const originalFile = readFileSync(
      join(stateDir, "reaction.session1.json"),
      "utf8",
    );

    const spawned: Array<{ script: string; args: string[] }> = [];
    const result = handleBuddyComment(
      JSON.stringify({
        last_assistant_message: "no comment here, just an empty reply",
        last_user_message: "go",
      }),
      {
        now: () => toolTs + 5_000,
        sessionId: "session1",
        spawnDetached: (script, args) => spawned.push({ script, args }),
        stateDir,
      },
    );

    expect(result).toEqual({ source: "none", updated: false });
    // File is byte-for-byte unchanged — the hook did not touch it.
    expect(readFileSync(join(stateDir, "reaction.session1.json"), "utf8")).toBe(
      originalFile,
    );
    // Bookkeeping still runs even when we skip the reaction write.
    expect(spawned).toEqual([
      { script: "server/award-xp.ts", args: ["turn"] },
      { script: "server/consolidate.ts", args: ["no comment here, just an empty reply", "go"] },
    ]);
  });

  test("falls back to a canned pool line when no comment is emitted", () => {
    const stateDir = makeStateDir();
    dirs.push(stateDir);
    writeFileSync(join(stateDir, "status.json"), JSON.stringify({ species: "blob" }));
    writeFileSync(join(stateDir, "events.json"), "{}");

    const result = handleBuddyComment(
      JSON.stringify({
        last_assistant_message: "a perfectly ordinary reply with no comment",
        last_user_message: "go",
      }),
      {
        now: () => 1_700_000_000_000,
        // Deterministic — pick the first element so the test is not flaky.
        random: () => 0,
        sessionId: "session1",
        spawnDetached: () => {},
        stateDir,
      },
    );

    expect(result.source).toBe("fallback");
    expect(result.updated).toBe(true);
    expect(result.comment).toBeString();
    expect(result.comment?.length ?? 0).toBeGreaterThan(0);
    const onDisk = JSON.parse(
      readFileSync(join(stateDir, "reaction.session1.json"), "utf8"),
    );
    expect(onDisk.source).toBe("fallback");
    expect(onDisk.reaction).toBe(result.comment);
    expect(onDisk.reason).toBe("turn");
  });
});
