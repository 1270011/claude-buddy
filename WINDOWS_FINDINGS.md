# Windows support findings

Notes from an extended Windows-on-claude-buddy debugging session, captured so
we don't lose the hard-won knowledge. These observations are from running on
Windows 11 Pro (ARM64) under MSYS2 `CLANGARM64` with x86-64 bun 1.3.6. Claude
Code is the official CLI build (version `2.1.101`).

## tl;dr

| Pipeline | Status on Windows | Notes |
|---|---|---|
| MCP tool responses (`/buddy`, `/buddy stats`, `/buddy summon`) | **Working after [#39]** | Fully renders the markdown card — header, code-block art, stats table, blockquote personality, emoji reaction. |
| Status line full multi-line art | **Working in principle** (not yet wired up) | We now know the real constraints and have a proven rendering recipe. Needs a Windows-specific implementation path; see "Status line recipe" below. |
| MCP server spawn lifecycle | **Flaky** | Server sometimes starts cleanly, sometimes fails with `Connection closed` moments after spawn. Not correlated with terminal emulator (reproduces in zsh, cmd, PowerShell, nu). |

[#39]: https://github.com/1270011/claude-buddy/pull/39

## What we confirmed works

### 1. MCP tool rendering via PR #39's markdown renderer

PR #39 replaced ANSI-based card rendering with a pure markdown renderer for
MCP tool responses. On Windows this fixes three real bugs we'd independently
hit:

- **No literal ANSI fragments.** The old renderer emitted raw `\x1b[38;2;...m`
  sequences, and Claude Code's UI was stripping the ESC byte but leaving
  `[38;2;...m` as literal text. Markdown output has no escape sequences, so
  nothing to strip.
- **ASCII art is aligned.** Wrapping the art in a markdown code block preserves
  whitespace reliably — Claude Code no longer left-anchors lines or eats
  leading spaces.
- **Stats table is readable.** Rendered as a proper GFM table.

The Unicode eye character `✦` (U+2726), which the earlier status line attempts
couldn't display, survives fine in the MCP tool pipeline.

### 2. Path fixes (already committed on this branch)

- `cli/install.ts` and `cli/doctor.ts` now normalize all config-file paths to
  forward slashes (`C:/Users/...`). When Claude Code piped the previous
  backslashed paths through Git Bash, lone backslashes were eaten as escape
  characters, corrupting hook invocations to e.g. `C:Userslcjansource...`.
- `statusline/buddy-status.sh` falls back to `tput cols` when `/proc/fd/0`
  walking fails, which it always does in MSYS2.

### 3. Configurable reaction TTL

`reactionTTL` is now honored in both the full art branch **and** the Windows
short-circuit (commit `edd777d`). The Windows branch previously used a
hardcoded 20-second window; now it reads `reactionTTL` from
`~/.claude-buddy/config.json`, matching the upstream default of 0 (permanent).

## The status line pipeline: revised understanding

The earlier version of this document claimed Claude Code's status line
pipeline "rejected multi-line art" on Windows. **That was wrong.** We
retracted it after running a capability probe.

What actually happens on Windows inside Claude Code's status line rendering:

### Capability matrix (from empirical probing)

| Capability | Status | Notes |
|---|---|---|
| Multi-line output | ✅ works | We rendered 5 lines cleanly |
| ASCII box drawing (`.----.`, `|`, `` ` ``, `'`) | ✅ works | |
| Unicode codepoints like `✦` (U+2726) | ✅ works | Even in multi-line with padding |
| ANSI color codes (`\x1b[38;2;R;G;Bm`) | ⚠️ silently stripped | Content intact, color lost. No literal fragments like `[38;2;...m`. |
| **Leading whitespace on each line** | ❌ stripped | One hard constraint. Regular ASCII space, tab, NBSP, em space, ideographic space — all stripped. |
| Braille Blank U+2800 as the first char | ✅ preserved | Not treated as whitespace, so the line survives stripping intact. |
| ASCII whitespace **after** a non-whitespace character | ✅ preserved | Once stripping stops, everything else survives. |
| Markdown (`**bold**`, `*italic*`, `` `code` ``, `# heading`) | ❌ rendered literally | No GFM processing. `**Biscuit**` shows as `**Biscuit**`. |

### The hard rule

> Each line must start with Braille Blank U+2800. After that, regular ASCII
> spaces and text survive unchanged. Use an all-`<braille blank><spaces>...`
> prefix as a SPACER to push content rightward.

### Terminal width detection on Windows

None of the usual sources work when Claude Code spawns the status line
script:

| Source | Result in Claude Code subprocess on Windows |
|---|---|
| `$COLUMNS` env var | unset |
| `tput cols` | returns 80 (its no-TTY fallback) |
| `stty size < /dev/tty` | empty (no TTY) |
| Claude Code stdin JSON | **no width field** — only `session_id`, `transcript_path`, `cwd`, `model`, `workspace`, `version`, `output_style`, `cost`, `context_window`, `rate_limits`, `vim`. |
| **`cmd //c "mode con" \| grep -i column`** | ✅ returns real width (e.g. 120) |

So on Windows, the only reliable width source is querying the Windows
console subsystem directly via `mode con`. This is a new dependency on
`cmd.exe` being reachable from bash, which is safe on any MSYS2 /
Git Bash environment.

### Status line recipe (not yet wired up as a production path)

This pattern renders cleanly on Windows Claude Code, right-aligned, with the
full species face intact:

```bash
# Terminal width via mode con
COLS=$(cmd //c "mode con" 2>/dev/null \
    | grep -i column | tr -d '\r' \
    | awk '{print $NF}')
case "$COLS" in ''|*[!0-9]*) COLS=120 ;; esac

# Pad = COLS - art bounding box - right margin
ART_W=10
MARGIN=4
PAD=$(( COLS - ART_W - MARGIN ))
[ "$PAD" -lt 1 ] && PAD=1

# SPACER = Braille Blank + ASCII spaces
SPACER=$(printf '\xe2\xa0\x80%*s' "$PAD" '')

# Pre-pad narrow art lines so they all end at the same column
printf '%s  .----.  \n%s( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n%s(      )\n%s  `----'\''  \n%s Biscuit\n' \
    "$SPACER" "$SPACER" "$SPACER" "$SPACER" "$SPACER"
```

What this gives us vs. the current minimal text fallback:

- Full ASCII species face, not just `Name: (reaction)`
- Right-aligned on the actual terminal width
- Name line below the art
- Multi-line support up to at least 5 lines

What it doesn't yet give us:

- **Speech bubble to the left of the art.** The non-Windows path draws a box
  containing the reaction text on the left side of the art, then pads the
  combined assembly to the right edge. That makes each line ~80+ chars wide.
  When we tried rendering this exact output (test level 19), Claude Code
  produced no visible output — something about the width, the dim+italic
  ANSI sequences, or the combination. Root cause not yet isolated.
- **Animation.** The non-Windows art cycles frames on a timestamp. Trivial
  to port once the baseline is in place.
- **Rarity color.** ANSI color is silently stripped, so this is essentially
  cosmetic-on-Linux-only. We can emit the codes anyway with zero cost.
- **Hat line.** Easy add.

### Why PR #39 did **not** fix this pipeline

PR #39 rewrote `server/art.ts::renderCompanionCardMarkdown` which feeds MCP
tool responses. The status line is an **independent rendering path** in
Claude Code — it reads the raw output of the status line command and applies
its own (different) transformation rules. The two pipelines have overlapping
but distinct constraints. Any markdown-based fix helps MCP tool output but
not the status line, and vice versa.

## What is still broken

### MCP server spawn is flaky

Symptoms:

- Sometimes `/buddy show` works. Sometimes it returns an empty bullet or a
  `Connection closed` error.
- Pattern is **independent of terminal emulator** (reproduces in WezTerm,
  Windows Terminal), **independent of shell** (zsh under MSYS2, cmd,
  PowerShell, nu shell), and even of how long the session has been running.
- Restarting Claude Code sometimes fixes it, sometimes doesn't.

Critically, the MCP server is **not** broken. Running
`bun server/index.ts` and feeding it a JSON-RPC initialize message from
the command line produces a correct response:

```
$ printf '{"jsonrpc":"2.0","id":1,"method":"initialize",...}\n' | bun server/index.ts
{"result":{"protocolVersion":"2025-03-26","capabilities":{...},"serverInfo":{"name":"claude-buddy",...},...}
```

The server responds, reports its capabilities, and holds the connection open
until stdin EOF — textbook behavior. So the bug is **in Claude Code's spawn
and stdio plumbing for MCP servers on Windows**, not in claude-buddy.

Environmental notes:

- Windows 11 Pro (ARM64)
- MSYS2 `CLANGARM64` (but issue reproduces outside MSYS2 too)
- bun 1.3.6 at `/c/Users/lcjan/.bun/bin/bun.exe`, x86-64 PE binary (running
  under ARM64 Windows emulation)
- `@modelcontextprotocol/sdk` resolved to 1.29.0 (pinned as `^1.12.1` in
  `package.json`, but lockfile has the newer version)
- Claude Code version `2.1.101`

Possible next things to try (not yet attempted):

- Change `~/.claude.json` to invoke bun via its absolute path rather than
  relying on PATH lookup (`"command": "C:/Users/lcjan/.bun/bin/bun.exe"`).
- Test with an x64 Windows machine to rule out ARM64 emulation weirdness.
- Capture Claude Code's MCP spawn / stdio logs if they exist.
- Downgrade `@modelcontextprotocol/sdk` to 1.12.1 to rule out a regression
  between 1.12 and 1.29.
- File an upstream issue against Claude Code with the `Connection closed`
  reproducer.

## Two pipelines, distinct constraints — key insight

The most load-bearing thing we learned this session is that **Claude Code
has at least two independent content rendering paths on Windows**, and they
fail differently:

1. **MCP tool response pipeline** — reads text content, treats it as
   markdown, renders via its markdown UI layer. Used to strip ANSI badly;
   PR #39 worked around this by emitting pure markdown. Now works for
   claude-buddy.
2. **Status line pipeline** — reads text content, treats it as literal
   terminal output, applies per-line leading-whitespace stripping and
   silently drops ANSI escape sequences. Accepts Unicode and multi-line
   content. Does **not** render markdown.

A fix for one does not fix the other. When reasoning about "does it
render on Windows?", always name which pipeline you mean.

## Test harness

The branch currently carries a temporary capability-probe harness inside
`statusline/buddy-status.sh`. When `~/.claude-buddy/status-test-level`
contains a number 1–30, the Windows branch outputs a specific test
pattern instead of the normal fallback. Levels we used this session:

| Level | Purpose | Result |
|---:|---|---|
| 1 | ANSI color, 1 line, ASCII | pass (ANSI stripped, content intact) |
| 2 | Single Unicode `✦`, 1 line | pass |
| 3 | ANSI + Unicode, 1 line | pass |
| 4 | 2 lines, plain ASCII | pass |
| 5 | 2 lines + leading ASCII spaces | fail (leading whitespace stripped) |
| 6 | 4 lines, plain ASCII art | pass |
| 7 | 4 lines + ANSI color | pass |
| 8 | 4 lines + color + Unicode eyes | pass |
| 9 | Markdown bold `**Biscuit**` | fail (literal asterisks) |
| 10 | Markdown italic `*Biscuit*` | fail (literal asterisks) |
| 11 | Markdown code `` `Biscuit` `` | fail (literal backticks) |
| 12 | Markdown heading `# Biscuit` | fail (literal hash) |
| 13 | Braille Blank U+2800 as leading padding (×4) | **pass** |
| 14 | Non-breaking space U+00A0 as leading padding | fail (stripped) |
| 15 | Em space U+2003 as leading padding | fail (stripped) |
| 16 | Ideographic space U+3000 as leading padding | fail (stripped) |
| 17 | 1 Braille Blank + 3 ASCII spaces as leading padding | pass |
| 18 | Braille Blank + internal whitespace mix | pass |
| 19 | Full non-Windows path (speech bubble + art) | **fail** — no visible output |
| 20 | 4 lines, art, Braille padding, no color | pass but center-unaligned |
| 21 | Same as 20 + name line | pass (5 lines work) |
| 22 | 4 lines art, Braille padding, + ANSI color | pass |
| 23 | Dynamic padding from `tput cols` (returns 80) | pass but padded to 80 cols only |
| 24 | Probe: prints `COLS=` value | reveals `tput cols = 80` fallback |
| 25 | Level 23 + pre-padded narrow art lines | pass, properly right-aligned to 80 cols |
| 26 | Dump stdin to file | reveals Claude Code stdin JSON has no width field |
| 27 | Probe all width sources | **`mode con` is the only one that works** |
| 28 | Hardcoded PAD=30 | proves Claude Code renders bytes literally, not auto-aligned |
| 29 | Hardcoded PAD=120 | ditto |
| 30 | `mode con` width + pre-padded 5-line art | **pass** — the recipe |

The harness should be removed before merging upstream; it exists purely
for capture of this session's experiments.

## Commit log on `fix/windows-path-separators`

```
edd777d fix(statusline): share reactionTTL config read with Windows fallback
2b86fef Merge remote-tracking branch 'origin/main' into fix/windows-path-separators
27bad9f fix(statusline): wrap Windows status line in round parens
520e5a9 fix(statusline): minimal text fallback for Claude Code on Windows
1a9bea6 fix(statusline): fall back to tput cols on Git Bash / Windows
23215ad fix(doctor): normalize STATUS_SCRIPT path for Git Bash on Windows
3d2543f fix(install): normalize config paths to forward slashes on Windows
```
