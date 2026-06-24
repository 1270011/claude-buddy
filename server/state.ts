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
import type { Companion, BuddyStats, StatName, Rarity, Hat } from "./engine.ts";
import type { Emotion } from "./art.ts";
import { RARITIES } from "./engine.ts";
import { grantCollectionReward, xpForLevel } from "./xp.ts";
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

export function sessionId(): string {
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
  /** Rarity-set milestone ids already granted (additional-rewards FR3). */
  raritySetMilestones: string[];
}

/** The id for the "owns one companion of every rarity tier" milestone. */
export const RARITY_SET_MILESTONE_ID = "full_set";

function emptyManifest(): Manifest {
  return { active: "buddy", companions: {}, raritySetMilestones: [] };
}

// ─── Atomic manifest I/O ─────────────────────────────────────────────────────

function loadManifest(): Manifest {
  try {
    const raw = readFileSync(MANIFEST_FILE, "utf8");
    const m = JSON.parse(raw) as Manifest;
    if (!m.companions) m.companions = {};
    // Back-fill the milestone list for manifests written before FR3 shipped.
    if (!Array.isArray(m.raritySetMilestones)) m.raritySetMilestones = [];
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

// ─── Rarity-set collection milestone (additional-rewards FR3) ─────────────────

export interface RaritySetProgress {
  /** Rarity tiers currently owned across the menagerie, in canonical order. */
  owned: Rarity[];
  /** Rarity tiers still needed for the full set, in canonical order. */
  missing: Rarity[];
  ownedCount: number;
  total: number;
  complete: boolean;
}

/**
 * Pure: progress toward the full-rarity-set milestone for a set of companions.
 * "Complete" means the menagerie holds at least one companion of every rarity
 * tier simultaneously (FR3.1).
 */
export function raritySetProgress(
  companions: Record<string, Companion>,
): RaritySetProgress {
  const present = new Set(
    Object.values(companions).map((c) => c.bones.rarity),
  );
  const owned = RARITIES.filter((r) => present.has(r));
  const missing = RARITIES.filter((r) => !present.has(r));
  return {
    owned,
    missing,
    ownedCount: owned.length,
    total: RARITIES.length,
    complete: missing.length === 0,
  };
}

/** Rarity-set progress for the current menagerie (I/O wrapper, for surfacing). */
export function getRaritySetProgress(): RaritySetProgress {
  return raritySetProgress(loadManifest().companions);
}

/** A one-line summary of rarity-set progress for cards (pure). */
export function formatRaritySetLine(p: RaritySetProgress): string {
  if (p.complete) return `Rarity set: ${p.ownedCount}/${p.total} — complete ✅`;
  return `Rarity set: ${p.ownedCount}/${p.total} (need: ${p.missing.join(", ")})`;
}

/**
 * Check the rarity-set milestone after a menagerie change and grant its
 * account-wide reward exactly once. Idempotent: a no-op once granted, and safe
 * to call opportunistically. Returns true only on the grant that first
 * completes the set. Cheap — companion count only changes on explicit player
 * action, so no polling is needed (design §2.3 / §6.1).
 */
export function checkRaritySetMilestone(): boolean {
  const m = loadManifest();
  if (m.raritySetMilestones.includes(RARITY_SET_MILESTONE_ID)) return false;
  if (!raritySetProgress(m.companions).complete) return false;

  m.raritySetMilestones.push(RARITY_SET_MILESTONE_ID);
  saveManifest(m);
  grantCollectionReward(); // account-wide title + multiplier in xp.json
  return true;
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
  // A new companion may complete the rarity set — grant the milestone once.
  checkRaritySetMilestone();
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

  saveManifest({ active, companions, raritySetMilestones: [] });
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
  theme: "dark" | "light" | "auto";
  moodEnabled: boolean;
  memoryEnabled: boolean;
  suggestionsEnabled: boolean;
  suggestionCooldown: number;
  /** Show the buddy's stat bars as a panel to the left of the art. */
  showStats: boolean;
  /** Show the prestige/streak badge line under the title (additional-rewards FR1.5). */
  showPrestigeBadge: boolean;
  /** Game-feel intensity gate (game-feel NFR0/FR-E1): off silences all juice. */
  gameFeel: GameFeel;
  /** Opt into deep-focus auto-quiet (game-feel FR-E1): during a long, error-free
   *  session, clamp `full` down to `subtle` so flow isn't interrupted. Default
   *  off — it's the one fuzzy signal, so it never quiets unless asked. */
  autoQuietFocus: boolean;
  /** Idle wander (movement design-movement §3): opt out of the buddy ambling on
   *  the status line without dropping gameFeel below "full". Default true; the
   *  walk still only animates when effectiveGameFeel() === "full". */
  wanderEnabled: boolean;
  /** §7.A vertical hop / path arc. Costs one reserved headroom row, so default
   *  false (NFR6 real-estate). */
  wanderHop: boolean;
  /** §7.B wide two-sided corridor: shifts the bubble left by a constant to open
   *  a left lane. Default false. */
  wanderWide: boolean;
  /** Bubble-follows-buddy: when true, the speech bubble + connector travel with
   *  the buddy as one rigid block (connector stays attached) instead of the
   *  bubble staying pinned while the connector retracts. Default false (the
   *  pinned-bubble layout invariant). Pure render flag, read live by bash. */
  wanderBubble: boolean;
}

/** Game-feel intensity level (game-feel FR-E1). */
export type GameFeel = "off" | "subtle" | "full";

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
  theme: "auto",
  moodEnabled: true,
  memoryEnabled: true,
  suggestionsEnabled: true,
  suggestionCooldown: 180,
  showStats: false,
  showPrestigeBadge: false,
  gameFeel: "subtle",
  autoQuietFocus: false,
  wanderEnabled: true,
  wanderHop: false,
  wanderWide: false,
  wanderBubble: false,
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

/**
 * The active game-feel intensity (game-feel FR-E1). Backfills to "subtle" for
 * configs written before the gate shipped (loadConfig merges DEFAULT_CONFIG).
 */
export function gameFeelLevel(): GameFeel {
  return loadConfig().gameFeel;
}

// ─── Auto-quiet: transient intensity clamp (game-feel FR-E1) ─────────────────

/**
 * Reaction reasons that signal a fresh error spike. While one of these is the
 * active (non-expired) reaction, game-feel clamps itself down by one notch so it
 * stays out of the way exactly when the work needs the glance (game-feel NFR0).
 */
const SPIKE_REASONS = new Set([
  "error",
  "test-fail",
  "build-fail",
  "type-error",
  "lint-fail",
]);

/**
 * Whether the active reaction indicates a fresh error spike.
 *
 * Pure — `reason` is the already-TTL-filtered `loadReaction()` reason; a
 * null/undefined reason (no fresh reaction) means no spike.
 *
 * @param reason: The active reaction reason, or null/undefined.
 * @returns True when the reason is an error-family spike.
 */
export function autoQuietActive(
  reason: string | null | undefined,
): boolean {
  return !!reason && SPIKE_REASONS.has(reason);
}

/**
 * Clamp the configured game-feel by one notch while auto-quiet is active.
 *
 * `full` drops to `subtle`; `subtle` and `off` are left untouched — auto-quiet
 * never silences the core delight, it only trims the chatty `full` extras.
 *
 * @param configured: The user's configured game-feel level.
 * @param quiet: Whether auto-quiet is currently active.
 * @returns The effective game-feel level after the clamp.
 */
export function clampGameFeel(
  configured: GameFeel,
  quiet: boolean,
): GameFeel {
  return quiet && configured === "full" ? "subtle" : configured;
}

/** Seconds the deep-focus heuristic waits before it considers a session "deep". */
export const FOCUS_MIN_SECONDS = 25 * 60; // 25 minutes

/**
 * Whether the deep-focus heuristic should clamp game-feel down a notch.
 *
 * Pure. Deep focus = a long, uninterrupted session with no fresh error. The
 * "no recent celebration" clause from the design is intentionally dropped: the
 * only persisted celebration timestamp is the transient one cleared on the very
 * next status write, so it carries no reliable "last M minutes" signal without
 * new state — and "no new persistence" is the governing principle here.
 *
 * @param opts.sessionElapsedSec: Seconds since the session baseline, or null
 *     when no session snapshot exists yet (⇒ not deep focus).
 * @param opts.hasFreshError: Whether an error-family reaction is currently
 *     fresh (a spike overrides deep focus — the spike path handles it).
 * @returns True when the session looks like deep focus.
 */
export function deepFocusActive(opts: {
  sessionElapsedSec: number | null;
  hasFreshError: boolean;
}): boolean {
  if (opts.hasFreshError) return false;
  if (opts.sessionElapsedSec === null) return false;
  return opts.sessionElapsedSec >= FOCUS_MIN_SECONDS;
}

/** Seconds since the current session's baseline snapshot, or null if none. */
function sessionElapsedSeconds(): number | null {
  try {
    const { loadSnapshot } =
      require("./session.ts") as typeof import("./session.ts");
    const snap = loadSnapshot();
    if (!snap) return null;
    return Math.floor(Date.now() / 1000) - snap.startedAt;
  } catch {
    return null;
  }
}

/** Why auto-quiet is clamping right now (for reporting), or null. */
export type AutoQuietReason = "error-spike" | "deep-focus" | null;

/**
 * The live auto-quiet reason, for *reporting* (doctor / `buddy_gamefeel`).
 *
 * Error spike is checked first (cheapest, highest signal); deep focus only when
 * the user has opted in via `autoQuietFocus`. Guarded; never throws.
 *
 * @returns The active clamp reason, or null when nothing is clamping.
 */
export function autoQuietReason(): AutoQuietReason {
  let reason: string | null | undefined;
  try {
    reason = loadReaction()?.reason;
  } catch {
    // Reaction state optional.
  }
  if (autoQuietActive(reason)) return "error-spike";

  let focusOptIn = false;
  try {
    focusOptIn = loadConfig().autoQuietFocus;
  } catch {
    // Config optional during first install / version skew.
  }
  if (
    focusOptIn &&
    deepFocusActive({
      sessionElapsedSec: sessionElapsedSeconds(),
      hasFreshError: autoQuietActive(reason),
    })
  ) {
    return "deep-focus";
  }
  return null;
}

/**
 * The effective game-feel intensity every *delight* producer should read.
 *
 * Wraps {@link gameFeelLevel} with the transient auto-quiet clamp (error spike,
 * or opt-in deep focus). The raw {@link gameFeelLevel} survives only for
 * *reporting* the configured value (`buddy_gamefeel`, doctor) — the clamp is
 * transient and must never be persisted as the user's choice. Guarded; never
 * throws.
 *
 * @returns The configured level, clamped to `subtle` while auto-quiet is active.
 */
export function effectiveGameFeel(): GameFeel {
  let configured: GameFeel = "subtle";
  try {
    configured = loadConfig().gameFeel;
  } catch {
    // Config optional during first install / version skew.
  }
  return clampGameFeel(configured, autoQuietReason() !== null);
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
  level: number;
  xp: number;
  mood: string;
  title: string | null;
  /** Prestige tier (0 = never ascended) — for the optional badge (FR1.5). */
  prestigeLevel: number;
  /** Current net-positive session streak — for the optional badge (FR2.4). */
  streak: number;
  stats: BuddyStats;
  peak: StatName;
  dump: StatName;
  /** Level-progress fill ratio, 0-100. 100 at MAX_LEVEL. */
  xpPct: number;
  /** Most recent XP award, for the statusline's transient toast. */
  lastXpGain: { amount: number; at: number } | null;
  /** Transient celebratory message preferred over `reaction` while fresh
   *  (game-feel FR-A1/A2/etc.). Null when none / when gameFeel is off. */
  celebration: Celebration | null;
  /** Optional celebratory frame cycle (game-feel FR-A3), animated by the status
   *  line only while the celebration is fresh, then it falls back to `frames`.
   *  Absent unless a flourish was requested and gameFeel ≠ off. */
  flourishFrames?: string[];
  flourishSequence?: number[];
  /** Idle-wander (movement): per-tick horizontal offset (cells, ≥ 0) the buddy
   *  art is nudged right within the reclaimed margin. Indexed by NOW % length,
   *  like frameSequence. Absent unless gameFeel === "full" and wander is on. */
  wanderSequence?: number[];
  /** Idle-wander hop (§7.A): per-tick vertical offset (rows, 0..hopHeight), same
   *  index. Present only when wanderHop is on; absent ⇒ floor-only. */
  wanderRowSequence?: number[];
}

// ─── Celebration channel (game-feel §2 — one transient slot, many producers) ──

export type CelebrationKind =
  | "levelup"
  | "loot"
  | "ascension"
  | "whim"
  | "discovery"
  | "shiny";

export interface Celebration {
  text: string;
  kind: CelebrationKind;
  at: number; // Date.now(), for the statusline's TTL check
}

/** Options for {@link writeStatusState} — replaces the old positional tail. */
export interface StatusOpts {
  reaction?: string;
  muted?: boolean;
  achievement?: string;
  level?: number;
  xp?: number;
  xpGain?: number;
  /** An explicit celebration to surface (levelup/whim/ascension/shiny/...). */
  celebration?: Celebration | null;
  /** Which producer triggered this write — scopes the loot side-channel. */
  cause?: "loot" | "levelup" | "ascension" | "whim" | "shiny" | "tool";
  /** Opt this write into the ascension frame flourish (game-feel FR-A3).
   *  Default off — reserved for the big moments (ascension/shiny), never the
   *  common loot/level-up case. Ignored when gameFeel is off. */
  flourish?: boolean;
}

/** Higher wins when several celebrations contend for the single bubble slot. */
const CELEB_PRIORITY: Record<CelebrationKind, number> = {
  ascension: 5,
  shiny: 4,
  levelup: 3,
  whim: 2,
  loot: 1,
  discovery: 0,
};

/** Loot causes that may surface the loot `lastDrop` side-channel as a toast. */
const LOOT_CAUSES = new Set(["loot", "levelup", "whim", "ascension"]);

/**
 * Pure: pick the celebration to write this tick, or null. Gated by `gameFeel`
 * (off ⇒ never). An explicit `opts.celebration` competes with a fresh loot
 * `lastDrop` — but loot only surfaces when `opts.cause` is loot-related (so an
 * unrelated tool write can't echo a stale 🎁). Highest {@link CELEB_PRIORITY}
 * wins. Exported for unit tests.
 */
export function buildCelebration(
  opts: StatusOpts,
  gate: GameFeel,
  lastDrop: { label: string; at: number } | null | undefined,
  now: number = Date.now(),
): Celebration | null {
  if (gate === "off") return null;
  const cands: Celebration[] = [];
  if (opts.celebration) cands.push(opts.celebration);
  if (lastDrop && opts.cause && LOOT_CAUSES.has(opts.cause)) {
    const ageS = now / 1000 - lastDrop.at;
    if (ageS >= 0 && ageS <= 10) {
      cands.push({ text: `\u{1F381} ${lastDrop.label}`, kind: "loot", at: now });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => CELEB_PRIORITY[b.kind] - CELEB_PRIORITY[a.kind]);
  return cands[0];
}

// ─── Emotion mapping (game-feel FR-A4) ────────────────────────────────────────

/** Active-reaction reason → emotion. Unmapped reasons stay neutral. */
const REASON_EMOTION: Record<string, Emotion> = {
  pet: "happy",
  buddy_pet: "happy",
  error: "angry",
  "test-fail": "angry",
  idle: "bored",
  "large-diff": "surprised",
};

/**
 * Pure: which emotion the current reaction reason implies. Neutral when the gate
 * is off, the reason is absent, or the reason isn't mapped. Exported for tests.
 */
export function resolveEmotion(
  reason: string | undefined,
  gate: GameFeel,
): Emotion {
  if (gate === "off" || !reason) return "neutral";
  return REASON_EMOTION[reason] ?? "neutral";
}

/** Level-progress fill ratio (0-100) for the statusline XP bar. 100 once
 *  there's no further level to progress toward (MAX_LEVEL). */
export function computeXpPct(level: number, totalXp: number): number {
  const lower = xpForLevel(level);
  const upper = xpForLevel(level + 1);
  if (upper <= lower) return 100;
  return Math.min(100, Math.round(((totalXp - lower) / (upper - lower)) * 100));
}

/** §7.B wide-corridor max amble distance (cells); see design-movement §8. The
 *  bash side mirrors this constant when reclaiming the left lane. */
const WANDER_RANGE_WIDE = 10;

export function writeStatusState(
  companion: Companion,
  opts: StatusOpts = {},
): void {
  const { reaction, muted, achievement, level, xp, xpGain } = opts;
  mkdirSync(STATE_DIR, { recursive: true });
  const { renderFace, RARITY_STARS } =
    require("./engine.ts") as typeof import("./engine.ts");
  const { getStatusFrames } =
    require("./art.ts") as typeof import("./art.ts");

  // Game-feel intensity, read once (guarded) — drives emotion + celebration.
  // effectiveGameFeel() applies the transient error-spike clamp (FR-E1).
  let gate: GameFeel = "subtle";
  try {
    gate = effectiveGameFeel();
  } catch {
    // Config / reaction optional during first install / version skew.
  }

  // Emotion frames (FR-A4): derived from the active reaction's reason.
  let emotion: Emotion = "neutral";
  try {
    emotion = resolveEmotion(loadReaction()?.reason, gate);
  } catch {
    // Reaction state optional.
  }
  // Seasonal cosmetic (FR-C2): an overlay hat in a date window, gate-gated.
  let seasonalHat: Hat | undefined;
  if (gate !== "off") {
    try {
      const { activeSeasonal } = require("./art.ts") as typeof import("./art.ts");
      seasonalHat = activeSeasonal()?.hat;
    } catch {
      // Seasonal is a best-effort delighter.
    }
  }
  const { frames, frameSequence } = getStatusFrames(
    companion.bones,
    emotion,
    seasonalHat,
  );
  let xpLevel = level ?? 1;
  let xpTotal = xp ?? 0;
  let xpTitle: string | null = null;
  let prestigeLevel = 0;
  let streak = 0;
  let moodStr = "focused";
  try {
    const { getXpState } = require("./xp.ts") as typeof import("./xp.ts");
    const xpState = getXpState();
    xpLevel = xpState.level;
    xpTotal = xpState.totalXp;
    xpTitle = xpState.title;
    prestigeLevel = xpState.prestigeLevel;
  } catch {
    // XP state is optional during first install / version skew.
  }
  try {
    const { loadStreak } = require("./streak.ts") as typeof import("./streak.ts");
    streak = loadStreak().current;
  } catch {
    // Streak state is optional during first install / version skew.
  }
  try {
    const { getMood } = require("./mood.ts") as typeof import("./mood.ts");
    moodStr = getMood().current;
  } catch {
    // Mood state is optional during first install / version skew.
  }
  const xpPct = computeXpPct(xpLevel, xpTotal);
  const lastXpGain =
    xpGain && xpGain > 0 ? { amount: xpGain, at: Date.now() } : null;

  // Celebration channel (game-feel §2/§2.5): gated by gameFeel; loot drops
  // ride a lazy/guarded side-channel so a roll failure never breaks the write.
  let celebration: Celebration | null = null;
  try {
    let lastDrop: { label: string; at: number } | null = null;
    try {
      const { loadLoot } = require("./loot.ts") as typeof import("./loot.ts");
      lastDrop = loadLoot().lastDrop ?? null;
    } catch {
      // Loot state is optional during first install / version skew.
    }
    celebration = buildCelebration(opts, gate, lastDrop);
  } catch {
    // Best-effort: a celebration must never break the status write.
  }

  // Ascension frame flourish (game-feel FR-A3): opt-in, gate-gated. Written as a
  // *separate* frame set; the status line animates it only while the celebration
  // is fresh, then falls back to the neutral `frames` above (self-reverting, no
  // second server write). Omitted entirely when off / not requested.
  let flFrames: string[] | undefined;
  let flSequence: number[] | undefined;
  if (opts.flourish && gate !== "off") {
    try {
      const { flourishFrames } = require("./art.ts") as typeof import("./art.ts");
      const fl = flourishFrames(companion.bones);
      flFrames = fl.frames;
      flSequence = fl.frameSequence;
    } catch {
      // Flourish is a best-effort delighter; never break the write.
    }
  }

  // Idle wander (movement design-movement §4): gate-gated + opt-out, built via a
  // lazy/guarded require like flourish — a generator failure leaves the buddy
  // planted and the write still completes. `gate` is the already-clamped
  // effectiveGameFeel(), so auto-quiet (full → subtle) omits the sequences and
  // the buddy stops pacing during a spike, with no extra wiring.
  let wanderSequence: number[] | undefined;
  let wanderRowSequence: number[] | undefined;
  if (gate === "full") {
    try {
      const cfg = loadConfig();
      if (cfg.wanderEnabled) {
        const { buildWanderSequence, moodWalkOpts } =
          require("./wander.ts") as typeof import("./wander.ts");
        const opts = moodWalkOpts(moodStr, xpLevel, Date.now());
        if (!cfg.wanderHop) opts.hopHeight = 0; // §7.A opt-in
        if (cfg.wanderWide) opts.range = WANDER_RANGE_WIDE; // §7.B opt-in
        const walk = buildWanderSequence(opts);
        wanderSequence = walk.horizontal;
        wanderRowSequence = walk.vertical;
      }
    } catch {
      // Best-effort delighter; a failure leaves the buddy planted.
    }
  }

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
    level: xpLevel,
    xp: xpTotal,
    mood: moodStr,
    title: xpTitle,
    prestigeLevel,
    streak,
    stats: companion.bones.stats,
    peak: companion.bones.peak,
    dump: companion.bones.dump,
    xpPct,
    lastXpGain,
    celebration,
    ...(flFrames && flSequence
      ? { flourishFrames: flFrames, flourishSequence: flSequence }
      : {}),
    ...(wanderSequence ? { wanderSequence } : {}),
    ...(wanderRowSequence ? { wanderRowSequence } : {}),
  };
  // Atomic write (game-feel §2.6): the MCP server, the award-xp.ts process, and
  // react.sh's jq patch all touch status.json — tmp+rename avoids torn reads.
  const file = join(STATE_DIR, "status.json");
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(state));
  }
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
  ".session_start.",
  "session.",
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
