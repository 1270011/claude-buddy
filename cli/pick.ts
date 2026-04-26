#!/usr/bin/env bun
/**
 * cli/pick.ts — interactive two-pane buddy picker
 *
 *  Left pane                     │  Right pane
 *  ──────────────────────────    │  ──────────────────────
 *  Saved:      list of slots     │  full companion card
 *  Criteria:   search form       │
 *  Results:    matched buddies   │  preview of highlighted
 *  Configuring: eye/hat/name/pers│  live preview
 *
 * Keys — Saved:       ↑↓ navigate  enter summon  r random  s search  d remove  q quit
 * Keys — Criteria:    ↑↓ field     ←→ value      enter run  esc back
 * Keys — Results:     ↑↓ navigate  enter configure  esc back  q quit
 * Keys — Configuring: ↑↓ field     ←→ value (eye/hat)  type (name/pers)  enter confirm  esc back
 */

import {
  loadActiveSlot, saveActiveSlot, listCompanionSlots,
  loadCompanionSlot, saveCompanionSlot, deleteCompanionSlot, slugify, unusedName, writeStatusState,
} from "../server/state.ts";
import {
  generateBones, SPECIES, RARITIES, STAT_NAMES, RARITY_STARS, EYES, HATS,
  type Species, type Rarity, type StatName, type Eye, type Hat,
  type BuddyBones, type Companion,
} from "../server/engine.ts";
import { generateBuddy, generatePersonality, generateName } from "../server/generation.ts";
import { renderCompanionCard } from "../server/art.ts";
import { randomBytes } from "crypto";

// ─── ANSI ─────────────────────────────────────────────────────────────────────

const RARITY_CLR: Record<string, string> = {
  common:    "\x1b[38;2;153;153;153m",
  uncommon:  "\x1b[38;2;78;186;101m",
  rare:      "\x1b[38;2;177;185;249m",
  epic:      "\x1b[38;2;175;135;255m",
  legendary: "\x1b[38;2;255;193;7m",
};
const B  = "\x1b[1m";
const D  = "\x1b[2m";
const RV = "\x1b[7m";
const N  = "\x1b[0m";
const CY = "\x1b[36m";
const GR = "\x1b[90m";
const YL = "\x1b[33m";
const GN = "\x1b[32m";

