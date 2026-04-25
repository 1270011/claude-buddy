#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync } from "fs";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const MODEL = "google/gemini-2.5-flash";
const LANGUAGES: Record<string, string> = {
  zh: "Chinese (Simplified)", es: "Spanish", ja: "Japanese", de: "German",
  fr: "French", pt: "Portuguese", ko: "Korean", ru: "Russian", ro: "Romanian",
  uk: "Ukrainian", tr: "Turkish", hi: "Hindi", it: "Italian", pl: "Polish",
  vi: "Vietnamese", ar: "Arabic", th: "Thai",
};

const enData = JSON.parse(readFileSync("locales/en.json", "utf8"));

const SYSTEM_PROMPT = `You are translating a JSON locale file for claude-buddy — a tamagotchi-style coding companion that lives in a developer's terminal.

Rules:
1. Preserve ALL JSON keys and structure EXACTLY as-is (keys in English, same nesting, same array lengths)
2. Preserve all {variable} placeholders EXACTLY as-is — do NOT translate them
3. Preserve all *asterisk actions* — translate the action verb but keep the *asterisks*
4. Keep the playful, snarky, affectionate tone
5. Preserve all emoji
6. Sound natural to a native developer — use casual/colloquial register, not formal textbook language
7. Return ONLY the translated JSON object, no markdown fences, no commentary`;

async function translateChunk(chunk: Record<string, unknown>, langName: string): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(chunk);
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://claude-buddy.dev",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Translate the following JSON to ${langName}. Return ONLY valid JSON:\n\n${payload}` },
      ],
      temperature: 0.3,
      max_tokens: 16384,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json() as any;
  let content = data.choices?.[0]?.message?.content ?? "";
  content = content.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  return JSON.parse(content);
}

async function translateLanguage(code: string, langName: string): Promise<void> {
  const outPath = `locales/${code}.json`;
  if (existsSync(outPath)) {
    console.log(`  ✓ ${code} already exists, skipping`);
    return;
  }

  console.log(`  → ${code} (${langName}): translating...`);

  const result: Record<string, any> = { _language: langName };

  const sections = ["reactions", "species", "overrides", "escalation", "rarity",
    "fallback_names", "vibe_words", "personality", "achievements", "mcp"];

  for (const section of sections) {
    if (!enData[section]) continue;
    const chunk = { [section]: enData[section] };
    try {
      const translated = await translateChunk(chunk, langName);
      result[section] = translated[section];
      process.stdout.write(`    ${section} ✓\n`);
    } catch (err: any) {
      console.error(`    ${section} FAILED: ${err.message}`);
      result[section] = enData[section];
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`  ✓ ${code} saved`);
}

async function main() {
  const targets = Object.entries(LANGUAGES);
  console.log(`Translating en.json → ${targets.length} languages...\n`);

  for (const [code, name] of targets) {
    try {
      await translateLanguage(code, name);
    } catch (err: any) {
      console.error(`  ✗ ${code} failed: ${err.message}`);
    }
  }

  console.log("\nDone! Run `bun test server/i18n.test.ts` to validate.");
}

main().catch(console.error);
