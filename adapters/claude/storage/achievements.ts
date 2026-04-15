/**
 * Claude-backed achievement storage and rendering.
 *
 * Pure achievement definitions and threshold logic live in core/achievements.ts.
 * This adapter persists counters and unlocked state under ~/.claude-buddy/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  ACHIEVEMENTS,
  EMPTY_GLOBAL,
  EMPTY_SLOT,
  GLOBAL_KEYS,
  SLOT_KEYS,
  getUnlockedAchievements,
  type Achievement,
  type EventCounters,
  type GlobalCounters,
  type SlotCounters,
} from "../../../core/achievements.ts";
import type { UnlockedAchievement } from "../../../core/model.ts";

const STATE_DIR = join(homedir(), ".claude-buddy");
const EVENTS_FILE = join(STATE_DIR, "events.json");
const DAYS_FILE = join(STATE_DIR, "active_days.json");
const UNLOCKED_FILE = join(STATE_DIR, "unlocked.json");

function slotEventsFile(slot: string): string {
  return join(STATE_DIR, `events.${slot}.json`);
}

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function atomicWrite(path: string, data: string): void {
  ensureDir();
  const tmp = path + ".tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function loadGlobalEvents(): GlobalCounters {
  try {
    const parsed = JSON.parse(readFileSync(EVENTS_FILE, "utf8"));
    return { ...EMPTY_GLOBAL, ...parsed };
  } catch {
    return { ...EMPTY_GLOBAL };
  }
}

export function saveGlobalEvents(events: GlobalCounters): void {
  atomicWrite(EVENTS_FILE, JSON.stringify(events, null, 2));
}

export function loadSlotEvents(slot: string): SlotCounters {
  try {
    const parsed = JSON.parse(readFileSync(slotEventsFile(slot), "utf8"));
    return { ...EMPTY_SLOT, ...parsed };
  } catch {
    return { ...EMPTY_SLOT };
  }
}

export function saveSlotEvents(slot: string, events: SlotCounters): void {
  atomicWrite(slotEventsFile(slot), JSON.stringify(events, null, 2));
}

export function loadEvents(slot?: string): EventCounters {
  const global = loadGlobalEvents();
  if (!slot) {
    return { ...global, pets: 0, reactions_given: 0 };
  }
  const slotEvents = loadSlotEvents(slot);
  return {
    ...global,
    pets: slotEvents.pets,
    reactions_given: slotEvents.reactions_given,
  };
}

function isSlotKey(key: keyof EventCounters): key is keyof SlotCounters {
  return (SLOT_KEYS as readonly string[]).includes(key);
}

function isGlobalKey(key: keyof EventCounters): key is keyof GlobalCounters {
  return (GLOBAL_KEYS as readonly string[]).includes(key);
}

export function incrementEvent(
  key: keyof EventCounters,
  amount: number = 1,
  slot?: string,
): EventCounters {
  if (isSlotKey(key) && slot) {
    const slotEvents = loadSlotEvents(slot);
    slotEvents[key] += amount;
    saveSlotEvents(slot, slotEvents);
  } else {
    const global = loadGlobalEvents();
    if (isGlobalKey(key)) {
      global[key] += amount;
    }
    saveGlobalEvents(global);
  }
  return loadEvents(slot);
}

export { loadEvents as loadGlobalEventsCompat, loadGlobalEvents as loadGlobalEventsDirect };

interface DayTracker {
  lastDate: string;
  totalDays: number;
}

export function trackActiveDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  let tracker: DayTracker;
  try {
    tracker = JSON.parse(readFileSync(DAYS_FILE, "utf8"));
  } catch {
    tracker = { lastDate: "", totalDays: 0 };
  }
  if (tracker.lastDate === today) return;

  tracker.lastDate = today;
  tracker.totalDays += 1;
  atomicWrite(DAYS_FILE, JSON.stringify(tracker, null, 2));

  const events = loadGlobalEvents();
  events.days_active = tracker.totalDays;
  saveGlobalEvents(events);
}

export function loadUnlocked(): UnlockedAchievement[] {
  try {
    return JSON.parse(readFileSync(UNLOCKED_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function saveUnlocked(unlocked: UnlockedAchievement[]): void {
  atomicWrite(UNLOCKED_FILE, JSON.stringify(unlocked, null, 2));
}

export function checkAndAward(slot?: string): Achievement[] {
  const events = loadEvents(slot);
  const unlocked = loadUnlocked();
  const unlockedIds = new Set(unlocked.map((u) => u.id));

  const newlyUnlocked = getUnlockedAchievements(events, unlockedIds);
  if (newlyUnlocked.length > 0) {
    unlocked.push(
      ...newlyUnlocked.map((ach) => ({
        id: ach.id,
        unlockedAt: Date.now(),
        slot: slot ?? undefined,
      })),
    );
    saveUnlocked(unlocked);
  }

  return newlyUnlocked;
}

const GOLD = "\x1b[38;2;255;193;7m";
const NC = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export function renderAchievementsCard(): string {
  const unlocked = loadUnlocked();
  const unlockedIds = new Set(unlocked.map((u) => u.id));

  const W = 40;
  const hr = "─".repeat(W - 2);
  const sep = `├${"╌".repeat(W - 2)}┤`;
  const lines: string[] = [];

  const total = ACHIEVEMENTS.length;
  const earned = unlockedIds.size;

  lines.push(`${GOLD}╭${hr}╮${NC}`);

  const header = "🏆 ACHIEVEMENTS";
  lines.push(`${GOLD}│${NC}  ${BOLD}${header}${NC}${"".padEnd(W - header.length - 4)}${GOLD}│${NC}`);

  const barFilled = total > 0 ? Math.round((earned / total) * 20) : 0;
  const bar = "█".repeat(barFilled) + "░".repeat(20 - barFilled);
  const barText = `${bar} ${earned}/${total}`;
  lines.push(`${GOLD}│${NC}  ${barText}${"".padEnd(W - barText.length - 4)}${GOLD}│${NC}`);

  lines.push(`${GOLD}${sep}${NC}`);

  for (const ach of ACHIEVEMENTS) {
    if (ach.secret && !unlockedIds.has(ach.id)) continue;

    const done = unlockedIds.has(ach.id);
    const status = done ? "✅" : "☐";
    const content = ` ${ach.icon}${status} ${ach.name}`;
    const descContent = `    ${ach.description}`;

    if (done) {
      lines.push(`${GOLD}│${NC} ${BOLD}${content}${NC}${"".padEnd(W - content.length - 3)}${GOLD}│${NC}`);
    } else {
      lines.push(`${GOLD}│${NC} ${DIM}${content}${NC}${"".padEnd(W - content.length - 3)}${GOLD}│${NC}`);
    }
    lines.push(`${GOLD}│${NC} ${DIM}${descContent}${NC}${"".padEnd(W - descContent.length - 3)}${GOLD}│${NC}`);
  }

  if (earned > 0 && earned === ACHIEVEMENTS.length) {
    lines.push(`${GOLD}${sep}${NC}`);
    const complete = "✨ ALL ACHIEVEMENTS UNLOCKED! ✨";
    lines.push(`${GOLD}│${NC}  ${BOLD}${complete}${NC}${"".padEnd(W - complete.length - 4)}${GOLD}│${NC}`);
  }

  lines.push(`${GOLD}╰${hr}╯${NC}`);

  return lines.join("\n");
}

export function renderAchievementsCardMarkdown(): string {
  const unlocked = loadUnlocked();
  const unlockedIds = new Set(unlocked.map((u) => u.id));
  const total = ACHIEVEMENTS.length;
  const earned = unlockedIds.size;

  const barFilled = total > 0 ? Math.round((earned / total) * 20) : 0;
  const bar = "█".repeat(barFilled) + "░".repeat(20 - barFilled);

  const parts: string[] = [];
  parts.push(`### 🏆 Achievements — ${earned}/${total}`);
  parts.push("");
  parts.push(`\`${bar}\``);
  parts.push("");

  for (const ach of ACHIEVEMENTS) {
    if (ach.secret && !unlockedIds.has(ach.id)) continue;
    const done = unlockedIds.has(ach.id);
    const status = done ? "✅" : "☐";
    parts.push(`${ach.icon}${status} **${ach.name}** — ${ach.description}`);
  }

  if (earned > 0 && earned === ACHIEVEMENTS.length) {
    parts.push("");
    parts.push("✨ **ALL ACHIEVEMENTS UNLOCKED!** ✨");
  }

  return parts.join("\n");
}
