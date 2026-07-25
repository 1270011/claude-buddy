#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  defaultSpawnDetached,
  fileExists,
  isOnCooldown,
  nonNegativeInteger,
  parseHookInput,
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

const BUDDY_COMMENT_PATTERN = /<!--\s*buddy:\s*([\s\S]*?)\s*-->/g;

export interface BuddyCommentResult {
  comment?: string;
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

export function handleBuddyComment(rawInput: string, runtime: HookRuntime = {}): BuddyCommentResult {
  const stateDir = resolveHookStateDir(runtime);
  if (!fileExists(join(stateDir, "status.json"))) return { updated: false };

  const input = parseHookInput(rawInput);
  if (!input) return { updated: false };

  const assistantMessage = stringField(input, "last_assistant_message");
  if (!assistantMessage) return { updated: false };

  const comment = extractBuddyComment(assistantMessage);
  if (!comment) return { updated: false };

  const now = runtime.now?.() ?? Date.now();
  const sid = resolveHookSessionId(runtime);
  const config = readJsonFile<BuddyConfig>(join(stateDir, "config.json")) ?? {};
  const cooldown = nonNegativeInteger(config.commentCooldown, 30);
  const cooldownFile = join(stateDir, `.last_comment.${sid}`);
  if (isOnCooldown(cooldownFile, cooldown, now)) return { updated: false };

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(cooldownFile, String(Math.floor(now / 1000)));
  writeFileSync(
    join(stateDir, `reaction.${sid}.json`),
    JSON.stringify({ reaction: comment, timestamp: now, reason: "turn" }),
  );

  const eventsFile = join(stateDir, "events.json");
  const events = readJsonFile<Events>(eventsFile) ?? {};
  events.turns = (typeof events.turns === "number" ? events.turns : 0) + 1;
  writeFileSync(eventsFile, JSON.stringify(events, null, 2));

  const spawnDetached = runtime.spawnDetached ?? defaultSpawnDetached(runtime);
  spawnDetached("server/award-xp.ts", ["turn"]);
  spawnDetached("server/consolidate.ts", [
    assistantMessage,
    stringField(input, "last_user_message"),
  ]);

  return { comment, updated: true };
}

if (import.meta.main) {
  try {
    handleBuddyComment(await readStdin());
  } catch {
    // Claude Code hooks must never fail the turn.
  }
  process.exit(0);
}
