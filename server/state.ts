/**
 * State management — reads/writes companion data to the buddy state dir.
 *
 * The state dir resolves via server/paths.ts (honors CLAUDE_CONFIG_DIR).
 * Default: ~/.claude-buddy/. With CLAUDE_CONFIG_DIR set:
 * $CLAUDE_CONFIG_DIR/buddy-state/.
 *
 * Storage layout (v3 — single manifest):
 *   <state-dir>/
 *     menagerie.json   <- SSOT: { active, companions: { [slot]: Companion } }
 *     reaction.$SID.json  <- transient reaction state (session-scoped)
 *     status.json      <- compact state for the status-line shell script
 *     config.json      <- user preferences (cooldown, bubble style, etc.)
 *
 * Rules:
 *   - saveCompanionSlot()  APPENDS only — throws if the slot already exists
 *   - saveCompanion()      UPDATES the currently-active slot (rename / personality)
 *   - All manifest writes are atomic (write tmp -> rename)
 *
 * Combined: PR #4 menagerie + PR #6 session isolation + config
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
} from "fs";
import { join } from "path";
import type { Companion } from "./engine.ts";
import {
  buddyStateDir,
  claudeSettingsPath,
  claudeUserConfigPath,
  toUnixPath,
} from "./path.ts";

export const STATE_DIR = buddyStateDir();
const MANIFEST_FILE = join(STATE_DIR, "menagerie.json");
const CONFIG_FILE = join(STATE_DIR, "config.json");

// ─── Session ID (PR #6: tmux session isolation) ─────────────────────────────

function sessionId(): string {
  const pane = process.env.TMUX_PANE;
  if (!pane) return "default";
  return pane.replace(/^%/, "");
}

function reactionFile(): string {
  return join(STATE_DIR, `reaction.${sessionId()}.json`);
}

// ─── Manifest schema ─────────────────────────────────────────────────────────

interface Manifest {
  active: string;
  companions: Record<string, Companion>;
}

function emptyManifest(): Manifest {
  return { active: "buddy", companions: {} };
}

// ─── Atomic manifest I/O ─────────────────────────────────────────────────────

function loadManifest(): Manifest {
  try {
    const raw = readFileSync(MANIFEST_FILE, "utf8");
    const m = JSON.parse(raw) as Manifest;
    if (!m.companions) m.companions = {};
    return m;
  } catch {
    return emptyManifest();
  }
}

function saveManifest(m: Manifest): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = MANIFEST_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(m, null, 2));
  renameSync(tmp, MANIFEST_FILE); // atomic on same filesystem
}

// ─── Slot helpers ────────────────────────────────────────────────────────────

/** Normalise a string to a safe slot key (a-z0-9-, max 14 chars). */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 14) || "buddy"
  );
}

/**
 * Return a random fallback name whose slug is not already in the manifest.
 * Falls back to "buddy-<random 3 digits>" if all names are taken.
 */
export function unusedName(): string {
  const { generateFallbackName } =
    require("./reactions.ts") as typeof import("./reactions.ts");
  const taken = new Set(Object.keys(loadManifest().companions));
  for (let i = 0; i < 50; i++) {
    const n = generateFallbackName();
    if (!taken.has(slugify(n))) return n;
  }
  let suffix = 0;
  while (taken.has(`buddy-${suffix}`)) suffix++;
  return `buddy-${suffix}`;
}

// ─── Active slot ─────────────────────────────────────────────────────────────

export function loadActiveSlot(): string {
  const m = loadManifest();
  if (m.active && m.companions[m.active]) return m.active;
  const first = Object.keys(m.companions)[0];
  if (first) {
    m.active = first;
    saveManifest(m);
    return first;
  }
  return "buddy";
}

export function saveActiveSlot(slot: string): void {
  const m = loadManifest();
  m.active = slot;
  saveManifest(m);
}

// ─── Companion slot API ───────────────────────────────────────────────────────

export function loadCompanionSlot(slot: string): Companion | null {
  return loadManifest().companions[slot] ?? null;
}

/**
 * APPEND a new companion to the manifest.
 * Throws if the slot already exists — use saveCompanion() to update an existing buddy.
 */
export function saveCompanionSlot(companion: Companion, slot: string): void {
  const m = loadManifest();
  if (m.companions[slot]) {
    throw new Error(`Slot "${slot}" already exists. Choose a different name.`);
  }
  m.companions[slot] = companion;
  saveManifest(m);
}

/**
 * UPDATE an existing (possibly non-active) companion slot.
 * Throws if the slot does not exist.
 */
