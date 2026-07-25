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

    expect(result).toEqual({ comment: "ship it", updated: true });
    expect(JSON.parse(readFileSync(join(stateDir, "reaction.session1.json"), "utf8"))).toEqual({
      reaction: "ship it",
      timestamp: 1_700_000_000_123,
      reason: "turn",
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

    expect(result).toEqual({ updated: false });
    expect(existsSync(join(stateDir, "reaction.default.json"))).toBe(false);
  });

  test("exits silently when the state directory is missing", () => {
    const stateDir = join(tmpdir(), `coding-buddy-missing-${Date.now()}`);

    const result = handleBuddyComment(
      JSON.stringify({ last_assistant_message: "<!-- buddy: hidden -->" }),
      { stateDir },
    );

    expect(result).toEqual({ updated: false });
    expect(existsSync(stateDir)).toBe(false);
  });
});
