# Contributing to claude-buddy

Thanks for wanting to help bring buddies back to life!

## Quick Setup

```bash
git clone https://github.com/1270011/claude-buddy.git
cd claude-buddy
bun install
bun run install-buddy
```

Restart Claude Code and type `/buddy` to verify everything works.

## Project Structure

| Directory | What it does |
|-----------|-------------|
| `server/` | MCP server — buddy engine, tools, state, reactions |
| `skills/` | `/buddy` slash command (SKILL.md) |
| `hooks/` | Shell scripts for error detection + comment extraction |
| `statusline/` | Animated status line renderer |
| `cli/` | Install, uninstall, show, hunt, verify commands |

## How to Contribute

### Bug Fixes
1. Open an issue describing the bug
2. Fork the repo and create a branch (`fix/description`)
3. Fix it, test it locally
4. Open a PR

### New Features
1. Open an issue first to discuss the idea
2. Fork and branch (`feat/description`)
3. Keep it simple — this is an MVP, small PRs are better than big ones
4. Open a PR

### New Species Art
Species art lives in `server/art.ts` and `statusline/buddy-status.sh`. Each species has 3 animation frames of 4-5 lines, ~12 chars wide. Use `{E}` as the eye placeholder.

### New Reactions
Reaction templates are in `server/reactions.ts`. Species-specific reactions go in `SPECIES_REACTIONS`, general ones in `REACTIONS`.

## Code Style

- TypeScript for server/CLI code
- Bash for hooks and status line (keep it POSIX-friendly where possible)
- No unnecessary dependencies
- If it can be simple, keep it simple

## Testing

```bash
# Verify buddy generation
bun run cli/verify.ts

# Show current buddy
bun run show

# Test MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | bun server/index.ts

# Test status line
echo '{}' | ./statusline/buddy-status.sh
```

## Questions?

Open an issue. No question is too small.
