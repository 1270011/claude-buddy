# LLM-Based Personality & Name Generation

**Date:** 2026-04-21  
**Status:** Approved

## Problem

Creature personalities and names are currently generated from fixed template pools ("A {rarity} {species} that {peak_phrase}. {rarity_closer} Though it {dump_phrase}.") with 15 peak phrases and 15 dump phrases. The results feel formulaic and repetitive across creatures. Names are random from a fixed word list.

## Goal

Replace template-based personality and name generation with LLM-generated text that feels unique to each creature's stats, species, and rarity. Generation should be invisible to the user — results are ready by the time they confirm hatching.

## Architecture

### New module: `server/generation.ts`

Exports two async functions:

```typescript
generatePersonality(bones: BuddyBones): Promise<string>
generateName(bones: BuddyBones, personality: string): Promise<string>
```

Both use `claude-haiku-4-5` via the Anthropic SDK (new dependency: `@anthropic-ai/sdk`).

**`generatePersonality` prompt inputs:**
- Species, rarity, shiny status
- All 5 stat values (DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK)
- Peak stat and dump stat
- Instruction: 3-4 sentences, trading-card/creature-compendium flavor text style, no meta-commentary, in-world description only

**`generateName` prompt inputs:**
- Species, rarity
- The already-generated personality (for coherence)
- Instruction: 1-2 words, gender-neutral, evocative

Name is generated after personality so it can reflect the character.

**Removals:**
- Template-based `generatePersonality` in `engine.ts`
- `generatePersonalityPrompt` stub in `reactions.ts`

### Picker TUI: `cli/pick.ts`

When a creature is highlighted in the picker list:

1. Fire `generatePersonality(bones)` immediately
2. On resolve, fire `generateName(bones, personality)`
3. Right pane shows a spinner in place of name and personality text while generating
4. On resolve, right pane updates with live results

**Caching:** Results are stored in a local `Map<string, {name, personality}>` keyed by a hash of the creature's bones. Scrolling back to a previously-viewed creature uses the cached result — no second API call.

**At hatch:** The already-generated name and personality are written directly into the new `Companion`. No second generation call.

### New MCP tools: `server/index.ts`

| Tool | Description |
|------|-------------|
| `buddy_generate_personality` | Re-generates personality for the active companion via LLM. Updates stored personality and returns new text. |
| `buddy_generate_name` | Re-generates name for the active companion via LLM. Updates stored name and returns new name. |

Existing `buddy_set_personality` and `buddy_rename` are unchanged — they remain the manual override path.

## Error Handling

On API failure (any error), both functions return a humorous placeholder:

- **Name:** `TryAgainLater`
- **Personality:** `This creature doesn't want to tell you about itself right now.`

For re-roll tools (`buddy_generate_personality`, `buddy_generate_name`): failures return a clear user-facing error message ("Generation failed — try again in a moment").

## Dependencies

- Add `@anthropic-ai/sdk` to `package.json`
- API key sourced from `ANTHROPIC_API_KEY` environment variable (always present in Claude Code sessions)

## Out of Scope

- Streaming personality text into the picker pane (plain resolved string is sufficient)
- Regenerating personality/name on stat changes
- Batch pre-generation of personalities for the full picker list
