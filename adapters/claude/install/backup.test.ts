import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("backup CLI help", () => {
  for (const flag of ["--help", "-h"]) {
    test(`prints rich help for ${flag}`, () => {
      const profileDir = mkdtempSync(join(tmpdir(), "claude-buddy-backup-help-"));

      try {
        const result = Bun.spawnSync({
          cmd: [process.execPath, "run", join(import.meta.dir, "backup.ts"), flag],
          cwd: import.meta.dir,
          env: { ...process.env, CLAUDE_CONFIG_DIR: profileDir },
        });
        const stdout = result.stdout.toString();
        const stderr = result.stderr.toString();
        const stateDir = join(profileDir, "buddy-state");

        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toContain("claude-buddy backup");
        expect(stdout).toContain("Commands:");
        expect(stdout).toContain("What gets backed up:");
        expect(stdout).toContain("Backup location:");
        expect(stdout).toContain(join(profileDir, "settings.json"));
        expect(stdout).toContain(join(profileDir, ".claude.json"));
        expect(stdout).toContain(join(profileDir, "skills", "buddy", "SKILL.md"));
        expect(stdout).toContain(join(stateDir, "menagerie.json"));
        expect(stdout).toContain(join(stateDir, "backups", "<timestamp>"));
      } finally {
        rmSync(profileDir, { recursive: true, force: true });
      }
    });
  }
});