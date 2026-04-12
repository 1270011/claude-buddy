#!/usr/bin/env bun
/**
 * buddy-shell — terminal wrapper with fixed buddy panel at bottom.
 *
 * Intercepts specific ANSI sequences from the PTY (alternate screen,
 * screen clear, scroll region reset) and repairs the panel after each.
 * Everything else passes through unmodified.
 *
 * Usage:
 *   npx tsx cli/buddy-shell.ts          # runs claude
 *   npx tsx cli/buddy-shell.ts bash     # runs bash
 */

import { spawn as ptySpawn } from "node-pty";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getArtFrame, HAT_ART } from "../server/art.ts";
import type { Species, Eye, Hat } from "../server/engine.ts";
import { getBiome, listBiomes } from "./biomes.ts";
import xtermPkg from "@xterm/headless";
import serializePkg from "@xterm/addon-serialize";
const { Terminal } = xtermPkg as any;
const { SerializeAddon } = serializePkg as any;

if (!process.stdin.isTTY && !process.argv.includes("--biomes")) {
  console.error("buddy-shell requires an interactive terminal (TTY)");
  process.exit(1);
}

// --biomes flag: list all and exit
if (process.argv.includes("--biomes")) {
  console.log("\nAvailable biomes:\n");
  for (const b of listBiomes()) {
    const tag = b.isDefault ? " (default)" : "";
    console.log(`  ${b.name}${tag}`);
  }
  console.log(`\nUsage: npx tsx cli/buddy-shell.ts claude --biome volcano\n`);
  process.exit(0);
}

// Parse --biome <name> from args
const biomeArgIdx = process.argv.indexOf("--biome");
const biomeOverride = biomeArgIdx >= 0 ? process.argv[biomeArgIdx + 1] : undefined;

const ESC = "\x1b";
const CSI = `${ESC}[`;
const moveTo = (r: number, c: number) => `${CSI}${r};${c}H`;
const clearLine = `${CSI}2K`;
const setScrollRegion = (top: number, bot: number) => `${CSI}${top};${bot}r`;
const BOLD = `${CSI}1m`;
const DIM = `${CSI}2m`;
const NC = `${CSI}0m`;
const CYAN = `${CSI}36m`;
const GREEN = `${CSI}32m`;
const YELLOW = `${CSI}33m`;
const MAGENTA = `${CSI}35m`;
const GRAY = `${CSI}90m`;

const RED = `${CSI}31m`;
const BLUE = `${CSI}34m`;

const RARITY_CLR: Record<string, string> = {
  common: GRAY, uncommon: GREEN, rare: BLUE,
  epic: MAGENTA, legendary: YELLOW,
};

const STATE_DIR = join(homedir(), ".claude-buddy");

// ─── xterm cell → ANSI renderer ─────────────────────────────────────────────
//
// Converts a single cell's color modes (default/palette/rgb) into the
// corresponding ANSI escape sequence. Tracks previous attributes so we
// only emit escape codes when something changes (massive perf win).

function fgForCell(cell: any): string {
  if (cell.isFgDefault()) return "39";
  if (cell.isFgRGB()) {
    const color = cell.getFgColor();
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `38;2;${r};${g};${b}`;
  }
  // Palette (16 or 256)
  return `38;5;${cell.getFgColor()}`;
}
function bgForCell(cell: any): string {
  if (cell.isBgDefault()) return "49";
  if (cell.isBgRGB()) {
    const color = cell.getBgColor();
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `48;2;${r};${g};${b}`;
  }
  return `48;5;${cell.getBgColor()}`;
}

const SCROLLBAR_WIDTH = 2;
// Reserved gap between Claude's content and the scrollbar — so word-select
// stops at the gap instead of copying scrollbar characters.
const SCROLLBAR_GAP = 1;
const SCROLLBAR_RESERVED = SCROLLBAR_WIDTH + SCROLLBAR_GAP;

function renderScrollbar(term: any, startRow: number, codeRows: number, col: number): string {
  const buf = term.buffer.active;
  if (buf.baseY === 0) return "";

  const ratio = buf.viewportY / buf.baseY;
  const totalLines = buf.length;
  const thumbSize = Math.max(1, Math.floor((codeRows * codeRows) / totalLines));
  const thumbTop = Math.round(ratio * (codeRows - thumbSize));

  const out: string[] = [];
  for (let i = 0; i < codeRows; i++) {
    const isThumb = i >= thumbTop && i < thumbTop + thumbSize;
    const seg = isThumb ? `${CSI}36m██${CSI}0m` : `${CSI}90m╎╎${CSI}0m`;
    out.push(moveTo(startRow + i, col - SCROLLBAR_WIDTH + 1) + seg);
  }
  return out.join("");
}

