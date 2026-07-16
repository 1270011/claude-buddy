# Custom species art

Runtime-loadable buddy skins — add a new drawing with **no code edit** and
**no change to the deterministic species roll**.

## Why these are separate from `server/art.ts`

The built-in species in `server/engine.ts` (`SPECIES`) form a fixed pool that
the generator picks from by index. Adding an entry there changes `SPECIES.length`,
which re-rolls the species of *every existing buddy* — the golden snapshot tests
guard against exactly that. Custom art sidesteps it: it is an **override layer**
keyed by name, never part of the RNG pool. Existing buddies are untouched.

## Format

```json
{
  "name": "fox",
  "art": [ /* 3 frames, each exactly 5 lines, {E} = eye placeholder */ ],
  "face": "({E}v{E})"   // optional inline face template
}
```

Rules (enforced by `cli/validate-species.ts`):

- exactly **3 frames**, each exactly **5 lines**
- each line **≤14 display columns**
- **no ANSI escape codes**
- `{E}` where the eye glyph should render

## Install a skin

1. Validate it:
   ```bash
   bun run cli/validate-species.ts custom-art/fox.json
   ```
2. Copy it into your buddy state dir (`~/.claude-buddy/custom-art/`, or
   `$CLAUDE_CONFIG_DIR/buddy-state/custom-art/` when that env var is set):
   ```bash
   mkdir -p ~/.claude-buddy/custom-art
   cp custom-art/fox.json ~/.claude-buddy/custom-art/
   ```
3. Point your active buddy at it (LLM-free):
   ```bash
   bun run buddy skin fox     # list available: `bun run buddy skin`
   ```

The skin overrides only the drawing/face for a buddy whose `species` matches the
JSON `name`. Everything else (stats, rarity, personality) is unchanged.
