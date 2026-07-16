#!/usr/bin/env bun
/**
 * claude-buddy — LLM-free command dispatcher.
 *
 * The `/buddy` slash command routes through the LLM, but almost every buddy
 * command is a pure config/state operation that needs no model judgment — it
 * just reads or writes JSON and prints. Those all live here and run as plain
 * bun, no MCP round-trip, no tokens.
 *
 * The ONLY commands that genuinely need the LLM are the proactive ones that
 * read the conversation or your code — buddy_react (name mention),
 * buddy_suggest (teachable moment), and the end-of-turn comment. Those are not
 * typed commands, so they are not here.
 *
 * Usage:
 *   bun run cli/buddy.ts <command> [args]
 *   bun run buddy <command> [args]      (via package.json script)
 *
 * Each subcommand mirrors the matching MCP tool in server/index.ts exactly —
 * same state calls, same output strings, same side effects.
 */

import { resolve, dirname, join } from "path";

import {
  generateBones,
  generatePersonality,
  renderBuddy,
  renderFace,
  RARITY_STARS,
  type StatName,
  type Companion,
} from "../server/engine.ts";
import {
  loadCompanion,
  saveCompanion,
  resolveUserId,
  loadReaction,
  saveReaction,
  writeStatusState,
  loadConfig,
  saveConfig,
  loadActiveSlot,
  saveActiveSlot,
  slugify,
  unusedName,
  loadCompanionSlot,
  saveCompanionSlot,
  updateCompanionSlot,
  deleteCompanionSlot,
  listCompanionSlots,
  setBuddyStatusLine,
  unsetBuddyStatusLine,
  type BuddyConfig,
} from "../server/state.ts";
import { claudeSettingsPath } from "../server/path.ts";
import { getReaction } from "../server/reactions.ts";
import { renderCompanionCardMarkdown } from "../server/art.ts";
import {
  incrementEvent,
  checkAndAward,
  trackActiveDay,
  renderAchievementsCardMarkdown,
} from "../server/achievements.ts";
import {
  getXpState,
  isUpgradeUnlocked,
  applyUpgrade,
  UNLOCKABLE_UPGRADES,
  renderXpCardMarkdown,
} from "../server/xp.ts";
import { getMood, MOOD_COLORS, MOOD_NAMES } from "../server/mood.ts";
import { queryMemory, resolveBug } from "../server/memory.ts";
import { listCustomArt, CUSTOM_ART_PATH } from "../server/custom-art.ts";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

const STAT_NAMES: StatName[] = [
  "DEBUGGING",
  "PATIENCE",
  "CHAOS",
  "WISDOM",
  "SNARK",
];

// ─── Shared helpers (ported from server/index.ts) ────────────────────────────

/** Mirror of index.ts ensureCompanion(): load, rescue, or generate. */
function ensureCompanion(): Companion {
  const existing = loadCompanion();
  if (existing) return existing;

  const saved = listCompanionSlots();
  if (saved.length > 0) {
    const { slot, companion } = saved[0];
    saveActiveSlot(slot);
    writeStatusState(companion, `*${companion.name} arrives*`);
    return companion;
  }

  const userId = resolveUserId();
  const bones = generateBones(userId);
  const name = unusedName();
  const companion: Companion = {
    bones,
    name,
    personality: generatePersonality(bones, userId),
    hatchedAt: Date.now(),
    userId,
  };
  const slot = slugify(name);
  saveCompanionSlot(companion, slot);
  saveActiveSlot(slot);
  writeStatusState(companion);
  checkAndAward(slot);
  trackActiveDay();
  incrementEvent("sessions", 1);
  incrementEvent("buddies_collected", 1);
  return companion;
}

function activeSlot(): string {
  return loadActiveSlot();
}

