---
name: buddy-stats
description: "Toggle the buddy's stat-bar panel in the status line. Use when the user types /buddy-stats."
argument-hint: "[on|off]"
allowed-tools: mcp__claude_buddy__*, Bash
---

# Buddy Stats Panel

Toggle the stat-bar panel (DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK, with
`▲` peak and `▼` dump markers) that renders to the left of the buddy in the
status line.

**Before routing, check whether `mcp__claude_buddy__*` tools are registered.**
If they are NOT, the claude-buddy MCP server failed to start — do not call the
tool (it errors unhelpfully). Tell the user to restart Claude Code / re-run
`bun run install-buddy`, and stop.

## Routing

| User input            | Action                                             |
|-----------------------|----------------------------------------------------|
| `/buddy-stats`        | Call `buddy_stats_panel` with no args → toggles    |
| `/buddy-stats on`     | Call `buddy_stats_panel` with `enabled=true`       |
| `/buddy-stats off`    | Call `buddy_stats_panel` with `enabled=false`      |

Display the tool's result text verbatim. The status line reads the setting live,
so the change appears within ~1 second — no restart needed (assuming the status
line is already enabled via `/buddy statusline on`).

## Notes

- The panel shows the active companion's stats. It sits as the leftmost column:
  `stats | speech bubble | buddy`.
- If the status line is disabled, enabling the panel has no visible effect until
  `/buddy statusline on` is run — the tool will say so.
