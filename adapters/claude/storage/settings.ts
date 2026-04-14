import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getBuddyStateDir, getClaudeSettingsPath, toUnixPath } from "./paths.ts";

export const CLAUDE_SETTINGS_PATH = getClaudeSettingsPath();

export function setBuddyStatusLine(
  statusScript: string,
  settingsPath: string = CLAUDE_SETTINGS_PATH,
): boolean {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.statusLine = {
      type: "command",
      command: toUnixPath(statusScript),
      padding: 1,
      refreshInterval: 1,
    };
    const tmp = settingsPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, settingsPath);
    return true;
  } catch {
    return false;
  }
}

export function unsetBuddyStatusLine(
  settingsPath: string = CLAUDE_SETTINGS_PATH,
): boolean {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!settings.statusLine?.command?.includes("buddy-status.sh")) return false;
    delete settings.statusLine;
    const tmp = settingsPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, settingsPath);
    return true;
  } catch {
    return false;
  }
}

export interface CleanupResult {
  statusLineRemoved: boolean;
  foreignStatusLineKept: boolean;
  transientFilesRemoved: number;
}

const TRANSIENT_PREFIXES = [
  "popup-stop.",
  "popup-resize.",
  "popup-env.",
  "popup-scroll.",
  "popup-reopen-pid.",
  "reaction.",
  ".last_reaction.",
  ".last_comment.",
];

export function cleanupPluginState(
  settingsPath: string = CLAUDE_SETTINGS_PATH,
  stateDir: string = getBuddyStateDir(),
): CleanupResult {
  const statusLineRemoved = unsetBuddyStatusLine(settingsPath);

  let foreignStatusLineKept = false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const cmd = settings.statusLine?.command;
    if (cmd && !cmd.includes("buddy-status.sh")) foreignStatusLineKept = true;
  } catch {
    // ignore missing settings
  }

  let transientFilesRemoved = 0;
  try {
    if (existsSync(stateDir)) {
      for (const file of readdirSync(stateDir)) {
        if (TRANSIENT_PREFIXES.some((prefix) => file.startsWith(prefix))) {
          rmSync(join(stateDir, file), { force: true });
          transientFilesRemoved++;
        }
      }
    }
  } catch {
    // ignore unreadable state dir
  }

  return { statusLineRemoved, foreignStatusLineKept, transientFilesRemoved };
}