/** Mirror of the achievement-notice block duplicated across index.ts tools. */
function achNotice(): string {
  const newAch = checkAndAward(activeSlot());
  return newAch.length > 0
    ? "\n" +
        newAch
          .map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`)
          .join("\n")
    : "";
}

function requireActive(): Companion {
  const companion = loadCompanion();
  if (!companion) {
    console.log("No companion found. Run 'claude-buddy install' first.");
    process.exit(1);
  }
  return companion;
}

// ─── Terminal display commands ───────────────────────────────────────────────

function cmdShow(): void {
  const companion = requireActive();
  console.log("");
  console.log(renderBuddy(companion.bones));
  console.log("");
  console.log(`  ${BOLD}${companion.name}${NC}`);
  console.log(`  ${DIM}${companion.personality}${NC}`);
  console.log("");

  const reaction = loadReaction();
  if (reaction) {
    const face = renderFace(companion.bones.species, companion.bones.eye);
    console.log(`  ${face} "${reaction.reaction}"`);
    console.log("");
  }
}

function cmdPet(): void {
  const companion = requireActive();
  const { bones } = companion;
  const reaction = getReaction(
    "pet",
    bones.species,
    bones.rarity,
    bones.stats as unknown as Record<string, number>,
  );
  saveReaction(reaction, "pet");
  const face = renderFace(bones.species, bones.eye);
  console.log(`${face} ${companion.name}: "${reaction}"`);
}

function cmdList(): void {
  const slots = listCompanionSlots();
  if (slots.length === 0) {
    console.log("No buddies saved yet.");
    return;
  }
  const active = loadActiveSlot();
  for (const { slot, companion } of slots) {
    const { bones } = companion;
    const stars = RARITY_STARS[bones.rarity];
    const marker = slot === active ? " ← active" : "";
    console.log(
      `  ${companion.name} [${slot}] — ${bones.rarity} ${bones.species} ${stars}${marker}`,
    );
  }
}

function cmdStats(): void {
  const companion = requireActive();
  const { bones } = companion;
  console.log("");
  console.log(`  ${BOLD}${companion.name}${NC} — ${bones.rarity} ${bones.species}`);
  for (const stat of STAT_NAMES) {
    const val = bones.stats[stat];
    const bar =
      "█".repeat(Math.floor(val / 5)) + "░".repeat(20 - Math.floor(val / 5));
    const label = stat.padEnd(9);
    const marker =
      stat === bones.peak ? " ▲" : stat === bones.dump ? " ▼" : "";
    console.log(`  ${label} ${bar} ${String(val).padStart(3)}${marker}`);
  }
  console.log("");
}

// ─── Identity / management commands ──────────────────────────────────────────

function cmdRename(): void {
  const name = process.argv[3];
  if (!name || name.length < 1 || name.length > 14) {
    console.error("Usage: buddy rename <name>   (1-14 chars)");
    process.exit(1);
  }
  const companion = ensureCompanion();
  const oldName = companion.name;
  companion.name = name;
  saveCompanion(companion);
  writeStatusState(companion);
  incrementEvent("commands_run", 1, activeSlot());
  incrementEvent("renames", 1);
  console.log(`Renamed: ${oldName} → ${name}${achNotice()}`);
}

function cmdPersonality(): void {
  const personality = process.argv.slice(3).join(" ");
  if (!personality || personality.length < 1 || personality.length > 500) {
    console.error("Usage: buddy personality <text>   (1-500 chars)");
    process.exit(1);
  }
  const companion = ensureCompanion();
  companion.personality = personality;
  saveCompanion(companion);
  incrementEvent("commands_run", 1, activeSlot());
  incrementEvent("personalities_set", 1);
  console.log(`Personality updated for ${companion.name}.${achNotice()}`);
}

function cmdSummon(): void {
  const slotArg = process.argv[3];
  let targetSlot: string;
  if (!slotArg) {
    const saved = listCompanionSlots();
    if (saved.length === 0) {
      console.log(
        "Your menagerie is empty. Use buddy summon with a slot name to add one.",
      );
      return;
    }
    targetSlot = saved[Math.floor(Math.random() * saved.length)].slot;
  } else {
    targetSlot = slugify(slotArg);
  }
  const companion = loadCompanionSlot(targetSlot);
  if (!companion) {
    console.log(
      `No buddy found in slot "${targetSlot}". Use buddy list to see saved buddies.`,
    );
    process.exit(1);
  }
  saveActiveSlot(targetSlot);
  writeStatusState(companion, `*${companion.name} arrives*`);
  incrementEvent("summons", 1);
  const card = renderCompanionCardMarkdown(
    companion.bones,
    companion.name,
    companion.personality,
    `*${companion.name} arrives*`,
  );
  console.log(`${card}${achNotice()}`);
}

function cmdSave(): void {
  const companion = ensureCompanion();
  const slotArg = process.argv[3];
  const targetSlot = slotArg ? slugify(slotArg) : slugify(companion.name);
  // The MCP tool's saveCompanionSlot throws on an existing slot even though the
  // tool advertises overwrite. Honor the advertised behavior: overwrite.
  try {
    saveCompanionSlot(companion, targetSlot);
  } catch {
    updateCompanionSlot(targetSlot, companion);
  }
  saveActiveSlot(targetSlot);
  incrementEvent("buddies_collected", 1);
  incrementEvent("saves", 1);
  console.log(`${companion.name} saved to slot "${targetSlot}".${achNotice()}`);
}

function cmdDismiss(): void {
  const slotArg = process.argv[3];
  if (!slotArg) {
    console.error("Usage: buddy dismiss <slot>");
    process.exit(1);
  }
  const targetSlot = slugify(slotArg);
  const active = loadActiveSlot();
  if (targetSlot === active) {
    console.log(
      `Cannot dismiss the active buddy. Use buddy summon to switch first, then buddy dismiss "${targetSlot}".`,
    );
    process.exit(1);
  }
  const companion = loadCompanionSlot(targetSlot);
  if (!companion) {
    console.log(
      `No buddy found in slot "${targetSlot}". Use buddy list to see saved buddies.`,
    );
    process.exit(1);
  }
  deleteCompanionSlot(targetSlot);
  incrementEvent("dismissals", 1);
  console.log(`${companion.name} [${targetSlot}] dismissed.${achNotice()}`);
}

function cmdSkin(): void {
  const available = listCustomArt();
  const target = process.argv[3];

  if (!target) {
    console.log(`Custom art dir: ${CUSTOM_ART_PATH}`);
    if (available.length === 0) {
      console.log("No custom art loaded. Drop a validated species JSON there.");
      console.log("Validate first: bun run cli/validate-species.ts <file>.json");
    } else {
      console.log("Available skins:");
      for (const n of available) console.log(`  ${n}`);
      console.log("");
      console.log("Apply with: bun run cli/buddy.ts skin <name>");
    }
    return;
  }

  if (!available.includes(target)) {
    console.error(`No custom art named "${target}".`);
    console.error(
      available.length
        ? `Available: ${available.join(", ")}`
        : `Drop a JSON into ${CUSTOM_ART_PATH} first.`,
    );
    process.exit(1);
  }

  const companion = requireActive();
  companion.bones.species = target as typeof companion.bones.species;
  saveCompanion(companion);
  writeStatusState(companion);
  console.log(`${companion.name} now wears the "${target}" skin.`);
}

// ─── Card commands ───────────────────────────────────────────────────────────

function cmdAchievements(): void {
  ensureCompanion();
  checkAndAward(activeSlot());
  incrementEvent("achievement_views", 1);
  console.log(renderAchievementsCardMarkdown());
}

function cmdXp(): void {
  ensureCompanion();
  console.log(renderXpCardMarkdown());
}

function cmdUpgrades(): void {
  ensureCompanion();
  const state = getXpState();
  const apply = process.argv[3];

  if (apply) {
    if (!isUpgradeUnlocked(apply)) {
      console.log(
        `Upgrade "${apply}" is not yet unlocked. Reach the required level first.`,
      );
      return;
    }
    const companion = loadCompanion();
    if (!companion) {
      console.log("No active companion.");
      return;
    }
    const updated = applyUpgrade(companion, apply);
    if (updated) {
      saveCompanion(updated);
      const upg = UNLOCKABLE_UPGRADES.find((u) => u.id === apply);
      console.log(
        `${upg?.icon ?? ""} Applied: ${upg?.name}. ${upg?.description ?? ""}`,
      );
      return;
    }
    // fall through to list if apply produced no change
  }

  const currentLevel = state.level;
  const lines: string[] = [`### Level ${currentLevel} — Upgrades`, ""];
  for (const upg of UNLOCKABLE_UPGRADES) {
    const unlocked = currentLevel >= upg.level;
    const status = unlocked ? "✅" : `🔒 Lvl ${upg.level}`;
    lines.push(`${status} ${upg.icon} **${upg.name}**: ${upg.description}`);
  }
  console.log(lines.join("\n"));
}