function stripAnsi(s: string): string { return s.replace(/\x1b\[[^m]*m/g, ""); }

function charWidth(cp: number): number {
  if (cp >= 0xFE00 && cp <= 0xFE0F) return 0;
  if (cp === 0x200D) return 0;
  if (cp >= 0x1F000) return 2;
  if (cp === 0x2728) return 2;
  if (cp >= 0x2600 && cp <= 0x27BF) return 1;
  if (cp >= 0x2500 && cp <= 0x257F) return 1;
  if (cp >= 0x2580 && cp <= 0x259F) return 1;
  if (cp >= 0x3000 && cp <= 0x9FFF) return 2;
  if (cp >= 0xF900 && cp <= 0xFAFF) return 2;
  if (cp >= 0xFF01 && cp <= 0xFF60) return 2;
  return 1;
}

function vlen(s: string): number {
  const clean = stripAnsi(s);
  let w = 0;
  for (const ch of clean) w += charWidth(ch.codePointAt(0)!);
  return w;
}

function rpad(s: string, w: number): string {
  const v = vlen(s);
  return v < w ? s + " ".repeat(w - v) : s;
}

function wrapText(text: string, width: number): string[] {
  if (!text) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word.slice(0, width);
    } else if (current.length + 1 + word.length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word.slice(0, width);
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── Option lists ─────────────────────────────────────────────────────────────

const SP_OPTS  = ["any", ...SPECIES]    as const;
const RA_OPTS  = ["any", ...RARITIES]   as const;
const SH_OPTS  = ["any", "yes", "no"]   as const;
const ST_OPTS  = ["any", ...STAT_NAMES] as const;
const MIN_OPTS = ["any", "5", "10", "15", "20", "25", "30", "35", "40", "45",
                  "50", "55", "60", "65", "70", "75", "80", "85", "90", "95"] as const;
const AVG_OPTS = MIN_OPTS;

// ci indices: [sp, ra, sh, pk, dp, avg, dbg, pat, cha, wis, snk]
//              0   1   2   3   4   5    6    7    8    9    10
const CRITERIA_ROWS: Array<{ label: string; opts: readonly string[] }> = [
  { label: "Species", opts: SP_OPTS  },
  { label: "Rarity ", opts: RA_OPTS  },
  { label: "Shiny  ", opts: SH_OPTS  },
  { label: "Peak   ", opts: ST_OPTS  },
  { label: "Dump   ", opts: ST_OPTS  },
  { label: "Min avg", opts: AVG_OPTS },
  { label: "Min DBG", opts: MIN_OPTS },
  { label: "Min PAT", opts: MIN_OPTS },
  { label: "Min CHA", opts: MIN_OPTS },
  { label: "Min WIS", opts: MIN_OPTS },
  { label: "Min SNK", opts: MIN_OPTS },
];

// ─── State ────────────────────────────────────────────────────────────────────

type Mode = "saved" | "criteria" | "searching" | "results" | "configuring";
interface SlotEntry   { slot: string; companion: Companion; }
interface BuddyResult { userId: string; bones: BuddyBones; }

interface State {
  mode:                   Mode;
  searching:              boolean;
  savedSlots:             SlotEntry[];
  savedCursor:            number;
  activeSlot:             string;
  criteriaFocus:          number;
  ci:                     number[];
  results:                BuddyResult[];
  resultCursor:           number;
  searchStatus:           string;
  // configuring mode
  configResult:           BuddyResult | null;
  configFocus:            number;   // 0=name  1=personality  2=eye  3=hat
  configEyeIdx:           number;
  configHatIdx:           number;
  configNameInput:        string;
  configPersonalityInput: string;
  configGenerating:       boolean;
  configIsEdit:           boolean;  // true when editing an existing buddy
  configEditSlot:         string;   // original slot name when editing
  configHatchedAt:        number;   // original hatchedAt when editing
  // shared
  confirmDelete:          boolean;
  message:                string;
  spinnerTick:            number;
}

function fresh(): State {
  return {
    mode:                   "saved",
    searching:              false,
    savedSlots:             listCompanionSlots(),
    savedCursor:            0,
    activeSlot:             loadActiveSlot(),
    criteriaFocus:          0,
    ci: [0, RA_OPTS.indexOf("legendary"), 0, 0, 0, 0, 0, 0, 0, 0, 0],
    results:                [],
    resultCursor:           0,
    searchStatus:           "",
    configResult:           null,
    configFocus:            0,
    configEyeIdx:           0,
    configHatIdx:           0,
    configNameInput:        "",
    configPersonalityInput: "",
    configGenerating:       false,
    configIsEdit:           false,
    configEditSlot:         "",
    configHatchedAt:        0,
    confirmDelete:          false,
    message:                "",
    spinnerTick:            0,
  };
}

// ─── Pane builders ────────────────────────────────────────────────────────────

const LEFT_W = 36;

function savedPane(s: State): string[] {
  const lines: string[] = [];
  lines.push(`${B}  Your Menagerie${N}  ${GR}[s] search  [e] edit  [d] remove${N}`);
  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);

  if (s.savedSlots.length === 0) {
    lines.push(`  ${GR}your menagerie is empty${N}`);
    lines.push(`  ${GR}press [s] to search${N}`);
  }

  for (let i = 0; i < s.savedSlots.length; i++) {
    const { slot, companion: c } = s.savedSlots[i];
    const isActive = slot === s.activeSlot;
    const isCursor = i === s.savedCursor;
    const dot  = isActive ? `${GN}●${N}` : " ";
    const clr  = RARITY_CLR[c.bones.rarity] ?? "";
    const star = RARITY_STARS[c.bones.rarity];
    const shiny = c.bones.shiny ? "✨" : "  ";
    const name  = c.name.slice(0, 11).padEnd(11);
    const sp    = c.bones.species.slice(0, 7).padEnd(7);
    const row   = ` ${dot} ${clr}${name}${N} ${GR}${sp}${N} ${clr}${star}${N} ${shiny}`;
    lines.push(isCursor ? RV + row + N : row);
  }

  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);
  if (s.confirmDelete) {
    const entry = s.savedSlots[s.savedCursor];
    lines.push(`  ${YL}remove ${B}${entry?.companion.name ?? "?"}${N}${YL}? [d/y] yes  [any] no${N}`);
  }
  return lines;
}