export function updateCompanionSlot(slot: string, companion: Companion): void {
  const m = loadManifest();
  if (!m.companions[slot]) {
    throw new Error(`Slot "${slot}" does not exist.`);
  }
  m.companions[slot] = companion;
  saveManifest(m);
}

export function deleteCompanionSlot(slot: string): void {
  const m = loadManifest();
  delete m.companions[slot];
  if (m.active === slot) {
    m.active = Object.keys(m.companions)[0] ?? "buddy";
  }
  saveManifest(m);
}

export function listCompanionSlots(): Array<{
  slot: string;
  companion: Companion;
}> {
  return Object.entries(loadManifest().companions).map(([slot, companion]) => ({
    slot,
    companion,
  }));
}

// ─── Primary companion API ────────────────────────────────────────────────────

export function loadCompanion(): Companion | null {
  migrateIfNeeded();
  const m = loadManifest();
  return m.companions[m.active] ?? null;
}

/**
 * UPDATE the currently-active companion (rename, personality changes, etc.).
 * This is the ONLY intentional in-place update path.
 */
export function saveCompanion(companion: Companion): void {
  const m = loadManifest();
  m.companions[m.active] = companion;
  saveManifest(m);
}

// ─── Migration: legacy companion.json -> single manifest ────────────────────

