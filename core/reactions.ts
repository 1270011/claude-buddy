/**
 * Reaction templates — species-aware buddy responses to events
 */

import type { Species, Rarity, StatName } from "./engine.ts";

type ReactionReason = "hatch" | "pet" | "error" | "test-fail" | "large-diff" | "turn" | "idle";

const NAME_REACTIONS: Partial<Record<Species, string[]>> = {
  dragon: ["*one eye opens slowly*", "...you called?", "*smoke curls from nostril* yes.", "*regards you from above*"],
  owl: ["*swivels head 180°*", "*blinks once, deliberately*", "hm.", "*adjusts perch*"],
  cat: ["*ear flicks*", "...what.", "*ignores you, but heard*", "*opens one eye*"],
  duck: ["*quack*", "*looks up mid-waddle*", "*attentive duck noises*"],
  ghost: ["*materialises*", "...boo?", "*phases closer*"],
  robot: ["NAME DETECTED.", "*whirrs attentively*", "STANDING BY."],
  capybara: ["*barely moves*", "*blinks slowly*", "...yes, friend."],
  axolotl: ["*gill flutter*", "*smiles gently*", "oh! hello."],
  blob: ["*jiggles*", "*oozes toward you*", "*wobbles excitedly*"],
  turtle: ["*slowly extends neck*", "...you called?", "*ancient eyes open*", "*shell creaks thoughtfully*", "*blinks once, patiently*"],
  goose: ["HONK.", "*necks aggressively*", "*wing flap*", "*honks in recognition*"],
  octopus: ["*eight eyes open*", "*curls an arm toward you*", "*changes color curiously*", "...yes, friend?"],
  penguin: ["*adjusts tie*", "*dignified waddle*", "*bows slightly*", "...yes, quite?"],
  snail: ["*slow head extension*", "...mmm?", "*trails slowly toward you*", "*antenna twitches*"],
  cactus: ["*stands silent*", "...hm.", "*spine twitches*", "*slowly rotates*"],
  rabbit: ["*ears perk up*", "*nose twitches*", "yes?", "*hops closer*"],
  mushroom: ["*releases a tiny spore*", "*cap tilts*", "*stands mysterious*", "...yes?"],
  chonk: ["*barely opens one eye*", "...mrrp?", "*yawns heavily*", "*rolls over toward you*"],
};

const SUCCESS_REACTIONS: Partial<Record<Species, string[]>> = {
  dragon: ["*nods, barely*", "...acceptable.", "*gold eyes gleam*", "as expected."],
  owl: ["*satisfied hoot*", "knowledge confirmed.", "*nods sagely*", "as the tests have spoken."],
  cat: ["*was never worried*", "*yawns*", "I knew you'd figure it out. eventually.", "*already asleep*"],
  duck: ["*celebratory quacking*", "*waddles in circles*", "quack!", "*happy duck noises*"],
  robot: ["OBJECTIVE: COMPLETE.", "*satisfying beep*", "NOMINAL.", "WITHIN ACCEPTABLE PARAMETERS."],
  capybara: ["*maximum chill maintained*", "*nods once*", "good vibes.", "see? no panic needed."],
  ghost: ["*drifts in quiet approval*", "not bad for the living.", "*soft spectral nod*", "the haunting may continue peacefully."],
  axolotl: ["*happy gill flutter*", "*beams*", "you did it!", "*blushes pink*"],
  blob: ["*jiggles happily*", "*gleams*", "yay!", "*bounces*"],
  turtle: ["*satisfied shell settle*", "as the ancients foretold.", "*slow approving nod*", "good. very good."],
  goose: ["*victorious honk*", "HONK OF APPROVAL.", "*struts triumphantly*", "*wing spread of victory*"],
  octopus: ["*turns gentle blue*", "*arms applaud in sync*", "excellent, from all angles.", "*satisfied bubble*"],
  penguin: ["*polite applause*", "quite good, quite good.", "*nods approvingly*", "splendid work, really."],
  snail: ["*slow satisfied nod*", "good things take time.", "*leaves victory slime*", "see? no rush was needed."],
  cactus: ["*blooms briefly*", "survival confirmed.", "*flowers in victory*", "*quiet bloom*"],
  rabbit: ["*excited binky*", "*zoomies of joy*", "yay yay yay!", "*thumps in celebration*"],
  mushroom: ["*spores of celebration*", "the mycelium approves.", "*cap brightens*", "spore of pride."],
  chonk: ["*happy purr*", "*satisfied chonk noises*", "acceptable.", "*sleeps even harder*"] ,
};

