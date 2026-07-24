#!/usr/bin/env node
/**
 * Post-install check: warn if bun is unavailable.
 * Installation must succeed for Node-only Pi/OMP consumers; Claude-only commands
 * will diagnose bun at runtime.
 */

const { spawn } = require("child_process");

function checkBun() {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["--version"], { stdio: "pipe" });
    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`✓ bun ${output.trim()} detected`);
        resolve(true);
      } else {
        console.error(
          "✗ bun is not installed. This package requires bun to run.\n" +
            "  Install: https://bun.sh\n" +
            "  Or use:  npm install -g bun"
        );
        resolve(false);
      }
    });
    proc.on("error", () => {
      console.error(
        "✗ bun is not installed. This package requires bun to run.\n" +
          "  Install: https://bun.sh\n" +
          "  Or use:  npm install -g bun"
      );
      resolve(false);
    });
  });
}

checkBun().then((ok) => {
  if (!ok) {
    console.warn("Install completed, but bun is required to run Claude-only commands.");
  }
  process.exit(0);
});