function renderXtermViewport(term: any, startRow: number, codeRows: number, cols: number): string {
  const buf = term.buffer.active;
  const viewportTop = buf.viewportY;
  const out: string[] = [];

  for (let vy = 0; vy < codeRows; vy++) {
    const bufY = viewportTop + vy;
    const line = buf.getLine(bufY);
    out.push(moveTo(startRow + vy, 1));
    out.push(`${CSI}0m`);

    if (!line) {
      out.push(" ".repeat(cols));
      continue;
    }

    let lastAttrs = "";
    let rendered = 0;

    for (let x = 0; x < Math.min(line.length, cols); x++) {
      const cell = line.getCell(x);
      if (!cell) { out.push(" "); rendered++; continue; }

      const parts: string[] = ["0"];
      if (cell.isBold()) parts.push("1");
      if (cell.isDim()) parts.push("2");
      if (cell.isItalic()) parts.push("3");
      if (cell.isUnderline()) parts.push("4");
      if (cell.isInverse()) parts.push("7");
      parts.push(fgForCell(cell));
      parts.push(bgForCell(cell));
      const attrs = parts.join(";");

      if (attrs !== lastAttrs) {
        out.push(`${CSI}${attrs}m`);
        lastAttrs = attrs;
      }

      const chars = cell.getChars();
      const width = cell.getWidth();
      if (width === 0) continue; // second half of a wide char
      out.push(chars || " ");
      rendered += width || 1;
    }

    // Pad remainder of row with spaces (reset first so bg doesn't bleed)
    if (rendered < cols) {
      out.push(`${CSI}0m`);
      out.push(" ".repeat(cols - rendered));
    }
  }

  return out.join("");
}

function layout() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const panel = Math.max(5, Math.floor(rows * 0.20));
  const code = rows - panel;
  return { cols, rows, panel, code };
}

function loadStatus(): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, "status.json"), "utf8"));
  } catch { return null; }
}

function loadStats(): Record<string, any> | null {
  try {
    const m = JSON.parse(readFileSync(join(STATE_DIR, "menagerie.json"), "utf8"));
    return m.companions?.[m.active]?.bones ?? null;
  } catch { return null; }
}

// ─── Render panel + set scroll region ───────────────────────────────────────

// ─── Interactive panel state ────────────────────────────────────────────────

type PanelMode = "menu" | "settings-full";
let panelFocus = false;
let panelMode: PanelMode = "menu";
let menuCursor = 0;
let settingsCursor = 0;
let pauseOutput = false; // when true, swallow PTY output (Claude is "hidden")
const MENU_ITEMS = ["Settings", "Pet buddy", "Say hi"];
let panelMessage = "";

// Settings definitions (key, label, cycle function on Enter)
import { readFileSync as readFs, writeFileSync as writeFs, existsSync as existsFs, mkdirSync as mkdirFs } from "fs";
const CONFIG_FILE = join(STATE_DIR, "config.json");

interface Settings {
  commentCooldown: number;
  reactionTTL: number;
  bubbleStyle: string;
  bubblePosition: string;
  showRarity: boolean;
}

