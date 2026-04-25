/**
 * Minimal i18n — JSON locale files with {variable} interpolation.
 *
 * Locale files live in <project-root>/locales/<code>.json.
 * The active language is stored in buddy config (config.json).
 * Falls back to English for any missing key.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";

function localeDir(): string {
  return join(dirname(import.meta.dir), "locales");
}

function discoverLocales(): Record<string, string> {
  const dir = localeDir();
  const locales: Record<string, string> = {};
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const code = f.slice(0, -5);
      try {
        const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
        locales[code] = data._language ?? code;
      } catch { /* skip malformed */ }
    }
  } catch { /* dir missing */ }
  return locales;
}

export const AVAILABLE_LOCALES: Record<string, string> = discoverLocales();

export function isVerified(code: string): boolean {
  const data = loadLocaleFile(code);
  return data?._verified === true;
}

export const VERIFIED_LOCALES: string[] = Object.keys(AVAILABLE_LOCALES).filter(c => isVerified(c));

function loadLocaleFile(code: string): Record<string, unknown> | null {
  const p = join(localeDir(), `${code}.json`);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

let cachedCode: string | null = null;
let cachedLocale: Record<string, unknown> = {};
let enLocale: Record<string, unknown> | null = null;

function getEnLocale(): Record<string, unknown> {
  if (!enLocale) enLocale = loadLocaleFile("en") ?? {};
  return enLocale;
}

function deepGet(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function setLocale(code: string): void {
  if (code === cachedCode) return;
  cachedCode = code;
  if (code === "en") {
    cachedLocale = getEnLocale();
  } else {
    cachedLocale = loadLocaleFile(code) ?? getEnLocale();
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  let val = deepGet(cachedLocale, key);
  if (val === undefined) val = deepGet(getEnLocale(), key);
  if (val === undefined) return key;
  if (typeof val !== "string") return key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = (val as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }

  return val as string;
}

export function tArray(key: string): string[] {
  let val = deepGet(cachedLocale, key);
  if (val === undefined) val = deepGet(getEnLocale(), key);
  if (!Array.isArray(val)) return [];
  return val as string[];
}

export function tObj(key: string): Record<string, unknown> {
  let val = deepGet(cachedLocale, key);
  if (val === undefined) val = deepGet(getEnLocale(), key);
  if (val === null || typeof val !== "object" || Array.isArray(val)) return {};
  return val as Record<string, unknown>;
}
