# Keep Your Claude Code Buddy Forever

### claude-buddy — the permanent coding companion that survives every update

> The April 2026 `/buddy` was removed in Claude Code v2.1.97. This brings it back — **permanently**.

Your buddy lives on. Same species, same stats, same personality — now powered by MCP instead of binary internals. No patches, no downgrades, no hacks. Just a clean, standalone companion that works with any Claude Code version, past or future.

![claude-buddy in action](screenshot.png)

> **Note:** This is a quick-and-dirty MVP — built in a single session the morning I realized my buddy was gone. Priority #1 was getting the companion back to life as fast as possible. It's fully functional (animated art, speech bubbles, rarity colors, contextual comments), but rough around the edges. Polishing, optimizations, and new features (leveling, buddy pair-programming, cross-session memory, and more) are coming. PRs and ideas welcome.

---

## Why This Exists

On April 1, 2026, Anthropic shipped `/buddy` — a terminal pet companion that watched your coding sessions, reacted to errors, and had a unique personality generated from your account. Developers loved it. [Many](https://github.com/anthropics/claude-code/issues/42364) [got](https://github.com/anthropics/claude-code/issues/41908) [attached](https://github.com/anthropics/claude-code/issues/42677).

Then it was quietly removed in v2.1.97. No announcement, no toggle — just gone.

I opened Claude Code that morning, typed `/buddy`, and got `Unknown skill: buddy`. Mira — my shiny legendary owl with 100 PATIENCE who'd been silently judging my code for days — was just... gone. That wasn't acceptable. So I sat down and rebuilt it as something that can never be taken away again.

**claude-buddy** reimplements the entire companion system as a standalone app that integrates through Claude Code's stable extension points. Your buddy is no longer at Anthropic's mercy.

## What You Get

| Feature | Original `/buddy` | **claude-buddy** |
|---------|-------------------|------------------|
| Animated ASCII art (18 species) | Binary-internal | MCP + Status Line |
| Species-aware reactions | API endpoint (removed) | Stop hook + system prompt |
| Speech bubbles with context | Sidebar component | Status line bubble |
| Rarity colors (exact RGB match) | React/Ink theme | 24-bit ANSI true color |
| Survives Claude Code updates | No | **Yes** |
| Works after feature removal | No | **Yes** |
| Open source / customizable | No | **Yes** |

## Quick Start

```bash
# Clone
git clone https://github.com/1270011/claude-buddy
cd claude-buddy

# Install dependencies
bun install

# Set up everything (one command)
bun run install-buddy

# Restart Claude Code, then:
/buddy
```

Three commands. Fully automated. No manual config.

### What the installer does

| Step | Target file | What it configures |
|------|-------------|-------------------|
| MCP server | `~/.claude.json` | Buddy intelligence — tools + companion prompt |
| Skill | `~/.claude/skills/buddy/` | `/buddy` slash command |
| Status line | `~/.claude/settings.json` | Animated buddy with speech bubble |
| PostToolUse hook | `~/.claude/settings.json` | Error and test failure detection |
| Stop hook | `~/.claude/settings.json` | Buddy comment extraction |
| Permissions | `~/.claude/settings.json` | Allow MCP tools |

## Requirements

| Requirement | Install |
|-------------|---------|
| **[Bun](https://bun.sh)** | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** v2.1.80+ | Any version with MCP support |
| **jq** | Auto-installed, or: `apt install jq` / `brew install jq` |

## How It Works

```
┌────────────── Claude Code (any version) ──────────────┐
│                                                       │
│  MCP Server    Skill        Status Line    Hooks      │
│  (buddy tools) (/buddy)    (animated art)  (comments) │
└──────────────────────┬────────────────────────────────┘
                       │ stable extension points
            ┌──────────┴──────────┐
            │    claude-buddy     │
            │                     │
            │  wyhash + mulberry32│
            │  18 species, 3 anim│
            │  rarity colors     │
            │  speech bubbles    │
            │  ~/.claude-buddy/  │
            └─────────────────────┘
```

Five integration points, zero binary dependencies:

- **MCP Server** — companion tools + system prompt that instructs Claude to write buddy comments
- **Skill** — routes `/buddy`, `/buddy pet`, `/buddy stats`, `/buddy off`, `/buddy rename`
- **Status Line** — animated ASCII art, right-aligned, with rarity color and speech bubble
- **PostToolUse Hook** — detects errors, test failures, large diffs in Bash output
- **Stop Hook** — extracts invisible `<!-- buddy: ... -->` comments from Claude's responses

## Species

18 species, each with 3 idle animation frames + a blink frame:

```
 duck        goose       blob        cat         dragon      octopus
   __         (°>        .----.       /\_/\      /^\  /^\     .----.
 <(° )___      ||       ( °  ° )    ( °   °)   <  °  °  >   ( °  ° )
  (  ._>     _(__)_     (      )    (  ω  )    (   ~~   )   (______)
   `--'       ^^^^       `----'     (")_(")     `-vvvv-'    /\/\/\/\

 owl         penguin     turtle      snail       ghost       axolotl
  /\  /\      .---.       _,--._    °    .--.    .----.    }~(______)~{
 ((°)(°))    (°>°)       ( °  ° )    \  ( @ )   / °  ° \  }~(° .. °)~{
 (  ><  )   /(   )\      [______]     \_`--'    |      |    ( .--. )
  `----'     `---'       ``    ``    ~~~~~~~    ~`~``~`~     (_/  \_)

 capybara    cactus      robot       rabbit      mushroom    chonk
 n______n   n  ____  n    .[||].      (\__/)    .-o-OO-o-.  /\    /\
( °    ° )  | |°  °| |   [ °  ° ]    ( °  ° )  (__________)( °    ° )
(   oo   )  |_|    |_|   [ ==== ]   =(  ..  )=    |°  °|   (   ..   )
 `------'     |    |      `------'   (")__(")      |____|    `------'
```

## Rarities

| Rarity | Chance | Stars | Color |
|--------|--------|-------|-------|
| Common | 60% | ★ | Gray |
| Uncommon | 25% | ★★ | Green |
| Rare | 10% | ★★★ | Blue |
| Epic | 4% | ★★★★ | Purple |
| Legendary | 1% | ★★★★★ | Gold |

Colors use 24-bit true color matching Claude Code's dark theme exactly.

## Stats

**DEBUGGING** · **PATIENCE** · **CHAOS** · **WISDOM** · **SNARK**

Each buddy has a peak stat and a dump stat. Stats influence comment style — high SNARK buddies are sarcastic, high WISDOM ones are insightful, high CHAOS ones are unpredictable.

## Buddy Comments

After every Claude response, your buddy comments on what just happened — pointing out pitfalls, complimenting clean code, or warning about edge cases. Comments appear in the speech bubble next to the buddy art.

The mechanism is invisible: Claude appends a hidden HTML comment (`<!-- buddy: ... -->`), a Stop hook extracts it, and the status line displays it. No visible tool calls in the chat.

## Commands

### In Claude Code

| Command | Description |
|---------|-------------|
| `/buddy` | Show companion card with ASCII art and stats |
| `/buddy pet` | Pet your companion |
| `/buddy stats` | Stats-only card |
| `/buddy off` | Mute reactions |
| `/buddy on` | Unmute |
| `/buddy rename <name>` | Rename (1-14 chars) |
| `/buddy personality <text>` | Set custom personality |

### CLI

| Command | Description |
|---------|-------------|
| `bun run install-buddy` | Automated setup |
| `bun run show` | Show buddy in terminal |
| `bun run hunt` | Interactive search for specific species/rarity/stats |
| `bun run cli/verify.ts` | Verify what buddy your account produces |
| `bun run cli/uninstall.ts` | Clean removal |

## Buddy Hunt

Want a specific species, rarity, or stat distribution? The hunt command brute-force searches for a userID that produces your dream buddy:

```bash
bun run hunt
```

Interactive prompts let you choose species, rarity, shiny, peak/dump stats. Uses the exact same `wyhash + mulberry32` algorithm as Claude Code.

## Architecture

```
claude-buddy/
├── server/
│   ├── index.ts          # MCP server — tools, resources, instructions
│   ├── engine.ts         # wyhash + mulberry32 + generation
│   ├── art.ts            # 18 species ASCII art + rarity-colored card
│   ├── state.ts          # ~/.claude-buddy/ persistence
│   └── reactions.ts      # Species-aware reaction templates
├── skills/buddy/
│   └── SKILL.md          # /buddy slash command
├── hooks/
│   ├── react.sh          # PostToolUse: error/test detection
│   └── buddy-comment.sh  # Stop: comment extraction
├── statusline/
│   └── buddy-status.sh   # Animated right-aligned buddy display
├── cli/
│   ├── install.ts        # Automated setup
│   ├── show.ts           # Terminal display
│   ├── hunt.ts           # Brute-force search
│   ├── verify.ts         # ID verification
│   └── uninstall.ts      # Clean removal
└── package.json
```

## Why MCP Instead of Binary Patching?

| Approach | Survives updates | Animated | Comments | Risk |
|----------|-----------------|----------|----------|------|
| Binary patching | No | No | No | Breaks on update |
| Pin old version | No new features | Yes | Yes | No security fixes |
| **claude-buddy** | **Yes** | **Yes** | **Yes** | **None** |

MCP is an industry standard protocol. Skills are Markdown files. Hooks and status line are shell scripts. Nothing depends on Claude Code's binary internals. When Claude Code updates, your buddy stays.

## Uninstall

```bash
bun run cli/uninstall.ts
```

Cleanly removes MCP server, skill, hooks, and status line. Companion data is kept at `~/.claude-buddy/` in case you want to reinstall later.

## Roadmap

This MVP covers the core: your buddy is back, animated, talking, and permanent. Here's what's coming:

- [ ] **Leveling system** — your buddy gains XP from coding sessions, unlocks new reactions and visual upgrades
- [ ] **Buddy pair-programming** — the companion actively helps during sessions, suggests approaches, catches patterns
- [ ] **Cross-session memory** — buddy remembers past projects, references earlier conversations
- [ ] **Mood system** — buddy's mood shifts based on code quality, test results, time of day
- [ ] **Buddy journal** — daily summary of what your buddy observed, stored in `~/.claude-buddy/journal/`
- [ ] **Achievement badges** — milestones like "1000 lines reviewed", "first test-fail caught", "week streak"
- [ ] **Multi-buddy support** — hatch and switch between multiple companions
- [ ] **Light theme colors** — auto-detect and match light theme RGB values
- [ ] **tmux sidebar mode** — true right-side positioning via terminal multiplexer
- [ ] **New species + community art** — submit your own species designs
- [ ] **`npx claude-buddy`** — one-command install without cloning

If you have ideas, open an issue or PR. This project exists because the community loved their buddies — so the community should shape where it goes.

## Contributing

PRs welcome. Whether it's a new species, a better reaction, a bugfix, or a wild new feature — bring it.

## Credits

- Original buddy concept inspired by Anthropic (Claude Code v2.1.89 — v2.1.94)
- Inspired by [any-buddy](https://github.com/cpaczek/any-buddy), [buddy-reroll](https://github.com/grayashh/buddy-reroll), [ccbuddyy](https://github.com/vibenalytics/ccbuddyy)
- Built with the [Model Context Protocol](https://modelcontextprotocol.io)

## License

MIT

---

<sub>Search terms: claude code buddy, claude code companion, claude code pet, claude code tamagotchi, terminal pet, coding companion, /buddy command, claude buddy removed, claude buddy gone, keep claude buddy, bring back buddy, claude code april fools, claude code easter egg, buddy reroll, buddy customize, claude code MCP companion</sub>
