import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, type Stats, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_GLOBAL,
  EMPTY_SLOT,
  GLOBAL_KEYS,
  SLOT_KEYS,
  type GlobalCounters,
  type SlotCounters,
} from "../../core/achievements.ts";
import type {
  BuddyConfig,
  Companion,
  EventCounters,
  ReactionState,
  UnlockedAchievement,
} from "../../core/model.ts";
import type {
  BuddyConfigRepository,
  BuddyEventRepository,
  BuddyRepository,
  ReactionRepository,
} from "../../core/ports.ts";

export interface FileBuddyConfig extends BuddyConfig {
  muted: boolean;
}

interface MenagerieManifest {
  active: string;
  companions: Record<string, Companion>;
}

interface ActiveDayState {
  lastDate: string;
  totalDays: number;
}

export const DEFAULT_FILE_BUDDY_CONFIG: FileBuddyConfig = {
  commentCooldown: 30,
  reactionTTL: 0,
  bubbleStyle: "classic",
  bubblePosition: "top",
  showRarity: true,
  statusLineEnabled: true,
  turnCommentModel: undefined,
  muted: false,
};

function isSlotKey(key: keyof EventCounters): key is keyof SlotCounters {
  return (SLOT_KEYS as readonly string[]).includes(key);
}

function isGlobalKey(key: keyof EventCounters): key is keyof GlobalCounters {
  return (GLOBAL_KEYS as readonly string[]).includes(key);
}
function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
  );
}
function sleepMs(ms: number): void {
  const target = Date.now() + ms;
  while (Date.now() < target) {}
}
const LOCK_STALE_MS = 3000;

function parseOwner(content: string): { pid?: number; token?: string } {
  const raw = content.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        pid: Number(parsed.pid),
        token: typeof parsed.token === "string" ? parsed.token : undefined,
      };
    }
  } catch {
    // Legacy plain-number owner file.
  }
  const pid = Number(raw);
  return Number.isFinite(pid) ? { pid } : {};
}


