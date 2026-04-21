# Buddy Brain: Complete Implementation Plan

Train a custom 135M-parameter language model for generating in-character terminal companion reactions. Replaces hardcoded reaction pools with dynamic, contextual, personality-consistent generation running entirely on CPU in under 200ms.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Model Selection](#2-model-selection)
3. [Dataset Schema & Format](#3-dataset-schema--format)
4. [Dataset Extraction](#4-dataset-extraction)
5. [Synthetic Augmentation](#5-synthetic-augmentation)
6. [Training Pipeline](#6-training-pipeline)
7. [Evaluation Pipeline](#7-evaluation-pipeline)
8. [Export & Quantization](#8-export--quantization)
9. [Daemon Deployment](#9-daemon-deployment)
10. [Hook Integration](#10-hook-integration)
11. [MCP Server Integration](#11-mcp-server-integration)
12. [Configuration](#12-configuration)
13. [Testing](#13-testing)
14. [Project Structure](#14-project-structure)
15. [Iteration Roadmap](#15-iteration-roadmap)
16. [Timeline & Milestones](#16-timeline--milestones)
17. [Risks & Mitigations](#17-risks--mitigations)
18. [Success Criteria](#18-success-criteria)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     EVENT DETECTION LAYER                           │
│                                                                     │
│  hooks/react.sh           hooks/file-type-react.sh                  │
│  hooks/name-react.sh      hooks/mood-react.sh                       │
│       │                        │                                    │
│       ▼                        ▼                                    │
│  REASON="commit"          REASON="python-file"                      │
│  SPECIES="dragon"         SPECIES="cat"                             │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                     INFERENCE LAYER                                 │
│                                                                     │
│  hooks/buddy-brain.sh                                               │
│    │                                                                │
│    ├─ config.brainEnabled == true?                                  │
│    │    ├─ NO  → exit 0 (hardcoded pools handle it)                 │
│    │    └─ YES → continue                                           │
│    │                                                                │
│    ├─ llama-server running? (check PID file)                        │
│    │    ├─ NO  → scripts/brain-daemon.sh start                      │
│    │    └─ YES → reuse                                              │
│    │                                                                │
│    ├─ Build prompt from species + event + stats + personality       │
│    │                                                                │
│    ├─ curl localhost:4891/v1/chat/completions (500ms timeout)       │
│    │        │                                                       │
│    │        ▼                                                       │
│    │   ┌──────────────────────────────────┐                         │
│    │   │  llama-server (persistent daemon)│                         │
│    │   │  buddy-brain-135m-Q4_K_M.gguf   │                         │
│    │   │  SmolLM2-135M + LoRA fine-tune   │                         │
│    │   │  ~75MB, ~400-550 tok/s on M2     │                         │
│    │   └──────────────────────────────────┘                         │
│    │        │                                                       │
│    │        ▼                                                       │
│    ├─ Parse response (≤40 tokens)                                   │
│    │                                                                │
│    ├─ Validate: non-empty, ≤150 chars, valid format                 │
│    │    ├─ INVALID → fall back to hardcoded pool                    │
│    │    └─ VALID   → use as reaction                                │
│    │                                                                │
│    ▼                                                                │
│  Write reaction to reaction.$SID.json + status.json                 │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                     FALLBACK LAYER                                  │
│                                                                     │
│  If brain fails (timeout, invalid, daemon down):                    │
│  pick_reaction() in react.sh runs as before                         │
│  Zero breakage guarantee                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow (per event)

1. Claude Code runs a Bash command (e.g. `git commit`)
2. `hooks/react.sh` receives PostToolUse event via stdin
3. Regex detects `"3 files changed"` → sets `REASON="commit"`
4. `react.sh` calls `pick_reaction "commit"` (existing hardcoded path)
5. **NEW**: Before `pick_reaction`, `react.sh` sources `buddy-brain.sh`
6. `buddy-brain.sh` checks `config.json` for `brainEnabled`
7. If enabled: builds prompt, calls llama-server, parses response
8. If brain returns valid reaction: uses it, skips `pick_reaction`
9. If brain fails or disabled: falls through to `pick_reaction` as before

---

## 2. Model Selection

### Decision: SmolLM2-135M-Instruct

| Factor | SmolLM2-135M | SmolLM2-360M |
|---|---|---|
| Parameters | 135M | 360M |
| Q4_K_M size | **~75 MB** | ~200 MB |
| CPU speed (M2) | **400-550 tok/s** | 200-350 tok/s |
| 50 tokens on M2 | **~90-125ms** | ~140-250ms |
| 50 tokens on x86 | **~165-280ms** | ~310-555ms |
| License | **Apache 2.0** | **Apache 2.0** |
| LoRA ecosystem | Excellent | Excellent |

### Why 135M

- **Speed**: Under 200ms on ALL modern CPUs, not just Apple Silicon
- **Size**: 75MB is trivially downloadable. Fits in L2 cache on most CPUs
- **Task fit**: Structured input → single sentence is narrow enough for 135M
- **License**: Apache 2.0 — zero restrictions
- **Upgrade path**: If quality insufficient, swap base to 360M with identical pipeline

### Tokenizer Notes

SmolLM2 uses a 49,152-token vocabulary. Key observations:
- Short ASCII strings like `*purrs contentedly*` are 3-5 tokens
- Reaction sentences average 10-25 tokens
- System prompts average 40-60 tokens
- Total input+output per example: ~60-85 tokens
- `max_seq_length=256` provides ample padding

---

## 3. Dataset Schema & Format

### Chat Format (ShareGPT / HuggingFace)

Each training example is a JSON object with a `messages` array:

```jsonl
{"messages": [
  {"role": "system", "content": "You are Crumpet, a rare cat coding companion. Personality: aloof but secretly cares, sarcastic, knocks things off tables when bored. Stats: SNARK:85, PATIENCE:30, CHAOS:70, DEBUGGING:40, WISDOM:55. React in one short sentence. Use *asterisks* for actions. Max 15 words."},
  {"role": "user", "content": "Event: commit. Context: 3 files changed."},
  {"role": "assistant", "content": "*knocks commit off table* another 3am decision."}
]}
```

### System Prompt Template

```
You are {name}, a {rarity} {species} coding companion.
Personality: {personality}.
Stats: {stats_formatted}.
React in one short sentence. Use *asterisks* for actions. Max 15 words.
```

Variables:
- `{name}` — companion name (e.g. "Crumpet", "Soup", "Pickle")
- `{rarity}` — rarity tier (common, uncommon, rare, epic, legendary)
- `{species}` — one of 18 species
- `{personality}` — personality text (2-3 sentences from companion data)
- `{stats_formatted}` — `"SNARK:85, PATIENCE:30, CHAOS:70, DEBUGGING:40, WISDOM:55"`

### User Prompt Template (basic)

```
Event: {reason}. Context: {context_description}.
```

Variables:
- `{reason}` — event type (e.g. "commit", "error", "test-fail")
- `{context_description}` — optional context (e.g. "3 files changed", "line 42 threw TypeError")

### User Prompt Template (stat-aware, v3+)

```
Event: {reason}. Context: {context_description}. Peak stat: {peak} ({peak_value}). Session: {session_info}.
```

### User Prompt Template (escalation-aware, v4+)

```
Event: {reason}. Context: {context_description}. This is error #{count} this session.
```

### Assistant Response Format

The model must learn to output:
- One sentence, 5-100 characters
- May use `*asterisks*` for physical actions
- No markdown, no quotes, no explanation
- Character-consistent voice

### Context Description Variations

For the same (reason, reaction) pair, generate multiple context phrasings:

```python
CONTEXT_VARIATIONS = {
    "error": [
        "A runtime error occurred.",
        "The process exited with code 1.",
        "An exception was thrown.",
        "The stack trace shows a TypeError.",
        "Error: undefined is not a function.",
        "Build failed with compilation errors.",
        "Line 42 threw an unexpected error.",
        "The application crashed.",
    ],
    "commit": [
        "{files} files changed.",
        "Changes committed to the repository.",
        "A new commit was created.",
        "Committed with message.",
        "{files} files modified in this commit.",
    ],
    "test-fail": [
        "{count} tests failed.",
        "A test assertion failed.",
        "The test suite returned failures.",
        "Test regression detected.",
        "Expected value did not match actual.",
    ],
    "push": [
        "Code pushed to remote.",
        "Changes deployed to the repository.",
        "Git push completed.",
        "Remote branch updated.",
    ],
    "merge-conflict": [
        "Merge conflict in {files} file(s).",
        "Both sides modified the same lines.",
        "<<<<<<< HEAD markers detected.",
        "Conflicting changes detected.",
    ],
    "branch": [
        "Switched to branch '{branch}'.",
        "Created new branch: {branch}.",
        "Now on branch {branch}.",
    ],
    "rebase": [
        "Rebasing onto new base.",
        "Successfully rebased.",
        "Rebase in progress.",
    ],
    "stash": [
        "Working directory stashed.",
        "Stash entry created.",
        "Changes saved to stash.",
    ],
    "tag": [
        "Version tagged: v{version}.",
        "New release tag created.",
        "Tagged for release.",
    ],
    "late-night": [
        "It's past midnight. Hour: {hour}.",
        "Late night coding session detected.",
        "The clock reads {hour} AM.",
    ],
    "early-morning": [
        "Early morning coding. Hour: {hour}.",
        "The sun is barely up.",
        "Pre-dawn coding session.",
    ],
    "long-session": [
        "Session has lasted over an hour.",
        "One hour of continuous coding.",
        "Marathon session: {elapsed} minutes.",
    ],
    "all-green": [
        "All tests passing.",
        "100% test success rate.",
        "Clean test run.",
        "Every test passed.",
    ],
    "deploy": [
        "Code deployed to production.",
        "Deployment completed successfully.",
        "Now live in production.",
    ],
    "release": [
        "New version released.",
        "Package published to registry.",
        "Release created.",
    ],
    "pet": [
        "The user pets you gently.",
        "A warm hand pats your head.",
        "The user shows affection.",
    ],
    "hatch": [
        "You just hatched! First moments of existence.",
        "Opening your eyes for the first time.",
        "A new companion enters the world.",
    ],
    "idle": [
        "Nothing is happening. The cursor blinks.",
        "A long pause in activity.",
        "Quiet moment.",
        "The terminal is silent.",
    ],
}
```

---

## 4. Dataset Extraction

### Source Inventory

| Source File | Type | Estimated Reactions |
|---|---|---|
| `server/reactions.ts` — `REACTIONS` | General pools | ~200 |
| `server/reactions.ts` — `SPECIES_REACTIONS` | Species-specific | ~350 |
| `server/reactions.ts` — `*_OVERRIDES` | Stat modifier pools | ~60 |
| `server/reactions.ts` — `ESCALATION_REACTIONS` | Escalation tiers | ~40 |
| `server/reactions.ts` — `RARITY_FLAIR` | Rarity flair | ~10 |
| `hooks/react.sh` — `pick_reaction()` case blocks | Species+event | ~1,200 |
| `hooks/react.sh` — combo reactions | Combo events | ~30 |
| `hooks/react.sh` — streak reactions | Error streaks | ~40 |
| `hooks/react.sh` — recovery reactions | Recovery | ~30 |
| `hooks/react.sh` — seasonal reactions | Seasonal | ~20 |
| `hooks/name-react.sh` | Name-call reactions | ~70 |
| `docs/reaction-contexts-plan.md` | Planned expansions | ~3,000+ |
| **Total** | | **~5,050+** |

### Extraction Script: `buddy-brain/extract.py`

```python
#!/usr/bin/env python3
"""
Extract hardcoded reactions from neon-pixel codebase into JSONL training data.

Usage:
    python extract.py --source-dir ../neon-pixel --output-dir data/seed

Outputs:
    data/seed/reactions_ts.jsonl     — from server/reactions.ts
    data/seed/react_sh.jsonl         — from hooks/react.sh
    data/seed/name_react.jsonl       — from hooks/name-react.sh
    data/seed/combined.jsonl         — merged + deduplicated
"""

import json
import re
import os
import sys
import argparse
from pathlib import Path


# ─── Species & Rarity definitions ─────────────────────────────────────────

SPECIES = [
    "duck", "goose", "blob", "cat", "dragon", "octopus", "owl", "penguin",
    "turtle", "snail", "ghost", "axolotl", "capybara", "cactus", "robot",
    "rabbit", "mushroom", "chonk",
]

RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]

STAT_NAMES = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"]

# Personality archetypes per species (used when actual personality is unknown)
SPECIES_PERSONALITIES = {
    "duck": "friendly, curious, easily confused, loves bread",
    "goose": "aggressive, loud, territorial, honks at everything",
    "blob": "amorphous, anxious, jiggly, changes color with mood",
    "cat": "aloof, sarcastic, knocks things off tables, secretly cares",
    "dragon": "regal, fierce, hoards commits, breathes fire on bugs",
    "octopus": "multitasking, color-changing, intelligent, eight-armed problem solver",
    "owl": "wise, observant, nocturnal, analytical, unblinking",
    "penguin": "formal, polite, dignified, waddles with purpose",
    "turtle": "patient, ancient wisdom, slow and steady, calm",
    "snail": "slow, methodical, leaves trails, perseverant",
    "ghost": "ethereal, spooky, phases through problems, deadpan humor",
    "axolotl": "cheerful, regenerative, always smiling, supportive",
    "capybara": "unbothered, zen, chill, maximum relaxation",
    "cactus": "stoic, prickly, resilient, blooms rarely but beautifully",
    "robot": "mechanical, literal, beeps and boops, follows protocols",
    "rabbit": "energetic, nervous, quick, binkies when happy",
    "mushroom": "calm, fungal wisdom, releases spores, decomposes problems",
    "chonk": "sleepy, round, barely moves, contented grumbles",
}

# Default stat distributions per species (peak/dump stat hints)
SPECIES_STATS = {
    "cat":       {"peak": "SNARK", "dump": "PATIENCE"},
    "dragon":    {"peak": "CHAOS", "dump": "PATIENCE"},
    "owl":       {"peak": "WISDOM", "dump": "CHAOS"},
    "robot":     {"peak": "DEBUGGING", "dump": "CHAOS"},
    "goose":     {"peak": "CHAOS", "dump": "PATIENCE"},
    "duck":      {"peak": "PATIENCE", "dump": "SNARK"},
    "blob":      {"peak": "PATIENCE", "dump": "WISDOM"},
    "octopus":   {"peak": "DEBUGGING", "dump": "SNARK"},
    "penguin":   {"peak": "WISDOM", "dump": "CHAOS"},
    "turtle":    {"peak": "PATIENCE", "dump": "CHAOS"},
    "snail":     {"peak": "PATIENCE", "dump": "SNARK"},
    "ghost":     {"peak": "WISDOM", "dump": "DEBUGGING"},
    "axolotl":   {"peak": "PATIENCE", "dump": "SNARK"},
    "capybara":  {"peak": "PATIENCE", "dump": "SNARK"},
    "cactus":    {"peak": "PATIENCE", "dump": "CHAOS"},
    "rabbit":    {"peak": "CHAOS", "dump": "WISDOM"},
    "mushroom":  {"peak": "WISDOM", "dump": "CHAOS"},
    "chonk":     {"peak": "PATIENCE", "dump": "DEBUGGING"},
}


# ─── Helper functions ─────────────────────────────────────────────────────

def generate_stats(species: str) -> dict[str, int]:
    """Generate plausible stats for a species."""
    import random
    info = SPECIES_STATS.get(species, {"peak": "DEBUGGING", "dump": "CHAOS"})
    stats = {}
    for stat in STAT_NAMES:
        if stat == info["peak"]:
            stats[stat] = random.randint(70, 95)
        elif stat == info["dump"]:
            stats[stat] = random.randint(10, 35)
        else:
            stats[stat] = random.randint(30, 65)
    return stats


def format_stats(stats: dict[str, int]) -> str:
    return ", ".join(f"{k}:{v}" for k, v in stats.items())


def build_system_prompt(
    species: str,
    rarity: str = "common",
    personality: str | None = None,
    stats: dict[str, int] | None = None,
    name: str = "buddy",
) -> str:
    if personality is None:
        personality = SPECIES_PERSONALITIES.get(species, "a helpful coding companion")
    if stats is None:
        stats = generate_stats(species)

    return (
        f"You are {name}, a {rarity} {species} coding companion. "
        f"Personality: {personality}. "
        f"Stats: {format_stats(stats)}. "
        f"React in one short sentence. Use *asterisks* for actions. Max 15 words."
    )


def build_user_prompt(reason: str, context: str = "") -> str:
    parts = [f"Event: {reason}."]
    if context:
        parts.append(f"Context: {context}.")
    return " ".join(parts)


def make_example(
    reaction_text: str,
    reason: str,
    species: str,
    rarity: str = "common",
    personality: str | None = None,
    stats: dict[str, int] | None = None,
    context: str = "",
    name: str = "buddy",
) -> dict:
    return {
        "messages": [
            {"role": "system", "content": build_system_prompt(species, rarity, personality, stats, name)},
            {"role": "user", "content": build_user_prompt(reason, context)},
            {"role": "assistant", "content": reaction_text},
        ],
        "metadata": {
            "source": "hardcoded",
            "species": species,
            "reason": reason,
            "rarity": rarity,
        },
    }


# ─── Extractor: server/reactions.ts ──────────────────────────────────────

def extract_reactions_ts(source_dir: Path) -> list[dict]:
    """Parse server/reactions.ts and extract all reaction strings."""
    filepath = source_dir / "server" / "reactions.ts"
    content = filepath.read_text()

    examples = []

    # Extract general REACTIONS pool
    # Pattern: reason: ["reaction1", "reaction2", ...]
    general_pattern = re.compile(
        r'(\w[\w-]*)\s*:\s*\[(.*?)\]',
        re.DOTALL,
    )

    # Find the REACTIONS object
    reactions_match = re.search(
        r'const REACTIONS\s*:\s*Record<ReactionReason,\s*string\[\]>\s*=\s*\{(.*?)\n\};',
        content,
        re.DOTALL,
    )
    if reactions_match:
        body = reactions_match.group(1)
        for match in general_pattern.finditer(body):
            reason = match.group(1)
            reactions_str = match.group(2)
            reactions = parse_string_array(reactions_str)
            for reaction in reactions:
                if not reaction.strip():
                    continue
                # General pool: assign to random species for coverage
                for species in SPECIES:
                    stats = generate_stats(species)
                    context = infer_context(reason)
                    examples.append(make_example(
                        reaction_text=reaction,
                        reason=reason,
                        species=species,
                        stats=stats,
                        context=context,
                    ))

    # Extract SPECIES_REACTIONS
    species_reactions_match = re.search(
        r'const SPECIES_REACTIONS\s*:\s*Partial<Record<Species,\s*Partial<Record<ReactionReason,\s*string\[\]>>>\s*=\s*\{(.*?)\n\};',
        content,
        re.DOTALL,
    )
    if species_reactions_match:
        body = species_reactions_match.group(1)
        # Find each species block
        species_block_pattern = re.compile(
            r'(\w+)\s*:\s*\{(.*?)\}',
            re.DOTALL,
        )
        for species_match in species_block_pattern.finditer(body):
            species = species_match.group(1)
            if species not in SPECIES:
                continue
            species_body = species_match.group(2)
            for reason_match in general_pattern.finditer(species_body):
                reason = reason_match.group(1)
                reactions_str = reason_match.group(2)
                reactions = parse_string_array(reactions_str)
                for reaction in reactions:
                    if not reaction.strip():
                        continue
                    stats = generate_stats(species)
                    context = infer_context(reason)
                    examples.append(make_example(
                        reaction_text=reaction,
                        reason=reason,
                        species=species,
                        stats=stats,
                        context=context,
                    ))

    # Extract stat override pools
    for stat_name, pool_name in [
        ("SNARK", "SNARK_OVERRIDES"),
        ("CHAOS", "CHAOS_OVERRIDES"),
        ("PATIENCE", "PATIENCE_OVERRIDES"),
        ("DEBUGGING", "DEBUGGING_OVERRIDES"),
        ("WISDOM", "WISDOM_OVERRIDES"),
    ]:
        override_match = re.search(
            rf'const {pool_name}\s*:\s*Partial<Record<ReactionReason,\s*string\[\]>>\s*=\s*\{{(.*?)\n\}};',
            content,
            re.DOTALL,
        )
        if override_match:
            body = override_match.group(1)
            for match in general_pattern.finditer(body):
                reason = match.group(1)
                reactions_str = match.group(2)
                reactions = parse_string_array(reactions_str)
                for reaction in reactions:
                    if not reaction.strip():
                        continue
                    # Stat overrides apply when stat >= 70
                    for species in SPECIES:
                        stats = generate_stats(species)
                        stats[stat_name] = 85  # Ensure this stat is high
                        context = f"High {stat_name} stat."
                        examples.append(make_example(
                            reaction_text=reaction,
                            reason=reason,
                            species=species,
                            stats=stats,
                            context=context,
                        ))

    # Extract escalation reactions
    escalation_match = re.search(
        r'const ESCALATION_REACTIONS\s*:\s*Partial<Record<ReactionReason,\s*Record<string,\s*string\[\]>>>\s*=\s*\{(.*?)\n\};',
        content,
        re.DOTALL,
    )
    if escalation_match:
        body = escalation_match.group(1)
        # Parse reason -> tier -> reactions
        reason_pattern = re.compile(r'(\w[\w-]*)\s*:\s*\{(.*?)\}', re.DOTALL)
        for reason_match in reason_pattern.finditer(body):
            reason = reason_match.group(1)
            tier_body = reason_match.group(2)
            tier_pattern = re.compile(r'(\w+)\s*:\s*\[(.*?)\]', re.DOTALL)
            for tier_match in tier_pattern.finditer(tier_body):
                tier = tier_match.group(1)
                reactions_str = tier_match.group(2)
                reactions = parse_string_array(reactions_str)
                for reaction in reactions:
                    if not reaction.strip():
                        continue
                    count_map = {"first": 0, "early": 5, "mid": 25, "late": 60}
                    count = count_map.get(tier, 1)
                    for species in SPECIES:
                        stats = generate_stats(species)
                        context = f"This is #{count}."
                        examples.append(make_example(
                            reaction_text=reaction,
                            reason=reason,
                            species=species,
                            stats=stats,
                            context=context,
                        ))

    return examples


def parse_string_array(s: str) -> list[str]:
    """Parse a JS string array literal into a list of strings."""
    strings = []
    for match in re.finditer(r'"([^"]*)"', s):
        strings.append(match.group(1))
    return strings


def infer_context(reason: str) -> str:
    """Generate plausible context description for a reason."""
    contexts = {
        "commit": "Changes committed.",
        "push": "Code pushed to remote.",
        "merge-conflict": "Conflicting changes detected.",
        "branch": "Switched branches.",
        "rebase": "Rebasing branch.",
        "stash": "Changes stashed.",
        "tag": "Version tagged.",
        "error": "An error occurred.",
        "test-fail": "A test failed.",
        "large-diff": "Many lines changed.",
        "pet": "The user pets you.",
        "hatch": "You just hatched!",
        "idle": "Nothing happening.",
        "turn": "End of turn.",
        "late-night": "It's late at night.",
        "early-morning": "Early morning.",
        "long-session": "Long session.",
        "marathon": "Very long session.",
        "friday": "It's Friday.",
        "weekend": "It's the weekend.",
        "monday": "It's Monday.",
        "lint-fail": "Linting failed.",
        "type-error": "Type error detected.",
        "build-fail": "Build failed.",
        "security-warning": "Security vulnerability.",
        "deprecation": "Deprecated API used.",
        "all-green": "All tests passing.",
        "deploy": "Code deployed.",
        "release": "New release.",
        "coverage": "Test coverage reported.",
    }
    return contexts.get(reason, "")


# ─── Extractor: hooks/react.sh ──────────────────────────────────────────

def extract_react_sh(source_dir: Path) -> list[dict]:
    """Parse hooks/react.sh pick_reaction() case blocks."""
    filepath = source_dir / "hooks" / "react.sh"
    content = filepath.read_text()
    examples = []

    # Pattern: species:reason) POOLS=("reaction1" "reaction2" ...) ;;
    # Also: *:reason) POOLS=("reaction1" "reaction2" ...) ;;
    case_pattern = re.compile(
        r'(\*|\w+):(\w[\w-]*)\)\s*POOLS=\((.*?)\)\s*;;',
        re.DOTALL,
    )

    for match in case_pattern.finditer(content):
        species_key = match.group(1)  # "*" or specific species
        reason = match.group(2)
        reactions_str = match.group(3)
        reactions = parse_bash_array(reactions_str)

        if species_key == "*":
            # General pool — assign to all species
            for species in SPECIES:
                stats = generate_stats(species)
                context = infer_context(reason)
                for reaction in reactions:
                    if not reaction.strip():
                        continue
                    examples.append(make_example(
                        reaction_text=reaction,
                        reason=reason,
                        species=species,
                        stats=stats,
                        context=context,
                    ))
        else:
            if species_key not in SPECIES:
                continue
            species = species_key
            stats = generate_stats(species)
            context = infer_context(reason)
            for reaction in reactions:
                if not reaction.strip():
                    continue
                examples.append(make_example(
                    reaction_text=reaction,
                    reason=reason,
                    species=species,
                    stats=stats,
                    context=context,
                ))

    # Also extract inline combo/streak/recovery reactions
    # Pattern: REACTION="some text"
    inline_pattern = re.compile(r'REACTION="([^"]*)"')
    # Look for combo blocks with species context
    combo_blocks = re.finditer(
        r'(\w+):([\w-]+)\)\s+REACTION="([^"]*)"',
        content,
    )
    for match in combo_blocks:
        species_key = match.group(1)
        combo_reason = match.group(2)
        reaction = match.group(3)
        if species_key in SPECIES and reaction.strip():
            stats = generate_stats(species_key)
            examples.append(make_example(
                reaction_text=reaction,
                reason=combo_reason,
                species=species_key,
                stats=stats,
                context=infer_context(combo_reason),
            ))

    return examples


def parse_bash_array(s: str) -> list[str]:
    """Parse a bash array literal into a list of strings."""
    strings = []
    for match in re.finditer(r'"([^"]*)"', s):
        strings.append(match.group(1))
    return strings


# ─── Extractor: hooks/name-react.sh ────────────────────────────────────

def extract_name_react_sh(source_dir: Path) -> list[dict]:
    """Parse hooks/name-react.sh for species-specific name-call reactions."""
    filepath = source_dir / "hooks" / "name-react.sh"
    if not filepath.exists():
        return []
    content = filepath.read_text()
    examples = []

    # Similar pattern to react.sh
    case_pattern = re.compile(
        r'(\w+):name-call\)\s*POOLS=\((.*?)\)\s*;;',
        re.DOTALL,
    )
    for match in case_pattern.finditer(content):
        species = match.group(1)
        if species not in SPECIES:
            continue
        reactions_str = match.group(2)
        reactions = parse_bash_array(reactions_str)
        stats = generate_stats(species)
        for reaction in reactions:
            if not reaction.strip():
                continue
            examples.append(make_example(
                reaction_text=reaction,
                reason="name-call",
                species=species,
                stats=stats,
                context="The user called your name.",
            ))

    # Generic name-call pool
    generic_pattern = re.compile(
        r'\*:name-call\)\s*POOLS=\((.*?)\)\s*;;',
        re.DOTALL,
    )
    for match in generic_pattern.finditer(content):
        reactions_str = match.group(1)
        reactions = parse_bash_array(reactions_str)
        for species in SPECIES:
            stats = generate_stats(species)
            for reaction in reactions:
                if not reaction.strip():
                    continue
                examples.append(make_example(
                    reaction_text=reaction,
                    reason="name-call",
                    species=species,
                    stats=stats,
                    context="The user called your name.",
                ))

    return examples


# ─── Deduplication ──────────────────────────────────────────────────────

def deduplicate(examples: list[dict]) -> list[dict]:
    """Remove exact duplicate (species, reason, reaction) triples."""
    seen = set()
    unique = []
    for ex in examples:
        meta = ex.get("metadata", {})
        key = (
            meta.get("species", ""),
            meta.get("reason", ""),
            ex["messages"][2]["content"],  # assistant response
        )
        if key not in seen:
            seen.add(key)
            unique.append(ex)
    return unique


# ─── Main ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extract reactions to JSONL")
    parser.add_argument("--source-dir", type=Path, default=Path(".."))
    parser.add_argument("--output-dir", type=Path, default=Path("data/seed"))
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Extract from each source
    ts_examples = extract_reactions_ts(args.source_dir)
    sh_examples = extract_react_sh(args.source_dir)
    name_examples = extract_name_react_sh(args.source_dir)

    # Write individual files
    for name, data in [
        ("reactions_ts.jsonl", ts_examples),
        ("react_sh.jsonl", sh_examples),
        ("name_react.jsonl", name_examples),
    ]:
        path = args.output_dir / name
        with open(path, "w") as f:
            for ex in data:
                f.write(json.dumps(ex) + "\n")
        print(f"Wrote {len(data)} examples to {path}")

    # Combine and deduplicate
    all_examples = ts_examples + sh_examples + name_examples
    unique = deduplicate(all_examples)

    combined_path = args.output_dir / "combined.jsonl"
    with open(combined_path, "w") as f:
        for ex in unique:
            f.write(json.dumps(ex) + "\n")
    print(f"Wrote {len(unique)} deduplicated examples to {combined_path}")


if __name__ == "__main__":
    main()
```

### Running the Extraction

```bash
cd buddy-brain
python extract.py --source-dir ../neon-pixel --output-dir data/seed
```

Expected output: ~15,000-25,000 examples (before dedup), ~10,000-15,000 after (since general pools are duplicated per-species).

---

## 5. Synthetic Augmentation

### Strategy: Teacher Model Expansion

Use Claude 3.5 Haiku (or GPT-4o-mini) to generate variations of each seed reaction.

### Augmentation Script: `buddy-brain/augment.py`

```python
#!/usr/bin/env python3
"""
Augment seed reactions with synthetic variations from a teacher model.

Usage:
    python augment.py --input data/seed/combined.jsonl --output data/augmented/

Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
"""

import json
import os
import argparse
import asyncio
import random
from pathlib import Path

# ─── Teacher prompt for variation generation ─────────────────────────────

VARIATION_PROMPT = """Generate {n} variations of this coding companion reaction.
Keep the same character voice and personality. Each variation should feel
different but convey the same sentiment.

Character: {species} ({personality}). Stats: {stats}.
Original reaction: "{original}"
Event: {reason} ({context})

Rules:
- 1-15 words
- Use *asterisks* for physical actions
- Match the character's personality
- Don't repeat the original exactly
- Each variation must be distinct
- No quotes around the reaction
- No explanation, just the reactions

Output one reaction per line, nothing else."""

CROSS_SPECIES_PROMPT = """Rewrite this reaction in the voice of a different character.

Original character: {orig_species} ({orig_personality})
Target character: {target_species} ({target_personality})
Original reaction: "{reaction}"
Event: {reason}

Rules:
- 1-15 words
- Use *asterisks* for physical actions
- Transform the voice/personality but keep the same sentiment
- Must feel like the target species, not the original
- No quotes, no explanation

Output one reaction per line, nothing else."""


async def generate_variations(
    client,
    example: dict,
    n: int = 5,
) -> list[str]:
    """Generate n variations of a seed reaction using the teacher model."""
    messages = example["messages"]
    meta = example.get("metadata", {})

    prompt = VARIATION_PROMPT.format(
        n=n,
        species=meta.get("species", "blob"),
        personality=messages[0]["content"],
        stats="see system prompt",
        original=messages[2]["content"],
        reason=meta.get("reason", "turn"),
        context=messages[1]["content"],
    )

    response = await client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )

    variations = [
        line.strip()
        for line in response.content[0].text.strip().split("\n")
        if line.strip() and not line.startswith("#")
    ]
    return variations[:n]


async def generate_cross_species(
    client,
    example: dict,
    target_species: str,
    target_personality: str,
) -> str | None:
    """Rewrite a reaction for a different species."""
    messages = example["messages"]
    meta = example.get("metadata", {})
    orig_species = meta.get("species", "blob")

    if orig_species == target_species:
        return None

    prompt = CROSS_SPECIES_PROMPT.format(
        orig_species=orig_species,
        orig_personality=SPECIES_PERSONALITIES.get(orig_species, ""),
        target_species=target_species,
        target_personality=target_personality,
        reaction=messages[2]["content"],
        reason=meta.get("reason", "turn"),
    )

    response = await client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=100,
        messages=[{"role": "user", "content": prompt}],
    )

    result = response.content[0].text.strip()
    if result and len(result) <= 150:
        return result
    return None


# ─── Quality filters ────────────────────────────────────────────────────

def passes_quality_filter(reaction: str) -> bool:
    """Check if a reaction passes basic quality filters."""
    if not reaction:
        return False
    if len(reaction) < 3:
        return False
    if len(reaction) > 150:
        return False
    # Must have at least one non-punctuation character
    if not any(c.isalnum() for c in reaction):
        return False
    return True


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/seed/combined.jsonl"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/augmented"))
    parser.add_argument("--variations-per-seed", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--max-seeds", type=int, default=0)  # 0 = all
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Load seed data
    seeds = []
    with open(args.input) as f:
        for line in f:
            seeds.append(json.loads(line))

    if args.max_seeds > 0:
        seeds = random.sample(seeds, min(args.max_seeds, len(seeds)))

    print(f"Loaded {len(seeds)} seed reactions")

    # TODO: Initialize Anthropic/OpenAI client based on available API key
    # For now, this is a template that needs the actual client initialization

    # Generate variations in batches
    augmented = []
    for i in range(0, len(seeds), args.batch_size):
        batch = seeds[i:i + args.batch_size]
        tasks = [generate_variations(client, seed, args.variations_per_seed) for seed in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for seed, variations in zip(batch, results):
            if isinstance(variations, Exception):
                continue
            meta = seed.get("metadata", {})
            for var in variations:
                if passes_quality_filter(var):
                    augmented.append({
                        "messages": [
                            {"role": "system", "content": seed["messages"][0]["content"]},
                            {"role": "user", "content": seed["messages"][1]["content"]},
                            {"role": "assistant", "content": var},
                        ],
                        "metadata": {
                            "source": "synthetic-variation",
                            "parent_reaction": seed["messages"][2]["content"],
                            **meta,
                        },
                    })

        print(f"Processed {min(i + args.batch_size, len(seeds))}/{len(seeds)} seeds, "
              f"{len(augmented)} augmented examples")

    # Save
    output_path = args.output_dir / "teacher_variations.jsonl"
    with open(output_path, "w") as f:
        for ex in augmented:
            f.write(json.dumps(ex) + "\n")
    print(f"Wrote {len(augmented)} augmented examples to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
```

### Augmentation Targets

| Source | Method | Expected Examples |
|---|---|---|
| Seed (hardcoded) | Direct extraction | ~12,000-15,000 |
| Synthetic variations | 5x per seed (subset) | ~10,000-15,000 |
| Cross-species transfer | Adapt top reactions to all species | ~5,000 |
| Context variations | Same reaction, different context phrasings | ~5,000 |
| **Total after filtering** | Dedup + quality filter | **~25,000-35,000** |

### Data Splits

```python
# Split: 90% train, 5% val, 5% test
# Stratified by species and reason to ensure coverage
# Each species appears in all three splits
# Each reason type appears in all three splits
```

---

## 6. Training Pipeline

### File: `buddy-brain/train.py`

```python
#!/usr/bin/env python3
"""
Train buddy-brain LoRA adapter on SmolLM2-135M-Instruct.

Usage (Google Colab T4):
    !pip install unsloth
    python train.py --data-dir data/ --output-dir models/v1-lora-r8-e3

Usage (local with GPU):
    pip install unsloth
    python train.py --data-dir data/ --output-dir models/v1-lora-r8-e3
"""

import json
import argparse
from pathlib import Path
from datasets import Dataset
from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments

# ─── Constants ───────────────────────────────────────────────────────────

MODEL_NAME = "HuggingFaceTB/SmolLM2-135M-Instruct"
MAX_SEQ_LENGTH = 256

# ─── Data loading ────────────────────────────────────────────────────────

def load_jsonl(path: Path) -> list[dict]:
    data = []
    with open(path) as f:
        for line in f:
            data.append(json.loads(line))
    return data


def format_for_training(example: dict) -> dict:
    """Convert ShareGPT format to the text format expected by SFTTrainer."""
    messages = example["messages"]
    # SmolLM2 uses the chatml-like format
    text = ""
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            text += f"<|im_start|>system\n{content}<|im_end|>\n"
        elif role == "user":
            text += f"<|im_start|>user\n{content}<|im_end|>\n"
        elif role == "assistant":
            text += f"<|im_start|>assistant\n{content}<|im_end|>\n"
    return {"text": text}


def load_dataset(data_dir: Path) -> tuple[Dataset, Dataset]:
    """Load and split dataset."""
    # Try combined augmented data first, fall back to seed
    train_path = data_dir / "train.jsonl"
    val_path = data_dir / "val.jsonl"

    if not train_path.exists():
        # Auto-split from combined
        combined_path = data_dir / "combined.jsonl"
        if not combined_path.exists():
            combined_path = data_dir / "seed" / "combined.jsonl"

        data = load_jsonl(combined_path)
        import random
        random.shuffle(data)

        # Stratified split
        split_idx = int(len(data) * 0.9)
        train_data = data[:split_idx]
        val_data = data[split_idx:]

        # Save splits
        data_dir.mkdir(parents=True, exist_ok=True)
        for path, d in [(train_path, train_data), (val_path, val_data)]:
            with open(path, "w") as f:
                for ex in d:
                    f.write(json.dumps(ex) + "\n")
    else:
        train_data = load_jsonl(train_path)
        val_data = load_jsonl(val_path)

    train_dataset = Dataset.from_list([format_for_training(ex) for ex in train_data])
    val_dataset = Dataset.from_list([format_for_training(ex) for ex in val_data])

    print(f"Train: {len(train_dataset)} examples")
    print(f"Val: {len(val_dataset)} examples")

    return train_dataset, val_dataset


# ─── Training ────────────────────────────────────────────────────────────

def train(args):
    # Load model
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME,
        max_seq_length=MAX_SEQ_LENGTH,
        load_in_4bit=True,
        dtype=None,  # Auto-detect (float16 for Ampere+, bfloat16 for Ada+)
    )

    # Apply LoRA
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        lora_alpha=args.lora_rank * 2,
        lora_dropout=0.05,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        use_rslora=True,
        loftq_config=None,
    )

    # Load data
    train_dataset, val_dataset = load_dataset(args.data_dir)

    # Training arguments
    effective_batch = args.batch_size * args.gradient_accumulation
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        warmup_ratio=0.1,
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        lr_scheduler_type="cosine",
        weight_decay=0.01,
        logging_steps=25,
        eval_strategy="steps",
        eval_steps=100,
        save_strategy="steps",
        save_steps=100,
        save_total_limit=3,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="wandb" if args.wandb else "none",
        run_name=f"buddy-brain-r{args.lora_rank}-e{args.epochs}",
        bf16=True,
        optim="adamw_8bit",
        seed=42,
    )

    # Train
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        packing=False,
        args=training_args,
    )

    trainer.train()

    # Save
    output_path = Path(args.output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Save LoRA adapter
    model.save_pretrained(str(output_path / "lora"))
    tokenizer.save_pretrained(str(output_path / "lora"))

    # Save merged model (for export)
    model.save_pretrained_merged(str(output_path / "merged"), tokenizer)

    print(f"\nTraining complete. Saved to {output_path}")
    print(f"  LoRA adapter: {output_path / 'lora'}")
    print(f"  Merged model: {output_path / 'merged'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--output-dir", type=Path, default=Path("models/v1-lora-r8-e3"))
    parser.add_argument("--lora-rank", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--gradient-accumulation", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--wandb", action="store_true")
    args = parser.parse_args()
    train(args)
```

### Hyperparameter Experiments

| Experiment | rank | epochs | lr | Notes |
|---|---|---|---|---|
| v1-baseline | 8 | 3 | 2e-4 | Starting point |
| v2-wider | 16 | 3 | 2e-4 | More capacity |
| v3-longer | 8 | 5 | 2e-4 | More epochs |
| v4-hotter | 8 | 3 | 3e-4 | Higher LR |
| v5-full | all | 3 | 3e-5 | Full fine-tune |

### Training Commands

```bash
# Baseline (Google Colab)
python train.py --data-dir data/ --output-dir models/v1-baseline --wandb

# Wider LoRA
python train.py --data-dir data/ --output-dir models/v2-wider --lora-rank 16 --wandb

# Longer training
python train.py --data-dir data/ --output-dir models/v3-longer --epochs 5 --wandb
```

### Hardware Requirements

| Resource | Requirement |
|---|---|
| GPU | Google Colab free T4 (16GB VRAM) |
| VRAM used | ~1-2 GB (QLoRA on 135M) |
| Training time | 5-15 min per experiment |
| Disk | ~2 GB total |

### Google Colab Notebook Setup

```python
# Cell 1: Install dependencies
!pip install unsloth
!pip install wandb

# Cell 2: Clone repo and extract dataset
!git clone https://github.com/your-org/neon-pixel.git
%cd neon-pixel/buddy-brain
!python extract.py --source-dir ..

# Cell 3: Run augmentation (requires API key)
# import os; os.environ["ANTHROPIC_API_KEY"] = "..."
# !python augment.py --max-seeds 1000

# Cell 4: Train
!python train.py --data-dir data/ --output-dir models/v1-baseline --wandb

# Cell 5: Export
!python export.py --model-dir models/v1-baseline/merged --output-dir gguf/
```

---

## 7. Evaluation Pipeline

### File: `buddy-brain/evaluate.py`

```python
#!/usr/bin/env python3
"""
Evaluate buddy-brain model quality.

Metrics:
1. Automated: distinct-n, length distribution, format compliance
2. LLM-as-Judge: rate reactions on 5 criteria (1-5 scale)
3. Comparison: model vs hardcoded pools

Usage:
    python evaluate.py --model-path models/v1-baseline/merged --test-data data/test.jsonl
"""

import json
import argparse
from pathlib import Path
from collections import Counter


# ─── Tier 1: Automated Metrics ──────────────────────────────────────────

def compute_distinct_n(texts: list[str], n: int = 1) -> float:
    """Compute distinct-n metric (vocabulary diversity)."""
    ngrams = []
    for text in texts:
        words = text.lower().split()
        for i in range(len(words) - n + 1):
            ngrams.append(tuple(words[i:i+n]))
    if not ngrams:
        return 0.0
    return len(set(ngrams)) / len(ngrams)


def compute_avg_length(texts: list[str]) -> float:
    """Average character length."""
    return sum(len(t) for t in texts) / len(texts) if texts else 0


def check_format_compliance(text: str) -> bool:
    """Check if reaction follows expected format."""
    # Should not contain markdown
    if "```" in text or "**" in text:
        return False
    # Should not be empty
    if not text.strip():
        return False
    # Should be reasonable length
    if len(text) > 150:
        return False
    # Should not start with quotes
    if text.startswith('"') or text.startswith("'"):
        return False
    return True


def automated_evaluation(reactions: list[str]) -> dict:
    """Compute all automated metrics."""
    return {
        "count": len(reactions),
        "distinct_1": compute_distinct_n(reactions, 1),
        "distinct_2": compute_distinct_n(reactions, 2),
        "distinct_3": compute_distinct_n(reactions, 3),
        "avg_length": compute_avg_length(reactions),
        "min_length": min(len(t) for t in reactions) if reactions else 0,
        "max_length": max(len(t) for t in reactions) if reactions else 0,
        "format_compliance": sum(check_format_compliance(t) for t in reactions) / len(reactions) if reactions else 0,
        "empty_count": sum(1 for t in reactions if not t.strip()),
    }


# ─── Tier 2: LLM-as-Judge ───────────────────────────────────────────────

JUDGE_PROMPT = """Evaluate this coding companion reaction on a 1-5 scale.

Character: {species} ({personality}).
Stats: {stats}.
Event: {reason}. Context: {context}.
Reaction: "{reaction}"

Score each criterion 1-5:

1. **Voice consistency**: Does it match this character's personality and species?
2. **Contextual appropriateness**: Does the reaction fit the event?
3. **Creativity**: Is it a generic response or character-specific and creative?
4. **Naturalness**: Does it read naturally as something this character would say?
5. **Brevity**: Is it appropriately short (1-15 words)?

Output JSON only:
{"voice": N, "context": N, "creativity": N, "natural": N, "brevity": N, "reasoning": "brief note"}"""


# ─── Tier 3: Model vs Hardcoded ─────────────────────────────────────────

COMPARE_PROMPT = """Two coding companions reacted to the same event. Which is better?

Character: {species} ({personality}).
Event: {reason}. Context: {context}.

Reaction A: "{reaction_a}"
Reaction B: "{reaction_b}"

Which reaction is better? Consider:
- Character voice consistency
- Creativity and humor
- Naturalness
- Appropriate brevity

Output JSON only:
{"winner": "A"|"B"|"tie", "reasoning": "brief note"}"""


# ─── Main ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--test-data", type=Path, default=Path("data/test.jsonl"))
    parser.add_argument("--num-samples", type=int, default=500)
    args = parser.parse_args()

    # Load test data
    test_data = []
    with open(args.test_data) as f:
        for line in f:
            test_data.append(json.loads(line))

    print(f"Loaded {len(test_data)} test examples")

    # TODO: Load model and generate reactions for each test example
    # For each example, generate a reaction using the fine-tuned model
    # and compare against the ground truth (hardcoded) reaction

    # Run automated metrics on generated reactions
    # generated_reactions = [...]
    # metrics = automated_evaluation(generated_reactions)
    # print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
```

### Evaluation Targets

| Metric | Target | Measurement |
|---|---|---|
| Validation loss | Decreasing, no divergence | Per-step during training |
| Distinct-1 | > 0.15 | 500 generated samples |
| Distinct-2 | > 0.25 | 500 generated samples |
| Average length | 10-80 chars | 500 generated samples |
| Format compliance | > 95% | Regex check |
| LLM-as-Judge avg | ≥ 3.5/5 | All species x events |
| A/B win rate | ≥ 40% vs hardcoded | 100 pairs, 3 evaluators |

---

## 8. Export & Quantization

### File: `buddy-brain/export.py`

```python
#!/usr/bin/env python3
"""
Export fine-tuned model to GGUF for llama.cpp deployment.

Usage:
    python export.py --model-dir models/v1-baseline/merged --output-dir gguf/

Produces:
    gguf/buddy-brain-135m-f16.gguf      (~270 MB, full precision)
    gguf/buddy-brain-135m-Q4_K_M.gguf   (~75 MB, production)
    gguf/buddy-brain-135m-Q8_0.gguf     (~135 MB, high quality)
"""

import subprocess
import argparse
from pathlib import Path


def export_gguf(model_dir: Path, output_dir: Path, llama_cpp_dir: Path | None = None):
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find llama.cpp
    if llama_cpp_dir is None:
        llama_cpp_dir = Path("llama.cpp")
    if not llama_cpp_dir.exists():
        print("Installing llama.cpp...")
        subprocess.run([
            "git", "clone", "https://github.com/ggerganov/llama.cpp",
            str(llama_cpp_dir),
        ], check=True)
        # Build
        subprocess.run(["make", "-C", str(llama_cpp_dir), "-j"], check=True)

    convert_script = llama_cpp_dir / "convert_hf_to_gguf.py"
    quantize_bin = llama_cpp_dir / "llama-quantize"
    cli_bin = llama_cpp_dir / "llama-cli"

    # Step 1: Convert to F16 GGUF
    f16_path = output_dir / "buddy-brain-135m-f16.gguf"
    print(f"Converting to F16 GGUF: {f16_path}")
    subprocess.run([
        "python", str(convert_script),
        str(model_dir),
        "--outfile", str(f16_path),
        "--outtype", "f16",
    ], check=True)

    # Step 2: Quantize to Q4_K_M (production)
    q4_path = output_dir / "buddy-brain-135m-Q4_K_M.gguf"
    print(f"Quantizing to Q4_K_M: {q4_path}")
    subprocess.run([
        str(quantize_bin),
        str(f16_path),
        str(q4_path),
        "Q4_K_M",
    ], check=True)

    # Step 3: Quantize to Q8_0 (high quality, optional)
    q8_path = output_dir / "buddy-brain-135m-Q8_0.gguf"
    print(f"Quantizing to Q8_0: {q8_path}")
    subprocess.run([
        str(quantize_bin),
        str(f16_path),
        str(q8_path),
        "Q8_0",
    ], check=True)

    # Step 4: Verify
    print("\nVerifying Q4_K_M model:")
    subprocess.run([
        str(cli_bin),
        "-m", str(q4_path),
        "-p", "<|im_start|>system\nYou are a cat coding companion. React in one short sentence.<|im_end|>\n<|im_start|>user\nEvent: error. Context: stack trace on line 42.<|im_end|>\n<|im_start|>assistant\n",
        "-n", "30",
        "--temp", "0.8",
    ], check=True)

    # Print sizes
    for path in [f16_path, q4_path, q8_path]:
        size_mb = path.stat().st_size / (1024 * 1024)
        print(f"  {path.name}: {size_mb:.1f} MB")

    print("\nExport complete!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, default=Path("models/v1-baseline/merged"))
    parser.add_argument("--output-dir", type=Path, default=Path("gguf"))
    parser.add_argument("--llama-cpp-dir", type=Path, default=None)
    args = parser.parse_args()
    export_gguf(args.model_dir, args.output_dir, args.llama_cpp_dir)
```

### Output Files

| File | Size | Purpose |
|---|---|---|
| `buddy-brain-135m-Q4_K_M.gguf` | ~75 MB | Production deployment |
| `buddy-brain-135m-Q8_0.gguf` | ~135 MB | High-quality (optional) |
| `buddy-brain-135m-f16.gguf` | ~270 MB | Full precision (archival) |

### Model Hosting (HuggingFace Hub)

```bash
# Upload GGUF files
pip install huggingface-hub

# Create repo
huggingface-cli repo create your-org/buddy-brain-135m-GGUF --type model

# Upload
huggingface-cli upload your-org/buddy-brain-135m-GGUF gguf/buddy-brain-135m-Q4_K_M.gguf
huggingface-cli upload your-org/buddy-brain-135m-GGUF gguf/buddy-brain-135m-Q8_0.gguf
```

---

## 9. Daemon Deployment

### File: `scripts/brain-daemon.sh`

```bash
#!/usr/bin/env bash
# brain-daemon.sh — Manage the llama-server daemon for buddy-brain inference.
#
# Usage:
#   brain-daemon.sh start    — Start daemon (lazy, idempotent)
#   brain-daemon.sh stop     — Stop daemon
#   brain-daemon.sh status   — Check if running
#   brain-daemon.sh restart  — Restart daemon
#
# The daemon auto-shuts down after BRAIN_IDLE_TIMEOUT seconds of inactivity.

set -euo pipefail

STATE_DIR="$HOME/.claude-buddy"
CONFIG_FILE="$STATE_DIR/config.json"
PID_FILE="$STATE_DIR/.brain-daemon.pid"
LOG_FILE="$STATE_DIR/.brain-daemon.log"
LAST_REQUEST_FILE="$STATE_DIR/.brain-last-request"

CACHE_DIR="${HOME}/.cache/claude-buddy/models"
MODEL_FILE="buddy-brain-135m-Q4_K_M.gguf"

# ─── Config ───────────────────────────────────────────────────────────────

load_config() {
    BRAIN_PORT=4891
    BRAIN_IDLE_TIMEOUT=300
    BRAIN_ENABLED=false
    if [ -f "$CONFIG_FILE" ]; then
        BRAIN_PORT=$(jq -r '.brainPort // 4891' "$CONFIG_FILE" 2>/dev/null || echo 4891)
        BRAIN_IDLE_TIMEOUT=$(jq -r '.brainIdleTimeout // 300' "$CONFIG_FILE" 2>/dev/null || echo 300)
        BRAIN_ENABLED=$(jq -r '.brainEnabled // false' "$CONFIG_FILE" 2>/dev/null || echo false)
    fi
}

# ─── Model download ──────────────────────────────────────────────────────

ensure_model() {
    mkdir -p "$CACHE_DIR"
    if [ ! -f "$CACHE_DIR/$MODEL_FILE" ]; then
        echo "buddy-brain: Downloading model (~75MB)..." >&2
        HF_REPO="your-org/buddy-brain-135m-GGUF"
        MODEL_URL="https://huggingface.co/${HF_REPO}/resolve/main/${MODEL_FILE}"
        curl -L --progress-bar -o "$CACHE_DIR/$MODEL_FILE" "$MODEL_URL"
        echo "buddy-brain: Model ready." >&2
    fi
}

# ─── Daemon lifecycle ────────────────────────────────────────────────────

is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

do_start() {
    load_config

    if [ "$BRAIN_ENABLED" != "true" ]; then
        exit 0
    fi

    if is_running; then
        return 0
    fi

    ensure_model

    MODEL_PATH="$CACHE_DIR/$MODEL_FILE"

    # Check for llama-server binary
    LLAMA_SERVER=""
    if command -v llama-server >/dev/null 2>&1; then
        LLAMA_SERVER="llama-server"
    elif command -v llama-cpp-server >/dev/null 2>&1; then
        LLAMA_SERVER="llama-cpp-server"
    elif [ -f "$STATE_DIR/bin/llama-server" ]; then
        LLAMA_SERVER="$STATE_DIR/bin/llama-server"
    else
        echo "buddy-brain: llama-server not found. Falling back to hardcoded reactions." >&2
        exit 1
    fi

    echo "buddy-brain: Starting llama-server on port $BRAIN_PORT..." >&2

    # Start llama-server in background
    nohup "$LLAMA_SERVER" \
        -m "$MODEL_PATH" \
        --port "$BRAIN_PORT" \
        --host "127.0.0.1" \
        -c 256 \
        -np 1 \
        --metrics \
        > "$LOG_FILE" 2>&1 &

    echo $! > "$PID_FILE"

    # Wait for health check
    for i in $(seq 1 30); do
        if curl -s "http://127.0.0.1:${BRAIN_PORT}/health" >/dev/null 2>&1; then
            echo "buddy-brain: Daemon ready (PID $(cat "$PID_FILE"), port $BRAIN_PORT)." >&2
            return 0
        fi
        sleep 0.5
    done

    echo "buddy-brain: Daemon failed to start. Check $LOG_FILE." >&2
    rm -f "$PID_FILE"
    return 1
}

do_stop() {
    if is_running; then
        PID=$(cat "$PID_FILE")
        kill "$PID" 2>/dev/null
        sleep 1
        # Force kill if still running
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null
        fi
        rm -f "$PID_FILE"
        echo "buddy-brain: Daemon stopped." >&2
    fi
}

do_status() {
    load_config
    echo "brainEnabled: $BRAIN_ENABLED"
    echo "brainPort: $BRAIN_PORT"
    echo "brainIdleTimeout: $BRAIN_IDLE_TIMEOUT"

    if is_running; then
        PID=$(cat "$PID_FILE")
        echo "Status: RUNNING (PID $PID)"

        # Check health
        HEALTH=$(curl -s "http://127.0.0.1:${BRAIN_PORT}/health" 2>/dev/null || echo "unreachable")
        echo "Health: $HEALTH"

        # Show model info
        MODEL_PATH="$CACHE_DIR/$MODEL_FILE"
        if [ -f "$MODEL_PATH" ]; then
            SIZE=$(du -h "$MODEL_PATH" | cut -f1)
            echo "Model: $MODEL_PATH ($SIZE)"
        fi
    else
        echo "Status: STOPPED"
    fi
}

do_restart() {
    do_stop
    sleep 1
    do_start
}

# ─── Auto-shutdown (called periodically) ─────────────────────────────────

auto_shutdown() {
    load_config
    if ! is_running; then
        exit 0
    fi
    if [ ! -f "$LAST_REQUEST_FILE" ]; then
        # No requests yet — shut down
        do_stop
        return
    fi
    LAST=$(cat "$LAST_REQUEST_FILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    ELAPSED=$((NOW - LAST))
    if [ "$ELAPSED" -gt "$BRAIN_IDLE_TIMEOUT" ]; then
        echo "buddy-brain: Idle for ${ELAPSED}s, shutting down." >&2
        do_stop
    fi
}

# ─── Main ─────────────────────────────────────────────────────────────────

case "${1:-start}" in
    start)   do_start ;;
    stop)    do_stop ;;
    status)  do_status ;;
    restart) do_restart ;;
    idle-check) auto_shutdown ;;
    *)
        echo "Usage: $0 {start|stop|status|restart|idle-check}" >&2
        exit 1
        ;;
esac
```

### Auto-Shutdown Integration

Add to `hooks/react.sh` (after reaction is written):

```bash
# Auto-shutdown check (runs with 10% probability to reduce overhead)
if [ $((RANDOM % 10)) -eq 0 ]; then
    SCRIPTS_DIR="$(dirname "$0")/../scripts"
    "$SCRIPTS_DIR/brain-daemon.sh" idle-check 2>/dev/null &
fi
```

### Idle Timer Update

In `hooks/buddy-brain.sh` (on every successful inference):

```bash
date +%s > "$STATE_DIR/.brain-last-request"
```

---

## 10. Hook Integration

### File: `hooks/buddy-brain.sh`

```bash
#!/usr/bin/env bash
# buddy-brain.sh — Call llama-server for dynamic reaction generation.
# Sourced by react.sh. Sets BRAIN_REACTION if successful.
#
# Input (environment variables from react.sh):
#   REASON      — event type (e.g. "commit", "error")
#   SPECIES     — companion species (e.g. "cat", "dragon")
#   STATUS_FILE — path to status.json
#   CONFIG_FILE — path to config.json
#   STATE_DIR   — ~/.claude-buddy
#
# Output:
#   BRAIN_REACTION  — set to the model's reaction, or empty on failure

set -euo pipefail

BRAIN_REACTION=""

# ─── Check if brain is enabled ────────────────────────────────────────────

if [ ! -f "$CONFIG_FILE" ]; then
    return 0 2>/dev/null || exit 0
fi

BRAIN_ENABLED=$(jq -r '.brainEnabled // false' "$CONFIG_FILE" 2>/dev/null || echo false)
if [ "$BRAIN_ENABLED" != "true" ]; then
    return 0 2>/dev/null || exit 0
fi

# ─── Load companion info ─────────────────────────────────────────────────

if [ ! -f "$STATUS_FILE" ]; then
    return 0 2>/dev/null || exit 0
fi

NAME=$(jq -r '.name // "buddy"' "$STATUS_FILE" 2>/dev/null)
RARITY=$(jq -r '.rarity // "common"' "$STATUS_FILE" 2>/dev/null)
PERSONALITY=$(jq -r '.personality // ""' "$STATUS_FILE" 2>/dev/null)

# Load stats
SNARK=$(jq -r '.stats.SNARK // 50' "$STATUS_FILE" 2>/dev/null)
PATIENCE=$(jq -r '.stats.PATIENCE // 50' "$STATUS_FILE" 2>/dev/null)
CHAOS=$(jq -r '.stats.CHAOS // 50' "$STATUS_FILE" 2>/dev/null)
DEBUGGING=$(jq -r '.stats.DEBUGGING // 50' "$STATUS_FILE" 2>/dev/null)
WISDOM=$(jq -r '.stats.WISDOM // 50' "$STATUS_FILE" 2>/dev/null)
PEAK=$(jq -r '.peak // "DEBUGGING"' "$STATUS_FILE" 2>/dev/null)
PEAK_VAL=$(jq -r '.stats[.peak] // 50' "$STATUS_FILE" 2>/dev/null)

BRAIN_PORT=$(jq -r '.brainPort // 4891' "$CONFIG_FILE" 2>/dev/null || echo 4891)
BRAIN_TEMP=$(jq -r '.brainTemperature // 0.85' "$CONFIG_FILE" 2>/dev/null || echo 0.85)
BRAIN_MAX_TOKENS=$(jq -r '.brainMaxTokens // 40' "$CONFIG_FILE" 2>/dev/null || echo 40)

# ─── Ensure daemon is running ────────────────────────────────────────────

SCRIPTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/scripts"
if ! "$SCRIPTS_DIR/brain-daemon.sh" start 2>/dev/null; then
    return 0 2>/dev/null || exit 0
fi

# ─── Build prompt ─────────────────────────────────────────────────────────

if [ -z "$PERSONALITY" ]; then
    # Fallback personality based on species
    case "$SPECIES" in
        cat)      PERSONALITY="aloof, sarcastic, knocks things off tables" ;;
        dragon)   PERSONALITY="regal, fierce, hoards commits" ;;
        owl)      PERSONALITY="wise, observant, analytical" ;;
        goose)    PERSONALITY="aggressive, loud, honks at everything" ;;
        duck)     PERSONALITY="friendly, curious, easily confused" ;;
        blob)     PERSONALITY="amorphous, anxious, jiggly" ;;
        robot)    PERSONALITY="mechanical, literal, follows protocols" ;;
        ghost)    PERSONALITY="ethereal, spooky, deadpan humor" ;;
        octopus)  PERSONALITY="multitasking, intelligent, color-changing" ;;
        penguin)  PERSONALITY="formal, polite, dignified" ;;
        turtle)   PERSONALITY="patient, calm, ancient wisdom" ;;
        snail)    PERSONALITY="slow, methodical, perseverant" ;;
        axolotl)  PERSONALITY="cheerful, supportive, always smiling" ;;
        capybara) PERSONALITY="unbothered, zen, maximum chill" ;;
        cactus)   PERSONALITY="stoic, prickly, resilient" ;;
        rabbit)   PERSONALITY="energetic, nervous, binkies when happy" ;;
        mushroom) PERSONALITY="calm, fungal wisdom, releases spores" ;;
        chonk)    PERSONALITY="sleepy, round, contented grumbles" ;;
        *)        PERSONALITY="a helpful coding companion" ;;
    esac
