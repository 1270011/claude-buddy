import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpBuddyStorage, DEFAULT_OMP_BUDDY_STATE_DIR } from "../omp/storage.ts";
import { PiBuddyStorage, DEFAULT_PI_BUDDY_STATE_DIR } from "../pi/storage.ts";
import { spawn } from "node:child_process";
import { FileBuddyStorage } from "./file-storage.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("host storage roots", () => {
  test("defaults Pi and OMP to distinct host-owned state directories", () => {
    expect(DEFAULT_PI_BUDDY_STATE_DIR.endsWith(join(".pi", "agent", "buddy"))).toBe(true);
    expect(DEFAULT_OMP_BUDDY_STATE_DIR.endsWith(join(".omp", "agent", "buddy"))).toBe(true);
    expect(DEFAULT_PI_BUDDY_STATE_DIR).not.toBe(DEFAULT_OMP_BUDDY_STATE_DIR);
  });

  test("reuses file storage behavior without sharing host state", () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-host-storage-"));
    temporaryDirectories.push(parent);
    const piRoot = join(parent, "pi");
    const ompRoot = join(parent, "omp");
    const piStorage = new PiBuddyStorage(piRoot);
    const ompStorage = new OmpBuddyStorage(ompRoot);

    piStorage.setMuted(true);
    ompStorage.setMuted(false);

    expect(piStorage.isMuted()).toBe(true);
    expect(ompStorage.isMuted()).toBe(false);
    expect(existsSync(join(piRoot, "config.json"))).toBe(true);
    expect(existsSync(join(ompRoot, "config.json"))).toBe(true);
  });
});

describe("cross-process locking", () => {
  test("concurrent same-root increments do not lose updates", async () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-lock-concurrency-"));
    temporaryDirectories.push(parent);
    const stateDir = join(parent, "state");
    mkdirSync(stateDir, { recursive: true });
    const storage = new FileBuddyStorage(stateDir);

    const workerPath = join(parent, "worker.ts");
    const workerCode = `import { FileBuddyStorage } from "${join(import.meta.dir, "file-storage.ts")}";\n` +
      "const stateDir = process.argv[2];\n" +
      "const count = Number(process.argv[3]);\n" +
      "const storage = new FileBuddyStorage(stateDir);\n" +
      "for (let i = 0; i < count; i++) storage.increment(\"commands_run\");\n";
    writeFileSync(workerPath, workerCode, "utf8");

    const workers = 4;
    const increments = 25;
    const children: Promise<void>[] = [];
    for (let i = 0; i < workers; i++) {
      children.push(
        new Promise<void>((resolve, reject) => {
          const child = spawn("bun", ["run", workerPath, stateDir, String(increments)], {
            stdio: "ignore",
          });
          child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Worker exited with code ${code}`));
          });
          child.on("error", reject);
        }),
      );
    }
    await Promise.all(children);

    expect(storage.loadCounters().commands_run).toBe(workers * increments);
  });

  test("concurrent increments in separate roots remain independent", async () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-lock-separate-roots-"));
    temporaryDirectories.push(parent);
    const piRoot = join(parent, "pi");
    const ompRoot = join(parent, "omp");
    mkdirSync(piRoot, { recursive: true });
    mkdirSync(ompRoot, { recursive: true });

    const workerPath = join(parent, "worker.ts");
    const workerCode = `import { FileBuddyStorage } from "${join(import.meta.dir, "file-storage.ts")}";\n` +
      "const stateDir = process.argv[2];\n" +
      "const count = Number(process.argv[3]);\n" +
      "const storage = new FileBuddyStorage(stateDir);\n" +
      "for (let i = 0; i < count; i++) storage.increment(\"commands_run\");\n";
    writeFileSync(workerPath, workerCode, "utf8");

    const workers = 3;
    const increments = 20;
    const runRoot = (root: string) =>
      Promise.all(
        Array.from({ length: workers }, () =>
          new Promise<void>((resolve, reject) => {
            const child = spawn("bun", ["run", workerPath, root, String(increments)], {
              stdio: "ignore",
            });
            child.on("exit", (code) => {
              if (code === 0) resolve();
              else reject(new Error(`Worker exited with code ${code}`));
            });
            child.on("error", reject);
          }),
        ),
      );

    await Promise.all([runRoot(piRoot), runRoot(ompRoot)]);

    const piStorage = new FileBuddyStorage(piRoot);
    const ompStorage = new FileBuddyStorage(ompRoot);
    expect(piStorage.loadCounters().commands_run).toBe(workers * increments);
    expect(ompStorage.loadCounters().commands_run).toBe(workers * increments);
  });

  test("recovers from a stale lock left by a dead process", () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-lock-stale-"));
    temporaryDirectories.push(parent);
    const stateDir = join(parent, "state");
    mkdirSync(stateDir, { recursive: true });
    const storage = new FileBuddyStorage(stateDir);

    writeFileSync(join(stateDir, ".lock"), "999999", "utf8");

    storage.increment("commands_run");

    expect(storage.loadCounters().commands_run).toBe(1);
  });
});
