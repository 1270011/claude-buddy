import { readFileSync } from "fs";
import { getClaudeJsonPath } from "./paths.ts";

export function resolveUserId(): string {
  try {
    const claudeJson = JSON.parse(
      readFileSync(getClaudeJsonPath(), "utf8"),
    );
    return claudeJson.oauthAccount?.accountUuid ?? claudeJson.userID ?? "anon";
  } catch {
    return "anon";
  }
}
