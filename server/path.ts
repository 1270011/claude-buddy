import {
  getBuddySkillDir,
  getBuddyStateDir,
  getClaudeConfigDir,
  getClaudeJsonPath,
  getClaudeSettingsPath,
  toUnixPath,
} from "../adapters/claude/storage/paths.ts";

export function claudeConfigDir(): string {
  return getClaudeConfigDir();
}

export function claudeSettingsPath(): string {
  return getClaudeSettingsPath();
}

export function claudeUserConfigPath(): string {
  return getClaudeJsonPath();
}

export function buddyStateDir(): string {
  return getBuddyStateDir();
}

export function claudeSkillDir(_name: string): string {
  return getBuddySkillDir();
}

export { toUnixPath };
