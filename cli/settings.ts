#!/usr/bin/env bun
/**
 * cli/settings.ts — View and update buddy settings
 *
 * Usage:
 *   bun run settings                Show current settings
 *   bun run settings cooldown 0     Set comment cooldown (0-300 seconds)
 */

import { loadConfig, saveConfig } from "../server/state.ts";
import { AVAILABLE_LOCALES } from "../server/i18n.ts";

const args = process.argv.slice(2);
const key = args[0];
const value = args[1];

if (!key) {
  const cfg = loadConfig();
  console.log(`
  claude-buddy settings
  ─────────────────────
  Comment cooldown:  ${cfg.commentCooldown}s    (0 = no throttling, default 30)
  Reaction TTL:      ${cfg.reactionTTL}s    (0 = permanent, default 0)
  Language:          ${cfg.language}    (${AVAILABLE_LOCALES[cfg.language] ?? cfg.language})

  Change:  bun run settings cooldown <seconds>
           bun run settings ttl <seconds>
           bun run settings language <code>
`);
  process.exit(0);
}

if (key === "cooldown") {
  if (value === undefined) {
    const cfg = loadConfig();
    console.log(`Comment cooldown: ${cfg.commentCooldown}s`);
    process.exit(0);
  }

  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0 || n > 300) {
    console.error("Error: cooldown must be 0-300 (seconds)");
    process.exit(1);
  }

  const cfg = saveConfig({ commentCooldown: n });
  console.log(`Updated: comment cooldown → ${cfg.commentCooldown}s`);
  process.exit(0);
}

if (key === "ttl") {
  if (value === undefined) {
    const cfg = loadConfig();
    console.log(`Reaction TTL: ${cfg.reactionTTL}s`);
    process.exit(0);
  }

  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0 || n > 300) {
    console.error("Error: ttl must be 0-300 (seconds, 0 = permanent)");
    process.exit(1);
  }

  const cfg = saveConfig({ reactionTTL: n });
  console.log(`Updated: reaction TTL → ${cfg.reactionTTL}s${n === 0 ? " (permanent)" : ""}`);
  process.exit(0);
}

if (key === "language") {
  if (value === undefined) {
    const cfg = loadConfig();
    console.log(`Language: ${cfg.language} (${AVAILABLE_LOCALES[cfg.language] ?? cfg.language})`);
    console.log("Available:", Object.entries(AVAILABLE_LOCALES).map(([c, n]) => `${c} (${n})`).join(", "));
    process.exit(0);
  }

  if (!AVAILABLE_LOCALES[value]) {
    console.error(`Error: unknown language "${value}"`);
    console.error("Available:", Object.keys(AVAILABLE_LOCALES).join(", "));
    process.exit(1);
  }

  const cfg = saveConfig({ language: value });
  console.log(`Updated: language → ${cfg.language} (${AVAILABLE_LOCALES[cfg.language]})`);
  process.exit(0);
}

console.error(`Unknown setting: ${key}`);
console.error("Available: cooldown, ttl, language");
process.exit(1);
