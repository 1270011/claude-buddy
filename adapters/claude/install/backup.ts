#!/usr/bin/env bun
/**
 * claude-buddy backup — snapshot all claude-buddy related state
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  readdirSync, statSync, rmSync, copyFileSync,
} from "fs";
import { dirname, join } from "path";
import { getBuddySkillDir, getBuddyStateDir, getClaudeJsonPath, getClaudeSettingsPath } from "../storage/paths.ts";

const SETTINGS = getClaudeSettingsPath();
const CLAUDE_JSON = getClaudeJsonPath();
const SKILL = join(getBuddySkillDir(), "SKILL.md");
const STATE_DIR = getBuddyStateDir();
const BACKUPS_DIR = join(STATE_DIR, "backups");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function ok(msg: string) { console.log(`${GREEN}✓${NC}  ${msg}`); }
function info(msg: string) { console.log(`${CYAN}→${NC}  ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}⚠${NC}  ${msg}`); }
function err(msg: string) { console.log(`${RED}✗${NC}  ${msg}`); }

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function tryRead(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function listBackups(): string[] {
  if (!existsSync(BACKUPS_DIR)) return [];
  return readdirSync(BACKUPS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(f))
    .filter((f) => statSync(join(BACKUPS_DIR, f)).isDirectory())
    .sort();
}

function createBackup(): string {
  const ts = timestamp();
  const dir = join(BACKUPS_DIR, ts);
  mkdirSync(dir, { recursive: true });

  const manifest: { timestamp: string; files: string[] } = { timestamp: ts, files: [] };

  const settings = tryRead(SETTINGS);
  if (settings) {
    writeFileSync(join(dir, "settings.json"), settings);
    manifest.files.push("settings.json");
    ok(`Backed up: ${SETTINGS}`);
  } else {
    warn(`Skipped: ${SETTINGS} (not found)`);
  }

  const claudeJsonRaw = tryRead(CLAUDE_JSON);
  if (claudeJsonRaw) {
    try {
      const claudeJson = JSON.parse(claudeJsonRaw);
      const ourMcp = claudeJson.mcpServers?.["claude-buddy"];
      if (ourMcp) {
        writeFileSync(join(dir, "mcpserver.json"), JSON.stringify(ourMcp, null, 2));
        manifest.files.push("mcpserver.json");
        ok(`Backed up: ${CLAUDE_JSON} → mcpServers["claude-buddy"]`);
      } else {
        warn(`Skipped: ${CLAUDE_JSON} mcpServers["claude-buddy"] (not registered)`);
      }
    } catch {
      err(`Failed to parse ${CLAUDE_JSON}`);
    }
  }

  const skill = tryRead(SKILL);
  if (skill) {
    writeFileSync(join(dir, "SKILL.md"), skill);
    manifest.files.push("SKILL.md");
    ok(`Backed up: ${SKILL}`);
  } else {
    warn(`Skipped: ${SKILL} (not found)`);
  }

  const stateDestDir = join(dir, "claude-buddy");
  mkdirSync(stateDestDir, { recursive: true });
  const stateFiles = ["menagerie.json", "config.json", "status.json", "events.json", "unlocked.json", "active_days.json"];
  for (const file of stateFiles) {
    const src = join(STATE_DIR, file);
    if (existsSync(src)) {
      copyFileSync(src, join(stateDestDir, file));
      manifest.files.push(`claude-buddy/${file}`);
      ok(`Backed up: ${join(STATE_DIR, file)}`);
    }
  }

  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return ts;
}

function cmdList() {
  const backups = listBackups();
  if (backups.length === 0) {
    info("No backups found.");
    info(`Run '${BOLD}bun run backup${NC}' to create one.`);
    return;
  }
  console.log(`\n${BOLD}claude-buddy backups${NC}\n`);
  for (const ts of backups) {
    const manifestPath = join(BACKUPS_DIR, ts, "manifest.json");
    const manifest = tryRead(manifestPath);
    let count = "?";
    if (manifest) {
      try { count = String(JSON.parse(manifest).files?.length ?? 0); } catch {}
    }
    const isLatest = ts === backups[backups.length - 1];
    const tag = isLatest ? `${GREEN}(latest)${NC}` : "";
    console.log(`  ${CYAN}${ts}${NC}  ${DIM}${count} files${NC}  ${tag}`);
  }
  console.log("");
}

function cmdShow(ts: string) {
  const dir = join(BACKUPS_DIR, ts);
  if (!existsSync(dir)) {
    err(`Backup not found: ${ts}`);
    process.exit(1);
  }
  const manifest = tryRead(join(dir, "manifest.json"));
  if (!manifest) {
    err("manifest.json missing");
    process.exit(1);
  }
  const data = JSON.parse(manifest);
  console.log(`\n${BOLD}Backup ${ts}${NC}\n`);
  console.log(`  ${DIM}Files:${NC}`);
  for (const file of data.files) console.log(`    - ${file}`);
  console.log("");
}

function restoreBackup(ts: string) {
  const dir = join(BACKUPS_DIR, ts);
  if (!existsSync(dir)) {
    err(`Backup not found: ${ts}`);
    process.exit(1);
  }

  info(`Restoring backup ${ts}...\n`);

  const settingsBak = join(dir, "settings.json");
  if (existsSync(settingsBak)) {
    mkdirSync(dirname(SETTINGS), { recursive: true });
    copyFileSync(settingsBak, SETTINGS);
    ok(`Restored: ${SETTINGS}`);
  }

  const mcpBak = join(dir, "mcpserver.json");
  if (existsSync(mcpBak)) {
    const ourMcp = JSON.parse(readFileSync(mcpBak, "utf8"));
    let claudeJson: { mcpServers?: Record<string, unknown> } = {};
    try {
      claudeJson = JSON.parse(readFileSync(CLAUDE_JSON, "utf8")) as { mcpServers?: Record<string, unknown> };
    } catch {}
    if (!claudeJson.mcpServers) claudeJson.mcpServers = {};
    claudeJson.mcpServers["claude-buddy"] = ourMcp;
    mkdirSync(dirname(CLAUDE_JSON), { recursive: true });
    writeFileSync(CLAUDE_JSON, JSON.stringify(claudeJson, null, 2));
    ok(`Restored: ${CLAUDE_JSON} → mcpServers["claude-buddy"]`);
  }

  const skillBak = join(dir, "SKILL.md");
  if (existsSync(skillBak)) {
    mkdirSync(dirname(SKILL), { recursive: true });
    copyFileSync(skillBak, SKILL);
    ok(`Restored: ${SKILL}`);
  }

  const stateDir = join(dir, "claude-buddy");
  if (existsSync(stateDir)) {
    mkdirSync(STATE_DIR, { recursive: true });
    for (const file of readdirSync(stateDir)) {
      copyFileSync(join(stateDir, file), join(STATE_DIR, file));
      ok(`Restored: ${join(STATE_DIR, file)}`);
    }
  }

  console.log(`\n${GREEN}Restore complete.${NC} Restart Claude Code to apply.\n`);
}

function cmdDelete(ts: string) {
  const dir = join(BACKUPS_DIR, ts);
  if (!existsSync(dir)) {
    err(`Backup not found: ${ts}`);
    process.exit(1);
  }
  rmSync(dir, { recursive: true });
  ok(`Deleted backup ${ts}`);
}

const action = process.argv[2] || "create";
const arg = process.argv[3];

switch (action) {
  case "create": {
    console.log(`\n${BOLD}Creating claude-buddy backup...${NC}\n`);
    const ts = createBackup();
    console.log(`\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${GREEN}  Backup created: ${ts}${NC}`);
    console.log(`${GREEN}  Location: ${BACKUPS_DIR}/${ts}${NC}`);
    console.log(`${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n`);
    console.log(`${DIM}  Restore with: bun run backup restore${NC}`);
    console.log(`${DIM}  Or:           bun run backup restore ${ts}${NC}\n`);
    break;
  }
  case "list":
  case "ls":
    cmdList();
    break;
  case "show":
    if (!arg) {
      err("Usage: bun run backup show <timestamp>");
      process.exit(1);
    }
    cmdShow(arg);
    break;
  case "restore": {
    const backups = listBackups();
    const ts = arg ?? backups[backups.length - 1];
    if (!ts) {
      err("No backups found to restore");
      process.exit(1);
    }
    restoreBackup(ts);
    break;
  }
  case "delete":
  case "rm":
    if (!arg) {
      err("Usage: bun run backup delete <timestamp>");
      process.exit(1);
    }
    cmdDelete(arg);
    break;
  default:
    err(`Unknown action: ${action}`);
    console.log("Usage: bun run backup [list|show <ts>|restore [ts]|delete <ts>]");
    process.exit(1);
}