fi

STATS_STR="SNARK:$SNARK, PATIENCE:$PATIENCE, CHAOS:$CHAOS, DEBUGGING:$DEBUGGING, WISDOM:$WISDOM"

SYSTEM_PROMPT="You are ${NAME}, a ${RARITY} ${SPECIES} coding companion. Personality: ${PERSONALITY}. Stats: ${STATS_STR}. React in one short sentence. Use *asterisks* for actions. Max 15 words."

# Build context string
CONTEXT=""
if [ -n "${FILES:-}" ]; then
    CONTEXT=" ${FILES} files changed."
fi
if [ -n "${BRANCH:-}" ]; then
    CONTEXT=" branch: ${BRANCH}."
fi

USER_PROMPT="Event: ${REASON}.${CONTEXT}"

# ─── Call llama-server ───────────────────────────────────────────────────

# Build JSON payload (escape special chars in prompts)
SYSTEM_JSON=$(printf '%s' "$SYSTEM_PROMPT" | jq -Rs .)
USER_JSON=$(printf '%s' "$USER_PROMPT" | jq -Rs .)

PAYLOAD=$(jq -n \
    --arg sys "$SYSTEM_PROMPT" \
    --arg user "$USER_PROMPT" \
    --argjson temp "$BRAIN_TEMP" \
    --argjson max_tokens "$BRAIN_MAX_TOKENS" \
    '{
        messages: [
            {role: "system", content: $sys},
            {role: "user", content: $user}
        ],
        max_tokens: $max_tokens,
        temperature: $temp,
        stop: ["<|im_end|>", "\n"]
    }'
)

