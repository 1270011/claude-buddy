import { afterEach, describe, expect, test } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import { getBuddySkillDir, getClaudeConfigDir, getClaudeJsonPath, getClaudeSettingsPath } from "./paths.ts";

const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  }
});

describe("Claude config path resolution", () => {
  test("falls back to legacy ~/.claude locations when CLAUDE_CONFIG_DIR is unset", () => {
    delete process.env.CLAUDE_CONFIG_DIR;

    expect(getClaudeConfigDir()).toBe(join(homedir(), ".claude"));
    expect(getClaudeSettingsPath()).toBe(join(homedir(), ".claude", "settings.json"));
    expect(getBuddySkillDir()).toBe(join(homedir(), ".claude", "skills", "buddy"));
    expect(getClaudeJsonPath()).toBe(join(homedir(), ".claude.json"));
  });

  test("uses CLAUDE_CONFIG_DIR for settings, skills, and .claude.json", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/custom-claude";

    expect(getClaudeConfigDir()).toBe("/tmp/custom-claude");
    expect(getClaudeSettingsPath()).toBe("/tmp/custom-claude/settings.json");
    expect(getBuddySkillDir()).toBe("/tmp/custom-claude/skills/buddy");
    expect(getClaudeJsonPath()).toBe("/tmp/custom-claude/.claude.json");
  });
});
