#!/usr/bin/env bun
/**
 * claude-buddy disable — temporarily deactivate buddy without losing data
 *
 * Removes: MCP server, status line, hooks
 * Keeps: companion data, backups, skill files
 *
 * Re-enable with: bun run install-buddy
 */

import { readFileSync, writeFileSync } from "fs";
import { getBuddyStateDir, getClaudeJsonPath, getClaudeSettingsPath } from "../storage/paths.ts";

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
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function ok(msg: string) { console.log(`${GREEN}✓${NC}  ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}⚠${NC}  ${msg}`); }

const CLAUDE_JSON = getClaudeJsonPath();
const SETTINGS = getClaudeSettingsPath();
const STATE_DIR = getBuddyStateDir();

console.log(`\n${BOLD}Disabling claude-buddy...${NC}\n`);

try {
  const claudeJson = JSON.parse(readFileSync(CLAUDE_JSON, "utf8"));
  if (claudeJson.mcpServers?.["claude-buddy"]) {
    delete claudeJson.mcpServers["claude-buddy"];
    if (Object.keys(claudeJson.mcpServers).length === 0) delete claudeJson.mcpServers;
    writeFileSync(CLAUDE_JSON, JSON.stringify(claudeJson, null, 2));
    ok(`MCP server removed from ${CLAUDE_JSON}`);
  } else {
    warn("MCP server was not registered");
  }
} catch {
  warn(`Could not update ${CLAUDE_JSON}`);
}

try {
  const settings = JSON.parse(readFileSync(SETTINGS, "utf8")) as ClaudeSettings;
  let changed = false;

  if (settings.statusLine?.command?.includes("buddy")) {
    delete settings.statusLine;
    ok("Status line removed");
    changed = true;
  }

  if (settings.hooks) {
    for (const hookType of ["PostToolUse", "Stop", "SessionStart", "SessionEnd", "UserPromptSubmit"]) {
      if (settings.hooks[hookType]) {
        const before = settings.hooks[hookType].length;
        settings.hooks[hookType] = settings.hooks[hookType].filter((h) => !hasBuddyHook(h));
        if (settings.hooks[hookType].length < before) changed = true;
        if (settings.hooks[hookType].length === 0) delete settings.hooks[hookType];
      }
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }

  if (changed) {
    writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
    ok("Hooks and status line removed from settings.json");
  }
} catch {
  warn("Could not update settings.json");
}

try {
  if (process.env.TMUX) {
    const { execSync } = await import("child_process");
    execSync("tmux display-popup -C 2>/dev/null", { stdio: "ignore" });
  }
} catch {
  // noop
}

console.log(`
${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${GREEN}  Buddy disabled.${NC}
${GREEN}  Companion data is preserved at ${STATE_DIR}${NC}
${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

${DIM}  Restart Claude Code for changes to take effect.
  Re-enable anytime with: bun run install-buddy${NC}
`);
