/**
 * claude-buddy installer
 *
 * Registers: MCP server (in ~/.claude.json), skill, hooks, status line (in settings.json)
 * Checks: bun, jq, ~/.claude/ directory
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "fs";
import { execSync } from "child_process";
import { join, resolve, dirname } from "path";
import { homedir } from "os";

import { generateBones, renderBuddy, renderFace, RARITY_STARS } from "../server/engine.ts";
import { toUnixPath } from "../server/path.ts";
import { loadCompanion, saveCompanion, resolveUserId, writeStatusState } from "../server/state.ts";
import { generateFallbackName } from "../server/reactions.ts";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_FILE = join(CLAUDE_DIR, "settings.json");
const BUDDY_DIR = join(CLAUDE_DIR, "skills", "buddy");
const PROJECT_ROOT = resolve(dirname(import.meta.dir));

function banner() {
  console.log(`
${CYAN}╔══════════════════════════════════════════════════════════╗${NC}
${CYAN}║${NC}  ${BOLD}claude-buddy${NC} — permanent coding companion              ${CYAN}║${NC}
${CYAN}║${NC}  ${DIM}MCP + Skill + StatusLine + Hooks${NC}                        ${CYAN}║${NC}
${CYAN}╚══════════════════════════════════════════════════════════╝${NC}
`);
}

function ok(msg: string) { console.log(`${GREEN}✓${NC}  ${msg}`); }
function info(msg: string) { console.log(`${CYAN}→${NC}  ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}⚠${NC}  ${msg}`); }
function err(msg: string) { console.log(`${RED}✗${NC}  ${msg}`); }

// ─── Preflight checks ──────────────────────────────────────────────────────

function preflight(): boolean {
  let pass = true;

  // Check bun
  try {
    execSync("bun --version", { stdio: "ignore" });
    ok("bun found");
  } catch {
    err("bun not found. Install: curl -fsSL https://bun.sh/install | bash");
    pass = false;
  }

  // Check jq (needed for status line + hooks)
  try {
    execSync("jq --version", { stdio: "ignore" });
    ok("jq found");
  } catch {
    warn("jq not found — installing...");
    try {
      execSync("sudo apt-get install -y jq 2>/dev/null || brew install jq 2>/dev/null", { stdio: "ignore" });
      ok("jq installed");
    } catch {
      err("Could not install jq. Install manually: apt install jq / brew install jq / windows: install from https://github.com/jqlang/jq/releases/latest and add to PATH");
      pass = false;
    }
  }

  // Check ~/.claude/ exists
  if (!existsSync(CLAUDE_DIR)) {
    err("~/.claude/ not found. Start Claude Code once first, then re-run.");
    pass = false;
  } else {
    ok("~/.claude/ found");
  }

  // Check ~/.claude.json exists
  const claudeJson = join(homedir(), ".claude.json");
  if (!existsSync(claudeJson)) {
    err("~/.claude.json not found. Start Claude Code once first, then re-run.");
    pass = false;
  } else {
    ok("~/.claude.json found");
  }

  return pass;
}

// ─── Load / update settings.json ────────────────────────────────────────────

function loadSettings(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(settings: Record<string, any>) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
}

// ─── Step 1: Register MCP server (in ~/.claude.json) ────────────────────────

function installMcp() {
  const serverPath = join(PROJECT_ROOT, "server", "index.ts");
  const claudeJsonPath = join(homedir(), ".claude.json");

  let claudeJson: Record<string, any> = {};
  try {
    claudeJson = JSON.parse(readFileSync(claudeJsonPath, "utf8"));
  } catch { /* fresh config */ }

  if (!claudeJson.mcpServers) claudeJson.mcpServers = {};

  claudeJson.mcpServers["claude-buddy"] = {
    command: "bun",
    args: [toUnixPath(serverPath)],
    cwd: toUnixPath(PROJECT_ROOT),
  };

  writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2));
  ok("MCP server registered in ~/.claude.json");
}

// ─── Step 2: Install skill ──────────────────────────────────────────────────

function installSkill() {
  const srcSkill = join(PROJECT_ROOT, "skills", "buddy", "SKILL.md");
  mkdirSync(BUDDY_DIR, { recursive: true });
  cpSync(srcSkill, join(BUDDY_DIR, "SKILL.md"), { force: true });
  ok("Skill installed: ~/.claude/skills/buddy/SKILL.md");
}

// ─── Step 3: Configure status line (with animation refresh) ─────────────────

function installStatusLine(settings: Record<string, any>) {
  const statusScript = join(PROJECT_ROOT, "statusline", "buddy-status.sh");

  settings.statusLine = {
    type: "command",
    command: toUnixPath(statusScript),
    padding: 1,
    refreshInterval: 1,  // 1 second — drives the buddy animation
  };

  ok("Status line configured (with animation refresh)");
}