const DEFAULT_NAME_REACTIONS = ["*perks up*", "...yes?", "*looks your way*"];
const DEFAULT_SUCCESS_REACTIONS = ["*nods*", "nice.", "*quiet approval*", "clean."];

interface ReactionPool {
  [key: string]: string[];
}

// General reactions by event type
const REACTIONS: Record<ReactionReason, string[]> = {
  hatch: [
    "*blinks* ...where am I?",
    "*stretches* hello, world!",
    "*looks around curiously* nice terminal you got here.",
    "*yawns* ok I'm ready. show me the code.",
  ],
  pet: [
    "*purrs contentedly*",
    "*happy noises*",
    "*nuzzles your cursor*",
    "*wiggles*",
    "again! again!",
    "*closes eyes peacefully*",
  ],
  error: [
    "*head tilts* ...that doesn't look right.",
    "saw that one coming.",
    "*adjusts glasses* line {line}, maybe?",
    "*slow blink* the stack trace told you everything.",
    "have you tried reading the error message?",
    "*winces*",
  ],
  "test-fail": [
    "*head rotates slowly* ...that test.",
    "bold of you to assume that would pass.",
    "*taps clipboard* {count} failed.",
    "the tests are trying to tell you something.",
    "*sips tea* interesting.",
    "*marks calendar* test regression day.",
  ],
  "large-diff": [
    "that's... a lot of changes.",
    "*counts lines* are you refactoring or rewriting?",
    "might want to split that PR.",
    "*nervous laughter* {lines} lines changed.",
    "bold move. let's see if CI agrees.",
  ],
  turn: [
    "*watches quietly*",
    "*takes notes*",
    "*nods*",
    "...",
    "*adjusts hat*",
  ],
  idle: [
    "*dozes off*",
    "*doodles in margins*",
    "*stares at cursor blinking*",
    "zzz...",
  ],
};

// Species-specific flavor
const SPECIES_REACTIONS: Partial<Record<Species, Partial<Record<ReactionReason, string[]>>>> = {
  owl: {
    error: [
      "*head rotates 180\u00b0* ...I saw that.",
      "*unblinking stare* check your types.",
      "*hoots disapprovingly*",
    ],
    pet: ["*ruffles feathers contentedly*", "*dignified hoot*"],
  },
  cat: {
    error: ["*knocks error off table*", "*licks paw, ignoring the stacktrace*"],
    pet: ["*purrs* ...don't let it go to your head.", "*tolerates you*"],
    idle: ["*pushes your coffee off the desk*", "*naps on keyboard*"],
  },
  duck: {
    error: ["*quacks at the bug*", "have you tried rubber duck debugging? oh wait."],
    pet: ["*happy quack*", "*waddles in circles*"],
  },
  dragon: {
    error: ["*smoke curls from nostrils*", "*considers setting the codebase on fire*"],
    "large-diff": ["*breathes fire on the old code* good riddance."],
  },
  ghost: {
    error: ["*phases through the stack trace*", "I've seen worse... in the afterlife."],
    idle: ["*floats through walls*", "*haunts your unused imports*"],
  },
  robot: {
    error: ["SYNTAX. ERROR. DETECTED.", "*beeps aggressively*"],
    "test-fail": ["FAILURE RATE: UNACCEPTABLE.", "*recalculating*"],
  },
  axolotl: {
    error: ["*regenerates your hope*", "*smiles despite everything*"],
    pet: ["*happy gill wiggle*", "*blushes pink*"],
  },
  capybara: {
    error: ["*unbothered* it'll be fine.", "*continues vibing*"],
    pet: ["*maximum chill achieved*", "*zen mode activated*"],
    idle: ["*just sits there, radiating calm*"],
  },
};