function criteriaPane(s: State): string[] {
  const lines: string[] = [];
  lines.push(`${B}  Search Criteria${N}`);
  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);

  for (let i = 0; i < CRITERIA_ROWS.length; i++) {
    const { label, opts } = CRITERIA_ROWS[i];
    const val     = opts[s.ci[i]];
    const focus   = i === s.criteriaFocus;
    const clr     = RARITY_CLR[val] ?? "";
    const arrow   = focus ? `${YL}>${N}` : " ";
    const valDisp = focus
      ? `${RV}${B} ${val.padEnd(11)} ${N}`
      : `${D}${clr} ${val.padEnd(11)} ${N}`;
    lines.push(`  ${arrow} ${GR}${label}${N}  ${valDisp}  ${GR}←→${N}`);
  }

  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);
  if (s.searchStatus) lines.push(`  ${YL}${s.searchStatus}${N}`);
  return lines;
}

function searchingPane(s: State): string[] {
  const lines: string[] = [];
  lines.push(`${B}  Searching...${N}`);
  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);
  lines.push(`  ${YL}${s.searchStatus || "starting..."}${N}`);
  lines.push(`  ${GR}any key to stop${N}`);
  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);
  return lines;
}

function resultsPane(s: State): string[] {
  const lines: string[] = [];
  lines.push(`${B}  Results${N}  ${GR}${s.results.length} found${N}`);
  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);

  if (s.results.length === 0) {
    lines.push(`  ${GR}no matches — try broader criteria${N}`);
  }

  const viewH  = 12;
  const offset = Math.max(0, s.resultCursor - Math.floor(viewH / 2));
  for (let i = offset; i < Math.min(s.results.length, offset + viewH); i++) {
    const b     = s.results[i].bones;
    const sel   = i === s.resultCursor;
    const clr   = RARITY_CLR[b.rarity] ?? "";
    const shiny = b.shiny ? "✨" : "  ";
    const ra    = b.rarity.slice(0, 3);
    const sp    = b.species.padEnd(8);
    const row   = `  ${clr}${ra}${N} ${sp} ${shiny}`;
    lines.push(sel ? RV + row + N : row);
  }

  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);
  return lines;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PERS_WRAP_W = LEFT_W - 6;

function configuringPane(s: State): string[] {
  const b   = s.configResult?.bones;
  const clr = b ? (RARITY_CLR[b.rarity] ?? "") : "";
  const lines: string[] = [];

  lines.push(`${B}  ${s.configIsEdit ? "Edit" : "Configure"} buddy${N}`);
  if (b) lines.push(`  ${clr}${b.rarity} ${b.species}${N}`);
  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);

  // Name (focus 0)
  {
    const focus  = s.configFocus === 0 && !s.configGenerating;
    const arrow  = focus ? `${YL}>${N}` : " ";
    const cursor = focus ? `${YL}▌${N}` : "";
    const text   = s.configNameInput || (!focus ? `${GR}random${N}` : "");
    lines.push(`  ${arrow} ${GR}Name   ${N}  ${text}${cursor}`);
    lines.push(`    ${GR}blank = random  max 14 chars${N}`);
  }

  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);

  // Personality (focus 1)
  {
    const focus  = s.configFocus === 1 && !s.configGenerating;
    const arrow  = focus ? `${YL}>${N}` : " ";
    const cursor = focus ? `${YL}▌${N}` : "";
    lines.push(`  ${arrow} ${GR}Personality${N}  ${GR}blank = random${N}`);

    const wrapped = wrapText(s.configPersonalityInput, PERS_WRAP_W);
    const display = wrapped.length ? [...wrapped] : [""];
    display[display.length - 1] += cursor;
    while (display.length < 4) display.push("");
    for (const dl of display) lines.push(`    ${dl}`);
  }

  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);

  // Eye (focus 2) — same style as criteria rows
  {
    const val   = EYES[s.configEyeIdx];
    const focus = s.configFocus === 2 && !s.configGenerating;
    const arrow = focus ? `${YL}>${N}` : " ";
    const vd    = focus
      ? `${RV}${B} ${val.padEnd(11)} ${N}`
      : `${D} ${val.padEnd(11)} ${N}`;
    lines.push(`  ${arrow} ${GR}Eye    ${N}  ${vd}  ${GR}←→${N}`);
  }

  // Hat (focus 3)
  {
    const val   = HATS[s.configHatIdx];
    const focus = s.configFocus === 3 && !s.configGenerating;
    const arrow = focus ? `${YL}>${N}` : " ";
    const vd    = focus
      ? `${RV}${B} ${val.padEnd(11)} ${N}`
      : `${D} ${val.padEnd(11)} ${N}`;
    lines.push(`  ${arrow} ${GR}Hat    ${N}  ${vd}  ${GR}←→${N}`);
  }

  lines.push(GR + "  " + "─".repeat(LEFT_W - 2) + N);

  if (s.configGenerating) {
    const frame = SPINNER_FRAMES[s.spinnerTick % SPINNER_FRAMES.length];
    lines.push(`  ${YL}${frame} generating...${N}`);
  } else {
    lines.push(`  ${GR}enter confirm  esc back${N}`);
  }

  return lines;
}

