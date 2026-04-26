import type { BuddyBones, StatName } from "./engine.ts";
import { loadConfig } from "./state.ts";

// ─── Template generation (used when llmGeneration config is disabled) ────────

const PEAK_PHRASES: Record<StatName, string[]> = {
  DEBUGGING: [
    "spots segfaults before the stack unwinds",
    "can read a backtrace like a map",
    "finds the off-by-one before the tests do",
  ],
  PATIENCE: [
    "outlasts any flaky test suite",
    "waits for the slow CI build without complaint",
    "never merges before the green check",
  ],
  CHAOS: [
    "treats breaking changes as a love language",
    "rewrites the Makefile on a Tuesday for fun",
    "thrives wherever the incident channel is loudest",
  ],
  WISDOM: [
    "has seen this bug before — in three other repos",
    "quotes the relevant RFC from memory",
    "recognizes the abstraction that will outlive its author",
  ],
  SNARK: [
    "leaves code review comments that linger",
    "finds the edge case you forgot and mentions it twice",
    "names things with uncomfortable accuracy",
  ],
};

const DUMP_PHRASES: Record<StatName, string[]> = {
  DEBUGGING: [
    "occasionally ships the workaround instead of the fix",
    "skips the repro step",
    "trusts the logs a little too much",
  ],
  PATIENCE: [
    "starts the rebase before the review is done",
    "has been known to close slow issues as stale",
    "has been known to force-push main",
  ],
  CHAOS: [
    "prefers everything to stay exactly where it is",
    "dislikes surprise refactors",
    "writes very thorough migration guides",
  ],
  WISDOM: [
    "sometimes reinvents the wheel with enthusiasm",
    "skips the existing prior art",
    "learns by doing, not by reading",
  ],
  SNARK: [
    "only leaves encouraging comments",
    "approves PRs with genuine warmth",
    "never says what it actually thinks",
  ],
};

const RARITY_CLOSER: Record<string, string[]> = {
  common:    ["Gets the job done.", "Reliable, if unassuming."],
  uncommon:  ["Has a few tricks up its sleeve.", "Worth keeping around."],
  rare:      ["Not to be underestimated.", "Earns its keep."],
  epic:      ["Commands quiet respect.", "The kind of companion repos are built around."],
  legendary: ["The kind you find once, if you're lucky.", "Leaves every codebase better than it found it."],
};

const TEMPLATE_NAMES = [
  "Crumpet", "Soup", "Pickle", "Biscuit", "Moth", "Gravy",
  "Nugget", "Sprocket", "Miso", "Waffle", "Pixel", "Ember",
  "Thimble", "Marble", "Sesame", "Cobalt", "Rusty", "Nimbus",
  "Thunder", "Void", "Velvet", "Rust", "Whisper", "Frost",
  "Honey", "Copper", "Dusk", "Quartz", "Soot", "Plum",
];

export function templatePersonality(bones: BuddyBones, userId: string): string {
  const seed = parseInt(userId.slice(0, 8), 16) || 0;
  const pick = <T>(arr: T[], salt: number = 0): T => arr[(seed + salt) % arr.length];
  const shiny = bones.shiny ? " Shimmers faintly in dark mode." : "";
  const peak = pick(PEAK_PHRASES[bones.peak]);
  const dump = pick(DUMP_PHRASES[bones.dump], 1);
  const closer = pick(RARITY_CLOSER[bones.rarity] ?? ["Gets the job done."], 2);
  return `A ${bones.rarity} ${bones.species} that ${peak}.${shiny} ${closer} Though it ${dump}.`;
}

export function templateName(userId: string): string {
  const seed = parseInt(userId.slice(0, 8), 16) || 0;
  return TEMPLATE_NAMES[seed % TEMPLATE_NAMES.length];
}

// ─── LLM generation ───────────────────────────────────────────────────────────

const QUERY_SYSTEM_PROMPT =
  "You write in-world flavor text for a creature-collecting game. " +
  "Reply with ONLY the requested content — no preamble, no postamble, " +
  "no meta-commentary, no markdown headers, no explanation.";

