#!/usr/bin/env bun
/**
 * claude-buddy CLI
 *
 * Usage:
 *   npx claude-buddy              Interactive install
 *   npx claude-buddy install      Install MCP + skill + hooks + statusline
 *   npx claude-buddy show         Show current buddy
 *   npx claude-buddy pick         Interactive two-pane buddy picker (saved + search)
 *   npx claude-buddy hunt         Search for a specific buddy (non-interactive)
 *   npx claude-buddy upgrade     Pull latest + reinstall
 *   npx claude-buddy uninstall    Remove all integrations
 *   npx claude-buddy verify       Verify what buddy your ID produces
 */

const args = process.argv.slice(2);
const command = args[0] || "install";

switch (command) {
  case "install":
    await import("./install.ts");
    break;
  case "show":
    await import("./show.ts");
    break;
  case "pick":
    await import("./pick.ts");
    break;
  case "hunt":
    await import("./hunt.ts");
    break;
  case "uninstall":
    await import("./uninstall.ts");
    break;
  case "verify":
    await import("./verify.ts");
    break;
  case "doctor":
    await import("./doctor.ts");
    break;
  case "test-statusline":
    await import("./test-statusline.ts");
    break;
  case "backup":
    await import("./backup.ts");
    break;
  case "settings":
    await import("./settings.ts");
    break;
  case "disable":
    await import("./disable.ts");
    break;
  case "upgrade":
    await import("./upgrade.ts");
    break;
  case "enable":
    await import("./install.ts");
    break;
  case "help":
  case "--help":
  case "-h":
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    showHelp();
    process.exit(1);
}

function showHelp() {
  console.log(`
claude-buddy — permanent coding companion for Claude Code

Setup:
  install-buddy     Set up MCP server, skill, hooks, and status line
  upgrade           Pull latest version and reinstall integrations
  enable            Same as install-buddy (re-enable after disable)
  disable           Temporarily deactivate buddy (data preserved)
  uninstall         Remove all claude-buddy integrations

Buddy:
  show              Display your current buddy
  pick              Interactive two-pane buddy picker (browse saved + search)
  hunt              Search for a specific buddy (non-interactive)
  verify            Verify what buddy your current ID produces

  upgrade           Pull latest version + reinstall (add --check to just check)

Settings:
  settings          Show current settings
  settings cooldown <n>  Set comment cooldown (0-300 seconds)
  settings ttl <n>       Set reaction display duration (0-300s, 0 = permanent)

Diagnostics:
  doctor            Run diagnostic report (paste output in bug reports)
  test-statusline   Test status line rendering in Claude Code
  backup            Snapshot or restore all claude-buddy state

In Claude Code:
  /buddy            Show companion card with ASCII art + stats
  /buddy pet        Pet your companion
  /buddy stats      Detailed stat card
  /buddy off        Mute reactions
  /buddy on         Unmute reactions
  /buddy rename     Rename companion (1-14 chars)
  /buddy personality  Set custom personality text
  /buddy summon     Summon a saved buddy (omit slot for random)
  /buddy save       Save current buddy to a named slot
  /buddy list       List all saved buddies
  /buddy dismiss    Remove a saved buddy slot
  /buddy pick       Launch interactive TUI picker (! bun run pick)
  /buddy frequency  Show or set comment cooldown (tmux only)
  /buddy style      Show or set bubble style (tmux only)
  /buddy position   Show or set bubble position (tmux only)
  /buddy rarity     Show or hide rarity stars (tmux only)
  /buddy width      Set bubble text width in chars (10-60, tmux only)
  /buddy language   Show or set buddy language (e.g. 'en', 'es', 'ja')

Usage:
  bun run <command>           e.g. bun run show, bun run doctor
  claude-buddy <command>      if globally linked (bun link)
  bun run help                Show this help
`);
}
