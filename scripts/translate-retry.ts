#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "fs";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const MODEL = "anthropic/claude-sonnet-4";
const enData = JSON.parse(readFileSync("locales/en.json", "utf8"));

const SYSTEM_PROMPT = `You are translating a JSON locale file for claude-buddy — a tamagotchi-style coding companion that lives in a developer's terminal.

Rules:
1. Preserve ALL JSON keys and structure EXACTLY as-is (keys in English, same nesting, same array lengths)
2. Preserve all {variable} placeholders EXACTLY as-is — do NOT translate them
3. Preserve all *asterisk actions* — translate the action verb but keep the *asterisks*
4. Keep the playful, snarky, affectionate tone
5. Preserve all emoji
6. Sound natural to a native developer
7. Return ONLY the translated JSON object. NO markdown fences. NO backticks. NO commentary. Start with { and end with }`;

const LANG_NAMES: Record<string, string> = {
  zh: "Chinese (Simplified)", es: "Spanish", ja: "Japanese", de: "German",
  fr: "French", pt: "Portuguese", ko: "Korean", ru: "Russian", ro: "Romanian",
  uk: "Ukrainian", tr: "Turkish", hi: "Hindi", it: "Italian", pl: "Polish",
  vi: "Vietnamese", ar: "Arabic", th: "Thai",
};

function isEnglishFallback(locale: any, section: string): boolean {
  const enSection = enData[section];
  const locSection = locale[section];
  if (!locSection) return true;
  if (Array.isArray(enSection)) {
    if (!Array.isArray(locSection) || locSection.length !== enSection.length) return true;
    return JSON.stringify(locSection) === JSON.stringify(enSection);
  }
  if (typeof enSection === "object" && enSection !== null) {
    if (typeof locSection !== "object" || locSection === null) return true;
    return JSON.stringify(locSection) === JSON.stringify(enSection);
  }
  return locSection === enSection;
}

async function translateChunk(chunk: Record<string, unknown>, langName: string, retries = 2): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(chunk);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Translate to ${langName}. Return ONLY raw JSON, no fences:\n\n${payload}` },
          ],
          temperature: 0.3,
          max_tokens: 16384,
        }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json() as any;
      let content = data.choices?.[0]?.message?.content ?? "";
      content = content.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
      return JSON.parse(content);
    } catch (err: any) {
      if (attempt < retries) {
        console.log(`      retry ${attempt + 1}...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const sections = ["reactions", "species", "overrides", "escalation", "rarity",
    "fallback_names", "vibe_words", "personality", "achievements", "mcp"];

  for (const [code, langName] of Object.entries(LANG_NAMES)) {
    const path = `locales/${code}.json`;
    const locale = JSON.parse(readFileSync(path, "utf8"));
    let changed = false;

    for (const section of sections) {
      if (!enData[section]) continue;
      if (!isEnglishFallback(locale, section)) continue;

      console.log(`  ${code}/${section} needs retranslation`);
      try {
        const translated = await translateChunk({ [section]: enData[section] }, langName);
        locale[section] = translated[section];
        changed = true;
        console.log(`    ✓ ${code}/${section}`);
      } catch (err: any) {
        console.error(`    ✗ ${code}/${section}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (changed) {
      writeFileSync(path, JSON.stringify(locale, null, 2) + "\n");
      console.log(`  saved ${code}`);
    }
  }
  console.log("Done!");
}

main().catch(console.error);
