import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { FileBuddyStorage } from "./file-storage.ts";
import type { BuddyBones } from "../../core/engine.ts";
import type { Companion } from "../../core/model.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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
  test("concurrent saveSlot and saveActiveSlot calls do not lose companions", async () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-slot-concurrency-"));
    temporaryDirectories.push(parent);
    const stateDir = join(parent, "state");
    mkdirSync(stateDir, { recursive: true });
    const storage = new FileBuddyStorage(stateDir);

    const fileStoragePath = join(import.meta.dir, "file-storage.ts");
    const modelPath = join(import.meta.dir, "../../core/model.ts");
    const enginePath = join(import.meta.dir, "../../core/engine.ts");

    const workerPath = join(parent, "slot-worker.ts");
    const workerCode =
      `import { FileBuddyStorage } from "${fileStoragePath}";\n` +
      `import type { BuddyBones } from "${enginePath}";\n` +
      `import type { Companion } from "${modelPath}";\n` +
      "const stateDir = process.argv[2];\n" +
      "const workerIndex = process.argv[3];\n" +
      "const slotCount = Number(process.argv[4]);\n" +
      "const storage = new FileBuddyStorage(stateDir);\n" +
      "const bones: BuddyBones = { rarity: 'common', species: 'duck', eye: '°', hat: 'none', shiny: false, stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 }, peak: 'DEBUGGING', dump: 'PATIENCE' };\n" +
      "for (let i = 0; i < slotCount; i++) {\n" +
      "  const slot = `${workerIndex}-${i}`;\n" +
      "  const companion: Companion = { bones, name: `updated-${workerIndex}-${i}`, personality: 'test', hatchedAt: 0, userId: `u-${workerIndex}-${i}` };\n" +
      "  storage.saveSlot(slot, companion);\n" +
      "  storage.saveActiveSlot(slot);\n" +
      "}\n";
    writeFileSync(workerPath, workerCode, "utf8");

    const workers = 4;
    const slotCount = 5;
    const children: Promise<void>[] = [];
    for (let i = 0; i < workers; i++) {
      children.push(
        new Promise<void>((resolve, reject) => {
          const child = spawn("bun", ["run", workerPath, stateDir, String(i), String(slotCount)], { stdio: "ignore" });
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Worker ${i} exited with code ${code}`))));
          child.on("error", reject);
        }),
      );
    }
    await Promise.all(children);

    const slots = storage.listSlots();
    expect(slots.length).toBe(workers * slotCount);
    for (let i = 0; i < workers; i++) {
      for (let j = 0; j < slotCount; j++) {
        const slot = `${i}-${j}`;
        const companion = storage.loadSlot(slot);
        expect(companion).not.toBeNull();
        expect(companion?.name).toBe(`updated-${i}-${j}`);
      }
    }
  });

  test("concurrent saveActive calls do not corrupt the active slot", async () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-save-active-concurrency-"));
    temporaryDirectories.push(parent);
    const stateDir = join(parent, "state");
    mkdirSync(stateDir, { recursive: true });
    const storage = new FileBuddyStorage(stateDir);

    const fileStoragePath = join(import.meta.dir, "file-storage.ts");
    const modelPath = join(import.meta.dir, "../../core/model.ts");
    const enginePath = join(import.meta.dir, "../../core/engine.ts");

    const workerPath = join(parent, "save-active-worker.ts");
    const workerCode =
      `import { FileBuddyStorage } from "${fileStoragePath}";\n` +
      `import type { BuddyBones } from "${enginePath}";\n` +
      `import type { Companion } from "${modelPath}";\n` +
      "const stateDir = process.argv[2];\n" +
      "const workerIndex = process.argv[3];\n" +
      "const storage = new FileBuddyStorage(stateDir);\n" +
      "const bones: BuddyBones = { rarity: 'common', species: 'duck', eye: '°', hat: 'none', shiny: false, stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 }, peak: 'DEBUGGING', dump: 'PATIENCE' };\n" +
      "const companion: Companion = { bones, name: `worker-${workerIndex}`, personality: 'test', hatchedAt: 0, userId: `u-${workerIndex}` };\n" +
      "storage.saveActive(companion);\n";
    writeFileSync(workerPath, workerCode, "utf8");

    const bones: BuddyBones = { rarity: 'common', species: 'duck', eye: '°', hat: 'none', shiny: false, stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 }, peak: 'DEBUGGING', dump: 'PATIENCE' };
    const seed: Companion = { bones, name: "seed", personality: "seed", hatchedAt: 0, userId: "seed" };
    storage.saveSlot("buddy", seed);
    storage.saveActiveSlot("buddy");

    const workers = 6;
    const children: Promise<void>[] = [];
    for (let i = 0; i < workers; i++) {
      children.push(
        new Promise<void>((resolve, reject) => {
          const child = spawn("bun", ["run", workerPath, stateDir, String(i)], { stdio: "ignore" });
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Worker ${i} exited with code ${code}`))));
          child.on("error", reject);
        }),
      );
    }
    await Promise.all(children);

    const slots = storage.listSlots();
    expect(slots.length).toBe(1);
    const active = storage.loadActive();
    expect(active).not.toBeNull();
    const expectedNames = new Set<string>();
    for (let i = 0; i < workers; i++) expectedNames.add(`worker-${i}`);
    expect(expectedNames.has(active!.name)).toBe(true);
  });
  test("concurrent ensureStableIdentity calls agree on a single id", async () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-identity-concurrency-"));
    temporaryDirectories.push(parent);
    const stateDir = join(parent, "state");
    mkdirSync(stateDir, { recursive: true });

    const fileStoragePath = join(import.meta.dir, "file-storage.ts");
    const workerPath = join(parent, "identity-worker.ts");
    const workerCode =
      `import { FileBuddyStorage } from "${fileStoragePath}";\n` +
      "const stateDir = process.argv[2];\n" +
      "const storage = new FileBuddyStorage(stateDir);\n" +
      "const id = storage.ensureStableIdentity();\n" +
      "process.stdout.write(id + '\\n');\n";
    writeFileSync(workerPath, workerCode, "utf8");

    const workers = 6;
    const outputs: string[] = [];
    const children: Promise<void>[] = [];
    for (let i = 0; i < workers; i++) {
      children.push(
        new Promise<void>((resolve, reject) => {
          let out = "";
          const child = spawn("bun", ["run", workerPath, stateDir], { stdio: ["ignore", "pipe", "ignore"] });
          child.stdout!.on("data", (data) => { out += data.toString(); });
          child.on("exit", (code) => {
            if (code === 0) {
              outputs.push(out.trim());
              resolve();
            } else {
              reject(new Error(`Worker ${i} exited with code ${code}`));
            }
          });
          child.on("error", reject);
        }),
      );
    }
    await Promise.all(children);

    const storage = new FileBuddyStorage(stateDir);
    const identity = storage.ensureStableIdentity();
    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toBe(identity);
  });
  test("lock acquisition cleans up unique temp files after contention", async () => {
    const parent = mkdtempSync(join(tmpdir(), "buddy-lock-cleanup-"));
    temporaryDirectories.push(parent);
    const stateDir = join(parent, "state");
    mkdirSync(stateDir, { recursive: true });

    const workerPath = join(parent, "cleanup-worker.ts");
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

    const storage = new FileBuddyStorage(stateDir);
    expect(storage.loadCounters().commands_run).toBe(workers * increments);

    const leftovers = readdirSync(stateDir).filter((name) => name.startsWith(".lock-"));
    expect(leftovers).toEqual([]);
  });
});