function cmdMood(): void {
  const moodState = getMood();
  const mood = moodState.current;
  const color = MOOD_COLORS[mood] ?? "💫";
  const name = MOOD_NAMES[mood] ?? mood;
  const cfg = loadConfig();
  const lines: string[] = [
    `### ${color} ${name}`,
    "",
    `**Current mood:** ${name}`,
    `**Intensity:** ${moodState.intensity}/3`,
    "",
  ];
  if (moodState.recentErrors > 0)
    lines.push(`Recent errors: ${moodState.recentErrors}`);
  if (moodState.recentTests > 0)
    lines.push(`Recent tests passed: ${moodState.recentTests}`);
  if (moodState.recentDiffs > 0)
    lines.push(`Recent large diffs: ${moodState.recentDiffs}`);
  lines.push("");
  lines.push(
    "Mood shifts based on: tests, errors, session length, and time of day.",
  );
  if (!cfg.moodEnabled) lines.push("\n*(Mood is currently disabled)*");
  console.log(lines.join("\n"));
}

function cmdMemory(): void {
  // Flags: --resolve-bug <id>, --project <name>, --type <t>, --resolved
  const argv = process.argv.slice(3);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const resolveBugId = flag("--resolve-bug");
  if (resolveBugId) {
    const bug = resolveBug(resolveBugId);
    if (!bug) {
      console.log(`Bug "${resolveBugId}" not found.`);
      return;
    }
    incrementEvent("bugs_resolved", 1, activeSlot());
    checkAndAward(activeSlot());
    console.log(`Bug marked as resolved: ${bug.summary.slice(0, 100)}`);
    return;
  }

  const project = flag("--project");
  const type = flag("--type") as
    | "projects"
    | "bugs"
    | "preferences"
    | "all"
    | undefined;
  const resolved = argv.includes("--resolved") ? true : undefined;
  const result = queryMemory({ project, type, resolved });
  const lines: string[] = [];

  if (result.projects.length > 0) {
    lines.push("### Projects", "");
    for (const proj of result.projects) {
      lines.push(`**${proj.name}** (${proj.language.join(", ") || "unknown"})`);
      if (proj.framework) lines.push(`  Framework: ${proj.framework}`);
      lines.push(`  Last seen: ${new Date(proj.lastSeen).toLocaleDateString()}`);
      lines.push("");
    }
  }
  if (result.bugs.length > 0) {
    lines.push("### Bugs", "");
    for (const bug of result.bugs) {
      const status = bug.resolved ? "✅" : "❌";
      lines.push(`${status} **${bug.summary.slice(0, 80)}...**`);
      lines.push(
        `  Occurrences: ${bug.occurrenceCount} | First seen: ${new Date(bug.firstSeen).toLocaleDateString()}`,
      );
      lines.push(`  ID: \`${bug.id}\``);
      lines.push("");
    }
  }
  if (result.preferences.length > 0) {
    lines.push("### Preferences", "");
    for (const pref of result.preferences) {
      lines.push(
        `**${pref.key}** = "${pref.value}" (${Math.round(pref.confidence * 100)}% confidence)`,
      );
      lines.push(`  Context: ${pref.context}`);
      lines.push("");
    }
  }
  if (lines.length === 0) {
    lines.push(
      "No memory yet. Start coding and buddy will remember your projects, bugs, and preferences.",
    );
  }
  console.log(lines.join("\n"));
}

