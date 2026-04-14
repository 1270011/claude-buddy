#!/usr/bin/env bun
/**
 * claude-buddy doctor — comprehensive diagnostic report
 */

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, resolve } from "path";
import { getBuddySkillDir, getBuddyStateDir, getClaudeConfigDir, getClaudeJsonPath, getClaudeSettingsPath } from "../storage/paths.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const CLAUDE_DIR = getClaudeConfigDir();
const CLAUDE_JSON = getClaudeJsonPath();
const STATE_DIR = getBuddyStateDir();
const SETTINGS = getClaudeSettingsPath();
const SKILL_PATH = join(getBuddySkillDir(), "SKILL.md");
const STATUS_SCRIPT = join(PROJECT_ROOT, "adapters", "claude", "statusline", "buddy-status.sh");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function section(title: string) {
  console.log(`\n${CYAN}${BOLD}━━━ ${title} ${"━".repeat(Math.max(0, 60 - title.length))}${NC}`);
}
function row(label: string, value: string) {
  console.log(`  ${DIM}${label.padEnd(28)}${NC} ${value}`);
}
function ok(msg: string) { console.log(`  ${GREEN}✓${NC} ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}⚠${NC} ${msg}`); }
function err(msg: string) { console.log(`  ${RED}✗${NC} ${msg}`); }

function tryExec(cmd: string, fallback = "(failed)"): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}
function tryRead(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}
function tryParseJson(text: string | null): any {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

console.log(`${CYAN}${BOLD}
╔══════════════════════════════════════════════════════════╗
║  claude-buddy doctor — diagnostic report                 ║
╚══════════════════════════════════════════════════════════╝${NC}`);
console.log(`\n${DIM}Copy this entire output into your GitHub issue.${NC}`);

section("Environment");
row("OS", tryExec("uname -srm"));
row("Hostname", tryExec("uname -n"));
row("User shell", process.env.SHELL ?? "(unset)");
row("Bash version", tryExec("bash --version | head -1"));
row("Bun version", tryExec("bun --version"));
row("Node version", tryExec("node --version", "(not installed)"));
row("jq version", tryExec("jq --version", "(not installed)"));
row("Claude Code version", tryExec("claude --version", "(not in PATH)"));

section("Terminal");
row("TERM", process.env.TERM ?? "(unset)");
row("COLORTERM", process.env.COLORTERM ?? "(unset)");
row("TERM_PROGRAM", process.env.TERM_PROGRAM ?? "(unset)");
row("LANG", process.env.LANG ?? "(unset)");
row("COLUMNS env var", process.env.COLUMNS ?? "(unset in subprocess)");
row("stty size", tryExec("stty size 2>/dev/null", "(no tty)"));
row("tput cols", tryExec("tput cols 2>/dev/null", "(failed)"));

section("Filesystem");
const procExists = existsSync("/proc");
row("/proc exists", procExists ? `${GREEN}yes${NC} (Linux)` : `${RED}no${NC} (macOS/BSD)`);
row("CLAUDE_CONFIG_DIR", process.env.CLAUDE_CONFIG_DIR ?? "(unset)");
row("Claude config dir", CLAUDE_DIR);
row("Claude config dir exists", existsSync(CLAUDE_DIR) ? "yes" : "no");
row("Claude config file", CLAUDE_JSON);
row("Claude config file exists", existsSync(CLAUDE_JSON) ? "yes" : "no");
row("Buddy state dir", STATE_DIR);
row("Buddy state dir exists", existsSync(STATE_DIR) ? "yes" : "no");
row("Project root", PROJECT_ROOT);
row("Status script exists", existsSync(STATUS_SCRIPT) ? "yes" : `${RED}no${NC}`);

section("claude-buddy state");
const menagerie = tryParseJson(tryRead(join(STATE_DIR, "menagerie.json")));
const status = tryParseJson(tryRead(join(STATE_DIR, "status.json")));

if (isRecord(menagerie)) {
  const activeSlot = typeof menagerie.active === "string" ? menagerie.active : "buddy";
  const companions = isRecord(menagerie.companions) ? menagerie.companions : {};
  const companion = companions[activeSlot];
  row("Active slot", activeSlot);
  row("Total slots", String(Object.keys(companions).length));
  if (isRecord(companion)) {
    const bones = isRecord(companion.bones) ? companion.bones : {};
    row("Companion name", typeof companion.name === "string" ? companion.name : "(none)");
    row("Species", typeof bones.species === "string" ? bones.species : "(none)");
    row("Rarity", typeof bones.rarity === "string" ? bones.rarity : "(none)");
    row("Hat", typeof bones.hat === "string" ? bones.hat : "(none)");
    row("Eye", typeof bones.eye === "string" ? bones.eye : "(none)");
    row("Shiny", String(typeof bones.shiny === "boolean" ? bones.shiny : false));
  } else {
    err(`No companion found in active slot "${activeSlot}"`);
  }
} else {
  err(`No manifest found at ${join(STATE_DIR, "menagerie.json")}`);
}

if (isRecord(status)) {
  row("Status muted", String(typeof status.muted === "boolean" ? status.muted : false));
  row("Current reaction", typeof status.reaction === "string" && status.reaction.length > 0 ? status.reaction : "(none)");
} else {
  warn(`No status state at ${join(STATE_DIR, "status.json")}`);
}

section("Claude Code config");
const settings = tryParseJson(tryRead(SETTINGS));
const claudeJson = tryParseJson(tryRead(CLAUDE_JSON));

if (isRecord(settings) && "statusLine" in settings && settings.statusLine !== undefined) {
  console.log(`  ${DIM}statusLine:${NC}`);
  console.log(`    ${JSON.stringify(settings.statusLine, null, 2).split("\n").join("\n    ")}`);
} else {
  warn(`No statusLine in ${SETTINGS}`);
}

if (isRecord(settings) && isRecord(settings.hooks)) {
  console.log(`  ${DIM}hooks:${NC}`);
  for (const event of Object.keys(settings.hooks)) {
    const hookEntries = settings.hooks[event];
    const count = Array.isArray(hookEntries) ? hookEntries.length : 0;
    row(`  ${event}`, `${count} entr${count === 1 ? "y" : "ies"}`);
  }
} else {
  warn("No hooks configured");
}

if (isRecord(claudeJson) && isRecord(claudeJson.mcpServers) && isRecord(claudeJson.mcpServers["claude-buddy"])) {
  ok(`MCP server registered in ${CLAUDE_JSON}`);
  console.log(`    ${JSON.stringify(claudeJson.mcpServers["claude-buddy"], null, 2).split("\n").join("\n    ")}`);
} else {
  err(`MCP server NOT registered in ${CLAUDE_JSON}`);
}

if (existsSync(SKILL_PATH)) {
  ok(`Skill installed: ${SKILL_PATH}`);
} else {
  err(`Skill missing: ${SKILL_PATH}`);
}

section("Live status line test");
if (existsSync(STATUS_SCRIPT)) {
  try {
    const output = execSync(`echo '{}' | ${STATUS_SCRIPT}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trimEnd();
    ok("Status script ran successfully");
    console.log(`\n  ${DIM}Output preview:${NC}`);
    for (const line of output.split("\n").slice(0, 6)) console.log(`    ${line}`);
  } catch {
    err("Status script failed to run");
  }
}

console.log("");
