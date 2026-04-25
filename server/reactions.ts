import type { Species, Rarity } from "./engine.ts";
import { t, tArray, tObj } from "./i18n.ts";

export type ReactionReason =
  | "hatch" | "pet" | "error" | "test-fail" | "large-diff" | "turn" | "idle"
  | "commit" | "push" | "merge-conflict" | "branch" | "rebase" | "stash" | "tag"
  | "late-night" | "early-morning" | "long-session" | "marathon" | "friday" | "weekend" | "monday"
  | "regex-file" | "css-file" | "sql-file" | "docker-file" | "ci-file" | "lock-file"
  | "env-file" | "test-file" | "doc-file" | "config-file" | "binary-file" | "gitignore"
  | "makefile" | "readme" | "package-file" | "proto-file"
  | "lint-fail" | "type-error" | "build-fail" | "security-warning" | "deprecation"
  | "frustrated" | "happy" | "stuck" | "sarcastic"
  | "many-edits" | "delete-file" | "large-file" | "create-file"
  | "all-green" | "deploy" | "release" | "coverage"
  | "debug-loop" | "write-spree" | "search-heavy"
  | "snark" | "chaos" | "patience" | "debugging" | "wisdom"
  | "late-night-error" | "late-night-commit" | "friday-push"
  | "marathon-error" | "weekend-conflict" | "build-after-push" | "marathon-test-fail"
  | "recovery-from-error" | "recovery-from-test-fail"
  | "recovery-from-build-fail" | "recovery-from-merge-conflict"
  | "lang-python" | "lang-typescript" | "lang-rust" | "lang-go"
  | "lang-java" | "lang-ruby" | "lang-php" | "lang-c"
  | "lang-cpp" | "lang-haskell" | "lang-swift" | "lang-elixir"
  | "lang-zig" | "lang-kotlin"
  | "streak-3" | "streak-5" | "streak-10" | "streak-20"
  | "new-year" | "valentines" | "pi-day" | "april-fools"
  | "halloween" | "christmas" | "new-years-eve" | "spooky-season"
  | "success";

export interface ReactionContext {
  line?: number;
  count?: number;
  lines?: number;
  files?: number;
  branch?: string;
  hour?: number;
  elapsed?: number;
  extension?: string;
}

export type BuddyStats = Record<string, number>;

function getReactionPool(reason: ReactionReason): string[] {
  return tArray(`reactions.${reason}`);
}

function getSpeciesPool(species: Species, reason: ReactionReason): string[] | null {
  const pool = tArray(`species.${species}.${reason}`);
  return pool.length > 0 ? pool : null;
}

const OVERRIDE_KEYS = ["snark", "chaos", "patience", "debugging", "wisdom"] as const;
type OverrideKey = typeof OVERRIDE_KEYS[number];
const STAT_TO_OVERRIDE: Record<string, OverrideKey> = {
  SNARK: "snark",
  CHAOS: "chaos",
  PATIENCE: "patience",
  DEBUGGING: "debugging",
  WISDOM: "wisdom",
};

function getOverridePool(overrideKey: OverrideKey, reason: ReactionReason): string[] | null {
  const pool = tArray(`overrides.${overrideKey}.${reason}`);
  return pool.length > 0 ? pool : null;
}

function applyStatModifier(reaction: string, reason: ReactionReason, stats: BuddyStats): string {
  const roll = Math.random();
  for (const [stat, overrideKey] of Object.entries(STAT_TO_OVERRIDE)) {
    const threshold = stat === "SNARK" ? 0.3 : stat === "CHAOS" ? 0.2 : stat === "WISDOM" ? 0.2 : 0.25;
    if ((stats[stat] ?? 0) >= 70 && roll < threshold) {
      const pool = getOverridePool(overrideKey, reason);
      if (pool) return pool[Math.floor(Math.random() * pool.length)];
    }
  }
  return reaction;
}