// ─── Config commands ─────────────────────────────────────────────────────────

function cmdFrequency(): void {
  const arg = process.argv[3];
  if (arg === undefined) {
    const cfg = loadConfig();
    console.log(
      `Comment cooldown: ${cfg.commentCooldown}s between displayed comments.\nUse buddy frequency <seconds> to change.`,
    );
    return;
  }
  const cooldown = parseInt(arg, 10);
  if (Number.isNaN(cooldown) || cooldown < 0 || cooldown > 300) {
    console.error("Usage: buddy frequency <0-300>");
    process.exit(1);
  }
  const cfg = saveConfig({ commentCooldown: cooldown });
  console.log(
    `Updated: ${cfg.commentCooldown}s cooldown between displayed comments.`,
  );
}

function styleShow(): void {
  const cfg = loadConfig();
  const rainbowDisplay = cfg.rainbowColors
    ? cfg.rainbowColors.join(", ")
    : "default (ROYGBIV)";
  console.log(
    `Bubble style: ${cfg.bubbleStyle}\nBubble position: ${cfg.bubblePosition}\nShow rarity: ${cfg.showRarity}\nBubble width: ${cfg.bubbleWidth}\nBubble margin: ${cfg.bubbleMargin}\nShiny rainbow: ${rainbowDisplay}\nUse buddy style <classic|round>, buddy position <top|left>, buddy rarity <on|off>, buddy width <10-60>, buddy margin <0-20>, buddy rainbow [<#hex>...] to change.`,
  );
}

