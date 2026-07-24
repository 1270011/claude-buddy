import type {
  BashToolResultEvent,
  ExtensionAPI,
  InputEvent,
  InputEventResult,
  SessionStartEvent,
  ToolResultEvent,
  TurnEndEvent,
} from "@oh-my-pi/pi-coding-agent";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { complete, type AssistantMessage, type TextContent, type UserMessage } from "@oh-my-pi/pi-ai";
import { BuddyCommandService } from "../../core/command-service.ts";
import type { Achievement } from "../../core/achievements.ts";
import type { BuddyTurnCommentModelConfig, Companion } from "../../core/model.ts";
import { getNameReaction, getSuccessReaction, isNameMentioned } from "../../core/reactions.ts";
import { OmpBuddyStorage } from "./storage.ts";
import { buildBuddyReactionPrompt, buildBuddyReactionSystemPrompt, normalizeBuddyComment, stripBuddyComments } from "./prompt.ts";
import { OmpBuddyUI } from "./ui.ts";
import type { OmpBuddyContext } from "./context.ts";

export type TurnCommentCompleter = (
  model: Parameters<typeof complete>[0],
  context: Parameters<typeof complete>[1],
  options: Parameters<typeof complete>[2],
) => Promise<AssistantMessage>;

export interface OmpBuddyLog {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  debug(event: string, data?: Record<string, unknown>): void;
}

interface RegisterOmpBuddyEventsDeps {
  service: BuddyCommandService;
  storage: OmpBuddyStorage;
  ui: OmpBuddyUI;
  logger: OmpBuddyLog;
  completeTurnComment?: TurnCommentCompleter;
}

export function registerOmpBuddyEvents(pi: ExtensionAPI, deps: RegisterOmpBuddyEventsDeps): void {
  pi.on("session_start", async (_event: SessionStartEvent, ctx: OmpBuddyContext) => {
    const result = deps.service.startSession();
    deps.logger.info("session_start", {
      companion: result.companion.name,
      species: result.companion.bones.species,
      created: result.created,
    });
    deps.ui.refresh(ctx, result.companion, deps.storage.loadLatest(), result.achievements);
    if (result.created) {
      ctx.ui.notify(`A new buddy hatched: ${result.companion.name}`, "info");
      deps.ui.notifyAchievements(ctx, result.achievements);
    }
  });

  pi.on("input", async (event: InputEvent, ctx: OmpBuddyContext): Promise<InputEventResult> => {
    if (event.source === "extension" || deps.storage.isMuted()) {
      deps.logger.debug("input_skipped", {
        source: event.source,
        muted: deps.storage.isMuted(),
      });
      return { handled: false };
    }

    const companion = deps.service.ensureCompanion().companion;
    if (!isNameMentioned(event.text, companion.name)) {
      return { handled: false };
    }

    deps.logger.info("name_mention_detected", {
      companion: companion.name,
      species: companion.bones.species,
      textPreview: event.text.slice(0, 160),
    });

    const reaction = getNameReaction(companion.bones.species);
    const result = deps.service.recordComment(reaction, "turn");
    deps.ui.refresh(ctx, result.companion, result.state, result.achievements);
    deps.ui.notifyAchievements(ctx, result.achievements);
    return { handled: false };
  });

  pi.on("tool_result", async (event: ToolResultEvent, ctx: OmpBuddyContext) => {
    if (deps.storage.isMuted()) {
      deps.logger.debug("tool_result_skipped", { reason: "muted" });
      return;
    }
    if (!shouldEmitPassiveReaction(deps.storage)) {
      deps.logger.debug("tool_result_skipped", { reason: "cooldown" });
      return;
    }
    const text = extractOmpToolText(event);
    let result:
      | ReturnType<BuddyCommandService["recordToolError"]>
      | ReturnType<BuddyCommandService["recordTestFailure"]>
      | ReturnType<BuddyCommandService["recordLargeDiff"]>
      | ReturnType<BuddyCommandService["recordComment"]>
      | undefined;

    const companion = deps.service.ensureCompanion().companion;
    if (isOmpBashToolResult(event)) {
      if (looksLikeTestFailure(text)) {
        result = deps.service.recordTestFailure(undefined, extractFailureCount(text));
      } else if (event.isError || (event.details?.exitCode ?? 0) !== 0) {
        result = deps.service.recordToolError(undefined, firstLineNumber(text));
      } else {
        const diffLines = extractLargeDiffLines(text);
        if (diffLines >= 80) {
          result = deps.service.recordLargeDiff(diffLines);
        } else if (looksLikeSuccess(text)) {
          result = deps.service.recordComment(getSuccessReaction(companion.bones.species), "turn");
        }
      }
    } else if (event.isError) {
      result = deps.service.recordToolError(undefined, firstLineNumber(text));
    }

    if (!result) {
      deps.logger.debug("tool_result_ignored", {
        isError: event.isError,
        textPreview: text.slice(0, 200),
      });
      return;
    }
    deps.logger.info("tool_result_reaction", {
      reason: result.state.reason,
      reaction: result.state.reaction,
      textPreview: text.slice(0, 200),
    });
    deps.ui.refresh(ctx, result.companion, result.state, result.achievements);
    deps.ui.notifyAchievements(ctx, result.achievements);
  });

  pi.on("turn_end", async (event: TurnEndEvent, ctx: OmpBuddyContext) => {
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
      deps.completeTurnComment ?? complete,
      deps.storage.loadOmpConfig().turnCommentModel,
    );
    if (!generated.comment) {
      deps.logger.warn("turn_end_comment_missing", {
        assistantPreview: isAssistantMessage(event.message) ? getAssistantText(event.message).slice(0, 200) : "",
      });
      deps.ui.refresh(ctx, progress.companion, deps.storage.loadLatest(), progress.achievements);
      return;
    }

    deps.logger.info("turn_end_reaction", {
      source: generated.source,
      reaction: generated.comment,
    });

    const reaction = deps.service.recordComment(generated.comment, "turn");
    const achievements = mergeAchievements(progress.achievements, reaction.achievements);
    deps.ui.refresh(ctx, reaction.companion, reaction.state, achievements);
    deps.ui.notifyAchievements(ctx, achievements);
  });
}

