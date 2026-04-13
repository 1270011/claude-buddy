/**
 * Achievement badges — milestones that unlock as you code with your buddy
 *
 * Event counters are split into two scopes:
 *   Global (events.json):      coding-activity counters (errors, tests, diffs, days, sessions, commands)
 *   Per-slot (events.<slot>.json): buddy-relationship counters (pets, turns, reactions)
 *
 * Achievement checks merge both scopes so threshold logic is transparent.
 * All writes use tmp+rename for atomicity (same pattern as state.ts).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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

// ─── Event counters (global) ─────────────────────────────────────────────────

export interface GlobalCounters {
  errors_seen: number;
  tests_failed: number;
  large_diffs: number;
  sessions: number;
  commands_run: number;
  days_active: number;
  turns: number;
}

// ─── Event counters (per-slot) ────────────────────────────────────────────────

export interface SlotCounters {
  pets: number;
  reactions_given: number;
}

// ─── Merged view for achievement checks ───────────────────────────────────────

export interface EventCounters extends GlobalCounters {
  pets: number;
  reactions_given: number;
}

export const GLOBAL_KEYS: (keyof GlobalCounters)[] = [
  "errors_seen", "tests_failed", "large_diffs",
  "sessions", "commands_run", "days_active", "turns",
];

export const SLOT_KEYS: (keyof SlotCounters)[] = [
  "pets", "reactions_given",
];

export const COUNTER_KEYS: (keyof EventCounters)[] = [
  "errors_seen", "tests_failed", "large_diffs", "turns", "pets",
  "sessions", "reactions_given", "commands_run", "days_active",
];

const EMPTY_GLOBAL: GlobalCounters = {
  errors_seen: 0, tests_failed: 0, large_diffs: 0,
  sessions: 0, commands_run: 0, days_active: 0, turns: 0,
};

const EMPTY_SLOT: SlotCounters = {
  pets: 0, reactions_given: 0,
};

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

export function incrementEvent(key: keyof EventCounters, amount: number = 1, slot?: string): EventCounters {
  if ((SLOT_KEYS as string[]).includes(key) && slot) {
    const slotEvents = loadSlotEvents(slot);
    (slotEvents as any)[key] += amount;
    saveSlotEvents(slot, slotEvents);
  } else {
    const global = loadGlobalEvents();
    if ((GLOBAL_KEYS as string[]).includes(key)) {
      (global as any)[key] += amount;
    }
    saveGlobalEvents(global);
  }
  return loadEvents(slot);
}

// ─── Backward-compatible overloads ────────────────────────────────────────────
// The shell hooks (react.sh) write directly to events.json for global counters
// like errors_seen and tests_failed. The loadEvents() and saveEvents() names
// below maintain that compatibility.

export { loadEvents as loadGlobalEventsCompat, loadGlobalEvents as loadGlobalEventsDirect };

// ─── Day tracking ────────────────────────────────────────────────────────────

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

// ─── Achievement definitions ─────────────────────────────────────────────────

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  check: (events: EventCounters) => boolean;
  secret: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_steps",
    name: "First Steps",
    description: "Hatch your buddy for the first time",
    icon: "\ud83c\udf1f",
    check: () => true,
    secret: false,
  },
  {
    id: "good_boy",
    name: "Good Buddy",
    description: "Pet your companion 10 times",
    icon: "\ud83e\uddf9",
    check: (e) => e.pets >= 10,
    secret: false,
  },
  {
    id: "best_friend",
    name: "Best Friend",
    description: "Pet your companion 50 times",
    icon: "\u2764\ufe0f",
    check: (e) => e.pets >= 50,
    secret: false,
  },
  {
    id: "bug_spotter",
    name: "Bug Spotter",
    description: "Witness your first error together",
    icon: "\ud83d\udc1b",
    check: (e) => e.errors_seen >= 1,
    secret: false,
  },
  {
    id: "error_whisperer",
    name: "Error Whisperer",
    description: "Survive 25 errors as a team",
    icon: "\ud83d\udd27",
    check: (e) => e.errors_seen >= 25,
    secret: false,
  },
  {
    id: "battle_scarred",
    name: "Battle-Scarred",
    description: "Survive 100 errors together",
    icon: "\ud83d\udc80",
    check: (e) => e.errors_seen >= 100,
    secret: true,
  },
  {
    id: "test_witness",
    name: "Test Witness",
    description: "See your first test failure",
    icon: "\u274c",
    check: (e) => e.tests_failed >= 1,
    secret: false,
  },
  {
    id: "test_veteran",
    name: "Test Veteran",
    description: "Witness 50 test failures",
    icon: "\ud83d\udcca",
    check: (e) => e.tests_failed >= 50,
    secret: false,
  },
  {
    id: "big_mover",
    name: "Big Mover",
    description: "Make a diff with 80+ lines",
    icon: "\ud83d\udce6",
    check: (e) => e.large_diffs >= 1,
    secret: false,
  },
  {
    id: "refactor_machine",
    name: "Refactor Machine",
    description: "Make 10 large diffs",
    icon: "\ud83d\udd28",
    check: (e) => e.large_diffs >= 10,
    secret: false,
  },
  {
    id: "chatterbox",
    name: "Chatterbox",
    description: "Your buddy reacts 100 times",
    icon: "\ud83d\udcac",
    check: (e) => e.reactions_given >= 100,
    secret: false,
  },
  {
    id: "week_streak",
    name: "Week Streak",
    description: "Code with your buddy for 7 days",
    icon: "\ud83d\udd25",
    check: (e) => e.days_active >= 7,
    secret: false,
  },
  {
    id: "month_streak",
    name: "Month Streak",
    description: "Code with your buddy for 30 days",
    icon: "\ud83d\udc51",
    check: (e) => e.days_active >= 30,
    secret: true,
  },
  {
    id: "power_user",
    name: "Power User",
    description: "Run 50 buddy commands",
    icon: "\u26a1",
    check: (e) => e.commands_run >= 50,
    secret: false,
  },
  {
    id: "dedicated",
    name: "Dedicated Companion",
    description: "Complete 200 turns together",
    icon: "\ud83c\udfc5",
    check: (e) => e.turns >= 200,
    secret: false,
  },
  {
    id: "thousand_turns",
    name: "Thousand Turns",
    description: "Reach 1000 turns together",
    icon: "\ud83c\udf96",
    check: (e) => e.turns >= 1000,
    secret: true,
  },
];

// ─── Unlocked badges persistence ─────────────────────────────────────────────

export interface UnlockedAchievement {
  id: string;
  unlockedAt: number;
  slot?: string;
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

// ─── Check + award ───────────────────────────────────────────────────────────

export function checkAndAward(slot?: string): Achievement[] {
  const e = loadEvents(slot);
  const unlocked = loadUnlocked();
  const unlockedIds = new Set(unlocked.map((u) => u.id));

  const newlyUnlocked: Achievement[] = [];

  for (const ach of ACHIEVEMENTS) {
    if (unlockedIds.has(ach.id)) continue;
    if (ach.check(e)) {
      unlocked.push({ id: ach.id, unlockedAt: Date.now(), slot: slot ?? undefined });
      newlyUnlocked.push(ach);
    }
  }

  if (newlyUnlocked.length > 0) {
    saveUnlocked(unlocked);
  }

  return newlyUnlocked;
}

// ─── Render achievement card ─────────────────────────────────────────────────

const GOLD = "\x1b[38;2;255;193;7m";
const NC = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export function renderAchievementsCard(): string {
  const unlocked = loadUnlocked();
  const unlockedIds = new Set(unlocked.map((u) => u.id));

  const W = 40;
  const hr = "\u2500".repeat(W - 2);
  const sep = `\u251c${"\u254c".repeat(W - 2)}\u2524`;
  const lines: string[] = [];

  const total = ACHIEVEMENTS.length;
  const earned = unlockedIds.size;

  lines.push(`${GOLD}\u256d${hr}\u256e${NC}`);

  const header = "\ud83c\udfc6 ACHIEVEMENTS";
  lines.push(`${GOLD}\u2502${NC}  ${BOLD}${header}${NC}${"".padEnd(W - header.length - 4)}${GOLD}\u2502${NC}`);

  const barFilled = total > 0 ? Math.round((earned / total) * 20) : 0;
  const bar = "\u2588".repeat(barFilled) + "\u2591".repeat(20 - barFilled);
  const barText = `${bar} ${earned}/${total}`;
  lines.push(`${GOLD}\u2502${NC}  ${barText}${"".padEnd(W - barText.length - 4)}${GOLD}\u2502${NC}`);

  lines.push(`${GOLD}${sep}${NC}`);

  for (const ach of ACHIEVEMENTS) {
    if (ach.secret && !unlockedIds.has(ach.id)) continue;

    const done = unlockedIds.has(ach.id);
    const status = done ? "\u2705" : "\u2610";
    const content = ` ${ach.icon}${status} ${ach.name}`;
    const descContent = `    ${ach.description}`;

    if (done) {
      lines.push(`${GOLD}\u2502${NC} ${BOLD}${content}${NC}${"".padEnd(W - content.length - 3)}${GOLD}\u2502${NC}`);
    } else {
      lines.push(`${GOLD}\u2502${NC} ${DIM}${content}${NC}${"".padEnd(W - content.length - 3)}${GOLD}\u2502${NC}`);
    }
    lines.push(`${GOLD}\u2502${NC} ${DIM}${descContent}${NC}${"".padEnd(W - descContent.length - 3)}${GOLD}\u2502${NC}`);
  }

  if (earned > 0 && earned === ACHIEVEMENTS.length) {
    lines.push(`${GOLD}${sep}${NC}`);
    const complete = "\u2728 ALL ACHIEVEMENTS UNLOCKED! \u2728";
    lines.push(`${GOLD}\u2502${NC}  ${BOLD}${complete}${NC}${"".padEnd(W - complete.length - 4)}${GOLD}\u2502${NC}`);
  }

  lines.push(`${GOLD}\u2570${hr}\u256f${NC}`);

  return lines.join("\n");
}

export function renderAchievementsCardMarkdown(): string {
  const unlocked = loadUnlocked();
  const unlockedIds = new Set(unlocked.map((u) => u.id));
  const total = ACHIEVEMENTS.length;
  const earned = unlockedIds.size;

  const barFilled = total > 0 ? Math.round((earned / total) * 20) : 0;
  const bar = "\u2588".repeat(barFilled) + "\u2591".repeat(20 - barFilled);

  const parts: string[] = [];
  parts.push(`### \ud83c\udfc6 Achievements \u2014 ${earned}/${total}`);
  parts.push("");
  parts.push(`\`${bar}\``);
  parts.push("");

  for (const ach of ACHIEVEMENTS) {
    if (ach.secret && !unlockedIds.has(ach.id)) continue;
    const done = unlockedIds.has(ach.id);
    const status = done ? "\u2705" : "\u2610";
    const line = `${ach.icon}${status} **${ach.name}** \u2014 ${ach.description}`;
    parts.push(line);
  }

  if (earned > 0 && earned === ACHIEVEMENTS.length) {
    parts.push("");
    parts.push("\u2728 **ALL ACHIEVEMENTS UNLOCKED!** \u2728");
  }

  return parts.join("\n");
}
