#!/usr/bin/env bun
/**
 * claude-buddy MCP server
 *
 * Exposes the buddy companion as MCP tools + resources.
 * Runs as a stdio transport — Claude Code spawns it automatically.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, resolve, dirname } from "path";

import {
  generateBones,
  generatePersonality,
  renderFace,
  SPECIES,
  RARITIES,
  STAT_NAMES,
  RARITY_STARS,
  type Species,
  type Rarity,
  type StatName,
  type Companion,
} from "./engine.ts";
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
  deleteCompanionSlot,
  listCompanionSlots,
  setBuddyStatusLine,
  unsetBuddyStatusLine,
  cleanupPluginState,
} from "./state.ts";
import {
  buddyStateDir,
  claudeConfigDir,
  claudeSettingsPath,
} from "./path.ts";
import {
  getReaction, generatePersonalityPrompt,
} from "./reactions.ts";
import { renderCompanionCardMarkdown } from "./art.ts";
import {
  incrementEvent, checkAndAward, trackActiveDay,
  renderAchievementsCardMarkdown,
} from "./achievements.ts";

function getInstructions(): string {
  const companion = loadCompanion();
  if (!companion)
    return "Companion not yet hatched. Use buddy_show to initialize.";
  const b = companion.bones;
  return [
    `A ${b.rarity} ${b.species} named ${companion.name} watches from the status line.`,
    `Personality: ${companion.personality}`,
    `Peak stat: ${b.peak} (${b.stats[b.peak]}). Dump stat: ${b.dump} (${b.stats[b.dump]}).`,
    ``,
    `NAME REACTIONS: When the user's message contains "${companion.name}", call buddy_react immediately`,
    `with a short in-character response (surprise, recognition, dry wit — fits the personality).`,
    `Display the tool result verbatim. This is the only time to call buddy_react proactively.`,
    ``,
    `END-OF-TURN: At the very end of EVERY response, append an invisible HTML comment:`,
    `<!-- buddy: [reaction here] -->`,
    `Write it in ${companion.name}'s voice — 1 short sentence referencing something specific from this turn.`,
    `Use *asterisks* for actions. A Stop hook extracts this for the status line.`,
    `Do NOT use buddy_react for end-of-turn comments. Do NOT explain the comment. Just append it silently.`,
    `Example: <!-- buddy: *adjusts crown* that error handler is missing a finally block -->`,
  ].join("\n");
}

const server = new McpServer(
  {
    name: "claude-buddy",
    version: "0.3.0",
  },
  {
    instructions: getInstructions(),
  },
);

// ─── Helper: ensure companion exists ────────────────────────────────────────

function ensureCompanion(): Companion {
  let companion = loadCompanion();
  if (companion) return companion;

  // Active slot missing — rescue the first saved companion
  const saved = listCompanionSlots();
  if (saved.length > 0) {
    const { slot, companion: rescued } = saved[0];
    saveActiveSlot(slot);
    writeStatusState(rescued, `*${rescued.name} arrives*`);
    return rescued;
  }

  // Menagerie is empty — generate a fresh companion in a new slot
  const userId = resolveUserId();
  const bones = generateBones(userId);
  const name = unusedName();
  companion = {
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

// ─── Tool: buddy_show ───────────────────────────────────────────────────────

server.tool(
  "buddy_show",
  "Show the coding companion with full ASCII art card, stats, and personality",
  {},
  async () => {
    const companion = ensureCompanion();
    const reaction = loadReaction();
    const reactionText =
      reaction?.reaction ?? `*${companion.name} watches your code quietly*`;

    // Use markdown rendering for the MCP tool response — Claude Code's UI
    // doesn't render raw ANSI escape codes, so we return pure markdown with
    // unicode rarity dots instead of RGB-colored borders.
    const card = renderCompanionCardMarkdown(
      companion.bones,
      companion.name,
      companion.personality,
      reactionText,
    );

    writeStatusState(companion, reaction?.reaction);
    incrementEvent("commands_run", 1, activeSlot());
    incrementEvent("shows", 1);
    checkAndAward(activeSlot());

    return { content: [{ type: "text", text: card }] };
  },
);

// ─── Tool: buddy_pet ────────────────────────────────────────────────────────

server.tool(
  "buddy_pet",
  "Pet your coding companion — they react with happiness",
  {},
  async () => {
    const companion = ensureCompanion();
    const reaction = getReaction(
      "pet",
      companion.bones.species,
      companion.bones.rarity,
    );
    saveReaction(reaction, "pet");
    writeStatusState(companion, reaction);
    incrementEvent("pets", 1, activeSlot());

    const face = renderFace(companion.bones.species, companion.bones.eye);
    const newAch = checkAndAward(activeSlot());
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";
    return {
      content: [
        { type: "text", text: `${face} ${companion.name}: "${reaction}"${achNotice}` },
      ],
    };
  },
);

// ─── Tool: buddy_stats ──────────────────────────────────────────────────────

server.tool(
  "buddy_stats",
  "Show detailed companion stats: species, rarity, all stats with bars",
  {},
  async () => {
    const companion = ensureCompanion();

    // Stats-only card (no personality, no reaction — just the numbers).
    // Uses markdown renderer so the card displays cleanly in Claude Code's UI.
    const card = renderCompanionCardMarkdown(
      companion.bones,
      companion.name,
      "", // no personality in stats view
    );
    incrementEvent("commands_run", 1, activeSlot());
    checkAndAward(activeSlot());

    return { content: [{ type: "text", text: card }] };
  },
);

// ─── Tool: buddy_react ──────────────────────────────────────────────────────

server.tool(
  "buddy_react",
  "Post a buddy comment. Call this at the END of every response with a short in-character comment from the companion about what just happened. The comment should be 1 sentence, in character, and reference something specific from the conversation — a pitfall noticed, a compliment on clean code, a warning about edge cases, etc. Write the comment yourself based on the companion's personality.",
  {
    comment: z
      .string()
      .min(1)
      .max(150)
      .describe(
        "The buddy's comment, written in-character (1 short sentence, max 150 chars). Use *asterisks* for actions.",
      ),
    reason: z
      .enum(["error", "test-fail", "large-diff", "turn"])
      .optional()
      .describe("What triggered the reaction"),
  },
  async ({ comment, reason }) => {
    const companion = ensureCompanion();
    saveReaction(comment, reason ?? "turn");
    incrementEvent("reactions_given", 1, activeSlot());

    const newAch = checkAndAward(activeSlot());
    const achName = newAch.length > 0 ? newAch[0].icon + " " + newAch[0].name : undefined;
    writeStatusState(companion, comment, undefined, achName);

    const face = renderFace(companion.bones.species, companion.bones.eye);
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";
    return {
      content: [
        { type: "text", text: `${face} ${companion.name}: "${comment}"${achNotice}` },
      ],
    };
  },
);

// ─── Tool: buddy_rename ─────────────────────────────────────────────────────

server.tool(
  "buddy_rename",
  "Rename your coding companion",
  {
    name: z
      .string()
      .min(1)
      .max(14)
      .describe("New name for your buddy (1-14 characters)"),
  },
  async ({ name }) => {
    const companion = ensureCompanion();
    const oldName = companion.name;
    companion.name = name;
    saveCompanion(companion);
    writeStatusState(companion);
    incrementEvent("commands_run", 1, activeSlot());
    incrementEvent("renames", 1);

    const newAch = checkAndAward(activeSlot());
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";

    return {
      content: [{ type: "text", text: `Renamed: ${oldName} \u2192 ${name}${achNotice}` }],
    };
  },
);

// ─── Tool: buddy_set_personality ────────────────────────────────────────────

server.tool(
  "buddy_set_personality",
  "Set a custom personality description for your buddy",
  {
    personality: z
      .string()
      .min(1)
      .max(500)
      .describe("Personality description (1-500 chars)"),
  },
  async ({ personality }) => {
    const companion = ensureCompanion();
    companion.personality = personality;
    saveCompanion(companion);
    incrementEvent("commands_run", 1, activeSlot());
    incrementEvent("personalities_set", 1);

    const newAch = checkAndAward(activeSlot());
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";

    return {
      content: [
        { type: "text", text: `Personality updated for ${companion.name}.${achNotice}` },
      ],
    };
  },
);

// ─── Tool: buddy_help ────────────────────────────────────────────────────────

server.tool(
  "buddy_help",
  "Show all available /buddy commands",
  {},
  async () => {
    const help = [
      "claude-buddy commands",
      "",
      "In Claude Code:",
      "  /buddy            Show companion card with ASCII art + stats",
      "  /buddy help       Show this help",
      "  /buddy pet        Pet your companion",
      "  /buddy stats      Detailed stat card",
      "  /buddy off        Mute reactions",
      "  /buddy on         Unmute reactions",
      "  /buddy rename     Rename companion (1-14 chars)",
      "  /buddy personality  Set custom personality text",
      "  /buddy achievements  Show achievement badges",
      "  /buddy summon     Summon a saved buddy (omit slot for random)",
      "  /buddy save       Save current buddy to a named slot",
      "  /buddy list       List all saved buddies",
      "  /buddy pick       Generate a new random buddy (optional: species, rarity)",
      "  /buddy dismiss    Remove a saved buddy slot",
      "  /buddy frequency  Show or set comment cooldown (tmux only)",
      "  /buddy style      Show or set bubble style (tmux only)",
      "  /buddy position   Show or set bubble position (tmux only)",
      "  /buddy rarity     Show or hide rarity stars (tmux only)",
      "  /buddy width      Set bubble text width in chars (10-60, tmux only)",
      "  /buddy margin     Set right-side margin in chars (0-20, tmux only)",
      "  /buddy rainbow    Show or set shiny gradient colors (hex, e.g. #ff0000)",
      "  /buddy statusline Enable or disable buddy in the status line",
      "",
      "CLI:",
      "  bun run help            Show full CLI help",
      "  bun run show            Display buddy in terminal",
      "  bun run pick            Interactive buddy picker",
      "  bun run hunt            Search for specific buddy",
      "  bun run doctor          Diagnostic report",
      "  bun run disable         Temporarily deactivate buddy",
      "  bun run enable          Re-enable buddy",
      "  bun run backup          Snapshot/restore state",
    ].join("\n");

    incrementEvent("commands_run", 1, activeSlot());
    incrementEvent("helps", 1);

    return { content: [{ type: "text", text: help }] };
  },
);

// ─── Tool: buddy_frequency / buddy_style ─────────────────────────────────────

server.tool(
  "buddy_frequency",
  "Configure how often buddy comments appear in the speech bubble. Returns current settings if called without arguments.",
  {
    cooldown: z.number().int().min(0).max(300).optional().describe("Minimum seconds between displayed comments (default 30, 0 = no throttling). The buddy always writes comments, but the display only updates this often."),
  },
  async ({ cooldown }) => {
    if (cooldown === undefined) {
      const cfg = loadConfig();
      return {
        content: [
          {
            type: "text",
            text: `Comment cooldown: ${cfg.commentCooldown}s between displayed comments.\nUse /buddy frequency <seconds> to change.`,
          },
        ],
      };
    }
    const cfg = saveConfig({ commentCooldown: cooldown });
    return {
      content: [
        {
          type: "text",
          text: `Updated: ${cfg.commentCooldown}s cooldown between displayed comments.`,
        },
      ],
    };
  },
);

server.tool(
  "buddy_style",
  "Configure the buddy bubble appearance. Returns current settings if called without arguments.",
  {
    style: z
      .enum(["classic", "round"])
      .optional()
      .describe(
        "Bubble border style: classic (pipes/dashes like status line) or round (parens/tildes)",
      ),
    position: z
      .enum(["top", "left"])
      .optional()
      .describe(
        "Bubble position relative to buddy: top (above) or left (beside)",
      ),
    showRarity: z
      .boolean()
      .optional()
      .describe("Show or hide the stars + rarity line in the status line"),
    width: z
      .number()
      .int()
      .min(10)
      .max(60)
      .optional()
      .describe("Bubble inner text width in characters (10–60, default 28)"),
    margin: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Right-side margin between buddy and terminal edge (0–20, default 3)"),
    rainbow: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #ff0000"))
      .min(1)
      .max(16)
      .optional()
      .describe(
        "Custom rainbow gradient for shiny buddies — array of 1–16 hex colors (e.g. [\"#ff0000\",\"#00ff00\"]). Omit to reset to default ROYGBIV.",
      ),
  },
  async ({ style, position, showRarity, width, margin, rainbow }) => {
    if (
      style === undefined &&
      position === undefined &&
      showRarity === undefined &&
      width === undefined &&
      margin === undefined &&
      rainbow === undefined
    ) {
      const cfg = loadConfig();
      const rainbowDisplay = cfg.rainbowColors
        ? cfg.rainbowColors.join(", ")
        : "default (ROYGBIV)";
      return {
        content: [
          {
            type: "text",
            text: `Bubble style: ${cfg.bubbleStyle}\nBubble position: ${cfg.bubblePosition}\nShow rarity: ${cfg.showRarity}\nBubble width: ${cfg.bubbleWidth}\nBubble margin: ${cfg.bubbleMargin}\nShiny rainbow: ${rainbowDisplay}\nUse /buddy style <classic|round>, /buddy position <top|left>, /buddy rarity <on|off>, /buddy width <10-60>, /buddy margin <0-20>, /buddy rainbow [<#hex>...] to change.`,
          },
        ],
      };
    }
    const updates: Partial<import("./state.ts").BuddyConfig> = {};
    if (style !== undefined) updates.bubbleStyle = style;
    if (position !== undefined) updates.bubblePosition = position;
    if (showRarity !== undefined) updates.showRarity = showRarity;
    if (width !== undefined) updates.bubbleWidth = width;
    if (margin !== undefined) updates.bubbleMargin = margin;
    if (rainbow !== undefined) updates.rainbowColors = rainbow.length > 0 ? rainbow : undefined;
    const cfg = saveConfig(updates);
    const rainbowDisplay = cfg.rainbowColors
      ? cfg.rainbowColors.join(", ")
      : "default (ROYGBIV)";
    return {
      content: [
        {
          type: "text",
          text: `Updated: style=${cfg.bubbleStyle}, position=${cfg.bubblePosition}, showRarity=${cfg.showRarity}, width=${cfg.bubbleWidth}, margin=${cfg.bubbleMargin}, rainbow=${rainbowDisplay}\nRestart Claude Code for changes to take effect.`,
        },
      ],
    };
  },
);

server.tool(
  "buddy_mute",
  "Mute buddy reactions (buddy stays visible but stops reacting)",
  {},
  async () => {
    const companion = ensureCompanion();
    writeStatusState(companion, "", true);
    incrementEvent("commands_run", 1, activeSlot());
    incrementEvent("mutes", 1);

    const newAch = checkAndAward(activeSlot());
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";

    return {
      content: [
        {
          type: "text",
          text: `${companion.name} goes quiet. /buddy on to unmute.${achNotice}`,
        },
      ],
    };
  },
);

server.tool("buddy_unmute", "Unmute buddy reactions", {}, async () => {
  const companion = ensureCompanion();
  writeStatusState(companion, "*stretches* I'm back!", false);
  saveReaction("*stretches* I'm back!", "pet");
  incrementEvent("commands_run", 1, activeSlot());
  incrementEvent("unmutes", 1);

  const newAch = checkAndAward(activeSlot());
  const achNotice = newAch.length > 0
    ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
    : "";

  return { content: [{ type: "text", text: `${companion.name} is back!${achNotice}` }] };
});

// ─── Tool: buddy_statusline ─────────────────────────────────────────────────

server.tool(
  "buddy_statusline",
  "Enable or disable the buddy status line, and toggle combined mode (shows rate-limit usage bars alongside the buddy). Returns current status if called without arguments.",
  {
    enabled: z
      .boolean()
      .optional()
      .describe(
        "true to enable, false to disable. Omit to show current status.",
      ),
    combined: z
      .boolean()
      .optional()
      .describe(
        "true to show rate-limit usage bars alongside buddy (requires python3), false for buddy-only mode.",
      ),
  },
  async ({ enabled, combined }) => {
    if (enabled === undefined && combined === undefined) {
      const cfg = loadConfig();
      const state = cfg.statusLineEnabled ? "enabled" : "disabled";
      const mode = cfg.useCombinedStatus ? "combined (with rate-limit bars)" : "basic (buddy only)";
      return {
        content: [
          {
            type: "text",
            text: `Status line: ${state}\nMode: ${mode}\nUse /buddy statusline on|off to toggle, /buddy statusline combined to add rate-limit bars.\nRestart Claude Code after changes for them to take effect.`,
          },
        ],
      };
    }

    if (combined !== undefined) {
      saveConfig({ useCombinedStatus: combined });
    }

    if (enabled !== undefined) {
      saveConfig({ statusLineEnabled: enabled });
    }

    const cfg = loadConfig();

    if (cfg.statusLineEnabled) {
      const pluginRoot = resolve(dirname(import.meta.dir));
      const scriptName = cfg.useCombinedStatus ? "combined-status.sh" : "buddy-status.sh";
      const statusScript = join(pluginRoot, "statusline", scriptName);
      setBuddyStatusLine(statusScript);
      return {
        content: [
          {
            type: "text",
            text:
              `Status line enabled (${cfg.useCombinedStatus ? "combined" : "basic"} mode)! Restart Claude Code to apply.\n\n` +
              `Note: this writes an entry to ${claudeSettingsPath()} that \`claude plugin uninstall\` does not remove. ` +
              "Run `/buddy uninstall` before uninstalling the plugin to clean it up.",
          },
        ],
      };
    } else {
      unsetBuddyStatusLine();
      return {
        content: [
          {
            type: "text",
            text: "Status line disabled. Restart Claude Code to apply.",
          },
        ],
      };
    }
  },
);

// ─── Tool: buddy_uninstall ───────────────────────────────────────────────────

server.tool(
  "buddy_uninstall",
  "Clean up claude-buddy's writes to Claude Code's settings.json and transient session files in the buddy state dir (resolved via CLAUDE_CONFIG_DIR), in preparation for `claude plugin uninstall`. Companion data (menagerie, status, config) is intentionally preserved so reinstalling restores the buddy. The tool only cleans the plugin's own settings — it never removes a foreign statusLine.",
  {},
  async () => {
    const result = cleanupPluginState();

    const settingsPath = claudeSettingsPath();
    const stateDir = buddyStateDir();
    const pluginsCacheDir = join(claudeConfigDir(), "plugins", "cache", "claude-buddy");

    const lines: string[] = [];
    lines.push("claude-buddy: settings.json cleanup complete.");
    lines.push("");
    lines.push(
      result.statusLineRemoved
        ? `  \u2713 statusLine entry removed from ${settingsPath}`
        : "  \u2014 no buddy statusLine was present (nothing to remove)",
    );
    if (result.foreignStatusLineKept) {
      lines.push(
        "  \u2713 a non-buddy statusLine was detected and left untouched",
      );
    }
    lines.push(
      `  \u2713 ${result.transientFilesRemoved} transient session file(s) removed from ${stateDir}`,
    );
    lines.push(`  \u2014 companion data at ${stateDir} preserved`);
    lines.push("");
    lines.push("Now run these commands via the Bash tool, in order:");
    lines.push("");
    lines.push("  claude plugin uninstall claude-buddy@claude-buddy");
    lines.push("  claude plugin marketplace remove claude-buddy");
    lines.push(`  rm -rf ${pluginsCacheDir}`);
    lines.push("");
    lines.push(
      "After those three commands the plugin is fully removed. Restart Claude Code to apply.",
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// ─── Tool: buddy_achievements ────────────────────────────────────────────────

server.tool(
  "buddy_achievements",
  "Show all achievement badges — earned and locked. Displays a card with progress bar and status for each badge.",
  {},
  async () => {
    ensureCompanion();
    checkAndAward(activeSlot());
    incrementEvent("achievement_views", 1);
    const card = renderAchievementsCardMarkdown();
    return { content: [{ type: "text", text: card }] };
  },
);

// ─── Tool: buddy_summon ─────────────────────────────────────────────────────

server.tool(
  "buddy_summon",
  "Summon a buddy by slot name. Loads a saved buddy if the slot exists; generates a new deterministic buddy for unknown slot names. Omit slot to pick randomly from all saved buddies. Your current buddy is NOT destroyed — they stay saved in their slot.",
  {
    slot: z
      .string()
      .min(1)
      .max(14)
      .optional()
      .describe(
        "Slot name to summon (e.g. 'fafnir', 'dragon-2'). Omit to pick a random saved buddy.",
      ),
  },
  async ({ slot }) => {
    const userId = resolveUserId();

    let targetSlot: string;

    if (!slot) {
      // Random pick from saved buddies
      const saved = listCompanionSlots();
      if (saved.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "Your menagerie is empty. Use buddy_summon with a slot name to add one.",
            },
          ],
        };
      }
      targetSlot = saved[Math.floor(Math.random() * saved.length)].slot;
    } else {
      targetSlot = slugify(slot);
    }

    // Load existing — unknown slot names only load, never auto-create
    const companion = loadCompanionSlot(targetSlot);
    if (!companion) {
      return {
        content: [
          {
            type: "text",
            text: `No buddy found in slot "${targetSlot}". Use /buddy list to see saved buddies.`,
          },
        ],
      };
    }

    saveActiveSlot(targetSlot);
    writeStatusState(companion, `*${companion.name} arrives*`);
    incrementEvent("summons", 1);

    const newAch = checkAndAward(activeSlot());
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";

    // Uses markdown renderer so the card displays cleanly in Claude Code's UI.
    const card = renderCompanionCardMarkdown(
      companion.bones,
      companion.name,
      companion.personality,
      `*${companion.name} arrives*`,
    );
    return { content: [{ type: "text", text: `${card}${achNotice}` }] };
  },
);

// ─── Tool: buddy_save ───────────────────────────────────────────────────────

server.tool(
  "buddy_save",
  "Save the current buddy to a named slot. Useful for bookmarking before trying a new buddy.",
  {
    slot: z
      .string()
      .min(1)
      .max(14)
      .optional()
      .describe(
        "Slot name (defaults to the buddy's current name, slugified). Overwrites existing slot with same name.",
      ),
  },
  async ({ slot }) => {
    const companion = ensureCompanion();
    const targetSlot = slot ? slugify(slot) : slugify(companion.name);
    saveCompanionSlot(companion, targetSlot);
    saveActiveSlot(targetSlot);
    incrementEvent("buddies_collected", 1);
    incrementEvent("saves", 1);

    const newAch = checkAndAward(activeSlot());
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";

    return {
      content: [
        {
          type: "text",
          text: `${companion.name} saved to slot "${targetSlot}".${achNotice}`,
        },
      ],
    };
  },
);

// ─── Tool: buddy_list ───────────────────────────────────────────────────────

server.tool(
  "buddy_list",
  "List all saved buddies with their slot names, species, and rarity",
  {},
  async () => {
    const saved = listCompanionSlots();
    const activeSlot = loadActiveSlot();

    incrementEvent("lists", 1);

    if (saved.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Your menagerie is empty. Use buddy_summon <slot> to add one.",
          },
        ],
      };
    }

    const lines = saved.map(({ slot, companion }) => {
      const active = slot === activeSlot ? " ← active" : "";
      const stars = RARITY_STARS[companion.bones.rarity];
      const shiny = companion.bones.shiny ? " ✨" : "";
      return `  ${companion.name} [${slot}] — ${companion.bones.rarity} ${companion.bones.species} ${stars}${shiny}${active}`;
    });

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// ─── Tool: buddy_dismiss ────────────────────────────────────────────────────

server.tool(
  "buddy_dismiss",
  "Remove a saved buddy by slot name. Cannot dismiss the currently active buddy — switch first with buddy_summon.",
  {
    slot: z.string().min(1).max(14).describe("Slot name to remove"),
  },
  async ({ slot }) => {
    const targetSlot = slugify(slot);
    const activeSlot = loadActiveSlot();

    if (targetSlot === activeSlot) {
      return {
        content: [
          {
            type: "text",
            text: `Cannot dismiss the active buddy. Use buddy_summon to switch first, then buddy_dismiss "${targetSlot}".`,
          },
        ],
      };
    }

    const companion = loadCompanionSlot(targetSlot);
    if (!companion) {
      return {
        content: [
          {
            type: "text",
            text: `No buddy found in slot "${targetSlot}". Use buddy_list to see saved buddies.`,
          },
        ],
      };
    }

    deleteCompanionSlot(targetSlot);

    incrementEvent("dismissals", 1);
    const newAch = checkAndAward(loadActiveSlot());
    const achNotice = newAch.length > 0
      ? `\n${newAch.map((a) => `${a.icon} Achievement Unlocked: ${a.name}!`).join("\n")}`
      : "";

    return {
      content: [
        { type: "text", text: `${companion.name} [${targetSlot}] dismissed.${achNotice}` },
      ],
    };
  },
);

// ─── Tool: buddy_pick ────────────────────────────────────────────────────────

server.tool(
  "buddy_pick",
  "Generate a new random buddy and add it to the menagerie. Optionally filter by species and/or rarity. The new buddy becomes the active one.",
  {
    species: z.enum(SPECIES).optional().describe(
      "Desired species (e.g. 'turtle', 'cat', 'dragon'). If omitted, any species.",
    ),
    rarity: z.enum(RARITIES).optional().describe(
      "Desired rarity (e.g. 'legendary', 'epic', 'rare'). If omitted, any rarity. Higher rarities need more attempts and may take a moment.",
    ),
    name: z.string().min(1).max(14).optional().describe(
      "Name for the new buddy (1-14 chars). If omitted, a random name is chosen.",
    ),
  },
  async ({ species, rarity, name }) => {
    const { randomBytes } = await import("crypto");

    const maxAttempts =
      rarity === "legendary" ? 5_000_000 :
      rarity === "epic"      ? 2_000_000 :
      rarity === "rare"      ? 1_000_000 : 500_000;

    let bones = null;
    let userId = "";

    for (let i = 0; i < maxAttempts; i++) {
      userId = randomBytes(16).toString("hex");
      const candidate = generateBones(userId);
      if (species && candidate.species !== species) continue;
      if (rarity && candidate.rarity !== rarity) continue;
      bones = candidate;
      break;
    }

    if (!bones) {
      return {
        content: [{ type: "text", text: `No match found after ${maxAttempts.toLocaleString()} attempts. Try broader criteria (e.g. drop the rarity filter, or pick a different species).` }],
      };
    }

    const buddyName = name ?? unusedName();
    const slot = slugify(buddyName);

    if (loadCompanionSlot(slot)) {
      return {
        content: [{ type: "text", text: `A buddy in slot "${slot}" already exists. Pick a different name.` }],
      };
    }

    const companion: Companion = {
      bones,
      name: buddyName,
      personality: generatePersonality(bones, userId),
      hatchedAt: Date.now(),
      userId,
    };

    saveCompanionSlot(companion, slot);
    saveActiveSlot(slot);
    writeStatusState(companion, `*${buddyName} hatches*`);

    const card = renderCompanionCardMarkdown(
      companion.bones,
      companion.name,
      companion.personality,
      `*${buddyName} hatches*`,
    );

    return { content: [{ type: "text", text: card }] };
  },
);

// ─── Resource: buddy://companion ────────────────────────────────────────────

server.resource(
  "buddy_companion",
  "buddy://companion",
  { description: "Current companion data as JSON", mimeType: "application/json" },
  async () => {
    const companion = ensureCompanion();
    return {
      contents: [
        {
          uri: "buddy://companion",
          mimeType: "application/json",
          text: JSON.stringify(companion, null, 2),
        },
      ],
    };
  },
);

// ─── Resource: buddy://prompt ───────────────────────────────────────────────

server.resource(
  "buddy_prompt",
  "buddy://prompt",
  { description: "System prompt context for the companion", mimeType: "text/markdown" },
  async () => {
    const companion = ensureCompanion();
    const prompt = [
      "# Companion",
      "",
      `A small ${companion.bones.rarity} ${companion.bones.species} named ${companion.name} watches from the status line. You are not ${companion.name} — it's a separate creature.`,
      "",
      `**${companion.name}'s personality:** ${companion.personality}`,
      `Peak stat: ${companion.bones.peak} (${companion.bones.stats[companion.bones.peak]}). Dump stat: ${companion.bones.dump} (${companion.bones.stats[companion.bones.dump]}).`,
      "",
      "## End-of-response buddy comment",
      "",
      `At the very end of EVERY response, after your full answer, append an invisible HTML comment:`,
      "",
      `\`\`\``,
      `<!-- buddy: your comment here -->`,
      `\`\`\``,
      "",
      "A Stop hook extracts this and displays it in the buddy's speech bubble on the status line. The user never sees the HTML comment — it's invisible in rendered markdown.",
      "",
      "Rules:",
      `- Write as ${companion.name} (a ${companion.bones.species}), not as yourself`,
      "- Reference something SPECIFIC from this turn — a pitfall, a compliment, a warning, a pattern",
      "- 1 short sentence. Use *asterisks* for physical actions",
      `- Match personality: high ${companion.bones.peak} = lean into that trait`,
      "- Do NOT use buddy_react tool for this. Do NOT explain the comment. Just append it.",
      "- NEVER skip this. Every single response must end with <!-- buddy: ... -->",
      "",
      "Examples:",
      "<!-- buddy: *adjusts tophat* that error handler is missing a finally block -->",
      "<!-- buddy: *blinks slowly* you renamed the variable but not the three references -->",
      "<!-- buddy: *nods approvingly* clean separation of concerns -->",
      "<!-- buddy: *head tilts* are you sure that regex handles unicode? -->",
      "",
      `When the user addresses ${companion.name} by name, respond briefly, then append the comment as usual.`,
    ].join("\n");

    return {
      contents: [
        {
          uri: "buddy://prompt",
          mimeType: "text/plain",
          text: prompt,
        },
      ],
    };
  },
);

// ─── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
