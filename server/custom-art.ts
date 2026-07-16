/**
 * Custom species art — runtime-loadable skins with no code edit.
 *
 * The built-in SPECIES_ART / FACE_TEMPLATES in art.ts + engine.ts are a closed
 * enum: adding a drawing there is a code change, and any new entry that joins
 * the RNG SPECIES pool would shift every user's deterministic roll. Custom art
 * deliberately sidesteps both problems — it is an OVERRIDE layer only:
 *
 *   - Loaded from <state-dir>/custom-art/*.json at runtime.
 *   - Keyed by the JSON's "name" field. If that name matches a species a pet
 *     already uses, the pet renders with the custom frames instead of built-in.
 *   - NEVER added to the SPECIES generation pool, so existing pets are untouched.
 *
 * File schema (validated by cli/validate-species.ts):
 *   { "name": string, "art": string[][]  // 3 frames x 5 lines, {E} = eye
 *     "face"?: string }                   // optional face template, {E} = eye
 *
 * To use one: drop a valid JSON into <state-dir>/custom-art/, then point a pet
 * at that name (bones.species) — see cli/buddy.ts `skin` command.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { STATE_DIR } from "./state.ts";

export interface CustomArt {
  name: string;
  art: string[][];
  face?: string;
}

const CUSTOM_ART_DIR = join(STATE_DIR, "custom-art");

// Loaded once per process. The CLI and MCP server are short-lived, so a simple
// module-level cache is enough; there is no long-running watcher to invalidate.
let cache: Record<string, CustomArt> | null = null;

function isValidShape(d: unknown): d is CustomArt {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0) return false;
  if (!Array.isArray(o.art) || o.art.length !== 3) return false;
  for (const frame of o.art) {
    if (!Array.isArray(frame) || frame.length !== 5) return false;
    if (!frame.every((l) => typeof l === "string")) return false;
  }
  if (o.face !== undefined && typeof o.face !== "string") return false;
  return true;
}

/** Load every valid custom-art JSON, keyed by its declared name. */
export function loadCustomArt(): Record<string, CustomArt> {
  if (cache) return cache;
  const out: Record<string, CustomArt> = {};
  if (existsSync(CUSTOM_ART_DIR)) {
    for (const f of readdirSync(CUSTOM_ART_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(CUSTOM_ART_DIR, f), "utf8"));
        if (isValidShape(data)) out[data.name] = data;
      } catch {
        // Skip malformed files silently — validate-species.ts is the linter.
      }
    }
  }
  cache = out;
  return out;
}

/** Return the 3-frame art array for a name, or null if no custom skin exists. */
export function getCustomFrames(name: string): string[][] | null {
  return loadCustomArt()[name]?.art ?? null;
}

/** Return the face template for a name, or null. */
export function getCustomFace(name: string): string | null {
  return loadCustomArt()[name]?.face ?? null;
}

/** List the names of all loaded custom skins. */
export function listCustomArt(): string[] {
  return Object.keys(loadCustomArt());
}

export const CUSTOM_ART_PATH = CUSTOM_ART_DIR;
