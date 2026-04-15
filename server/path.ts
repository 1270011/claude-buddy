// Compatibility wrapper for legacy server/path.ts imports.
// Path normalization plus Claude profile/state resolution now live in
// adapters/claude/storage/paths.ts, and scripts/paths.sh remains the shell
// counterpart that should stay in sync with those resolvers.
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