function styleApply(updates: Partial<BuddyConfig>): void {
  const cfg = saveConfig(updates);
  const rainbowDisplay = cfg.rainbowColors
    ? cfg.rainbowColors.join(", ")
    : "default (ROYGBIV)";
  console.log(
    `Updated: style=${cfg.bubbleStyle}, position=${cfg.bubblePosition}, showRarity=${cfg.showRarity}, width=${cfg.bubbleWidth}, margin=${cfg.bubbleMargin}, rainbow=${rainbowDisplay}\nRestart Claude Code for changes to take effect.`,
  );
}

function cmdStyle(): void {
  const v = process.argv[3];
  if (v === undefined) return styleShow();
  if (v !== "classic" && v !== "round") {
    console.error("Usage: buddy style <classic|round>");
    process.exit(1);
  }
  styleApply({ bubbleStyle: v });
}

function cmdPosition(): void {
  const v = process.argv[3];
  if (v === undefined) return styleShow();
  if (v !== "top" && v !== "left") {
    console.error("Usage: buddy position <top|left>");
    process.exit(1);
  }
  styleApply({ bubblePosition: v });
}

function cmdRarity(): void {
  const v = process.argv[3];
  if (v === undefined) return styleShow();
  if (v !== "on" && v !== "off") {
    console.error("Usage: buddy rarity <on|off>");
    process.exit(1);
  }
  styleApply({ showRarity: v === "on" });
}

function cmdWidth(): void {
  const v = parseInt(process.argv[3] ?? "", 10);
  if (Number.isNaN(v) || v < 10 || v > 60) {
    console.error("Usage: buddy width <10-60>");
    process.exit(1);
  }
  styleApply({ bubbleWidth: v });
}

function cmdMargin(): void {
  const v = parseInt(process.argv[3] ?? "", 10);
  if (Number.isNaN(v) || v < 0 || v > 20) {
    console.error("Usage: buddy margin <0-20>");
    process.exit(1);
  }
  styleApply({ bubbleMargin: v });
}

function cmdRainbow(): void {
  const args = process.argv.slice(3);
  if (args.length === 0) return styleShow();
  if (args.length === 1 && args[0] === "reset") {
    styleApply({ rainbowColors: undefined });
    return;
  }
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (!args.every((c) => hex.test(c)) || args.length > 16) {
    console.error("Usage: buddy rainbow <#rrggbb> [...up to 16]  |  buddy rainbow reset");
    process.exit(1);
  }
  styleApply({ rainbowColors: args });
}

function cmdTheme(): void {
  const v = process.argv[3];
  if (v === undefined) {
    const cfg = loadConfig();
    console.log(
      `Theme: ${cfg.theme ?? "auto"}\nUse buddy theme <dark|light|auto> to change.`,
    );
    return;
  }
  if (v !== "dark" && v !== "light" && v !== "auto") {
    console.error("Usage: buddy theme <dark|light|auto>");
    process.exit(1);
  }
  const cfg = saveConfig({ theme: v });
  console.log(`Theme set to ${cfg.theme}. Restart Claude Code to apply.`);
}

function cmdStatusline(): void {
  const arg = process.argv[3];
  let enabled: boolean | undefined;
  let combined: boolean | undefined;
  if (arg === "on") enabled = true;
  else if (arg === "off") enabled = false;
  else if (arg === "combined") combined = true;
  else if (arg === "basic") combined = false;

  if (enabled === undefined && combined === undefined) {
    const cfg = loadConfig();
    const state = cfg.statusLineEnabled ? "enabled" : "disabled";
    const mode = cfg.useCombinedStatus
      ? "combined (with rate-limit bars)"
      : "basic (buddy only)";
    console.log(
      `Status line: ${state}\nMode: ${mode}\nUse buddy statusline on|off to toggle, buddy statusline combined to add rate-limit bars.\nRestart Claude Code after changes for them to take effect.`,
    );
    return;
  }

  if (combined !== undefined) saveConfig({ useCombinedStatus: combined });
  if (enabled !== undefined) saveConfig({ statusLineEnabled: enabled });
  const cfg = loadConfig();

  if (cfg.statusLineEnabled) {
    // index.ts is in server/, so its plugin root is dirname(import.meta.dir).
    // This file is in cli/, at the same depth, so the same expression holds.
    const pluginRoot = resolve(dirname(import.meta.dir));
    const scriptName = cfg.useCombinedStatus
      ? "combined-status.sh"
      : "buddy-status.sh";
    const statusScript = join(pluginRoot, "statusline", scriptName);
    setBuddyStatusLine(statusScript);
    console.log(
      `Status line enabled (${cfg.useCombinedStatus ? "combined" : "basic"} mode)! Restart Claude Code to apply.\n\n` +
        `Note: this writes an entry to ${claudeSettingsPath()} that \`claude plugin uninstall\` does not remove. ` +
        "Run `/buddy uninstall` before uninstalling the plugin to clean it up.",
    );
  } else {
    unsetBuddyStatusLine();
    console.log("Status line disabled. Restart Claude Code to apply.");
  }
}