async function queryClaude(prompt: string): Promise<string> {
  // Strip ANTHROPIC_API_KEY so `claude` uses the Pro subscription auth
  // rather than a (possibly depleted) API-key account.
  const { ANTHROPIC_API_KEY, ...env } = process.env;

  const proc = Bun.spawn(
    [
      "claude", "-p",
      "--model", "haiku",
      "--tools", "",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      "--system-prompt", QUERY_SYSTEM_PROMPT,
      prompt,
    ],
    { stdout: "pipe", stderr: "pipe", env },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`claude CLI exited ${proc.exitCode}: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout.trim();
}

function bonesPromptBlock(bones: BuddyBones): string {
  const statLines = Object.entries(bones.stats)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return [
    `Species: ${bones.species}`,
    `Rarity: ${bones.rarity}`,
    `Shiny: ${bones.shiny}`,
    `Stats: ${statLines}`,
    `Peak stat: ${bones.peak} (${bones.stats[bones.peak]})`,
    `Dump stat: ${bones.dump} (${bones.stats[bones.dump]})`,
  ].join("\n");
}

function sanitizeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9 '-]/g, "").slice(0, 14).trim();
}

export async function generateBuddy(
  bones: BuddyBones,
  userId?: string,
): Promise<{ name: string; personality: string }> {
  if (!loadConfig().llmGeneration) {
    const uid = userId ?? "anon";
    return { name: templateName(uid), personality: templatePersonality(bones, uid) };
  }
  const prompt = [
    bonesPromptBlock(bones),
    "",
    "Generate both a NAME and PERSONALITY for this coding companion.",
    "Be specific to this creature's stats and species — no generic filler.",
    "Reply in exactly this format, with no preamble or extra lines:",
    "NAME: <1-2 words, gender-neutral, evocative>",
    "PERSONALITY: <3-4 sentences of trading-card / creature-compendium flavor text; stay fully in-world; describe behavior, quirks, and character>",
  ].join("\n");

  try {
    const text = await queryClaude(prompt);
    const nameMatch = text.match(/^\s*NAME:\s*(.+?)\s*$/mi);
    const personalityMatch = text.match(/PERSONALITY:\s*([\s\S]+?)\s*$/i);
    const name = sanitizeName(nameMatch?.[1] ?? "");
    const personality = (personalityMatch?.[1] ?? "").trim();
    if (!name || !personality) throw new Error("unparseable response");
    return { name, personality };
  } catch {
    return {
      name: "TryAgainLater",
      personality: "This creature doesn't want to tell you about itself right now.",
    };
  }
}

export async function generatePersonality(bones: BuddyBones, userId?: string): Promise<string> {
  if (!loadConfig().llmGeneration) return templatePersonality(bones, userId ?? "anon");
  const prompt = [
    bonesPromptBlock(bones),
    "",
    "Write 3-4 sentences of trading-card / creature-compendium flavor text for this coding companion.",
    "Stay fully in-world — no meta-commentary. Describe behavior, quirks, and character.",
    "Be specific to this creature's stats and species. Do not use generic filler.",
  ].join("\n");

  try {
    const text = await queryClaude(prompt);
    if (!text) throw new Error("empty response");
    return text;
  } catch {
    return "This creature doesn't want to tell you about itself right now.";
  }
}

export async function generateName(
  bones: BuddyBones,
  personality: string,
  userId?: string,
): Promise<string> {
  if (!loadConfig().llmGeneration) return templateName(userId ?? "anon");
  const prompt = [
    `Species: ${bones.species}`,
    `Rarity: ${bones.rarity}`,
    `Personality: ${personality}`,
    "",
    "Give this coding companion a name. 1-2 words, gender-neutral, evocative.",
    "Reply with ONLY the name — no punctuation, no explanation.",
  ].join("\n");

  try {
    const text = await queryClaude(prompt);
    if (!text) throw new Error("empty response");
    return sanitizeName(text) || "TryAgainLater";
  } catch {
    return "TryAgainLater";
  }
}