function shouldEmitPassiveReaction(storage: OmpBuddyStorage): boolean {
  const cooldownSeconds = storage.loadOmpConfig().commentCooldown;
  if (cooldownSeconds <= 0) return true;
  const latest = storage.loadLatest();
  if (!latest?.timestamp) return true;
  return Date.now() - latest.timestamp >= cooldownSeconds * 1000;
}

export function isOmpBashToolResult(
  event: ToolResultEvent,
): event is BashToolResultEvent {
  return event.toolName === "bash";
}

export function extractOmpToolText(event: ToolResultEvent): string {
  return event.content
    .filter((item): item is Extract<(typeof event.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function looksLikeTestFailure(text: string): boolean {
  return /\b(?:[1-9][0-9]*\s+)?(?:tests?|specs?)\s+(?:failed|failing|did\s+not\s+pass)\b|(?:^|[\r\n])\s*FAIL(?:\s|$)|\bnot\s+ok\b|✗|✘/i.test(text);
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

export async function generateTurnComment(
  ctx: OmpBuddyContext,
  companion: Companion,
  event: TurnEndEvent,
  logger: OmpBuddyLog,
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
      assistantPreview: assistantText.slice(0, 200),
      toolPreview: toolResultsText.slice(0, 200),
      assistantLength: assistantText.length,
      toolLength: toolResultsText.length,
      promptLength: promptText.length,
      systemPromptLength: systemPrompt.length,
      toolResultCount: event.toolResults.length,
    });
    logger.debug("turn_comment_llm_prompt", {
      systemPromptPreview: systemPrompt.slice(0, 800),
      promptPreview: promptText.slice(0, 1200),
      userText,
      assistantText,
      toolResultsText,
    });
    let apiKey: string | undefined;
    try {
      apiKey = await ctx.modelRegistry.getApiKey(turnCommentModel);
    } catch (error) {
      logger.warn("turn_comment_auth_unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const headers = ctx.modelRegistry.getProviderHeaders(turnCommentModel.provider);
    logger.debug("turn_comment_auth", {
      hasApiKey: Boolean(apiKey),
      headerKeys: Object.keys(headers ?? {}),
    });
    if (apiKey) {
      const userMessage: UserMessage = {
        role: "user",
        content: [{ type: "text", text: promptText }],
        timestamp: Date.now(),
      };

      try {
        const response = await completeTurnComment(
          turnCommentModel,
          {
            systemPrompt: [systemPrompt],
            messages: [userMessage],
          },
          {
            apiKey,
            headers,
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
            errorMessage: "errorMessage" in response ? response.errorMessage : undefined,
            contentTypes: response.content.map((block) => block.type),
            contentCount: response.content.length,
            rawPreview: text.slice(0, 200),
            rawLength: text.length,
            normalized,
          });
          if (normalized) return { comment: normalized, source: "llm" };
          logger.warn("turn_comment_llm_empty", {
            rawPreview: text.slice(0, 200),
          });
        }
      } catch (error) {
        logger.error("turn_comment_llm_error", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    } else {
      logger.warn("turn_comment_auth_unavailable", {
        message: "missing api key",
      });
    }
  } else {
    logger.warn("turn_comment_llm_skipped", { reason: "no_model" });
  }

  const fallback = deriveTurnComment(companion, event.message);
  logger.warn("turn_comment_fallback", {
    fallback,
    assistantPreview: assistantText.slice(0, 200),
  });
  return { comment: fallback, source: fallback ? "fallback" : "none" };
}

export function resolveTurnCommentModel(
  ctx: OmpBuddyContext,
  logger?: OmpBuddyLog,
  override?: BuddyTurnCommentModelConfig,
): NonNullable<OmpBuddyContext["model"]> | null {
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

function getUserPromptText(ctx: OmpBuddyContext): string {
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
