import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buddy statusline colors", () => {
  test("uses rarity color for the name and stars, not the art", () => {
    const configDir = mkdtempSync(join(tmpdir(), "coding-buddy-statusline-"));
    temporaryDirectories.push(configDir);
    const stateDir = join(configDir, "buddy-state");
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, "config.json"), JSON.stringify({ theme: "dark" }));
    writeFileSync(join(stateDir, "status.json"), JSON.stringify({
      name: "Nimbus",
      rarity: "uncommon",
      stars: "★★",
      shiny: false,
      reaction: "",
      achievement: "",
      level: 1,
      mood: "focused",
      frames: ["  art\n (°°)"],
      frameSequence: [0],
    }));

    const result = Bun.spawnSync(["bash", join(import.meta.dir, "buddy-status.sh")], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_SESSION_ID: "",
        TMUX_PANE: "",
        BUDDY_FAKE_NOW: "0",
        COLUMNS: "80",
        BUDDY_SHELL: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = result.stdout.toString();
    const green = "\x1b[38;2;78;186;101m";
    const greenLines = output.split("\n").filter((line) => line.includes(green));

    expect(result.exitCode).toBe(0);
    expect(greenLines).toHaveLength(1);
    expect(greenLines[0]).toContain("Nimbus ★★");
    expect(output).not.toContain(`${green}  art`);
    expect(output).not.toContain(`${green} (°°)`);
  });
});

describe("buddy sub-status cache", () => {
  test("returns immediately and refreshes the cache with the same stdin payload", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "coding-buddy-substatus-"));
    temporaryDirectories.push(configDir);
    const stateDir = join(configDir, "buddy-state");
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, "config.json"), JSON.stringify({
      subStatusCommand: "sleep 1; cat",
    }));
    writeFileSync(join(stateDir, "status.json"), JSON.stringify({
      name: "Nimbus",
      rarity: "common",
      stars: "",
      shiny: false,
      reaction: "",
      achievement: "",
      level: 1,
      mood: "focused",
      frames: ["  art"],
      frameSequence: [0],
    }));

    const input = '{"payload":"same-input"}\n';
    const started = performance.now();
    const first = spawnSync("bash", [join(import.meta.dir, "buddy-status.sh")], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_SESSION_ID: "",
        TMUX_PANE: "",
        BUDDY_FAKE_NOW: "0",
        COLUMNS: "80",
        BUDDY_SHELL: "",
      },
      input,
      stdout: "pipe",
      stderr: "pipe",
    });
    const elapsedMs = performance.now() - started;

    expect(first.status).toBe(0);
    // Includes launching a fresh bash process; the one-second sub-command is
    // intentionally not part of this wall-clock measurement.
    expect(elapsedMs).toBeLessThan(1500);
    expect(existsSync(join(stateDir, ".substatus.default"))).toBe(false);

    for (let attempt = 0; attempt < 30; attempt++) {
      if (Bun.file(join(stateDir, ".substatus.default")).size > 0) break;
      await Bun.sleep(100);
    }

    expect(readFileSync(join(stateDir, ".substatus.default"), "utf8").trim()).toBe(input.trim());
    await Bun.sleep(200);
    const second = spawnSync("bash", [join(import.meta.dir, "buddy-status.sh")], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_SESSION_ID: "",
        TMUX_PANE: "",
        BUDDY_FAKE_NOW: "0",
        COLUMNS: "80",
        BUDDY_SHELL: "",
      },
      input,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(second.stdout.toString()).toContain(input.trim());
  });
});
