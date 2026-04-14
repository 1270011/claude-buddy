export {
  getBuddyStateDir as buddyStateDir,
  getClaudeConfigDir as claudeConfigDir,
  getClaudeJsonPath as claudeUserConfigPath,
  getClaudeSettingsPath as claudeSettingsPath,
  toUnixPath,
} from "../storage/paths.ts";

export function claudeSkillDir(_name: string): string {
  const { getBuddySkillDir } = require("../storage/paths.ts") as typeof import("../storage/paths.ts");
  return getBuddySkillDir();
}