function getRarityFlair(rarity: Rarity): { chance: number; pool: string[] } | null {
  const flairChances: Record<string, number> = {
    uncommon: 0.2,
    rare: 0.3,
    epic: 0.4,
    legendary: 0.5,
  };
  const chance = flairChances[rarity];
  if (!chance) return null;
  const pool = tArray(`rarity.flair.${rarity}`);
  if (pool.length === 0) return null;
  return { chance, pool };
}

function applyRarityFlair(reaction: string, rarity: Rarity): string {
  const entry = getRarityFlair(rarity);
  if (!entry) return reaction;
  if (Math.random() >= entry.chance) return reaction;
  const flair = entry.pool[Math.floor(Math.random() * entry.pool.length)];
  if (rarity === "legendary" && Math.random() < 0.3) {
    return flair + " " + reaction;
  }
  return reaction + " " + flair;
}

function getEscalationPool(reason: ReactionReason, tier: string): string[] | null {
  const pool = tArray(`escalation.${reason}.${tier}`);
  return pool.length > 0 ? pool : null;
}

function getEscalationTier(count: number): "first" | "early" | "mid" | "late" | null {
  if (count === 0) return "first";
  if (count < 10) return "early";
  if (count < 50) return "mid";
  return "late";
}

const REASON_TO_COUNTER: Partial<Record<ReactionReason, string>> = {
  error: "errors_seen",
  "test-fail": "tests_failed",
  commit: "commits_made",
  push: "pushes_made",
  "merge-conflict": "conflicts_resolved",
  "lint-fail": "lint_fails",
  "type-error": "type_errors",
  "build-fail": "build_fails",
};

export function getReaction(
  reason: ReactionReason,
  species: Species,
  rarity: Rarity,
  stats?: BuddyStats,
  context?: ReactionContext,
): string {
  const speciesPool = getSpeciesPool(species, reason);
  const generalPool = getReactionPool(reason);
  if (!generalPool || generalPool.length === 0) return "...";

  const pool = speciesPool && Math.random() < 0.4 ? speciesPool : generalPool;
  let reaction = pool[Math.floor(Math.random() * pool.length)];

  if (stats) {
    reaction = applyStatModifier(reaction, reason, stats);
  }

  reaction = applyRarityFlair(reaction, rarity);

  if (context?.line) reaction = reaction.replace("{line}", String(context.line));
  if (context?.count) reaction = reaction.replace("{count}", String(context.count));
  if (context?.lines) reaction = reaction.replace("{lines}", String(context.lines));
  if (context?.files) reaction = reaction.replace("{files}", String(context.files));
  if (context?.branch) reaction = reaction.replace("{branch}", context.branch);

  return reaction;
}

function getFallbackNames(): string[] {
  return tArray("fallback_names");
}

function getVibeWords(): string[] {
  return tArray("vibe_words");
}

export function generateFallbackName(): string {
  const names = getFallbackNames();
  return names[Math.floor(Math.random() * names.length)];
}

export function generatePersonalityPrompt(
  species: Species,
  rarity: Rarity,
  stats: Record<string, number>,
  shiny: boolean,
): string {
  const words = getVibeWords();
  const vibes: string[] = [];
  for (let i = 0; i < 4; i++) {
    vibes.push(words[Math.floor(Math.random() * words.length)]);
  }

  const statStr = Object.entries(stats).map(([k, v]) => `${k}:${v}`).join(", ");
  const template = tArray("personality.prompt_template");
  const shinyLine = shiny ? t("personality.shiny_template") : "";

  return [
    ...template.slice(0, 2),
    "",
    `Rarity: ${rarity.toUpperCase()}`,
    `Species: ${species}`,
    `Stats: ${statStr}`,
    `Inspiration words: ${vibes.join(", ")}`,
    shinyLine,
    "",
    "Return JSON: {\"name\": \"1-14 chars\", \"personality\": \"2-3 sentences describing behavior\"}",
  ].filter(Boolean).join("\n");
}
