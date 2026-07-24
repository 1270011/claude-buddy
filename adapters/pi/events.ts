import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  SessionStartEvent,
  ToolResultEvent,
  TurnEndEvent,
} from "@mariozechner/pi-coding-agent";
import { isBashToolResult } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { complete, type AssistantMessage, type TextContent, type UserMessage } from "@mariozechner/pi-ai";
import { BuddyCommandService, type ReactionResult } from "../../core/command-service.ts";
import type { Achievement } from "../../core/achievements.ts";
import type { BuddyTurnCommentModelConfig, Companion } from "../../core/model.ts";
import { getNameReaction, getSuccessReaction, isNameMentioned } from "../../core/reactions.ts";
import { PiBuddyStorage } from "./storage.ts";
import { buildBuddyReactionPrompt, buildBuddyReactionSystemPrompt, normalizeBuddyComment, stripBuddyComments } from "./prompt.ts";
import { PiBuddyUI } from "./ui.ts";

export interface PiBuddyLog {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  debug(event: string, data?: Record<string, unknown>): void;
}
interface RegisterBuddyEventsDeps {
  service: BuddyCommandService;
  storage: PiBuddyStorage;
  ui: PiBuddyUI;
  logger: PiBuddyLog;
}

export function registerBuddyEvents(pi: ExtensionAPI, deps: RegisterBuddyEventsDeps): void {
  pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
    const result = deps.service.startSession();
    deps.logger.info("session_start", {
      companion: result.companion.name,
      species: result.companion.bones.species,
      created: result.created,
    });
    deps.ui.refresh(ctx, result.companion, deps.storage.loadLatest(), result.achievements);
    if (result.created) {
      ctx.ui.notify(`A new buddy hatched: ${result.companion.name}`, "info");
    }
    deps.ui.notifyAchievements(ctx, result.achievements);
  });

  pi.on("input", async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> => {
    if (event.source === "extension" || deps.storage.isMuted()) {
      deps.logger.debug("input_skipped", {
        source: event.source,
        muted: deps.storage.isMuted(),
      });
      return { action: "continue" };
    }

    const companion = deps.service.ensureCompanion().companion;
    if (!isNameMentioned(event.text, companion.name)) {
      return { action: "continue" };
    }

    deps.logger.info("name_mention_detected", {
      companion: companion.name,
      species: companion.bones.species,
      textLength: event.text.length,
    });

    const reaction = getNameReaction(companion.bones.species);
    const result = deps.service.recordComment(reaction, "turn");
    deps.ui.refresh(ctx, result.companion, result.state, result.achievements);
    deps.ui.notifyAchievements(ctx, result.achievements);
    return { action: "continue" };
  });

  pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (deps.storage.isMuted()) {
      deps.logger.debug("tool_result_skipped", { reason: "muted" });
      return;
    }

    const text = extractToolText(event);
    const canEmit = shouldEmitPassiveReaction(deps.storage);
    let result: ReactionResult | undefined;
    const companion = deps.service.ensureCompanion().companion;
    if (isBashToolResult(event)) {
      if (looksLikeTestFailure(text)) {
        const count = extractFailureCount(text);
        if (canEmit) {
          result = deps.service.recordTestFailure(undefined, count);
        } else {
          const achievements = deps.service.trackTestFailure(undefined, count);
          if (achievements.length > 0) { deps.ui.refresh(ctx, companion, deps.storage.loadLatest(), achievements); }
        }
      } else if (event.isError) {
        const line = firstLineNumber(text);
        if (canEmit) {
          result = deps.service.recordToolError(undefined, line);
        } else {
          const achievements = deps.service.trackToolError(undefined, line);
          if (achievements.length > 0) { deps.ui.refresh(ctx, companion, deps.storage.loadLatest(), achievements); }
        }
      } else {
        const diffLines = extractLargeDiffLines(text);
        if (diffLines >= 80) {
          if (canEmit) {
            result = deps.service.recordLargeDiff(diffLines);
          } else {
            const achievements = deps.service.trackLargeDiff(diffLines);
            if (achievements.length > 0) { deps.ui.refresh(ctx, companion, deps.storage.loadLatest(), achievements); }
          }
        } else if (canEmit && looksLikeSuccess(text)) {
          result = deps.service.recordComment(getSuccessReaction(companion.bones.species), "turn");
        }
      }
    } else if (event.isError) {
      const line = firstLineNumber(text);
      if (canEmit) {
        result = deps.service.recordToolError(undefined, line);
      } else {
        const achievements = deps.service.trackToolError(undefined, line);
        if (achievements.length > 0) { deps.ui.refresh(ctx, companion, deps.storage.loadLatest(), achievements); }
      }
    }

    if (!canEmit) {
      deps.logger.debug("tool_result_skipped", { reason: "cooldown" });
      return;
    }

    if (!result) {
      const ignoredData: Record<string, unknown> = { isError: event.isError, textLength: text.length };
      if (diagnosticPreviewsEnabled()) {
        ignoredData.textPreview = text.slice(0, 200);
      }
      deps.logger.debug("tool_result_ignored", ignoredData);
      return;
    }
    deps.logger.info("tool_result_reaction", {
      reason: result.state.reason,
      reactionLength: result.state.reaction.length,
      textLength: text.length,
    });
    deps.ui.refresh(ctx, result.companion, result.state, result.achievements);
    deps.ui.notifyAchievements(ctx, result.achievements);
  });

  pi.on("turn_end", async (event: TurnEndEvent, ctx: ExtensionContext) => {
    const progress = deps.service.recordTurnOnly();
    if (deps.storage.isMuted()) {
      deps.logger.debug("turn_end_skipped", { reason: "muted" });
      deps.ui.refresh(ctx, progress.companion, null, progress.achievements);
      return;
    }

    const generated = await generateTurnComment(
      ctx,
      progress.companion,
      event,
      deps.logger,
      complete,
      deps.storage.loadPiConfig().turnCommentModel,
    );
    if (!generated.comment) {
      const assistantLength = isAssistantMessage(event.message) ? getAssistantText(event.message).length : 0;
      deps.logger.warn("turn_end_comment_missing", { assistantLength });
      deps.ui.refresh(ctx, progress.companion, deps.storage.loadLatest(), progress.achievements);
      return;
    }

    deps.logger.info("turn_end_reaction", {
      source: generated.source,
      reactionLength: generated.comment.length,
    });

    const reaction = deps.service.recordComment(generated.comment, "turn");
    const achievements = mergeAchievements(progress.achievements, reaction.achievements);
    deps.ui.refresh(ctx, reaction.companion, reaction.state, achievements);
    deps.ui.notifyAchievements(ctx, achievements);
  });
  pi.on("session_shutdown", () => {
    deps.ui.cancelTimers();
  });
}
function diagnosticPreviewsEnabled(): boolean {
  const value = process.env.BUDDY_DIAGNOSTIC_PREVIEWS;
  return value === "1" || value === "true";
}