// The tmux popup mode was removed in favour of the status line / buddy-shell
// — its modal `tmux display-popup` intercepted the `Ctrl+b` prefix, breaking
// every tmux binding while the buddy was visible (issue #57). For backwards
// compatibility any legacy SessionStart/SessionEnd hooks that reference the
// popup manager are stripped out below when re-installing.

function stripLegacyPopupHooks(settings: Record<string, any>) {
  if (!settings.hooks) return;
  for (const hookType of ["SessionStart", "SessionEnd"] as const) {
    if (!settings.hooks[hookType]) continue;
    settings.hooks[hookType] = settings.hooks[hookType].filter(
      (h: any) => !h.hooks?.some((hh: any) =>
        hh.command?.includes("popup-manager") || hh.command?.includes("claude-buddy/popup"),
      ),
    );
    if (settings.hooks[hookType].length === 0) delete settings.hooks[hookType];
  }
}

// ─── Step 4: Register hooks ─────────────────────────────────────────────────

function installHooks(settings: Record<string, any>) {
  const reactHook    = join(PROJECT_ROOT, "hooks", "react.sh");
  const commentHook  = join(PROJECT_ROOT, "hooks", "buddy-comment.sh");
  const nameHook     = join(PROJECT_ROOT, "hooks", "name-react.sh");

  if (!settings.hooks) settings.hooks = {};

  // PostToolUse: detect errors/test failures/successes in Bash output
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (h: any) => !h.hooks?.some((hh: any) => hh.command?.includes("claude-buddy")),
  );
  settings.hooks.PostToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: toUnixPath(reactHook) }],
  });

  // Stop: extract <!-- buddy: --> comment from Claude's response
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  settings.hooks.Stop = settings.hooks.Stop.filter(
    (h: any) => !h.hooks?.some((hh: any) => hh.command?.includes("claude-buddy")),
  );
  settings.hooks.Stop.push({
    hooks: [{ type: "command", command: toUnixPath(commentHook) }],
  });

  // UserPromptSubmit: detect buddy's name in user message → instant status line reaction
  if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    (h: any) => !h.hooks?.some((hh: any) => hh.command?.includes("claude-buddy")),
  );
  settings.hooks.UserPromptSubmit.push({
    hooks: [{ type: "command", command: toUnixPath(nameHook) }],
  });

  ok("Hooks registered: PostToolUse + Stop + UserPromptSubmit");
}

// ─── Step 5: Ensure MCP tools are allowed ───────────────────────────────────

function ensurePermissions(settings: Record<string, any>) {
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];

  const allow: string[] = settings.permissions.allow;
  if (!allow.includes("mcp__*") && !allow.some((p: string) => p.startsWith("mcp__claude_buddy"))) {
    allow.push("mcp__claude_buddy__*");
    ok("Permission added: mcp__claude_buddy__*");
  } else {
    ok("MCP permissions already configured");
  }
}

// ─── Step 6: Initialize companion ───────────────────────────────────────────

function initCompanion() {
  let companion = loadCompanion();
  if (companion) {
    info(`Existing companion found: ${companion.name} (${companion.bones.rarity} ${companion.bones.species})`);
    return companion;
  }

  const userId = resolveUserId();
  info(`Generating companion from user ID: ${userId.slice(0, 12)}...`);

  const bones = generateBones(userId);
  companion = {
    bones,
    name: generateFallbackName(),
    personality: `A ${bones.rarity} ${bones.species} who watches code with quiet intensity.`,
    hatchedAt: Date.now(),
    userId,
  };

  saveCompanion(companion);
  writeStatusState(companion);
  ok(`Companion hatched: ${companion.name}`);

  return companion;
}

// ─── Main ───────────────────────────────────────────────────────────────────

banner();

info("Checking requirements...\n");
if (!preflight()) {
  console.log(`\n${RED}Installation aborted. Fix the issues above and retry.${NC}\n`);
  process.exit(1);
}

console.log("");
info("Installing claude-buddy...\n");

const settings = loadSettings();

installMcp();
installSkill();

stripLegacyPopupHooks(settings);
installStatusLine(settings);

installHooks(settings);
ensurePermissions(settings);
saveSettings(settings);

console.log("");
const companion = initCompanion();

console.log("");
console.log(renderBuddy(companion.bones));
console.log("");
console.log(`  ${BOLD}${companion.name}${NC} -- ${companion.personality}`);
console.log("");

console.log(`${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
console.log(`${GREEN}  Done! Restart Claude Code and type /buddy${NC}`);
console.log(`${GREEN}  Display mode: status line${NC}`);
console.log(`${GREEN}  Your companion is now permanent -- survives any update.${NC}`);
console.log(`${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
console.log("");
console.log(`${DIM}  /buddy        show your companion`);
console.log(`  /buddy pet    pet your companion`);
console.log(`  /buddy stats  detailed stat card`);
console.log(`  /buddy off    mute reactions`);
console.log(`  /buddy on     unmute reactions${NC}`);
console.log("");
