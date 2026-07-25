import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const temporaryDirectories: string[] = [];
const statuslineScript = join(import.meta.dir, "buddy-status.sh");

function createStatuslineFixture(config: Record<string, unknown>) {
  const configDir = mkdtempSync(join(tmpdir(), "coding-buddy-substatus-"));
  temporaryDirectories.push(configDir);
  const stateDir = join(configDir, "buddy-state");
  mkdirSync(stateDir);
  writeFileSync(join(stateDir, "config.json"), JSON.stringify(config));
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
  return { configDir, stateDir };
}

function runStatusline(configDir: string, input = "{}\n") {
  return spawnSync("bash", [statuslineScript], {
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
}

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const attempts = Math.ceil(timeoutMs / 50);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (condition()) return;
    await Bun.sleep(50);
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

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
    const { configDir, stateDir } = createStatuslineFixture({
      subStatusCommand: "sleep 1; cat",
    });

    const input = '{"payload":"same-input"}\n';
    const started = performance.now();
    const first = runStatusline(configDir, input);
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
    const second = runStatusline(configDir, input);

    expect(second.stdout.toString()).toContain(input.trim());
  });

  test("uses one temp path and cleans it up after a failed refresh", async () => {
    const { configDir, stateDir } = createStatuslineFixture({
      subStatusCommand: "sleep 1; exit 1",
    });
    const tempFile = join(stateDir, ".substatus.default.tmp");
    const lockDir = join(stateDir, ".substatus.default.lock");

    expect(runStatusline(configDir).status).toBe(0);
    await waitFor(() => existsSync(tempFile));
    expect(readdirSync(stateDir).filter((name) => name.startsWith(".substatus.default.")).sort())
      .toEqual([".substatus.default.lock", ".substatus.default.tmp"]);

    await waitFor(() => !existsSync(tempFile) && !existsSync(lockDir));
    expect(existsSync(tempFile)).toBe(false);
    expect(readdirSync(stateDir).filter((name) => name.startsWith(".substatus.default.")).sort())
      .toEqual([]);
  });

  test("sweeps old temp files without deleting the cache or lock", () => {
    const { configDir, stateDir } = createStatuslineFixture({});
    const cacheFile = join(stateDir, ".substatus.default");
    const staleTemp = join(stateDir, ".substatus.default.old");
    const lockDir = join(stateDir, ".substatus.default.lock");
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);

    writeFileSync(cacheFile, "cached\n");
    writeFileSync(staleTemp, "orphan\n");
    mkdirSync(lockDir);
    utimesSync(staleTemp, oldDate, oldDate);

    expect(runStatusline(configDir).status).toBe(0);
    expect(existsSync(staleTemp)).toBe(false);
    expect(readFileSync(cacheFile, "utf8")).toBe("cached\n");
    expect(existsSync(lockDir)).toBe(true);
  });

  test("uses the 15-second default and honors a numeric TTL override", async () => {
    const { configDir, stateDir } = createStatuslineFixture({
      subStatusCommand: "printf refreshed",
      subStatusRefreshSeconds: "invalid",
    });
    const cacheFile = join(stateDir, ".substatus.default");
    const oldDate = new Date(Date.now() - 10 * 1000);
    writeFileSync(cacheFile, "cached\n");
    utimesSync(cacheFile, oldDate, oldDate);

    expect(runStatusline(configDir).status).toBe(0);
    await Bun.sleep(200);
    expect(readFileSync(cacheFile, "utf8")).toBe("cached\n");

    writeFileSync(join(stateDir, "config.json"), JSON.stringify({
      subStatusCommand: "printf refreshed",
      subStatusRefreshSeconds: 5,
    }));
    expect(runStatusline(configDir).status).toBe(0);
    await waitFor(() => readFileSync(cacheFile, "utf8") === "refreshed");
  });
});