function shouldEmitPassiveReaction(storage: PiBuddyStorage): boolean {
  const cooldownSeconds = storage.loadPiConfig().commentCooldown;
  if (cooldownSeconds <= 0) return true;
  const latest = storage.loadLatest();
  if (!latest?.timestamp) return true;
  return Date.now() - latest.timestamp >= cooldownSeconds * 1000;
}

function extractToolText(event: ToolResultEvent): string {
  const fromContent = event.content
    .filter((item): item is Extract<(typeof event.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");

  if (fromContent.trim()) return fromContent;
  if (isBashToolResult(event)) {
    return "";
  }
  return "";
}

const EXPLICIT_FAILURE_PATTERN = /\b(?:[1-9][0-9]*\s+)?(?:tests?|specs?)\s+(?:failed|failing|did\s+not\s+pass)\b/i;

function hasTestContext(line: string): boolean {
  return /\b(?:bun\s+test|npm\s+test|yarn\s+test|pnpm\s+test|vitest|jest|mocha|ava|tap|pytest|cargo\s+test|go\s+test|dotnet\s+test|phpunit|rspec|test\s+suite|test\s+runner|tests?\s+(?:passed|failed|ok)|TAP\s*version|1\.\.\d+|#\s+(?:tests|pass|fail|todo|skip|ok))\b/i.test(line);
}

function isGenericFailureMarker(line: string): boolean {
  return /^\s*(?:FAIL|not\s+ok|[✗✘×])\s*$/i.test(line) ||
    /\b[✗✘×]\b/.test(line) ||
    /(?:^|[\r\n])\s*FAIL(?:\s|$)/i.test(line) ||
    /\bnot\s+ok\b/i.test(line);
}

export function looksLikeTestFailure(text: string): boolean {
  if (EXPLICIT_FAILURE_PATTERN.test(text)) return true;

  const lines = text.split(/\r?\n/);
  const contextWindow: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    contextWindow.push(line);
    if (contextWindow.length > 3) contextWindow.shift();
    if (isGenericFailureMarker(line) && contextWindow.some((contextLine) => hasTestContext(contextLine))) {
      return true;
    }
  }
  return false;
}

function looksLikeSuccess(text: string): boolean {
  return /\b(all )?[0-9]+ tests? (passed|ok)\b|✓|✔|PASS(ED)?|\bDone\b|\bSuccess\b|exit code 0|Build succeeded/i.test(text);
}

function extractFailureCount(text: string): number | undefined {
  const match = text.match(/(\d+)\s+(tests? )?(failed|failing)/i);
  return match ? Number(match[1]) : undefined;
}

function extractLargeDiffLines(text: string): number {
  const statMatch = text.match(/(\d+)\s+insertions?\(\+\).*?(\d+)\s+deletions?\(-\)/is);
  if (statMatch) {
    return Number(statMatch[1]) + Number(statMatch[2]);
  }

  const patchLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .length;
  return patchLines;
}

function firstLineNumber(text: string): number | undefined {
  const match = text.match(/line\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function mergeAchievements(first: Achievement[], second: Achievement[]): Achievement[] {
  const merged = new Map<string, Achievement>();
  for (const achievement of [...first, ...second]) {
    merged.set(achievement.id, achievement);
  }
  return [...merged.values()];
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => stripBuddyComments(block.text))
    .join("\n");
}

type TurnCommentCompleter = (
  model: Parameters<typeof complete>[0],
  context: Parameters<typeof complete>[1],
  options: Parameters<typeof complete>[2],
) => Promise<AssistantMessage>;
export async function generateTurnComment(
  ctx: ExtensionContext,
  companion: Companion,
  event: TurnEndEvent,
  logger: PiBuddyLog,
  completeTurnComment: TurnCommentCompleter = complete,
  modelOverride?: BuddyTurnCommentModelConfig,
): Promise<{ comment: string | null; source: "llm" | "fallback" | "none" }> {
  const assistantText = isAssistantMessage(event.message) ? getAssistantText(event.message) : "";
  if (!assistantText.trim()) {
    logger.warn("turn_comment_skipped", { reason: "empty_assistant_text" });
    return { comment: null, source: "none" };
  }

  const turnCommentModel = resolveTurnCommentModel(ctx, logger, modelOverride);
  if (turnCommentModel) {
    const toolResultsText = getToolResultsText(event);
    const userText = getUserPromptText(ctx);
    const systemPrompt = buildBuddyReactionSystemPrompt(companion);
    const promptText = buildBuddyReactionPrompt(companion, assistantText, toolResultsText, userText);
    logger.info("turn_comment_llm_attempt", {
      modelProvider: turnCommentModel.provider,
      modelId: turnCommentModel.id,
      assistantLength: assistantText.length,
      toolLength: toolResultsText.length,
      userTextLength: userText.length,
      promptLength: promptText.length,
      systemPromptLength: systemPrompt.length,
      toolResultCount: event.toolResults.length,
    });
    const promptDebugData: Record<string, unknown> = {
      assistantLength: assistantText.length,
      toolLength: toolResultsText.length,
      userTextLength: userText.length,
    };
    if (diagnosticPreviewsEnabled()) {
      promptDebugData.systemPromptPreview = systemPrompt.slice(0, 800);
      promptDebugData.promptPreview = promptText.slice(0, 1200);
      promptDebugData.userTextPreview = userText.slice(0, 200);
      promptDebugData.assistantPreview = assistantText.slice(0, 200);
      promptDebugData.toolPreview = toolResultsText.slice(0, 200);
    }
    logger.debug("turn_comment_llm_prompt", promptDebugData);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(turnCommentModel);
    logger.debug("turn_comment_auth", {
      ok: auth.ok,
      hasApiKey: auth.ok ? !!auth.apiKey : false,
      headerKeys: auth.ok ? Object.keys(auth.headers ?? {}) : [],
    });
    if (auth.ok && auth.apiKey) {
      const userMessage: UserMessage = {
        role: "user",
        content: [{ type: "text", text: promptText }],
        timestamp: Date.now(),
      };

      try {
        const response = await completeTurnComment(
          turnCommentModel,
          {
            systemPrompt,
            messages: [userMessage],
          },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
          },
        );

        if (response.stopReason !== "aborted") {
          const text = response.content
            .filter((block): block is TextContent => block.type === "text")
            .map((block) => block.text)
            .join("\n");
          const normalized = normalizeBuddyComment(text);
          logger.info("turn_comment_llm_result", {
            stopReason: response.stopReason,
            errorMessage: "errorMessage" in response ? (response as { errorMessage?: string }).errorMessage : undefined,
            contentTypes: response.content.map((block) => block.type),
            contentCount: response.content.length,
            rawLength: text.length,
            normalizedLength: normalized.length,
          });
          if (normalized) return { comment: normalized, source: "llm" };
          logger.warn("turn_comment_llm_empty", { rawLength: text.length });
        }
      } catch (error) {
        logger.error("turn_comment_llm_error", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    } else {
      logger.warn("turn_comment_auth_unavailable", {
        ok: auth.ok,
        message: auth.ok ? "missing api key" : auth.error,
      });
    }
  } else {
    logger.warn("turn_comment_llm_skipped", { reason: "no_model" });
  }

  const fallback = deriveTurnComment(companion, event.message);
  logger.warn("turn_comment_fallback", {
    fallbackLength: fallback?.length ?? 0,
    assistantLength: assistantText.length,
  });
  return { comment: fallback, source: fallback ? "fallback" : "none" };
}

export interface PiTurnCommentModelContext {
  model: ExtensionContext["model"];
  modelRegistry: Pick<ExtensionContext["modelRegistry"], "find">;
}

export function resolveTurnCommentModel(
  ctx: PiTurnCommentModelContext,
  logger?: PiBuddyLog,
  override?: BuddyTurnCommentModelConfig,
): NonNullable<PiTurnCommentModelContext["model"]> | null {
  const activeOverride = override;
  if (activeOverride?.provider && activeOverride.model) {
    const model = ctx.modelRegistry.find(activeOverride.provider, activeOverride.model);
    if (model) {
      logger?.debug("turn_comment_model_selected", {
        source: "config",
        provider: model.provider,
        model: model.id,
      });
      return model;
    }
    logger?.warn("turn_comment_model_missing", {
      source: "config",
      provider: activeOverride.provider,
      model: activeOverride.model,
    });
  }

  if (ctx.model) {
    logger?.debug("turn_comment_model_selected", {
      source: "session",
      provider: ctx.model.provider,
      model: ctx.model.id,
    });
    return ctx.model;
  }

  return null;
}

function getToolResultsText(event: TurnEndEvent): string {
  return event.toolResults
    .map((result) => result.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n"))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
}

function getUserPromptText(ctx: ExtensionContext): string {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .slice(0, 4000);
  }
  return "";
}

export function deriveTurnComment(companion: Companion, message: AgentMessage): string | null {
  if (!isAssistantMessage(message)) return null;

  const text = sanitizeAssistantText(getAssistantText(message));
  if (!text) return null;

  const file = firstMatch(text, /`([^`]+\.[a-z0-9]+)`/i)
    ?? firstMatch(text, /\b([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|sh|py|rs|go|java|rb|css|html|ya?ml))\b/i);

  if (file) {
    return fitComment(`*takes note* ${file} got the attention this turn.`, 150);
  }

  if (/\b(regex|unicode)\b/i.test(text)) {
    return fitComment("*head tilts* that regex still wants a second look.", 150);
  }

  if (/\b(test|tests|assert|spec)\b/i.test(text)) {
    return fitComment("*nods slowly* good. keep the tests honest.", 150);
  }

  if (/\b(error|bug|fix|failure|failing|exception)\b/i.test(text)) {
    return fitComment("*watches closely* one fix always tries to drag a second one behind it.", 150);
  }

  const topic = firstMeaningfulSentence(text);
  if (!topic) return null;

  const speciesLead = companion.bones.species === "owl"
    ? "*blinks slowly*"
    : companion.bones.species === "snail"
    ? "*slow nod*"
    : "*takes note*";

  return fitComment(`${speciesLead} ${topic}`, 150);
}

function sanitizeAssistantText(text: string): string {
  return text
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function firstMeaningfulSentence(text: string): string | null {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const cleaned = sentence
      .replace(/^here'?s what I (?:did|changed)[:\-]?\s*/i, "")
      .replace(/^I\s+/i, "")
      .replace(/^we\s+/i, "")
      .trim();
    if (cleaned.length < 18) continue;
    return cleaned;
  }

  return text.length >= 18 ? text : null;
}

function fitComment(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