function loadSettings(): Settings {
  const defaults: Settings = { commentCooldown: 30, reactionTTL: 0, bubbleStyle: "classic", bubblePosition: "top", showRarity: true };
  try { return { ...defaults, ...JSON.parse(readFs(CONFIG_FILE, "utf8")) }; } catch { return defaults; }
}
function saveSettings(cfg: Settings) {
  if (!existsFs(STATE_DIR)) mkdirFs(STATE_DIR, { recursive: true });
  writeFs(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

const SETTINGS_LIST = [
  { key: "commentCooldown" as const, label: "Comment Cooldown", cycle: (v: Settings) => { v.commentCooldown = (v.commentCooldown + 10) % 120; } },
  { key: "reactionTTL" as const, label: "Reaction TTL", cycle: (v: Settings) => { v.reactionTTL = (v.reactionTTL + 10) % 60; } },
  { key: "bubbleStyle" as const, label: "Bubble Style", cycle: (v: Settings) => { v.bubbleStyle = v.bubbleStyle === "classic" ? "round" : "classic"; } },
  { key: "bubblePosition" as const, label: "Bubble Position", cycle: (v: Settings) => { v.bubblePosition = v.bubblePosition === "top" ? "left" : "top"; } },
  { key: "showRarity" as const, label: "Show Rarity", cycle: (v: Settings) => { v.showRarity = !v.showRarity; } },
];

function setupPanel() {
  const { cols, code, panel } = layout();
  const s = loadStatus();
  const bones = loadStats();

  const out: string[] = [];

  // Set scroll region to code area only
  out.push(setScrollRegion(1, code));

  // Clear panel area
  for (let i = 0; i < panel; i++) {
    out.push(moveTo(code + 1 + i, 1) + clearLine);
  }

  // Separator line with focus hint
  {
    const clrLine = panelFocus ? `${CSI}33m` : CYAN;
    const label = panelFocus ? " buddy [FOCUS] " : " buddy  ";
    const hint = panelFocus ? " esc back " : " Ctrl+Space / F2 to open ";
    const used = label.length + hint.length + 2;
    out.push(moveTo(code + 1, 1) +
      `${clrLine}─${label}${DIM}${hint}${NC}${clrLine}${"─".repeat(Math.max(0, cols - used))}${NC}`);
  }

  if (!s) {
    out.push(moveTo(code + 2, 1) +
      `${DIM}  No buddy. Run: bun run install-buddy${NC}`);
    process.stdout.write(out.join(""));
    return;
  }

  const clr = RARITY_CLR[s.rarity] ?? GRAY;
  const shiny = s.shiny ? " ✨" : "";

  // ─── 3-column layout ──────────────────────────────────────────
  //
  //  | left: speech bubble | center: buddy art | far right: stats |
  //

  // Get ASCII art
  let artLines: string[] = [];
  try {
    artLines = getArtFrame(s.species as Species, s.eye as Eye, 0);
    const hatLine = HAT_ART[s.hat as Hat];
    if (hatLine && artLines[0] && !artLines[0].trim()) artLines[0] = hatLine;
    artLines = artLines.filter(l => l.trim());
  } catch {
    artLines = [s.face || "(??)"];
  }

  const contentRows = panel - 1;
  const artW = 14;
  const artStart = Math.floor(cols / 2) - Math.floor(artW / 2);

  // ── Speech bubble (simple, above buddy) ──
  let bubbleLines: string[] = [];
  const maxBubbleW = Math.min(40, artStart - 4); // up to 40 chars or available space
  const maxBubbleLines = Math.max(1, contentRows - 2); // leave room for top/bottom border

  if (s.reaction && !s.muted && maxBubbleW > 8) {
    const text = s.reaction;
    const wrapped: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line.length + word.length + 1 > maxBubbleW) {
        if (line) wrapped.push(line);
        line = word.length > maxBubbleW ? word.slice(0, maxBubbleW - 1) + "…" : word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) wrapped.push(line);
    const maxLines = Math.min(wrapped.length, maxBubbleLines);
    const bw = Math.max(...wrapped.slice(0, maxLines).map(l => l.length));
    bubbleLines.push(`╭${"─".repeat(bw + 2)}╮`);
    for (let i = 0; i < maxLines; i++) {
      bubbleLines.push(`│ ${wrapped[i].padEnd(bw)} │`);
    }
    bubbleLines.push(`╰${"─".repeat(bw + 2)}╯`);
  }
  const bubbleW = bubbleLines.length > 0 ? bubbleLines[0].length : 0;
  // Position bubble upper-left of the buddy (right edge slightly overlaps buddy's left side)
  const bubbleCol = Math.max(1, artStart + 2 - bubbleW);

  // ── Right column: name + stats (far right) ──
  const statW = 20;
  const rightStart = cols - statW;
  const rightLines: string[] = [];
  rightLines.push(`${BOLD}${clr}${s.name}${NC}${shiny}`);
  rightLines.push(`${clr}${s.rarity?.toUpperCase()} ${s.species} ${s.stars}${NC}`);

  if (bones?.stats) {
    for (const [k, v] of Object.entries(bones.stats as Record<string, number>)) {
      const marker = k === bones.peak ? "▲" : k === bones.dump ? "▼" : " ";
      const c = k === bones.peak ? GREEN : k === bones.dump ? `${CSI}31m` : DIM;
      rightLines.push(`${c}${k.padEnd(10)} ${String(v).padStart(3)}${marker}${NC}`);
    }
  }

  // ── Generate landscape from biome ──
  function renderBgRow(row: number, seed: number, isGround: boolean): string {
    const bgOut: string[] = [];
    bgOut.push(moveTo(row, 1) + clearLine);
    if (isGround) {
      bgOut.push(moveTo(row, 1));
      let line = "";
      const gc = biome.groundChars;
      for (let x = 0; x < cols; x++) {
        line += gc[(x * 13 + 7) % gc.length];
      }
      bgOut.push(`${biome.ground}${line}${NC}`);
    } else {
      const pChars = biome.particle.chars;
      for (let x = 1; x <= cols; x++) {
        const h = ((seed * 31 + x * 17) % 97);
        if (h < 3) {
          bgOut.push(moveTo(row, x) + `${biome.particle.color}${pChars[0]}${NC}`);
        } else if (h < 5 && pChars.length > 1) {
          bgOut.push(moveTo(row, x) + `${biome.particle.color}${pChars[1]}${NC}`);
        } else if (h < 6 && pChars.length > 2) {
          bgOut.push(moveTo(row, x) + `${biome.particle.color}${pChars[2]}${NC}`);
        }
      }
    }
    return bgOut.join("");
  }

  // Structure from biome (house/lighthouse/tower/etc)
  const biome = getBiome(s.rarity, biomeOverride);
  const structureLines = biome.structure.slice(-contentRows);
  const structureStart = artStart + artW + 2;

  // Position buddy so feet are on the ground (last art line = last row)
  // If art has 4 lines and contentRows is 4:
  //   row 0: art[0] (sky)
  //   row 1: art[1] (sky)
  //   row 2: art[2] (sky)
  //   row 3: art[3] (ground) — feet on grass
  const artOffset = Math.max(0, contentRows - artLines.length);
  const structOffset = Math.max(0, contentRows - structureLines.length);

  // ── Render rows ──
  for (let i = 0; i < contentRows; i++) {
    const row = code + 2 + i;
    const isLastRow = i === contentRows - 1;

    // Background: sky or ground
    out.push(renderBgRow(row, i * 3 + 1, isLastRow));

    // Interactive menu (top-left of panel)
    if (panelMode === "menu" && i < MENU_ITEMS.length) {
      const isCursor = panelFocus && i === menuCursor;
      const prefix = isCursor ? `${CSI}33m▸ ` : "  ";
      const text = MENU_ITEMS[i];
      const colorOn = panelFocus ? (isCursor ? `${CSI}33m${BOLD}` : `${CSI}37m`) : DIM;
      out.push(moveTo(row, 2) + `${colorOn}${prefix}${text}${NC}`);
    }

    // Panel message (bottom row if there's a message)
    if (i === contentRows - 1 && panelMessage) {
      out.push(moveTo(row, 2) + `${GREEN}✓ ${panelMessage}${NC}`);
    }

    // Structure from biome (right of buddy, on the ground)
    const structIdx = i - structOffset;
    if (structIdx >= 0 && structIdx < structureLines.length && structureStart + 16 < rightStart) {
      out.push(moveTo(row, structureStart) + structureLines[structIdx]);
    }

    // Buddy art (feet on ground) — rendered BEFORE the bubble
    const artIdx = i - artOffset;
    if (artIdx >= 0 && artIdx < artLines.length) {
      out.push(moveTo(row, artStart) + `${clr}${BOLD}${artLines[artIdx]}${NC}`);
    }

    // Stats (far right)
    if (i < rightLines.length) {
      out.push(moveTo(row, rightStart) + rightLines[i]);
    }

    // Speech bubble (rendered LAST — highest z-index, always on top)
    if (i < bubbleLines.length && bubbleCol > 0) {
      out.push(moveTo(row, bubbleCol) + `${clr}${bubbleLines[i]}${NC}`);
    }
  }

  process.stdout.write(out.join(""));
}

// ─── Sequences that destroy our panel ───────────────────────────────────────

const DESTRUCTIVE = [
  "\x1b[?1049h",   // enter alternate screen
  "\x1b[?1049l",   // leave alternate screen
  "\x1b[2J",       // clear entire screen
  "\x1b[r",        // reset scroll region
];

function containsDestructive(data: string): boolean {
  return DESTRUCTIVE.some(seq => data.includes(seq));
}

// ─── Main ───────────────────────────────────────────────────────────────────

const { cols, code } = layout();

process.stdin.setRawMode(true);
process.stdin.resume();

// Enter alternate screen buffer. Since xterm-headless manages Claude's scrollback
// internally and we intercept mouse wheel to scroll xterm, we don't need the
// terminal's native scrollback. Alt screen gives us:
//   - No native scrollbar confusion (nothing to show in main buffer)
//   - No resize pollution (alt buffer has no scrollback)
//   - Clean exit (terminal's pre-wrapper content is restored, like vim/htop)
process.stdout.write(`${CSI}?1049h`);
process.stdout.write(`${CSI}2J${moveTo(1, 1)}`);
setupPanel();

// Spawn PTY (filter out --biome args)
const rawArgs = process.argv.slice(2).filter((a, i, arr) =>
  a !== "--biome" && (i === 0 || arr[i - 1] !== "--biome")
);
const cmd = rawArgs[0] || "claude";
const args = rawArgs.slice(1);

// Create a virtual xterm terminal for Claude. We feed Claude's PTY output
// into xterm, which parses ANSI and maintains its own cell buffer + scrollback.
// Then we render the visible viewport into the top area of the real terminal.
// This gives us true scrollback isolation — the real terminal's main buffer
// is not polluted by Claude's output.
const xterm = new Terminal({
  cols: cols - SCROLLBAR_RESERVED,
  rows: code,
  scrollback: 5000,
  allowProposedApi: true,
});

// Serialize addon lets us save/restore the buffer as an ANSI string.
// Used on resize: save → clear → resize → restore → Claude's redraw goes on top.
const serializeAddon = new SerializeAddon();
xterm.loadAddon(serializeAddon);

const pty = ptySpawn(cmd, args, {
  name: "xterm-256color",
  cols: cols - SCROLLBAR_RESERVED,
  rows: code,
  cwd: process.cwd(),
  env: { ...process.env, BUDDY_SHELL: "1" } as Record<string, string>,
});

// Coalesced renderer — we don't re-render on every tiny PTY chunk,
// we accumulate and render at most every ~16ms (60 fps).
let renderPending = false;

// Safety-net queue for single-arrow chunks. Node can split a wheel burst
// across data events, so a lone arrow might actually be part of a wheel
// tick. We hold single arrows for 30ms — if more arrive, scroll; if the
// timer expires alone, treat as a real keypress.
let arrowQueue: string[] = [];
let arrowFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushArrowQueue() {
  const q = arrowQueue;
  arrowQueue = [];
  arrowFlushTimer = null;
  if (q.length === 0) return;
  if (q.length >= 2) {
    const ups = q.filter(a => a === "\x1b[A").length;
    const downs = q.filter(a => a === "\x1b[B").length;
    xterm.scrollLines((downs - ups) * 2);
    scheduleRender();
  } else {
    for (const a of q) pty.write(a);
  }
}
// Track what we last told the real terminal so we only send updates on change
let lastCursorX = -1, lastCursorY = -1;
let lastCursorVisible = true;

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  setTimeout(() => {
    renderPending = false;
    if (pauseOutput) return;
    const { cols: c, code: h } = layout();
    const innerCols = c - SCROLLBAR_RESERVED;
    const buf = xterm.buffer.active;
    const isAtBottom = buf.viewportY === buf.baseY;

    const parts: string[] = [];
    parts.push(`${CSI}?25l`);
    parts.push(renderXtermViewport(xterm, 1, h, innerCols));
    parts.push(renderScrollbar(xterm, 1, h, c));
    if (isAtBottom) {
      parts.push(moveTo(buf.cursorY + 1, buf.cursorX + 1));
      parts.push(`${CSI}?25h`);
    }
    process.stdout.write(parts.join(""));
  }, 16);
}