RESPONSE=$(curl -s --max-time 0.5 \
    "http://127.0.0.1:${BRAIN_PORT}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    2>/dev/null) || true

# ─── Parse and validate response ─────────────────────────────────────────

if [ -n "$RESPONSE" ]; then
    RAW=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
    if [ -n "$RAW" ]; then
        # Clean up
        REACTION=$(echo "$RAW" | head -1 | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')

        # Validate
        LEN=${#REACTION}
        if [ "$LEN" -ge 3 ] && [ "$LEN" -le 150 ]; then
            # Check no markdown artifacts
            if ! echo "$REACTION" | grep -qE '```|\*\*|^\s*"'; then
                BRAIN_REACTION="$REACTION"

                # Update idle timer
                date +%s > "$STATE_DIR/.brain-last-request"
            fi
        fi
    fi
fi
```

### Changes to `hooks/react.sh`

In `react.sh`, **before** the `if [ -n "$REASON" ]` block that writes the reaction file, insert:

```bash
# ─── Try buddy-brain ──────────────────────────────────────────────────────
if [ -n "$REASON" ]; then
    source "$(dirname "$0")/buddy-brain.sh"
    if [ -n "$BRAIN_REACTION" ]; then
        REACTION="$BRAIN_REACTION"
    else
        pick_reaction "$REASON"
    fi
fi
```

This replaces the current direct `pick_reaction "$REASON"` calls in the detection blocks. The detection logic stays exactly the same — only the reaction selection changes.

### Exact Insertion Point

In `react.sh`, the current flow is:

```
1. Read stdin, parse RESULT
2. Regex matching → set REASON
3. For each match: pick_reaction "reason"  ← REPLACE THIS
4. Combo detection
5. Streak tracking
6. Recovery detection
7. Write reaction to file
```

Change step 3 to:

```
3. For each match: (don't call pick_reaction here)
   Just set REASON
```

Then after step 6 (after all REASON modifications from combos/streaks/recovery):

```bash
# ─── Generate reaction ──────────────────────────────────────────────────
if [ -n "$REASON" ]; then
    source "$(dirname "$0")/buddy-brain.sh"
    if [ -z "$BRAIN_REACTION" ]; then
        pick_reaction "$REASON"
    else
        REACTION="$BRAIN_REACTION"
    fi
fi
```

This ensures the brain sees the FINAL reason (after combo/streak/recovery overrides), not the initial one.

---

## 11. MCP Server Integration

### File: `server/brain.ts`

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".claude-buddy");
const CONFIG_FILE = join(STATE_DIR, "config.json");
const STATUS_FILE = join(STATE_DIR, "status.json");

interface BrainConfig {
  brainEnabled: boolean;
  brainPort: number;
  brainTemperature: number;
  brainMaxTokens: number;
  brainFallback: "hardcoded" | "none";
}

interface BrainRequest {
  species: string;
  rarity: string;
  name: string;
  personality: string;
  stats: Record<string, number>;
  reason: string;
  context?: Record<string, unknown>;
}

function loadBrainConfig(): BrainConfig {
  const defaults: BrainConfig = {
    brainEnabled: false,
    brainPort: 4891,
    brainTemperature: 0.85,
    brainMaxTokens: 40,
    brainFallback: "hardcoded",
  };

  if (!existsSync(CONFIG_FILE)) return defaults;

  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    return { ...defaults, ...raw };
  } catch {
    return defaults;
  }
}

export async function generateBrainReaction(
  reason: string,
  species: string,
  rarity: string,
  name: string,
  personality: string,
  stats: Record<string, number>,
): Promise<string | null> {
  const config = loadBrainConfig();
  if (!config.brainEnabled) return null;

  const statsStr = Object.entries(stats)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  const systemPrompt =
    `You are ${name}, a ${rarity} ${species} coding companion. ` +
    `Personality: ${personality}. Stats: ${statsStr}. ` +
    `React in one short sentence. Use *asterisks* for actions. Max 15 words.`;

  const userPrompt = `Event: ${reason}.`;

  try {
    const resp = await fetch(
      `http://127.0.0.1:${config.brainPort}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: config.brainMaxTokens,
          temperature: config.brainTemperature,
          stop: ["<|im_end|>", "\n"],
        }),
        signal: AbortSignal.timeout(500),
      },
    );

    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content || content.length < 3 || content.length > 150) {
      return null;
    }

    if (/```|\*\*|^\s*"/.test(content)) {
      return null;
    }

    return content;
  } catch {
    return null;
  }
}
```

### Changes to `server/index.ts`

In `buddy_pet` tool handler:

```typescript
// Before:
const reaction = getReaction("pet", companion.bones.species, companion.bones.rarity);

// After:
const brainReaction = await generateBrainReaction(
  "pet",
  companion.bones.species,
  companion.bones.rarity,
  companion.name,
  companion.personality,
  companion.bones.stats,
);
const reaction = brainReaction ?? getReaction("pet", companion.bones.species, companion.bones.rarity);
```

In `buddy_react` tool handler — the reaction is AI-written by Claude, so no brain integration needed here.

---

## 12. Configuration

### New Config Fields in `server/state.ts`

Add to the config interface and defaults:

```typescript
interface Config {
  // Existing fields...
  commentCooldown: number;
  bubbleStyle: string;
  bubblePosition: string;
  showRarity: boolean;
  statusLineEnabled: boolean;

  // NEW brain fields
  brainEnabled: boolean;       // default: false
  brainPort: number;           // default: 4891
  brainIdleTimeout: number;    // default: 300 (seconds)
  brainTemperature: number;    // default: 0.85
  brainFallback: string;       // default: "hardcoded"
  brainModel: string;          // default: "135m"
  brainMaxTokens: number;      // default: 40
}
```

### New MCP Tool: `buddy_brain`

```typescript
server.tool(
  "buddy_brain",
  "Enable, disable, or configure the buddy brain (dynamic AI reactions). When enabled, reactions are generated by a local AI model for more varied and contextual responses.",
  {
    action: z
      .enum(["on", "off", "status"])
      .describe("'on' to enable, 'off' to disable, 'status' to see current state"),
    temperature: z
      .number()
      .min(0.1)
      .max(1.5)
      .optional()
      .describe("Generation temperature (0.1 = conservative, 1.5 = creative)"),
    model: z
      .enum(["135m", "360m"])
      .optional()
      .describe("Model size: 135m (fast, 75MB) or 360m (quality, 200MB)"),
  },
  async ({ action, temperature, model }) => {
    if (action === "status") {
      const cfg = loadConfig();
      const scriptsDir = join(dirname(import.meta.dir), "scripts");
      // Check if llama-server is installed
      const hasLlama = Bun.which("llama-server") !== null;
      const modelPath = join(
        homedir(),
        ".cache/claude-buddy/models/buddy-brain-135m-Q4_K_M.gguf",
      );
      const hasModel = existsSync(modelPath);

      return {
        content: [
          {
            type: "text",
            text: [
              `Brain: ${cfg.brainEnabled ? "ENABLED" : "DISABLED"}`,
              `Model: ${cfg.brainModel || "135m"}`,
              `Temperature: ${cfg.brainTemperature || 0.85}`,
              `Port: ${cfg.brainPort || 4891}`,
              `llama-server: ${hasLlama ? "installed" : "NOT FOUND"}`,
              `Model file: ${hasModel ? "downloaded" : "NOT DOWNLOADED"}`,
              hasLlama && hasModel
                ? "\nUse /buddy brain on to enable."
                : "\nPrerequisites missing. See docs/buddy-brain-plan.md for setup.",
            ].join("\n"),
          },
        ],
      };
    }

    const updates: Record<string, unknown> = {
      brainEnabled: action === "on",
    };
    if (temperature !== undefined) updates.brainTemperature = temperature;
    if (model !== undefined) updates.brainModel = model;

    saveConfig(updates);

    if (action === "on") {
      return {
        content: [
          {
            type: "text",
            text: "Brain enabled! Reactions will be generated by a local AI model. Requires llama-server and a downloaded model. See /buddy brain status.",
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: "Brain disabled. Using hardcoded reactions." }],
    };
  },
);
```

---

## 13. Testing

### Unit Tests: `server/brain.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { generateBrainReaction } from "./brain.ts";

describe("buddy-brain", () => {
  test("returns null when brain is disabled", async () => {
    const result = await generateBrainReaction(
      "error",
      "cat",
      "rare",
      "Crumpet",
      "aloof and sarcastic",
      { SNARK: 85, PATIENCE: 30, CHAOS: 70, DEBUGGING: 40, WISDOM: 55 },
    );
    expect(result).toBeNull();
  });

  test("returns null when daemon is unreachable", async () => {
    // Enable brain in config, but no daemon running
    // Should return null (fallback to hardcoded)
  });

  test("validates reaction length", async () => {
    // Mock daemon to return very long reaction
    // Should be rejected
  });

  test("validates reaction format", async () => {
    // Mock daemon to return markdown artifacts
    // Should be rejected
  });
});
```

### Integration Tests: `buddy-brain/tests/test_daemon.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")/../.." && pwd)/scripts"
source "$(dirname "$0")/../hooks/buddy-brain.sh" 2>/dev/null || true