function previewPane(s: State): string[] {
  let c: Companion | null = null;

  if (s.mode === "saved") {
    c = s.savedSlots[s.savedCursor]?.companion ?? null;
  } else if (s.mode === "results") {
    const r = s.results[s.resultCursor];
    if (r) {
      c = { bones: r.bones, name: "???", personality: "", hatchedAt: Date.now(), userId: r.userId };
    }
  } else if (s.mode === "configuring" && s.configResult) {
    const r = s.configResult;
    const previewBones: BuddyBones = {
      ...r.bones,
      eye: EYES[s.configEyeIdx] as Eye,
      hat: HATS[s.configHatIdx] as Hat,
    };
    const name        = s.configNameInput || "???";
    const personality = s.configPersonalityInput || "";
    c = { bones: previewBones, name, personality, hatchedAt: Date.now(), userId: r.userId };
  }

  if (!c) return [`  ${GR}no preview${N}`];
  const rightW = 34;
  return renderCompanionCard(c.bones, c.name, c.personality, undefined, 0, rightW).split("\n");
}

// ─── Screen render ────────────────────────────────────────────────────────────

function drawScreen(s: State): void {
  const cols = Math.max(80, process.stdout.columns || 80);
  const rows = Math.max(20, process.stdout.rows    || 24);

  const leftLines  = s.mode === "saved"        ? savedPane(s)
                   : s.mode === "criteria"     ? criteriaPane(s)
                   : s.mode === "searching"    ? searchingPane(s)
                   : s.mode === "results"      ? resultsPane(s)
                   : configuringPane(s);
  const rightLines = previewPane(s);
  const contentH   = rows - 2;

  let out = "\x1b[2J\x1b[H";

  const title = ` claude-buddy pick `;
  const fill  = "─".repeat(Math.max(0, cols - title.length - 2));
  out += `${CY}─${B}${title}${N}${CY}${fill}─${N}\n`;

  for (let i = 0; i < contentH; i++) {
    const l = rpad(leftLines[i] ?? "", LEFT_W);
    const r = rightLines[i] ?? "";
    out += l + GR + "│" + N + " " + r + "\n";
  }

  const helpText =
    s.mode === "saved"        ? "↑↓ navigate  enter summon  r random  s search  e edit  d remove  q quit" :
    s.mode === "criteria"     ? "↑↓ field  ←→ value  enter search  esc back" :
    s.mode === "searching"    ? "any key to stop and show results so far" :
    s.mode === "results"      ? "↑↓ navigate  enter configure  esc back  q quit" :
    s.mode === "configuring"  ? "↑↓ field  ←→ value (eye/hat)  type (name/pers)  enter confirm  esc back" : "";
  out += `${GR}─${N} ${GR}${helpText}${N} ${GR}${"─".repeat(Math.max(0, cols - helpText.length - 4))}${N}`;

  if (s.message) {
    out += `\x1b[${rows};1H  ${GN}${B}${s.message}${N}`;
  }

  process.stdout.write(out);
}

// ─── Search ───────────────────────────────────────────────────────────────────