// Rarity affects reaction quality/length
const RARITY_BONUS: Partial<Record<Rarity, string[]>> = {
  legendary: [
    "*legendary aura intensifies*",
    "*sparkles knowingly*",
  ],
  epic: [
    "*epic presence noted*",
  ],
};

export function getReaction(
  reason: ReactionReason,
  species: Species,
  rarity: Rarity,
  context?: { line?: number; count?: number; lines?: number },
): string {
  // Try species-specific first
  const speciesPool = SPECIES_REACTIONS[species]?.[reason];
  const generalPool = REACTIONS[reason];

  // 40% chance of species-specific if available
  const pool = speciesPool && Math.random() < 0.4 ? speciesPool : generalPool;
  let reaction = pool[Math.floor(Math.random() * pool.length)];

  // Template substitution
  if (context?.line) reaction = reaction.replace("{line}", String(context.line));
  if (context?.count) reaction = reaction.replace("{count}", String(context.count));
  if (context?.lines) reaction = reaction.replace("{lines}", String(context.lines));

  return reaction;
}

export function getNameReaction(species: Species): string {
  const pool = NAME_REACTIONS[species] ?? DEFAULT_NAME_REACTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getSuccessReaction(species: Species): string {
  const pool = SUCCESS_REACTIONS[species] ?? DEFAULT_SUCCESS_REACTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Personality generation (fallback names when API unavailable) ────────────

const FALLBACK_NAMES = [
  "Crumpet", "Soup", "Pickle", "Biscuit", "Moth", "Gravy",
  "Nugget", "Sprocket", "Miso", "Waffle", "Pixel", "Ember",
  "Thimble", "Marble", "Sesame", "Cobalt", "Rusty", "Nimbus",
];

const VIBE_WORDS = [
  "thunder", "biscuit", "void", "accordion", "moss", "velvet", "rust",
  "pickle", "crumb", "whisper", "gravy", "frost", "ember", "soup",
  "marble", "thorn", "honey", "static", "copper", "dusk", "sprocket",
  "quartz", "soot", "plum", "flint", "oyster", "loom", "anvil",
  "cork", "bloom", "pebble", "vapor", "mirth", "glint", "cider",
];

export function generateFallbackName(): string {
  return FALLBACK_NAMES[Math.floor(Math.random() * FALLBACK_NAMES.length)];
}

export function generatePersonalityPrompt(
  species: Species,
  rarity: Rarity,
  stats: Record<string, number>,
  shiny: boolean,
): string {
  const vibes: string[] = [];
  for (let i = 0; i < 4; i++) {
    vibes.push(VIBE_WORDS[Math.floor(Math.random() * VIBE_WORDS.length)]);
  }

  const statStr = Object.entries(stats).map(([k, v]) => `${k}:${v}`).join(", ");

  return [
    "Generate a coding companion — a small creature that lives in a developer's terminal.",
    "Don't repeat yourself — every companion should feel distinct.",
    "",
    `Rarity: ${rarity.toUpperCase()}`,
    `Species: ${species}`,
    `Stats: ${statStr}`,
    `Inspiration words: ${vibes.join(", ")}`,
    shiny ? "SHINY variant — extra special." : "",
    "",
    "Return JSON: {\"name\": \"1-14 chars\", \"personality\": \"2-3 sentences describing behavior\"}",
  ].filter(Boolean).join("\n");
}