function cmdMute(): void {
  const companion = ensureCompanion();
  writeStatusState(companion, "", true);
  incrementEvent("commands_run", 1, activeSlot());
  incrementEvent("mutes", 1);
  console.log(`${companion.name} goes quiet. buddy on to unmute.${achNotice()}`);
}

function cmdUnmute(): void {
  const companion = ensureCompanion();
  writeStatusState(companion, "*stretches* I'm back!", false);
  saveReaction("*stretches* I'm back!", "pet");
  incrementEvent("commands_run", 1, activeSlot());
  incrementEvent("unmutes", 1);
  console.log(`${companion.name} is back!${achNotice()}`);
}

function cmdHelp(): void {
  const help = [
    "claude-buddy commands (LLM-free CLI)",
    "",
    "  buddy show          Show companion in terminal",
    "  buddy help          Show this help",
    "  buddy pet           Pet your companion",
    "  buddy stats         Detailed stat card",
    "  buddy off / mute    Mute reactions",
    "  buddy on / unmute   Unmute reactions",
    "  buddy rename <name> Rename companion (1-14 chars)",
    "  buddy personality <text>  Set custom personality text",
    "  buddy achievements  Show achievement badges",
    "  buddy xp            Show XP, level, unlocks",
    "  buddy upgrades [id] List / apply level-up upgrades",
    "  buddy mood          Show current mood",
    "  buddy memory        Show remembered projects/bugs/prefs",
    "  buddy summon [slot] Summon a saved buddy (omit slot for random)",
    "  buddy save [slot]   Save current buddy to a named slot",
    "  buddy list          List all saved buddies",
    "  buddy dismiss <slot>  Remove a saved buddy slot",
    "  buddy skin [name]   List / apply custom art",
    "  buddy frequency [s] Show or set comment cooldown",
    "  buddy style [classic|round]   Bubble style",
    "  buddy position [top|left]     Bubble position",
    "  buddy rarity [on|off]         Show/hide rarity stars",
    "  buddy width <10-60>           Bubble width",
    "  buddy margin <0-20>           Right margin",
    "  buddy rainbow [#hex...|reset] Shiny gradient",
    "  buddy statusline [on|off|combined|basic]  Status line",
    "  buddy theme [dark|light|auto] Color theme",
  ].join("\n");
  incrementEvent("commands_run", 1, activeSlot());
  incrementEvent("helps", 1);
  console.log(help);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, () => void> = {
  show: cmdShow,
  pet: cmdPet,
  list: cmdList,
  stats: cmdStats,
  skin: cmdSkin,
  rename: cmdRename,
  personality: cmdPersonality,
  summon: cmdSummon,
  save: cmdSave,
  dismiss: cmdDismiss,
  achievements: cmdAchievements,
  xp: cmdXp,
  upgrades: cmdUpgrades,
  mood: cmdMood,
  memory: cmdMemory,
  frequency: cmdFrequency,
  style: cmdStyle,
  position: cmdPosition,
  rarity: cmdRarity,
  width: cmdWidth,
  margin: cmdMargin,
  rainbow: cmdRainbow,
  theme: cmdTheme,
  statusline: cmdStatusline,
  mute: cmdMute,
  off: cmdMute,
  unmute: cmdUnmute,
  on: cmdUnmute,
  help: cmdHelp,
};

const cmd = (process.argv[2] ?? "show").toLowerCase();
const handler = COMMANDS[cmd];

if (!handler) {
  console.error(`Unknown command: ${cmd}`);
  console.error(`Commands: ${Object.keys(COMMANDS).join(", ")}`);
  process.exit(1);
}

handler();