export class FileBuddyStorage
  implements BuddyRepository, ReactionRepository, BuddyConfigRepository, BuddyEventRepository
{
  private heldLock: { depth: number; token: string } | null = null;

  constructor(
    readonly stateDir: string,
    private readonly defaultConfig: FileBuddyConfig = DEFAULT_FILE_BUDDY_CONFIG,
  ) {}

  private path(name: string): string {
    return join(this.stateDir, name);
  }

  private ensureDir(): void {
    if (!existsSync(this.stateDir)) mkdirSync(this.stateDir, { recursive: true });
  }

  private atomicWrite(path: string, value: string): void {
    this.ensureDir();
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, value, "utf8");
    renameSync(temporaryPath, path);
  }

  private acquireLock(): void {
    if (this.heldLock) {
      this.heldLock.depth++;
      return;
    }
    this.ensureDir();
    const lockFile = this.path(".lock");
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const token = randomUUID();
      const uniqueFile = this.path(`.lock-${process.pid}-${token}`);
      try {
        const owner = JSON.stringify({ pid: process.pid, token });
        writeFileSync(uniqueFile, owner, { mode: 0o600, encoding: "utf8" });
        const fd = openSync(uniqueFile, "r");
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        try {
          linkSync(uniqueFile, lockFile);
        } finally {
          try {
            unlinkSync(uniqueFile);
          } catch {}
        }
        this.heldLock = { depth: 1, token };
        return;
      } catch (err) {
        if (!isNodeError(err)) throw err;
        if (err.code === "EEXIST" || err.code === "ENOTEMPTY" || err.code === "EISDIR" || err.code === "EPERM") {
          if (this.isLockStale(lockFile)) {
            this.removeLock(lockFile);
          }
          sleepMs(5);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Could not acquire buddy lock for ${this.stateDir}`);
  }

  private isLockStale(lockPath: string): boolean {
    let info: Stats;
    try {
      info = statSync(lockPath);
    } catch {
      return false;
    }
    const ownerPath = info.isDirectory() ? join(lockPath, "owner") : lockPath;
    let raw = "";
    try {
      raw = readFileSync(ownerPath, "utf8");
    } catch (err) {
      if (!isNodeError(err) || err.code !== "ENOENT") return false;
      let mtime: Date;
      try {
        mtime = statSync(ownerPath).mtime;
      } catch {
        try {
          mtime = info.mtime;
        } catch {
          return false;
        }
      }
      return Date.now() - mtime.getTime() > LOCK_STALE_MS;
    }
    const owner = parseOwner(raw);
    const pid = owner.pid;
    if (typeof pid !== "number" || pid <= 1 || !Number.isFinite(pid)) {
      let mtime: Date;
      try {
        mtime = statSync(ownerPath).mtime;
      } catch {
        return false;
      }
      return Date.now() - mtime.getTime() > LOCK_STALE_MS;
    }
    try {
      process.kill(pid, 0);
      return false;
    } catch (err) {
      if (isNodeError(err) && err.code === "EPERM") return false;
      return true;
    }
  }

  private removeLock(lockPath: string): void {
    try {
      const info = statSync(lockPath);
      if (info.isDirectory()) {
        rmSync(lockPath, { recursive: true, force: true });
      } else {
        unlinkSync(lockPath);
      }
    } catch {}
  }

  private releaseLock(): void {
    if (!this.heldLock) return;
    if (--this.heldLock.depth > 0) return;
    const { token } = this.heldLock;
    this.heldLock = null;
    const lockFile = this.path(".lock");
    let ownerPath = lockFile;
    try {
      const info = statSync(lockFile);
      if (info.isDirectory()) {
        ownerPath = join(lockFile, "owner");
      }
    } catch {
      // Lock is already gone; nothing to release.
      return;
    }
    try {
      const owner = parseOwner(readFileSync(ownerPath, "utf8"));
      if (owner.token && owner.token !== token) return;
    } catch {
      // Owner missing or unreadable; do not risk removing someone else's lock.
      return;
    }
    this.removeLock(lockFile);
  }

  private withLock<T>(operation: () => T): T {
    this.acquireLock();
    try { return operation(); } finally { this.releaseLock(); }
  }

  private readJson<T extends object>(path: string, fallback: T): T {
    try {
      return { ...fallback, ...JSON.parse(readFileSync(path, "utf8")) };
    } catch {
      return { ...fallback };
    }
  }

  private loadManifest(): MenagerieManifest {
    const manifest = this.readJson<MenagerieManifest>(this.path("menagerie.json"), {
      active: "buddy",
      companions: {},
    });
    if (!manifest.companions) manifest.companions = {};
    if (!manifest.active) manifest.active = Object.keys(manifest.companions)[0] ?? "buddy";
    return manifest;
  }

  private saveManifest(manifest: MenagerieManifest): void {
    this.atomicWrite(this.path("menagerie.json"), JSON.stringify(manifest, null, 2));
  }


  private slotEventsFile(slot: string): string {
    return this.path(`events.${slot}.json`);
  }

  loadActive(): Companion | null {
    const manifest = this.loadManifest();
    return manifest.companions[manifest.active] ?? null;
  }

  saveActive(companion: Companion): void {
    this.withLock(() => {
      const manifest = this.loadManifest();
      manifest.companions[manifest.active] = companion;
      this.saveManifest(manifest);
    });
  }

  loadSlot(slot: string): Companion | null {
    return this.loadManifest().companions[slot] ?? null;
  }

  saveSlot(slot: string, companion: Companion): void {
    this.withLock(() => {
      const manifest = this.loadManifest();
      if (manifest.companions[slot]) throw new Error(`Slot "${slot}" already exists.`);
      manifest.companions[slot] = companion;
      this.saveManifest(manifest);
    });
  }

  deleteSlot(slot: string): void {
    this.withLock(() => {
      const manifest = this.loadManifest();
      delete manifest.companions[slot];
      if (manifest.active === slot) {
        manifest.active = Object.keys(manifest.companions)[0] ?? "buddy";
      }
      this.saveManifest(manifest);
    });
  }

  listSlots(): Array<{ slot: string; companion: Companion }> {
    return Object.entries(this.loadManifest().companions).map(([slot, companion]) => ({
      slot,
      companion,
    }));
  }

  loadActiveSlot(): string | null {
    const manifest = this.loadManifest();
    if (manifest.active && manifest.companions[manifest.active]) return manifest.active;
    return Object.keys(manifest.companions)[0] ?? null;
  }

  saveActiveSlot(slot: string): void {
    this.withLock(() => {
      const manifest = this.loadManifest();
      manifest.active = slot;
      this.saveManifest(manifest);
    });
  }

  loadLatest(): ReactionState | null {
    try {
      const reaction = JSON.parse(readFileSync(this.path("reaction.json"), "utf8")) as ReactionState;
      const ttl = this.loadHostConfig().reactionTTL;
      if (ttl > 0 && Date.now() - reaction.timestamp > ttl * 1000) return null;
      return reaction;
    } catch {
      return null;
    }
  }

  saveLatest(reaction: ReactionState): void {
    this.atomicWrite(this.path("reaction.json"), JSON.stringify(reaction, null, 2));
  }

  clearLatestReaction(): void {
    this.saveLatest({ reaction: "", reason: "clear", timestamp: Date.now() });
  }

  loadConfig(): BuddyConfig {
    return this.loadHostConfig();
  }

  saveConfig(config: Partial<BuddyConfig>): BuddyConfig {
    return this.saveHostConfig(config);
  }

  loadHostConfig(): FileBuddyConfig {
    return this.readJson<FileBuddyConfig>(this.path("config.json"), this.defaultConfig);
  }

  saveHostConfig(config: Partial<FileBuddyConfig>): FileBuddyConfig {
    const merged = { ...this.loadHostConfig(), ...config };
    this.atomicWrite(this.path("config.json"), JSON.stringify(merged, null, 2));
    return merged;
  }

  isMuted(): boolean {
    return this.loadHostConfig().muted;
  }

  setMuted(muted: boolean): FileBuddyConfig {
    return this.saveHostConfig({ muted });
  }

  loadCounters(slot?: string): EventCounters {
    const global = this.readJson<GlobalCounters>(this.path("events.json"), EMPTY_GLOBAL);
    if (!slot) return { ...global, ...EMPTY_SLOT };
    const slotCounters = this.readJson<SlotCounters>(this.slotEventsFile(slot), EMPTY_SLOT);
    return { ...global, ...slotCounters };
  }

  increment(key: keyof EventCounters, amount = 1, slot?: string): EventCounters {
    return this.withLock(() => {
      if (isSlotKey(key) && slot) {
        const slotCounters = this.readJson<SlotCounters>(this.slotEventsFile(slot), EMPTY_SLOT);
        slotCounters[key] += amount;
        this.atomicWrite(this.slotEventsFile(slot), JSON.stringify(slotCounters, null, 2));
      } else if (isGlobalKey(key)) {
        const global = this.readJson<GlobalCounters>(this.path("events.json"), EMPTY_GLOBAL);
        global[key] += amount;
        this.atomicWrite(this.path("events.json"), JSON.stringify(global, null, 2));
      }
      return this.loadCounters(slot);
    });
  }

  loadUnlocked(): UnlockedAchievement[] {
    try {
      return JSON.parse(readFileSync(this.path("unlocked.json"), "utf8")) as UnlockedAchievement[];
    } catch {
      return [];
    }
  }

  saveUnlocked(unlocked: UnlockedAchievement[]): void {
    this.atomicWrite(this.path("unlocked.json"), JSON.stringify(unlocked, null, 2));
  }

  trackActiveDay(): void {
    this.withLock(() => {
      const today = new Date().toISOString().slice(0, 10);
      const current = this.readJson<ActiveDayState>(this.path("active_days.json"), {
        lastDate: "",
        totalDays: 0,
      });
      if (current.lastDate === today) return;

      const next = { lastDate: today, totalDays: current.totalDays + 1 };
      this.atomicWrite(this.path("active_days.json"), JSON.stringify(next, null, 2));

      const global = this.readJson<GlobalCounters>(this.path("events.json"), EMPTY_GLOBAL);
      global.days_active = next.totalDays;
      this.atomicWrite(this.path("events.json"), JSON.stringify(global, null, 2));
    });
  }

  ensureStableIdentity(): string {
    return this.withLock(() => {
      this.ensureDir();
      try {
        const parsed = JSON.parse(readFileSync(this.path("identity.json"), "utf8")) as {
          userId?: string;
        };
        if (parsed.userId) return parsed.userId;
      } catch {
        // Create a stable identity below.
      }

      const userId = randomUUID();
      this.atomicWrite(this.path("identity.json"), JSON.stringify({ userId }, null, 2));
      return userId;
    });
  }
}

export function slugifySlot(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 14) || "buddy"
  );
}