pty.onData((data: string) => {
  xterm.write(data);
  if (!pauseOutput) scheduleRender();
});

// Enable alternate scroll mode (1007) — terminal converts wheel to arrow
// keys in alt screen, so we can detect them as key events. No mouse tracking
// means native selection (click, double-click, shift-extend) works normally.
process.stdout.write(`${CSI}?1007h`);

// Keyboard → PTY or panel
process.stdin.on("data", (data: Buffer) => {
  const s = data.toString();

  // Wheel-scroll detection.
  //   - 2+ arrows in one chunk → definitely wheel (most common case)
  //   - 1 arrow → ambiguous; queue for 30ms to catch burst split across chunks
  if (!panelFocus && panelMode !== "settings-full") {
    const ups = (s.match(/\x1b\[A/g) || []).length;
    const downs = (s.match(/\x1b\[B/g) || []).length;
    const arrowCount = ups + downs;
    const stripped = s.replace(/\x1b\[[AB]/g, "");
    const isPureArrows = stripped.length === 0 && arrowCount > 0;

    if (isPureArrows) {
      if (arrowCount >= 2) {
        // Merge with anything queued (all wheel)
        if (arrowFlushTimer) { clearTimeout(arrowFlushTimer); arrowFlushTimer = null; }
        const qUps = arrowQueue.filter(a => a === "\x1b[A").length + ups;
        const qDowns = arrowQueue.filter(a => a === "\x1b[B").length + downs;
        arrowQueue = [];
        xterm.scrollLines((qDowns - qUps) * 2);
        scheduleRender();
        return;
      }
      arrowQueue.push(s);
      if (arrowFlushTimer) clearTimeout(arrowFlushTimer);
      arrowFlushTimer = setTimeout(flushArrowQueue, 30);
      return;
    }
  }

  // Ctrl+Space (\x00) or F2 (\x1bOQ or \x1b[12~) — toggle panel focus
  if (s === "\x00" || s === "\x1bOQ" || s === "\x1b[12~") {
    panelFocus = !panelFocus;
    panelMessage = "";
    refreshPanel();
    return;
  }

  // Fullscreen settings mode: navigate settings, Esc exits back to Claude
  if (panelMode === "settings-full") {
    if (s === "\x1b[A") { settingsCursor = Math.max(0, settingsCursor - 1); renderFullSettings(); return; }
    if (s === "\x1b[B") { settingsCursor = Math.min(SETTINGS_LIST.length - 1, settingsCursor + 1); renderFullSettings(); return; }
    if (s === "\r" || s === "\n") {
      const cfg = loadSettings();
      const def = SETTINGS_LIST[settingsCursor];
      def.cycle(cfg);
      saveSettings(cfg);
      panelMessage = `${def.label} → ${cfg[def.key]}`;
      renderFullSettings();
      return;
    }
    if (s === "\x1b") { exitFullSettings(); return; }
    return;  // swallow all other keys in fullscreen
  }

  // Panel focus mode (small menu at bottom)
  if (panelFocus) {
    if (s === "\x1b[A") { menuCursor = Math.max(0, menuCursor - 1); refreshPanel(); return; }
    if (s === "\x1b[B") { menuCursor = Math.min(MENU_ITEMS.length - 1, menuCursor + 1); refreshPanel(); return; }
    if (s === "\r" || s === "\n") {
      if (menuCursor === 0) {
        panelFocus = false; // leave focus mode since fullscreen takes over
        enterFullSettings();
      } else if (menuCursor === 1) {
        panelMessage = "*purrs*";
        refreshPanel();
      } else if (menuCursor === 2) {
        panelMessage = "Hi from the buddy!";
        refreshPanel();
      }
      return;
    }
    if (s === "\x1b") { panelFocus = false; panelMessage = ""; refreshPanel(); return; }
    return;
  }

  // Normal mode: forward everything to PTY
  pty.write(s);
});

function refreshPanel() {
  process.stdout.write(`${ESC}7`);
  setupPanel();
  process.stdout.write(`${ESC}8`);
}

// Render settings taking over the full terminal
function renderFullSettings() {
  const { cols, rows } = layout();
  const cfg = loadSettings();
  const out: string[] = [];

  // Clear entire screen
  out.push(`${CSI}2J${moveTo(1, 1)}`);

  // Title bar
  const title = " ⚙  claude-buddy — Settings ";
  const titleFill = "─".repeat(Math.max(0, cols - title.length - 2));
  out.push(`${CYAN}${BOLD}─${title}${NC}${CYAN}${titleFill}─${NC}\n`);
  out.push("\n");

  // Render each setting as a box-like line
  const listStart = 4;
  for (let i = 0; i < SETTINGS_LIST.length; i++) {
    const def = SETTINGS_LIST[i];
    const isCursor = i === settingsCursor;
    const val = String(cfg[def.key]);
    const border = isCursor ? `${CSI}33m` : GRAY;
    const textClr = isCursor ? `${CSI}33m${BOLD}` : `${CSI}37m`;
    const row = listStart + i * 3;

    out.push(moveTo(row, 4) +
      `${border}╭${"─".repeat(cols - 10)}╮${NC}`);
    out.push(moveTo(row + 1, 4) +
      `${border}│${NC} ${textClr}${isCursor ? "▸ " : "  "}${def.label.padEnd(24)}${NC}` +
      `${CSI}36m${BOLD}${val.padEnd(cols - 38)}${NC}${border}│${NC}`);
    out.push(moveTo(row + 2, 4) +
      `${border}╰${"─".repeat(cols - 10)}╯${NC}`);
  }

  // Message
  if (panelMessage) {
    const msgRow = listStart + SETTINGS_LIST.length * 3 + 1;
    out.push(moveTo(msgRow, 4) + `${GREEN}✓ ${panelMessage}${NC}`);
  }

  // Footer help bar
  const help = " ↑↓ navigate  enter change  esc back to claude ";
  out.push(moveTo(rows, 1) +
    `${CYAN}─${DIM}${help}${NC}${CYAN}${"─".repeat(Math.max(0, cols - help.length - 1))}${NC}`);

  process.stdout.write(out.join(""));
}

function enterFullSettings() {
  pauseOutput = true;
  panelMode = "settings-full";
  settingsCursor = 0;
  panelMessage = "";
  // We're ALREADY in alt screen (wrapper entered it at startup).
  // Just reset scroll region, clear the whole screen, and draw settings.
  // Don't send another \x1b[?1049h — it's a no-op when stacked and the
  // matching ?1049l would exit the wrapper's alt screen entirely.
  process.stdout.write(`${CSI}r`);
  process.stdout.write(`${CSI}2J${moveTo(1, 1)}`);
  process.stdout.write(`${CSI}?25l`);
  renderFullSettings();
}

function exitFullSettings() {
  panelMode = "menu";
  panelMessage = "";
  pauseOutput = false;
  const { cols: c, code: h } = layout();
  const innerCols = c - SCROLLBAR_RESERVED;
  process.stdout.write(`${CSI}2J`);
  process.stdout.write(setScrollRegion(1, h));
  process.stdout.write(renderXtermViewport(xterm, 1, h, innerCols));
  process.stdout.write(renderScrollbar(xterm, 1, h, c));
  setupPanel();
  process.stdout.write(`${CSI}?25h`);
}

// Resize: clear xterm completely (no history preservation — like tmux).
// Claude's SIGWINCH redraw lands on a clean buffer. Loses conversation
// history across resize, but avoids ghost echoes.
process.stdout.on("resize", () => {
  const l = layout();
  const innerCols = l.cols - SCROLLBAR_RESERVED;
  xterm.reset();
  xterm.resize(innerCols, l.code);
  pty.resize(innerCols, l.code);
  process.stdout.write(`${CSI}2J`);
  process.stdout.write(renderXtermViewport(xterm, 1, l.code, innerCols));
  setupPanel();
  pty.write("\x0c");
});

// Periodic panel refresh (repairs gradual damage). Skipped while
// fullscreen settings are open — the panel doesn't exist there.
const timer = setInterval(() => {
  if (panelMode === "settings-full") return;
  process.stdout.write(`${ESC}7`);
  setupPanel();
  process.stdout.write(`${ESC}8`);
}, 3000);

// Cleanup: leave alt screen — original terminal content comes back
pty.onExit(({ exitCode }) => {
  clearInterval(timer);
  process.stdout.write(`${CSI}r`);                   // reset scroll region
  process.stdout.write(`${CSI}?1007l`);               // disable alternate scroll
  process.stdout.write(`${CSI}?1049l`);              // leave alt screen
  process.stdout.write(`${CSI}?25h`);                // show cursor
  try { process.stdin.setRawMode(false); } catch {}
  process.stdin.pause();
  process.exit(exitCode);
});

await new Promise(() => {});
