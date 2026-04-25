#!/usr/bin/env bun
/**
 * Re-translate locales using Claude with few-shot examples and per-language
 * style guides. Produces higher-quality creative translations.
 *
 * Usage: bun run scripts/translate-v2.ts [--language es] [--section reactions]
 */
import { readFileSync, writeFileSync } from "fs";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const MODEL = "anthropic/claude-sonnet-4";
const enData = JSON.parse(readFileSync("locales/en.json", "utf8"));

const args = process.argv.slice(2);
const filterLang = args.includes("--language") ? args[args.indexOf("--language") + 1] : null;
const filterSection = args.includes("--section") ? args[args.indexOf("--section") + 1] : null;

const LANG_CONFIG: Record<string, { name: string; formality: string; notes: string }> = {
  zh: { name: "Simplified Chinese", formality: "casual/internet slang acceptable (网络用语)", notes: "Use 开发者 casual register. 术语如 commit/push/merge 可不翻译。" },
  es: { name: "Spanish", formality: "informal tú form", notes: "Latin American Spanish preferred. Dev terms (commit, push, branch) stay in English." },
  ja: { name: "Japanese", formality: "casual (だ/である, not です/ます)", notes: "Use casual developer speak. Emoji-heavy. Dev terms stay in English/katakana." },
  de: { name: "German", formality: "casual du form, lowercase in asterisk actions", notes: "Du form. Dev terms stay in English. Asterisk actions can be lowercase." },
  fr: { name: "French", formality: "informal tu form", notes: "Tu form. Dev terms stay in English. Can use verlan/argot sparingly." },
  pt: { name: "Brazilian Portuguese", formality: "informal", notes: "Brazilian Portuguese. Dev terms stay in English." },
  ko: { name: "Korean", formality: "casual 반말 (banmal)", notes: "Use 반말. Dev terms in English. Internet slang OK." },
  ru: { name: "Russian", formality: "informal ты", notes: "Ты form. Dev terms stay in English." },
  ro: { name: "Romanian", formality: "informal tu", notes: "Tu form. Dev terms stay in English." },
  uk: { name: "Ukrainian", formality: "informal ти", notes: "Ти form. Dev terms stay in English." },
  tr: { name: "Turkish", formality: "informal sen", notes: "Sen form. Dev terms stay in English." },
  hi: { name: "Hindi", formality: "casual/intimate", notes: "Dev terms in English transliteration OK (कमिट, पुश). Mix Hinglish where natural." },
  it: { name: "Italian", formality: "informal tu", notes: "Tu form. Dev terms stay in English." },
  pl: { name: "Polish", formality: "informal ty", notes: "Ty form. Dev terms stay in English." },
  vi: { name: "Vietnamese", formality: "casual", notes: "Casual register. Dev terms stay in English. Natural Vietnamese phrasing." },
  ar: { name: "Arabic", formality: "casual/modern standard", notes: "Modern Standard Arabic with casual tone. Dev terms stay in English." },
  th: { name: "Thai", formality: "casual", notes: "Casual register. Dev terms stay in English." },
};

const FEW_SHOT_EXAMPLES = `Example translations (English → Spanish, to show desired quality):

EN: "*head tilts* ...that doesn't look right."
ES: "*inclinando la cabeza* ...eso no pinta bien."

EN: "have you tried reading the error message?"
ES: "¿ya leíste el mensaje de error o solo lloras?"

EN: "*knocks error off table*"
ES: "*tira el error de la mesa con la pata*"

EN: "FRIDAY PUSH. the ballad of every developer."
ES: "PUSH EN VIERNES. la balada de todx desarrollador."

EN: "Rust. where the borrow checker is your strictest reviewer."
ES: "Rust. donde el borrow checker es tu reviewer más exigente."

Notice: tone is snarky/playful, dev terms stay English, asterisk actions are vivid, casual register.`;

const SYSTEM_PROMPT = `You are a professional translator specializing in software developer culture and humor.

You are translating strings for claude-buddy — a tamagotchi-style coding companion that lives in a developer's terminal. The companion makes snarky, affectionate, playful comments about code.

CRITICAL RULES:
1. Return ONLY valid JSON. No markdown fences. No backticks. No commentary.
2. Preserve ALL JSON keys exactly (never translate keys, only string values).
3. Preserve all {variable} placeholders EXACTLY as-is — {line}, {count}, {files}, {branch}, {lines}, {name}, {icon}, etc.
4. Preserve all *asterisk actions* — translate the action verb/description but keep the *asterisks* wrapping.
5. Preserve all emoji exactly.
6. Same array lengths as source. Same nesting structure.
7. The tone must be: playful, snarky, affectionate, casual. Like a witty dev friend.
8. Dev terms like "commit", "push", "merge", "branch", "rebase", "lint", "deploy", "CI" should generally stay in English — they're universal dev jargon.
9. Each string in an array should be independently translated — don't make them all sound the same.`;

async function translateSection(
  section: string,
  langCode: string,
  langConfig: typeof LANG_CONFIG[string],
  retries = 2,
): Promise<any> {
  const sourceChunk = { [section]: enData[section] };
  const payload = JSON.stringify(sourceChunk, null, 2);

  const userPrompt = `Translate the following JSON section "${section}" from English to ${langConfig.name}.

Style: ${langConfig.formality}
Notes: ${langConfig.notes}

${FEW_SHOT_EXAMPLES}

Here is the JSON to translate:

${payload}

Remember: return ONLY the translated JSON object for the "${section}" key. No fences, no explanation.`;

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
            { role: "user", content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 16384,
        }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
      const data = await resp.json() as any;
      let content = data.choices?.[0]?.message?.content ?? "";
      content = content.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
      const parsed = JSON.parse(content);
      return parsed[section] ?? parsed;
    } catch (err: any) {
      if (attempt < retries) {
        console.log(`      retry ${attempt + 1}...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const sections = ["reactions", "species", "overrides", "escalation", "rarity",
    "fallback_names", "vibe_words", "personality", "achievements", "mcp"];

  const targetLangs = filterLang ? { [filterLang]: LANG_CONFIG[filterLang] } : LANG_CONFIG;

  console.log(`Translating with ${MODEL} (few-shot + per-language style guides)\n`);

  for (const [code, config] of Object.entries(targetLangs)) {
    if (!config) { console.log(`  skipping ${code} — no config`); continue; }
    const path = `locales/${code}.json`;
    let locale: any = {};
    try { locale = JSON.parse(readFileSync(path, "utf8")); } catch { /* new */ }

    console.log(`\n=== ${code} (${config.name}) ===`);

    const targetSections = filterSection ? [filterSection] : sections;

    for (const section of targetSections) {
      if (!enData[section]) continue;
      console.log(`  ${section}...`);
      try {
        const translated = await translateSection(section, code, config);
        locale[section] = translated;
        console.log(`  ${section} ✓`);
      } catch (err: any) {
        console.error(`  ${section} ✗: ${err.message.slice(0, 100)}`);
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    locale._language = config.name;
    locale._verified = false;
    writeFileSync(path, JSON.stringify(locale, null, 2) + "\n");
    console.log(`  saved ${code}`);
  }

  console.log("\nDone! Run `bun test server/i18n.test.ts` to validate.");
}

main().catch(console.error);
