#!/usr/bin/env bun
import { readFileSync } from "fs";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const MODEL = "anthropic/claude-sonnet-4";
const enData = JSON.parse(readFileSync("locales/en.json", "utf8"));

const LANGS = ["zh","es","ja","de","fr","pt","ko","ru","ro","uk","tr","hi","it","pl","vi","ar","th"];
const LANG_NAMES: Record<string, string> = {
  zh: "Chinese", es: "Spanish", ja: "Japanese", de: "German",
  fr: "French", pt: "Portuguese", ko: "Korean", ru: "Russian", ro: "Romanian",
  uk: "Ukrainian", tr: "Turkish", hi: "Hindi", it: "Italian", pl: "Polish",
  vi: "Vietnamese", ar: "Arabic", th: "Thai",
};

const SAMPLE_KEYS = [
  ["reactions", "hatch", "0"],
  ["reactions", "error", "2"],
  ["reactions", "merge-conflict", "0"],
  ["reactions", "all-green", "0"],
  ["reactions", "lang-rust", "0"],
  ["reactions", "friday", "0"],
  ["species", "cat", "error", "0"],
  ["species", "dragon", "commit", "0"],
  ["species", "ghost", "idle", "0"],
  ["species", "goose", "test-fail", "0"],
  ["overrides", "snark", "error", "0"],
  ["escalation", "error", "late", "0"],
  ["achievements", "first_steps", "description"],
  ["achievements", "iron_will", "description"],
  ["achievements", "cursed", "description"],
  ["mcp", "mute"],
  ["mcp", "empty_menagerie_summon"],
];

function getNested(obj: any, keys: string[]): any {
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return null;
    cur = cur[k];
  }
  return cur;
}

async function scoreLanguage(code: string): Promise<void> {
  const langName = LANG_NAMES[code];
  const locData = JSON.parse(readFileSync(`locales/${code}.json`, "utf8"));

  const samples: { key: string; en: string; loc: string }[] = [];
  for (const keyPath of SAMPLE_KEYS) {
    const enVal = getNested(enData, keyPath);
    const locVal = getNested(locData, keyPath);
    if (enVal && locVal) {
      samples.push({ key: keyPath.join("."), en: enVal, loc: locVal });
    }
  }

  const pairs = samples.map(s => `[${s.key}]\nEN: ${s.en}\n${code.toUpperCase()}: ${s.loc}`).join("\n\n");

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: "user",
        content: `You are a translation quality reviewer for software UI strings. The source is a playful coding companion (tamagotchi-style).

For each translation pair below, rate the translation on a 1-5 scale for:
- A: Accuracy (meaning preserved)
- T: Tone (playful/snarky/affectionate tone preserved)  
- N: Naturalness (sounds natural to a native ${langName} developer)

Also flag any specific issues (wrong meaning, lost humor, awkward phrasing, untranslated parts).

Output format - one line per pair:
KEY | A:1-5 T:1-5 N:1-5 | issue or "ok"

Then a final line: TOTAL | avg_A avg_T avg_N | overall:GOOD/FAIR/POOR

${pairs}`
      }],
      temperature: 0.2,
      max_tokens: 2048,
    }),
  });

  const data = await resp.json() as any;
  const content = data.choices?.[0]?.message?.content ?? "error";
  
  const lines = content.trim().split("\n");
  const totalLine = lines.find(l => l.startsWith("TOTAL")) || "";
  const overall = totalLine.includes("GOOD") ? "GOOD" : totalLine.includes("FAIR") ? "FAIR" : totalLine.includes("POOR") ? "POOR" : "?";
  
  console.log(`\n=== ${code} (${langName}) — ${overall} ===`);
  for (const line of lines) {
    if (line.includes("|") && !line.startsWith("TOTAL")) {
      const parts = line.split("|");
      const key = parts[0]?.trim();
      const scores = parts[1]?.trim();
      const issue = parts[2]?.trim();
      if (issue && issue !== "ok" && issue !== "OK") {
        console.log(`  ⚠ ${key}: ${scores} — ${issue}`);
      }
    }
  }
  console.log(`  ${totalLine}`);

  await new Promise(r => setTimeout(r, 3000));
}

async function main() {
  console.log("Translation Quality Audit");
  console.log("=========================");
  
  for (const code of LANGS) {
    try {
      await scoreLanguage(code);
    } catch (err: any) {
      console.error(`\n=== ${code} FAILED: ${err.message} ===`);
    }
  }
}

main().catch(console.error);
