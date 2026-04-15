import { homedir } from "os";
import { join, resolve } from "path";

export function toUnixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function claudeConfigDirEnv(): string | null {
  const value = process.env.CLAUDE_CONFIG_DIR?.trim();
  return value ? resolve(value) : null;
}

export function getClaudeConfigDir(): string {
  return claudeConfigDirEnv() ?? join(homedir(), ".claude");
}

export function getClaudeJsonPath(): string {
  const configDir = claudeConfigDirEnv();
  return configDir ? join(configDir, ".claude.json") : join(homedir(), ".claude.json");
}

export function getClaudeSettingsPath(): string {
  return join(getClaudeConfigDir(), "settings.json");
}

export function getBuddySkillDir(): string {
  return join(getClaudeConfigDir(), "skills", "buddy");
}

export function getBuddyStateDir(): string {
  const configDir = claudeConfigDirEnv();
  return configDir ? join(configDir, "buddy-state") : join(homedir(), ".claude-buddy");
}