function migrateIfNeeded(): void {
  if (existsSync(MANIFEST_FILE)) return;

  const companions: Record<string, Companion> = {};
  let active = "buddy";

  // Absorb menagerie/<slot>.json files
  const menagerieDir = join(STATE_DIR, "menagerie");
  if (existsSync(menagerieDir)) {
    try {
      for (const f of readdirSync(menagerieDir).filter((f) =>
        f.endsWith(".json"),
      )) {
        const slot = f.slice(0, -5);
        try {
          companions[slot] = JSON.parse(
            readFileSync(join(menagerieDir, f), "utf8"),
          );
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* noop */
    }
  }

  // Absorb legacy companion.json
  const legacyFile = join(STATE_DIR, "companion.json");
  if (existsSync(legacyFile) && Object.keys(companions).length === 0) {
    try {
      const c: Companion = JSON.parse(readFileSync(legacyFile, "utf8"));
      const slot = slugify(c.name);
      companions[slot] = c;
      active = slot;
    } catch {
      /* noop */
    }
  }

  // Read active pointer if it exists
  const activeFile = join(STATE_DIR, "active");
  if (existsSync(activeFile)) {
    try {
      const a = readFileSync(activeFile, "utf8").trim();
      if (a && companions[a]) active = a;
    } catch {
      /* noop */
    }
  }

  if (Object.keys(companions).length > 0) {
    active = active && companions[active] ? active : Object.keys(companions)[0];
  }

  saveManifest({ active, companions });
}

// ─── Reaction state (session-scoped for tmux isolation) ──────────────────────

export interface ReactionState {
  reaction: string;
  timestamp: number;
  reason: string;
}

export function loadReaction(): ReactionState | null {
  try {
    const data: ReactionState = JSON.parse(readFileSync(reactionFile(), "utf8"));
    const { reactionTTL } = loadConfig();
    if (reactionTTL > 0 && Date.now() - data.timestamp > reactionTTL * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveReaction(reaction: string, reason: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const state: ReactionState = { reaction, timestamp: Date.now(), reason };
  writeFileSync(reactionFile(), JSON.stringify(state));
}

// ─── Identity resolution ─────────────────────────────────────────────────────

export function resolveUserId(): string {
  try {
    const claudeJson = JSON.parse(readFileSync(claudeUserConfigPath(), "utf8"));
    return claudeJson.oauthAccount?.accountUuid ?? claudeJson.userID ?? "anon";
  } catch {
    return "anon";
  }
}

// ─── Config persistence (PR #6: tmux popup settings) ─────────────────────────

export interface BuddyConfig {
  commentCooldown: number;
  reactionTTL: number;
  bubbleStyle: "classic" | "round";
  bubblePosition: "top" | "left";
  showRarity: boolean;
  statusLineEnabled: boolean;
  bubbleWidth: number;
  bubbleMargin: number;
  useCombinedStatus: boolean;
  rainbowColors?: string[];
}

const DEFAULT_CONFIG: BuddyConfig = {
  commentCooldown: 30,
  reactionTTL: 0,
  bubbleStyle: "classic",
  bubblePosition: "top",
  showRarity: true,
  statusLineEnabled: false,
  bubbleWidth: 28,
  bubbleMargin: 8,
  useCombinedStatus: false,
};

export function loadConfig(): BuddyConfig {
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    return { ...DEFAULT_CONFIG, ...data };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Partial<BuddyConfig>): BuddyConfig {
  mkdirSync(STATE_DIR, { recursive: true });
  const current = loadConfig();
  const merged = { ...current, ...config };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

// ─── Status line state (compact JSON for the shell script) ───────────────────

export interface StatusState {
  name: string;
  species: string;
  rarity: string;
  stars: string;
  face: string;
  eye: string;
  shiny: boolean;
  hat: string;
  reaction: string;
  muted: boolean;
  achievement: string;
  frames: string[];
  frameSequence: number[];
}

export function writeStatusState(
  companion: Companion,
  reaction?: string,
  muted?: boolean,
  achievement?: string,
): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const { renderFace, RARITY_STARS } =
    require("./engine.ts") as typeof import("./engine.ts");
  const { getStatusFrames } =
    require("./art.ts") as typeof import("./art.ts");
  const { frames, frameSequence } = getStatusFrames(companion.bones);
  const state: StatusState = {
    name: companion.name,
    species: companion.bones.species,
    rarity: companion.bones.rarity,
    stars: RARITY_STARS[companion.bones.rarity],
    face: renderFace(companion.bones.species, companion.bones.eye),
    eye: companion.bones.eye,
    shiny: companion.bones.shiny,
    hat: companion.bones.hat,
    reaction: reaction ?? "",
    muted: muted ?? false,
    achievement: achievement ?? "",
    frames,
    frameSequence,
  };
  writeFileSync(join(STATE_DIR, "status.json"), JSON.stringify(state));
}

// ─── Claude Code settings.json patching (for buddy_statusline tool) ──────────

export const CLAUDE_SETTINGS_PATH = claudeSettingsPath();

/**
 * Write settings.statusLine pointing to the given buddy-status script.
 * Atomic via tmp + rename. Returns false if settings.json is unreachable.
 */
export function setBuddyStatusLine(
  statusScript: string,
  settingsPath: string = CLAUDE_SETTINGS_PATH,
): boolean {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.statusLine = {
      type: "command",
      command: toUnixPath(statusScript),
      padding: 1,
      refreshInterval: 1,
    };
    const tmp = settingsPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, settingsPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove settings.statusLine — but only if it points to buddy-status.sh.
 * Leaves foreign statusLines untouched. Returns false if no buddy line was
 * present or settings.json is unreachable.
 */
export function unsetBuddyStatusLine(
  settingsPath: string = CLAUDE_SETTINGS_PATH,
): boolean {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!settings.statusLine?.command?.includes("buddy-status.sh")) return false;
    delete settings.statusLine;
    const tmp = settingsPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, settingsPath);
    return true;
  } catch {
    return false;
  }
}

// ─── Plugin uninstall cleanup ───────────────────────────────────────────────

export interface CleanupResult {
  statusLineRemoved: boolean;
  foreignStatusLineKept: boolean;
  transientFilesRemoved: number;
}

const TRANSIENT_PREFIXES = [
  "popup-stop.",
  "popup-resize.",
  "popup-env.",
  "popup-scroll.",
  "popup-reopen-pid.",
  "reaction.",
  ".last_reaction.",
  ".last_comment.",
];

/**
 * Clean up plugin-owned writes to the user's global state so that
 * `claude plugin uninstall` leaves no orphaned entries behind. Specifically:
 *   - remove settings.statusLine if it points to buddy-status.sh
 *   - delete session-scoped transient files under ~/.claude-buddy/
 *
 * Companion data (menagerie.json, status.json, config.json) is intentionally
 * kept — users reinstalling get their buddy back. Call-sites that want a full
 * wipe should delete STATE_DIR themselves after calling this.
 */
export function cleanupPluginState(
  settingsPath: string = CLAUDE_SETTINGS_PATH,
  stateDir: string = STATE_DIR,
): CleanupResult {
  const statusLineRemoved = unsetBuddyStatusLine(settingsPath);

  let foreignStatusLineKept = false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const cmd = settings.statusLine?.command;
    if (cmd && !cmd.includes("buddy-status.sh")) foreignStatusLineKept = true;
  } catch {
    /* missing settings.json is fine */
  }

  let transientFilesRemoved = 0;
  try {
    if (existsSync(stateDir)) {
      for (const f of readdirSync(stateDir)) {
        if (TRANSIENT_PREFIXES.some(p => f.startsWith(p))) {
          rmSync(join(stateDir, f), { force: true });
          transientFilesRemoved++;
        }
      }
    }
  } catch {
    /* state dir unreadable is fine */
  }

  return { statusLineRemoved, foreignStatusLineKept, transientFilesRemoved };
}
