#!/usr/bin/env bun
/**
 * claude-buddy uninstall — remove all integrations
 *
 * Companion data and backups are intentionally left in the buddy state dir so
 * you can reinstall later without losing them.
 */

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { cleanupPluginState } from "../storage/settings.ts";
import { getBuddySkillDir, getBuddyStateDir, getClaudeJsonPath, getClaudeSettingsPath } from "../storage/paths.ts";

interface HookCommand {
  type: "command";
  command: string;
}

interface HookMatcherEntry {
  matcher?: string;
  hooks?: HookCommand[];
}

interface ClaudeSettings {
  statusLine?: { command?: string };
  hooks?: Record<string, HookMatcherEntry[]>;
  [key: string]: unknown;
}

function hasBuddyHook(entry: HookMatcherEntry): boolean {
  return (entry.hooks ?? []).some((hook) => hook.command.includes("claude-buddy"));
}

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

function ok(msg: string) { console.log(`${GREEN}✓${NC}  ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}⚠${NC}  ${msg}`); }

const SETTINGS_FILE = getClaudeSettingsPath();
const SKILL_DIR = getBuddySkillDir();
const STATE_DIR = getBuddyStateDir();
const CLAUDE_JSON = getClaudeJsonPath();

console.log("\nclaude-buddy uninstall\n");

// Stop legacy popup helpers before removing config that might try to restart them.
try {
  if (existsSync(STATE_DIR)) {
    for (const f of readdirSync(STATE_DIR).filter((f) => f.startsWith("popup-reopen-pid."))) {
      const pidPath = join(STATE_DIR, f);
      const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
      if (pid > 0) {
        try { process.kill(pid); } catch {}
      }
      rmSync(pidPath, { force: true });
    }
  }
  if (process.env.TMUX) {
    const { execSync } = await import("child_process");
    execSync("tmux display-popup -C 2>/dev/null", { stdio: "ignore" });
  }
  ok("Popup stopped");
} catch {
  // noop
}

// Remove the MCP server registration from Claude's user config.
try {
  const claudeJson = JSON.parse(readFileSync(CLAUDE_JSON, "utf8"));
  if (claudeJson.mcpServers?.["claude-buddy"]) {
    delete claudeJson.mcpServers["claude-buddy"];
    if (Object.keys(claudeJson.mcpServers).length === 0) delete claudeJson.mcpServers;
    writeFileSync(CLAUDE_JSON, JSON.stringify(claudeJson, null, 2));
    ok(`MCP server removed from ${CLAUDE_JSON}`);
  }
} catch {
  warn(`Could not update ${CLAUDE_JSON}`);
}

// Remove hooks and the status line from settings.json.
try {
  const settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as ClaudeSettings;
  let changed = false;

  if (settings.statusLine?.command?.includes("buddy")) {
    delete settings.statusLine;
    ok("Status line removed");
    changed = true;
  }

  for (const hookType of ["PostToolUse", "Stop", "SessionStart", "SessionEnd", "UserPromptSubmit"] as const) {
    if (settings.hooks?.[hookType]) {
      const before = settings.hooks[hookType].length;
      settings.hooks[hookType] = settings.hooks[hookType].filter((h) => !hasBuddyHook(h));
      if (settings.hooks[hookType].length < before) {
        ok(`${hookType} hooks removed`);
        changed = true;
      }
      if (settings.hooks[hookType].length === 0) delete settings.hooks[hookType];
    }
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  if (changed) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
  }
} catch {
  warn("Could not update settings.json");
}

// Clear transient session files that should not survive an uninstall.
const cleanup = cleanupPluginState(SETTINGS_FILE, STATE_DIR);
if (cleanup.transientFilesRemoved > 0) {
  ok(`Removed ${cleanup.transientFilesRemoved} transient session files`);
}

// Remove the installed skill files.
if (existsSync(SKILL_DIR)) {
  rmSync(SKILL_DIR, { recursive: true });
  ok("Skill removed");
} else {
  warn("Skill not found (already removed)");
}

// Keep the state dir (profile-scoped when CLAUDE_CONFIG_DIR is set) so the
// buddy can be restored or reinstalled later without losing its data.
if (existsSync(STATE_DIR)) {
  warn(`Companion data kept at ${STATE_DIR} — delete manually if not needed`);
}

console.log(`\n${GREEN}Done.${NC} Restart Claude Code to apply changes.\n`);