function avgStat(bones: BuddyBones): number {
  const vals = Object.values(bones.stats) as number[];
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function runSearch(s: State): Promise<void> {
  const wantSp    = SP_OPTS[s.ci[0]]  !== "any" ? SP_OPTS[s.ci[0]]  as Species  : null;
  const wantRa    = RA_OPTS[s.ci[1]]  !== "any" ? RA_OPTS[s.ci[1]]  as Rarity   : null;
  const wantShiny = SH_OPTS[s.ci[2]] === "yes"  ? true
                  : SH_OPTS[s.ci[2]] === "no"   ? false : null;
  const wantPeak  = ST_OPTS[s.ci[3]]  !== "any" ? ST_OPTS[s.ci[3]]  as StatName : null;
  const wantDump  = ST_OPTS[s.ci[4]]  !== "any" ? ST_OPTS[s.ci[4]]  as StatName : null;
  const minAvg    = AVG_OPTS[s.ci[5]] !== "any" ? Number(AVG_OPTS[s.ci[5]])      : null;
  const minDBG    = MIN_OPTS[s.ci[6]]  !== "any" ? Number(MIN_OPTS[s.ci[6]])     : null;
  const minPAT    = MIN_OPTS[s.ci[7]]  !== "any" ? Number(MIN_OPTS[s.ci[7]])     : null;
  const minCHA    = MIN_OPTS[s.ci[8]] !== "any" ? Number(MIN_OPTS[s.ci[8]])      : null;
  const minWIS    = MIN_OPTS[s.ci[9]] !== "any" ? Number(MIN_OPTS[s.ci[9]])      : null;
  const minSNK    = MIN_OPTS[s.ci[10]] !== "any" ? Number(MIN_OPTS[s.ci[10]])    : null;

  const maxAttempts =
    wantRa === "legendary" ? 10_000_000_000 :
    wantRa === "epic"      ?  50_000_000 :
    wantRa === "rare"      ?  20_000_000 : 10_000_000;

  const results: BuddyResult[] = [];
  const YIELD_EVERY    = 5_000_000;
  const PROGRESS_EVERY = 1_000_000;

  for (let i = 0; i < maxAttempts && results.length < 20; i++) {
    if (!s.searching) break;

    if (i > 0 && i % YIELD_EVERY === 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    if (i > 0 && i % PROGRESS_EVERY === 0) {
      s.searchStatus = `${(i / 1e6).toFixed(1)}M checked — ${results.length} found`;
      drawScreen(s);
    }

    const userId = randomBytes(16).toString("hex");
    const bones  = generateBones(userId);

    if (wantSp    !== null && bones.species !== wantSp)     continue;
    if (wantRa    !== null && bones.rarity  !== wantRa)     continue;
    if (wantShiny !== null && bones.shiny   !== wantShiny)  continue;
    if (wantPeak  !== null && bones.peak    !== wantPeak)   continue;
    if (wantDump  !== null && bones.dump    !== wantDump)   continue;
    if (minAvg    !== null && avgStat(bones) < minAvg)      continue;
    if (minDBG    !== null && bones.stats.DEBUGGING < minDBG) continue;
    if (minPAT    !== null && bones.stats.PATIENCE  < minPAT) continue;
    if (minCHA    !== null && bones.stats.CHAOS     < minCHA) continue;
    if (minWIS    !== null && bones.stats.WISDOM    < minWIS) continue;
    if (minSNK    !== null && bones.stats.SNARK     < minSNK) continue;

    results.push({ userId, bones });
  }

  s.searching    = false;
  s.searchStatus = `${results.length} found`;
  s.results      = results;
  s.resultCursor = 0;
  s.mode         = "results";
  drawScreen(s);
}

// ─── Configuring generation ───────────────────────────────────────────────────

async function confirmConfiguring(
  s: State,
  redraw: () => void,
  onDone: (message: string) => void,
): Promise<void> {
  const r = s.configResult!;
  const bones: BuddyBones = {
    ...r.bones,
    eye: EYES[s.configEyeIdx] as Eye,
    hat: HATS[s.configHatIdx] as Hat,
  };

  const spinnerInterval = setInterval(() => { s.spinnerTick++; redraw(); }, 100);

  let name        = s.configNameInput.trim();
  let personality = s.configPersonalityInput.trim();

  try {
    if (!name && !personality) {
      const gen = await generateBuddy(bones);
      name        = gen.name;
      personality = gen.personality;
    } else if (!name) {
      name = await generateName(bones, personality);
    } else if (!personality) {
      personality = await generatePersonality(bones);
    }
  } finally {
    clearInterval(spinnerInterval);
  }

  const hatchedAt = s.configIsEdit ? s.configHatchedAt : Date.now();
  const companion: Companion = { bones, name, personality, hatchedAt, userId: r.userId };

  if (s.configIsEdit) {
    const originalSlot = s.configEditSlot;
    let slug = slugify(name);
    // If new slug conflicts with a *different* existing slot, fall back to original name
    if (slug !== originalSlot && loadCompanionSlot(slug)) {
      name = companion.name = originalSlot;
      slug = originalSlot;
    }
    deleteCompanionSlot(originalSlot);
    saveCompanionSlot(companion, slug);
    saveActiveSlot(slug);
    writeStatusState(companion, `*${name} updated*`);
    onDone(`✓ ${name} updated!`);
  } else {
    let slug = slugify(name);
    if (loadCompanionSlot(slug)) {
      name = unusedName();
      slug = slugify(name);
    }
    companion.name = name;
    saveCompanionSlot(companion, slug);
    saveActiveSlot(slug);
    writeStatusState(companion, `*${name} arrives*`);
    onDone(`✓ ${name} saved!`);
  }
}

// ─── Key handlers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function onKey(key: string, s: State): boolean {
  if (key === "\x03") return true;

  switch (s.mode) {
    case "configuring": {
      if (s.configGenerating) break; // ignore input during generation

      if (key === "\x1b") {
        s.mode = s.configIsEdit ? "saved" : "results";
        s.configResult = null;
        break;
      }
      if (key === "\x1b[A" || key === "k") {
        s.configFocus = clamp(s.configFocus - 1, 0, 3);
      } else if (key === "\x1b[B" || key === "j") {
        s.configFocus = clamp(s.configFocus + 1, 0, 3);
      } else if (key === "\x1b[C" || key === "l") {
        if (s.configFocus === 2) s.configEyeIdx = (s.configEyeIdx + 1) % EYES.length;
        else if (s.configFocus === 3) s.configHatIdx = (s.configHatIdx + 1) % HATS.length;
      } else if (key === "\x1b[D" || key === "h") {
        if (s.configFocus === 2) s.configEyeIdx = (s.configEyeIdx - 1 + EYES.length) % EYES.length;
        else if (s.configFocus === 3) s.configHatIdx = (s.configHatIdx - 1 + HATS.length) % HATS.length;
      } else if (key === "" || key === "\b") {
        if (s.configFocus === 0) s.configNameInput = s.configNameInput.slice(0, -1);
        else if (s.configFocus === 1) s.configPersonalityInput = s.configPersonalityInput.slice(0, -1);
      } else if (key === "\x15") {  // ctrl+u — clear focused text field
        if (s.configFocus === 0) s.configNameInput = "";
        else if (s.configFocus === 1) s.configPersonalityInput = "";
      } else if (key === "\r" || key === "\n") {
        s.configGenerating = true; // triggers confirmConfiguring in main loop
      } else if (key.length === 1 && key >= " ") {
        if (s.configFocus === 0 && s.configNameInput.length < 14) {
          s.configNameInput += key;
        } else if (s.configFocus === 1) {
          s.configPersonalityInput += key;
        }
      }
      break;
    }

    case "saved": {
      if (s.confirmDelete) {
        if (key === "d" || key === "y") {
          const entry = s.savedSlots[s.savedCursor];
          if (entry) {
            deleteCompanionSlot(entry.slot);
            s.savedSlots  = listCompanionSlots();
            s.activeSlot  = loadActiveSlot();
            s.savedCursor = clamp(s.savedCursor, 0, Math.max(0, s.savedSlots.length - 1));
            s.message     = `✗ ${entry.companion.name} removed`;
          }
        }
        s.confirmDelete = false;
        break;
      }
      if (key === "q")                          return true;
      if (key === "s")                          { s.mode = "criteria"; break; }
      if (key === "d" && s.savedSlots.length > 0) { s.confirmDelete = true; break; }
      if (key === "e" && s.savedSlots.length > 0) {
        const entry = s.savedSlots[s.savedCursor];
        if (entry) {
          const { companion, slot } = entry;
          s.configResult           = { userId: companion.userId, bones: companion.bones };
          s.configFocus            = 0;
          s.configEyeIdx           = Math.max(0, EYES.indexOf(companion.bones.eye as typeof EYES[number]));
          s.configHatIdx           = Math.max(0, HATS.indexOf(companion.bones.hat as typeof HATS[number]));
          s.configNameInput        = companion.name;
          s.configPersonalityInput = companion.personality;
          s.configGenerating       = false;
          s.configIsEdit           = true;
          s.configEditSlot         = slot;
          s.configHatchedAt        = companion.hatchedAt;
          s.mode                   = "configuring";
        }
        break;
      }
      if (key === "\x1b[A" || key === "k")      s.savedCursor = clamp(s.savedCursor - 1, 0, s.savedSlots.length - 1);
      else if (key === "\x1b[B" || key === "j") s.savedCursor = clamp(s.savedCursor + 1, 0, s.savedSlots.length - 1);
      else if (key === "r") {
        if (s.savedSlots.length > 0) {
          const entry = s.savedSlots[Math.floor(Math.random() * s.savedSlots.length)];
          s.savedCursor = s.savedSlots.indexOf(entry);
          saveActiveSlot(entry.slot);
          writeStatusState(entry.companion, `*${entry.companion.name} arrives*`);
          s.message = `✓ ${entry.companion.name} summoned at random!`;
          return true;
        }
      } else if (key === "\r" || key === "\n") {
        const entry = s.savedSlots[s.savedCursor];
        if (entry) {
          saveActiveSlot(entry.slot);
          writeStatusState(entry.companion, `*${entry.companion.name} arrives*`);
          s.message = `✓ ${entry.companion.name} summoned!`;
          return true;
        }
      }
      break;
    }

    case "criteria": {
      if (key === "q")                          return true;
      if (key === "\x1b")                       { s.mode = "saved"; break; }
      if (key === "\x1b[A" || key === "k")      s.criteriaFocus = clamp(s.criteriaFocus - 1, 0, CRITERIA_ROWS.length - 1);
      else if (key === "\x1b[B" || key === "j") s.criteriaFocus = clamp(s.criteriaFocus + 1, 0, CRITERIA_ROWS.length - 1);
      else if (key === "\x1b[C" || key === "l") {
        const len = CRITERIA_ROWS[s.criteriaFocus].opts.length;
        s.ci[s.criteriaFocus] = (s.ci[s.criteriaFocus] + 1) % len;
      } else if (key === "\x1b[D" || key === "h") {
        const len = CRITERIA_ROWS[s.criteriaFocus].opts.length;
        s.ci[s.criteriaFocus] = (s.ci[s.criteriaFocus] - 1 + len) % len;
      } else if (key === "\r" || key === "\n") {
        s.mode         = "searching";
        s.searching    = true;
        s.searchStatus = "starting...";
        drawScreen(s);
        runSearch(s);
      }
      break;
    }

    case "searching": {
      s.searching = false;
      break;
    }

    case "results": {
      if (key === "q")                          return true;
      if (key === "\x1b")                       { s.mode = "criteria"; break; }
      if (key === "\x1b[A" || key === "k")      s.resultCursor = clamp(s.resultCursor - 1, 0, s.results.length - 1);
      else if (key === "\x1b[B" || key === "j") s.resultCursor = clamp(s.resultCursor + 1, 0, s.results.length - 1);
      else if (key === "\r" || key === "\n") {
        const r = s.results[s.resultCursor];
        if (r) {
          s.configResult           = r;
          s.configFocus            = 0;
          s.configEyeIdx           = 0;
          s.configHatIdx           = 0;
          s.configNameInput        = "";
          s.configPersonalityInput = "";
          s.configGenerating       = false;
          s.configIsEdit           = false;
          s.configEditSlot         = "";
          s.configHatchedAt        = 0;
          s.mode                   = "configuring";
        }
      }
      break;
    }
  }
  return false;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function cleanup(): void {
  process.stdout.write("\x1b[?25h");
  try { process.stdin.setRawMode(false); } catch {}
  process.stdin.pause();
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("buddy pick requires an interactive terminal (TTY)");
    process.exit(1);
  }

  process.stdout.write("\x1b[?25l");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  const s = fresh();
  drawScreen(s);

  function redraw() { drawScreen(s); }

  let generationStarted = false;

  await new Promise<void>((resolve) => {
    process.stdin.on("data", (key: string) => {
      const quit = onKey(key, s);
      drawScreen(s);

      if (s.configGenerating && !generationStarted) {
        generationStarted = true;
        confirmConfiguring(s, redraw, (msg) => {
          cleanup();
          process.stdout.write("\x1b[2J\x1b[H");
          console.log(`\n  ${msg}\n`);
          resolve();
        });
      }

      if (quit) {
        cleanup();
        process.stdout.write("\x1b[2J\x1b[H");
        if (s.message) console.log(`\n  ${s.message}\n`);
        resolve();
      }
    });
  });

  process.exit(0);
}

main();