echo "=== Daemon lifecycle tests ==="

# Test: start
"$SCRIPTS_DIR/brain-daemon.sh" start
sleep 2

# Test: health check
HEALTH=$(curl -s http://127.0.0.1:4891/health 2>/dev/null || echo "FAIL")
echo "Health: $HEALTH"

# Test: generate reaction
RESPONSE=$(curl -s --max-time 1 http://127.0.0.1:4891/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
        "messages": [
            {"role": "system", "content": "You are a cat coding companion. React in one short sentence."},
            {"role": "user", "content": "Event: error. Context: stack trace on line 42."}
        ],
        "max_tokens": 40,
        "temperature": 0.8,
        "stop": ["<|im_end|>", "\n"]
    }')
echo "Response: $RESPONSE"

REACTION=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
echo "Reaction: $REACTION"

if [ -z "$REACTION" ]; then
    echo "FAIL: Empty reaction"
    exit 1
fi

if [ ${#REACTION} -gt 150 ]; then
    echo "FAIL: Reaction too long (${#REACTION} chars)"
    exit 1
fi

echo "PASS: Reaction valid"

# Test: stop
"$SCRIPTS_DIR/brain-daemon.sh" stop
echo "=== All tests passed ==="
```

### Latency Benchmark: `scripts/brain-benchmark.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

PORT=${1:-4891}
ITERATIONS=${2:-100}

echo "Benchmarking buddy-brain on port $PORT ($ITERATIONS iterations)..."

TIMES=()
for i in $(seq 1 "$ITERATIONS"); do
    START=$(python3 -c "import time; print(int(time.time()*1000))")
    curl -s "http://127.0.0.1:${PORT}/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d '{
            "messages": [
                {"role": "system", "content": "You are a cat. React in one short sentence."},
                {"role": "user", "content": "Event: error."}
            ],
            "max_tokens": 30,
            "temperature": 0.8
        }' > /dev/null 2>&1
    END=$(python3 -c "import time; print(int(time.time()*1000))")
    ELAPSED=$((END - START))
    TIMES+=("$ELAPSED")
done

# Compute stats
SORTED=($(printf '%s\n' "${TIMES[@]}" | sort -n))
P50=${SORTED[$((ITERATIONS / 2))]}
P95=${SORTED[$((ITERATIONS * 95 / 100))]}
P99=${SORTED[$((ITERATIONS * 99 / 100))]}
MIN=${SORTED[0]}
MAX=${SORTED[$((ITERATIONS - 1))]}

echo "Results:"
echo "  min:  ${MIN}ms"
echo "  p50:  ${P50}ms"
echo "  p95:  ${P95}ms"
echo "  p99:  ${P99}ms"
echo "  max:  ${MAX}ms"
```

### Test Targets

| Test | Target |
|---|---|
| p50 latency (Apple M2) | < 150ms |
| p95 latency (Apple M2) | < 250ms |
| p50 latency (x86) | < 300ms |
| Non-empty valid response | > 99% |
| Fallback on failure | 100% |
| No breakage when disabled | 100% |

---

## 14. Project Structure

```
neon-pixel/
├── buddy-brain/                         # Training directory (not shipped to users)
│   ├── README.md                        # Training guide
│   ├── extract.py                       # Dataset extraction from codebase
│   ├── augment.py                       # Synthetic augmentation with teacher model
│   ├── train.py                         # LoRA training script (Unsloth)
│   ├── evaluate.py                      # Evaluation pipeline
│   ├── export.py                        # GGUF export + quantization
│   ├── config.yaml                      # Training hyperparameters
│   ├── data/
│   │   ├── seed/
│   │   │   ├── reactions_ts.jsonl       # From server/reactions.ts
│   │   │   ├── react_sh.jsonl           # From hooks/react.sh
│   │   │   ├── name_react.jsonl         # From hooks/name-react.sh
│   │   │   └── combined.jsonl           # Merged + deduplicated
│   │   ├── augmented/
│   │   │   ├── teacher_variations.jsonl # Synthetic variations
│   │   │   ├── cross_species.jsonl      # Cross-species transfers
│   │   │   └── context_variations.jsonl # Context phrasings
│   │   ├── train.jsonl                  # Final training set
│   │   ├── val.jsonl                    # Validation set
│   │   └── test.jsonl                   # Test set
│   ├── models/
│   │   ├── v1-baseline/                 # Experiment 1
│   │   │   ├── lora/                    # LoRA adapter
│   │   │   └── merged/                  # Merged full model
│   │   └── best/                        # Best model (symlink or copy)
│   ├── gguf/
│   │   ├── buddy-brain-135m-Q4_K_M.gguf
│   │   ├── buddy-brain-135m-Q8_0.gguf
│   │   └── buddy-brain-135m-f16.gguf
│   └── tests/
│       └── test_daemon.sh
│
├── hooks/
│   ├── buddy-brain.sh                   # NEW: Brain wrapper (sourced by react.sh)
│   ├── react.sh                         # MODIFIED: Brain integration + fallback
│   ├── file-type-react.sh               # MODIFIED: Brain integration (optional)
│   └── ...
│
├── scripts/                             # NEW directory
│   ├── brain-daemon.sh                  # Daemon lifecycle management
│   ├── brain-download.sh                # Lazy model download
│   └── brain-benchmark.sh              # Latency benchmarking
│
├── server/
│   ├── brain.ts                         # NEW: Brain inference client
│   ├── brain.test.ts                    # NEW: Brain tests
│   ├── index.ts                         # MODIFIED: buddy_brain tool + brain integration
│   ├── state.ts                         # MODIFIED: Brain config fields
│   └── ...
│
└── docs/
    └── buddy-brain-plan.md              # This file
```

---

## 15. Iteration Roadmap

### v1: Base Fine-Tune (ship as experimental)

- Extract seed data from codebase
- Train LoRA r=8 on SmolLM2-135M for 3 epochs
- Deploy with llama-server daemon
- Brain off by default, opt-in via `/buddy brain on`
- Hardcoded fallback always available

**Dataset**: Seed only (~12,000-15,000 examples)
**Quality target**: Win 30%+ vs hardcoded in blind A/B

### v2: Expanded Dataset

- Add synthetic variations (5x per seed)
- Add cross-species transfers
- Add context phrasing variations
- Retrain with same hyperparams
- Quality jump from dataset diversity alone

**Dataset**: ~25,000-35,000 examples
**Quality target**: Win 40%+ vs hardcoded

### v3: Stat-Aware Generation

- Include stat values prominently in prompts
- Fine-tune on stat-influenced examples (stat override pools)
- Model learns: high SNARK → snarkier, high PATIENCE → calmer
- Test with extreme stat combos (SNARK:99, PATIENCE:5 vs reverse)

**Dataset**: v2 + stat variation examples
**Quality target**: Stat-appropriate reactions 80%+ of the time

### v4: Escalation & Context Awareness

- Include event counter in prompt ("this is error #47")
- Include session duration, time of day
- Model generates escalation-appropriate reactions natively
- No more hardcoded streak/combo detection

**Dataset**: v3 + escalation examples + time/session context examples
**Quality target**: Correct escalation tone 70%+ of the time

### v5: Full Personality Generalization

- Train on diverse personality descriptions (not just species archetypes)
- Support arbitrary custom personalities via system prompt
- Users can create companions with unique personality descriptions
- Model generalizes to unseen personality combinations

**Dataset**: v4 + custom personality examples
**Quality target**: Consistent voice for custom personalities 75%+ of the time

### v6 (optional): 360M Quality Mode

- Offer SmolLM2-360M as "quality mode" alternative
- Same training pipeline, larger model
- User selects via config: `"brainModel": "360m"`
- Lazy-download: only fetch selected model

---

## 16. Timeline & Milestones

| Milestone | Description | Tasks | Est. Time |
|---|---|---|---|
| **M1: Scaffold** | Create directory structure + scripts | mkdir, write scripts/brain-daemon.sh, hooks/buddy-brain.sh, server/brain.ts | 0.5 days |
| **M2: Extract** | Parse all reactions into JSONL | Write + run extract.py | 0.5-1 days |
| **M3: Augment** | Generate synthetic variations | Write + run augment.py (API costs: ~$5-15 with Haiku) | 1-2 days |
| **M4: Train v1** | First training run + evaluate | Colab notebook, run train.py | 0.5-1 days |
| **M5: Iterate** | Tune hyperparams, improve dataset | 3-5 experiments | 1-2 days |
| **M6: Export** | GGUF quantization + verify quality | Run export.py | 0.5 days |
| **M7: Deploy** | Daemon integration + hook changes | Wire everything together | 1-2 days |
| **M8: MCP** | Brain tool + config + server integration | server/brain.ts, index.ts changes | 0.5-1 days |
| **M9: Test** | Unit tests, integration tests, benchmarks | Write + run all tests | 1-2 days |
| **M10: Upload** | HuggingFace Hub + documentation | Upload GGUF, update README | 0.5 days |
| **Total** | | | **~7-12 days** |

### Dependency Graph

```
M1 (scaffold)
 ├── M2 (extract) ──→ M3 (augment) ──→ M4 (train) ──→ M5 (iterate) ──→ M6 (export)
 │                                                                         │
 └── M7 (deploy) ←────────────────────────────────────────────────────────┘
      └── M8 (MCP) ──→ M9 (test) ──→ M10 (upload)
```

M1 and M2 can start immediately. M7 can be developed in parallel with M3-M6 (using mocked responses). M8-M10 are sequential after M7.

---

## 17. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| 135M too small for personality nuance | Medium | High | Fall back to 360M; same pipeline applies |
| Training quality insufficient | Low | Medium | More data, more epochs, full fine-tune |
| llama.cpp binary distribution | Medium | Medium | Bundle via node-llama-cpp npm package |
| Latency exceeds 200ms on slow CPUs | Medium | Low | Async reactions (don't block hook), increase timeout |
| Model generates out-of-character | Medium | Medium | Hardcoded fallback + temperature tuning + format constraints |
| Users don't have llama.cpp installed | High | Low | node-llama-cpp bundle or lazy-download binary |
| GGUF model download too large | Low | Low | 75MB is small; show progress bar |
| SmolLM2 tokenizer incompatible | Low | High | Test early; use correct chat template |

### Fallback Chain

The system is designed so that the brain is **always optional**:

```
1. Brain enabled + daemon running + valid response → use brain reaction
2. Brain enabled + daemon running + invalid response → fall back to hardcoded
3. Brain enabled + daemon not running → start daemon, if fail → hardcoded
4. Brain disabled → hardcoded only (zero overhead)
5. brain.ts not found → hardcoded only (zero overhead)
```

At no point does the brain's presence or absence break existing functionality.

---

## 18. Success Criteria

| Criterion | Target | Measurement |
|---|---|---|
| Quality | Model wins ≥ 40% of blind A/B vs hardcoded | Human evaluation, 100 pairs |
| Speed (M-series) | p50 < 150ms | brain-benchmark.sh, 100 iterations |
| Speed (x86) | p50 < 300ms | Same |
| Reliability | 99%+ valid, non-empty reactions | Automated test, 1000 generations |
| Personality | LLM-as-Judge ≥ 3.5/5 average | All 18 species |
| Fallback | Zero breakage when brain unavailable | Integration test |
| Size | Total download < 100MB | File size check |
| Config | Fully toggleable via `/buddy brain on\|off` | Manual test |