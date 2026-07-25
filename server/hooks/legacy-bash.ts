#!/usr/bin/env bun

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { packageRootFromHooks, readStdin } from "./common.ts";

const ALLOWED = new Set([
  "react.sh",
  "file-type-react.sh",
  "name-react.sh",
  "mood-react.sh",
]);

if (import.meta.main) {
  try {
    const script = process.argv[2] ?? "";
    if (ALLOWED.has(script)) {
      const root = packageRootFromHooks();
      const hook = join(root, "hooks", "legacy", script);
      if (existsSync(hook)) {
        spawnSync("bash", [hook], {
          cwd: root,
          input: await readStdin(),
          stdio: ["pipe", "ignore", "ignore"],
          timeout: 14_000,
        });
      }
    }
  } catch {
    // Claude Code hooks must never fail the turn.
  }
  process.exit(0);
}
