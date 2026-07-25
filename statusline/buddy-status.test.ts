import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
