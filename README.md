<div align="center">

<!-- ============================================================ -->
<!-- LOGO / HERO                                                  -->
<!-- Later replace with: docs/logo.png                            -->
<!-- ============================================================ -->
<img src="https://placehold.co/120x120/6366f1/ffffff?text=%F0%9F%A6%89" alt="claude-buddy logo" width="120" />

# Claude Code Buddy

### Your Claude Code buddy — permanently. Survives every update.

<!-- ============================================================ -->
<!-- BADGES                                                        -->
<!-- ============================================================ -->

[![Version](https://img.shields.io/github/v/release/1270011/claude-buddy?style=flat-square&color=6366f1)](https://github.com/1270011/claude-buddy/releases)
[![License](https://img.shields.io/github/license/1270011/claude-buddy?style=flat-square&color=10b981)](LICENSE)
[![Stars](https://img.shields.io/github/stars/1270011/claude-buddy?style=flat-square&color=f59e0b)](https://github.com/1270011/claude-buddy/stargazers)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-v2.1.80%2B-8b5cf6?style=flat-square)](https://claude.ai/code)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macOS-blue?style=flat-square)](#requirements)
[![MCP](https://img.shields.io/badge/powered%20by-MCP-ec4899?style=flat-square)](https://modelcontextprotocol.io)

<!-- ============================================================ -->
<!-- HERO GIF — the most important asset                          -->
<!-- ============================================================ -->

<br>

<img src="docs/hero.gif" alt="claude-buddy in action" width="800" />

<br><br>

> **Anthropic removed `/buddy` in Claude Code v2.1.97.** This brings it back — *forever*. Same species, same stats, same personality. Now powered by MCP, so no update can ever take it away again.

<br>

<!-- ============================================================ -->
<!-- FEATURE HIGHLIGHTS — 4-column grid, no borders               -->
<!-- ============================================================ -->

<table>
<tr>
<td align="center" width="25%">
<h3>🛡️</h3>
<b>Survives Updates</b><br>
<sub>MCP-based, not binary-patched. Your buddy lives through every Claude Code release.</sub>
</td>
<td align="center" width="25%">
<h3>🎨</h3>
<b>19 Species</b><br>
<sub>From ducks to dragons — each with animated ASCII art and rarity colors.</sub>
</td>
<td align="center" width="25%">
<h3>💬</h3>
<b>Speech Bubbles</b><br>
<sub>Your buddy comments on your code in real time. Invisible, contextual, alive.</sub>
</td>
<td align="center" width="25%">
<h3>⚡</h3>
<b>One-Command Install</b><br>
<sub>Zero config. Works on any Claude Code v2.1.80+. Uninstall anytime.</sub>
</td>
</tr>
</table>

<br>

</div>

<!-- ============================================================ -->
<!-- QUICK START                                                  -->
<!-- ============================================================ -->

## 📋 Requirements

- **[bun](https://bun.sh/install)** on `PATH` — claude-buddy's MCP server runs on bun. Install once: `curl -fsSL https://bun.sh/install | bash`
- **Claude Code v2.1.80+**
- **Linux or macOS** (Windows is experimental)

## 🚀 Quick Start

```bash
git clone https://github.com/1270011/claude-buddy
cd claude-buddy
bun install
bun run install-buddy
```

Then restart Claude Code and type `/buddy`. That's it.

<sub>💡 Want a global `claude-buddy` command? → `bun link`</sub>
<br>
<sub>💡 Need help? → `bun run help` or `claude-buddy help` (if linked) in terminal · `/buddy help` in Claude Code</sub>

### Multiple Claude profiles?

If you run Claude Code with `CLAUDE_CONFIG_DIR` set (e.g. separate work and personal accounts), pass the same env var to install so buddy lands in the active profile and gets its own menagerie:

```bash
CLAUDE_CONFIG_DIR=~/.claude-personal bun run install-buddy
CLAUDE_CONFIG_DIR=~/.claude-personal bun run uninstall
```

The installer prints `Target profile: <path>` at the top so you can see at a glance which profile you're targeting. Each profile gets its own MCP entry, skill, hooks, status line, and `$CLAUDE_CONFIG_DIR/buddy-state/` menagerie — installs in one profile don't touch another. With `CLAUDE_CONFIG_DIR` unset, behaviour is identical to single-profile (`~/.claude/`, `~/.claude-buddy/`).

<br>

---

<!-- ============================================================ -->
<!-- COLLAPSIBLE SECTIONS START HERE                              -->
<!-- ============================================================ -->

<details>
<summary><b>🐙 &nbsp; Meet the 19 Species</b></summary>

<br>

Every buddy is uniquely generated from your Claude Code account — same species, same stats, same personality every time. 19 species, each with 3 idle animation frames + a blink.

<!-- Later replace with: docs/species-grid.png -->
<p align="center">
<img src="https://placehold.co/800x500/1e1e2e/cdd6f4?text=%F0%9F%90%99+SPECIES+GRID+IMAGE+%F0%9F%90%99%0A%2818+species+in+a+visual+grid%29" alt="all 18 species" width="800" />
</p>

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

### Rarities

| Rarity | Chance | Stars | Color |
|:---|:---:|:---:|:---|
| Common | 60% | ★ | Gray |
| Uncommon | 25% | ★★ | Green |
| Rare | 10% | ★★★ | Blue |
| Epic | 4% | ★★★★ | Purple |
| Legendary | 1% | ★★★★★ | Gold |

Colors use **24-bit true color** matching Claude Code's dark theme exactly.

### Stats

Every buddy has **5 core stats**: `DEBUGGING` · `PATIENCE` · `CHAOS` · `WISDOM` · `SNARK`

High SNARK buddies are sarcastic. High WISDOM ones are insightful. High CHAOS ones are unpredictable. Each buddy has a peak stat and a dump stat.

</details>

---

<details>
<summary><b>🏗️ &nbsp; How It Works</b></summary>

<br>

Five integration points, zero binary dependencies. When Claude Code updates, your buddy stays.

```
┌────────────── Claude Code (any version) ──────────────┐
│                                                        │
│   MCP Server    Skill       Status Line    Hooks       │
│  (buddy tools) (/buddy)    (animated art) (comments)   │
└───────────────────────┬────────────────────────────────┘
                        │ stable extension points
             ┌──────────┴──────────┐
             │    claude-buddy     │
             │                     │
             │  wyhash + mulberry32│
             │  18 species, 3 anim │
             │  rarity colors      │
             │  speech bubbles     │
             │  ~/.claude-buddy/   │
             └─────────────────────┘
```

- **MCP Server** — companion tools + system prompt that instructs Claude to write buddy comments
- **Skill** — routes `/buddy`, `/buddy pet`, `/buddy stats`, `/buddy off`, `/buddy rename`
- **Status Line** — animated ASCII art, right-aligned, with rarity color and speech bubble
- **PostToolUse Hook** — detects errors, test failures, large diffs in Bash output
- **Stop Hook** — extracts invisible `<!-- buddy: ... -->` comments from Claude's responses

### Why MCP Instead of Binary Patching?

| Approach | Survives Updates | Animated | Comments | Risk |
|---|:---:|:---:|:---:|---|
| Binary patching | ❌ | ❌ | ❌ | Breaks on update |
| Pin old version | ❌ | ✅ | ✅ | No security fixes |
| **claude-buddy** | **✅** | **✅** | **✅** | **None** |

MCP is an industry-standard protocol. Skills are Markdown files. Hooks and status line are shell scripts. Nothing depends on Claude Code's binary internals.

### Repository Layout

```
claude-buddy/
├── server/          # MCP server — tools, engine, art, reactions, state
├── skills/buddy/    # /buddy slash command
├── hooks/           # PostToolUse + Stop hooks (error & comment detection)
├── statusline/      # Animated right-aligned buddy display
└── cli/             # install, show, hunt, verify, doctor, backup, uninstall
```

</details>

---

<details>
<summary><b>🛠️ &nbsp; Commands Reference</b></summary>

<br>

### In Claude Code

| Command | Description |
|---|---|
| `/buddy` | Show companion card with ASCII art and stats |
| `/buddy pet` | Pet your companion |
| `/buddy stats` | Stats-only card |
| `/buddy off` / `on` | Mute / unmute reactions |
| `/buddy rename <name>` | Rename (1–14 chars) |
| `/buddy personality <text>` | Set custom personality |
| `/buddy summon [slot]` | Summon a saved buddy (omit slot for random) |
| `/buddy save [slot]` | Save current buddy to a named slot |
| `/buddy list` | List all saved buddies |
| `/buddy dismiss <slot>` | Remove a saved buddy slot |
| `/buddy pick` | Launch interactive TUI picker (`! bun run pick`) |
| `/buddy frequency [seconds]` | Show or set comment cooldown |
| `/buddy style [classic\|round]` | Bubble border style (tmux only) |
| `/buddy position [top\|left]` | Bubble position (tmux only) |
| `/buddy rarity [on\|off]` | Show or hide stars + rarity line (tmux only) |
| `/buddy help` | Show all buddy commands |

### CLI

| Command | Description |
|---|---|
| `bun run install-buddy` | Automated setup |
| `bun run show` | Show buddy in terminal |
| `bun run pick` | Interactive TUI to find and save your dream buddy |
| `bun run hunt` | Legacy search (use `pick` instead) |
| `bun run doctor` | Full diagnostic report |
| `bun run verify` | Verify buddy generation matches expected output |
| `bun run backup` | Snapshot / restore state |
| `bun run settings` | View / change buddy settings — cooldown, TTL (TUI coming soon) |
| `bun run disable` | Temporarily deactivate buddy |
| `bun run enable` | Re-enable buddy |
| `bun run help` | Full CLI reference |
| `bun run cli/uninstall.ts` | Clean removal |

<sub>💡 Want a global `claude-buddy` command? → `cd claude-buddy && bun link`</sub>

### 🎯 Buddy Pick

Want a specific species, rarity, or stat distribution?

```bash
bun run pick
```

Interactive TUI with saved buddies, criteria search, vim keys, and two-pane preview. Uses the exact same `wyhash + mulberry32` algorithm as Claude Code.

</details>

---

<details>
<summary><b>🔍 &nbsp; Diagnostic Tools</b></summary>

<br>

claude-buddy ships with built-in diagnostics for debugging across terminals and platforms.

### `bun run doctor`
Complete diagnostic — environment, terminal info, state, settings, padding test, live status line output. **Always run this first when filing a bug report.**

### `bun run test-statusline`
Temporarily replaces your status line with a multi-line diagnostic. Shows padding strategies side-by-side, color support, Unicode handling.

```bash
bun run test-statusline          # install test
# restart Claude Code, screenshot
bun run test-statusline restore  # restore buddy
```

### `bun run backup`
Snapshot all claude-buddy state to a timestamped backup. Use before experiments.

```bash
bun run backup              # create snapshot
bun run backup list         # list snapshots
bun run backup restore      # restore latest
bun run backup restore <ts> # restore specific
```

</details>

---

<details>
<summary><b>🐛 &nbsp; Troubleshooting</b></summary>

<br>

### Buddy not appearing in status line

1. Run `bun run doctor` — does the script work directly?
2. Restart Claude Code completely — `instructions` are loaded once at session start
3. Check `~/.claude/settings.json` has the `statusLine` block
4. Make sure `bun` and `jq` are in `$PATH`

### Buddy comments not showing

The buddy comment mechanism uses an MCP server `instructions` field that Claude only reads at **session start**. If you installed claude-buddy in an existing session, restart Claude Code.

```bash
jq '.mcpServers["claude-buddy"]' ~/.claude.json
```

### Buddy art looks broken or misaligned

Known MVP issue on some terminal/platform combos — different terminals render Braille Pattern Blank (U+2800) at different widths.

To help us fix it:
1. Run `bun run doctor` and paste output in a [new issue](https://github.com/1270011/claude-buddy/issues/new)
2. Run `bun run test-statusline` and screenshot the result
3. Then `bun run test-statusline restore`

### Recovery from a broken state

```bash
bun run backup restore      # restore latest backup
bun run cli/uninstall.ts    # full clean removal
```

</details>

---

<details>
<summary><b>📋 &nbsp; Requirements</b></summary>

<br>

| Requirement | Install |
|---|---|
| **[Bun](https://bun.sh)** | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** v2.1.80+ | Any version with MCP support |
| **jq** | `apt install jq` / `brew install jq` / [`windows: download and add 'jq.exe' from jqlang/jq to path`](https://github.com/jqlang/jq/releases/latest)|

> **Will I get the same buddy I had?** Yes. claude-buddy uses the exact same algorithm as the original (`wyhash + mulberry32`, same salt, same identity resolution). If your `~/.claude.json` still has your `accountUuid`, you'll get the identical species, rarity, stats, and cosmetics.

</details>

<br>

---

## 🗺️ Roadmap

- [x] **Multi-buddy support** — menagerie system with named slots, interactive TUI picker 💜[@doctor-ew](https://github.com/doctor-ew)💜
- [ ] **Leveling system** — XP from coding sessions, unlockable reactions and upgrades
- [ ] **Buddy pair-programming** — active help during sessions, pattern detection
- [ ] **Cross-session memory** — remembers past projects and earlier conversations
- [ ] **Mood system** — shifts based on code quality, tests, time of day
- [x] **Achievement badges** — "1000 lines reviewed", "week streak", etc. 💜[ndcorder](https://github.com/ndcorder)💜
- [ ] **Light theme colors** — auto-detect and match light theme RGB
- [x] **New species + community art** — wyvern added 💜[@jpmalone0](https://github.com/jpmalone0)💜 (community contributions welcome)
- [ ] **`npx claude-buddy`** — one-command install without cloning

<br>

---

## 💜 Contributors

Thank you to everyone who helped bring buddies back to life.

<a href="https://github.com/1270011/claude-buddy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=1270011/claude-buddy" alt="Contributors" />
</a>

<sub>Automatically generated from the [contributors graph](https://github.com/1270011/claude-buddy/graphs/contributors) via [contrib.rocks](https://contrib.rocks).</sub>

<br>

Want to help? New species, better reactions, bugfixes, wild new features — [PRs welcome](https://github.com/1270011/claude-buddy/pulls).

<br>

---

## 🙏 Credits

- Original buddy concept by **Anthropic** (Claude Code v2.1.89 — v2.1.94)
- Inspired by [any-buddy](https://github.com/cpaczek/any-buddy), [buddy-reroll](https://github.com/grayashh/buddy-reroll), [ccbuddyy](https://github.com/vibenalytics/ccbuddyy)
- Built with the [Model Context Protocol](https://modelcontextprotocol.io)

<br>

---

<div align="center">

### 📜 License

MIT — do whatever you want, just don't take my buddy away again.

<br>

<sub><b>Keywords:</b> claude code buddy · claude code companion · claude code pet · terminal pet · coding companion · tamagotchi · MCP companion · /buddy command · claude buddy removed · bring back buddy · ASCII art pet</sub>

</div>
