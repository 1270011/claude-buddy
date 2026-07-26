#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { reactionPool } from "./reaction-data.ts";
import {
  defaultSpawnDetached,
  fileExists,
  isOnCooldown,
  nonNegativeInteger,
  parseHookInput,
  pickRandom,
  readJsonFile,
  readStdin,
  resolveHookSessionId,
  resolveHookStateDir,
  stringField,
  type HookRuntime,
} from "./common.ts";

interface BuddyConfig {
  commentCooldown?: unknown;
}

interface Events {
  turns?: number;
  [key: string]: unknown;
}

interface BuddyStatus {
  species?: unknown;
  [key: string]: unknown;
}

interface ReactionFile {
  source?: string;
  timestamp?: number;
  [key: string]: unknown;
}

const BUDDY_COMMENT_PATTERN = /<!--\s*buddy:\s*([\s\S]*?)\s*-->/g;

/** Provenance of the reaction the hook wrote (matches server/state.ts). */
export type ReactionSource = "comment" | "fallback" | "none";

export interface BuddyCommentResult {
  comment?: string;
  /** What produced the bubble. `"none"` means the hook ran but wrote nothing. */
  source: ReactionSource;
  updated: boolean;
}

export function extractBuddyComment(message: string): string {
  let comment = "";
  for (const match of message.matchAll(BUDDY_COMMENT_PATTERN)) {
    const candidate = match[1]?.trim();
    if (candidate) comment = candidate;
  }
  return comment;
}

/**
 * Conservative freshness window for an existing `buddy_react` MCP tool
 * reaction. If the file on disk still has `source: "tool"` and is younger
 * than this, the tool call is authoritative — the Stop hook must not
 * clobber it. Tuned to comfortably outlive the default 30 s cooldown.
 */
const TOOL_REACTION_FRESHNESS_MS = 60_000;

function pickTurnFallback(
  species: string,
  runtime: HookRuntime,
): string | undefined {
  // Mirror the upstream hook convention (file-type-react / mood-react /
  // react): pick from reaction-data.ts directly rather than calling
  // server/reactions.ts getReaction, which is reserved for the MCP
  // server's tool-call path. The hook context doesn't carry the
  // stat-modifier / rarity-flair inputs and trying to bridge those types
  // adds complexity for no observable gain on a fallback pool pick.
  const pool = reactionPool(species, "turn");
  if (pool.length === 0) return undefined;
  return pickRandom(pool, runtime);
}

function readSpeciesFromStatus(stateDir: string): string {
  const status = readJsonFile<BuddyStatus>(join(stateDir, "status.json"));
  return typeof status?.species === "string" && status.species.length > 0
    ? status.species
    : "blob";
}

function isFreshToolReaction(reactionPath: string, nowMs: number): boolean {
  const existing = readJsonFile<ReactionFile>(reactionPath);
  if (!existing) return false;
  if (existing.source !== "tool") return false;
  const ts = typeof existing.timestamp === "number" ? existing.timestamp : 0;
  const age = nowMs - ts;
  return age >= 0 && age < TOOL_REACTION_FRESHNESS_MS;
}

export function handleBuddyComment(
  rawInput: string,
  runtime: HookRuntime = {},
): BuddyCommentResult {
  const stateDir = resolveHookStateDir(runtime);
  if (!fileExists(join(stateDir, "status.json"))) {
    return { source: "none", updated: false };
  }

  const input = parseHookInput(rawInput);
  if (!input) return { source: "none", updated: false };

  const assistantMessage = stringField(input, "last_assistant_message");
  if (!assistantMessage) return { source: "none", updated: false };

  const now = runtime.now?.() ?? Date.now();
  const sid = resolveHookSessionId(runtime);
  const reactionPath = join(stateDir, `reaction.${sid}.json`);
  const cooldownFile = join(stateDir, `.last_comment.${sid}`);
  const config = readJsonFile<BuddyConfig>(join(stateDir, "config.json")) ?? {};
  const cooldown = nonNegativeInteger(config.commentCooldown, 30);
  const spawnDetached = runtime.spawnDetached ?? defaultSpawnDetached(runtime);

  // ─── Bookkeeping: runs on every assistant message, regardless of source ──

  const eventsFile = join(stateDir, "events.json");
  const events = readJsonFile<Events>(eventsFile) ?? {};
  events.turns = (typeof events.turns === "number" ? events.turns : 0) + 1;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(eventsFile, JSON.stringify(events, null, 2));
  spawnDetached("server/award-xp.ts", ["turn"]);
  spawnDetached("server/consolidate.ts", [
    assistantMessage,
    stringField(input, "last_user_message"),
  ]);

  // ─── Don't clobber a fresh buddy_react MCP-tool reaction ─────────────────
  // The tool fires DURING the turn; this hook fires AFTER. The model-
  // authored line written by the tool is authoritative — leave it alone.

  if (isFreshToolReaction(reactionPath, now)) {
    return { source: "none", updated: false };
  }

  // ─── Cooldown: rate-limit the reaction write only ────────────────────────

  if (isOnCooldown(cooldownFile, cooldown, now)) {
    return { source: "none", updated: false };
  }

  // ─── Pick a reaction: legacy comment → canned pool → nothing ────────────

  const commentFromMessage = extractBuddyComment(assistantMessage);
  let comment: string | undefined;
  let source: ReactionSource;

  if (commentFromMessage) {
    comment = commentFromMessage;
    source = "comment";
  } else {
    const species = readSpeciesFromStatus(stateDir);
    const fallback = pickTurnFallback(species, runtime);
    if (fallback) {
      comment = fallback;
      source = "fallback";
    } else {
      return { source: "none", updated: false };
    }
  }

  writeFileSync(cooldownFile, String(Math.floor(now / 1000)));
  writeFileSync(
    reactionPath,
    JSON.stringify({
      reaction: comment,
      timestamp: now,
      reason: "turn",
      source,
    }),
  );

  return { comment, source, updated: true };
}

if (import.meta.main) {
  try {
    handleBuddyComment(await readStdin());
  } catch {
    // Claude Code hooks must never fail the turn.
  }
  process.exit(0);
}
