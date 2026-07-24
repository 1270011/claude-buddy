import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveTurnComment,
  generateTurnComment,
  registerBuddyEvents,
  resolveTurnCommentModel,
  type PiBuddyLog,
  type PiTurnCommentModelContext,
} from "./events.ts";
import { getNameReaction, getSuccessReaction } from "../../core/reactions.ts";
import type { Companion } from "../../core/model.ts";
import { getModels, type AssistantMessage } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  SessionStartEvent,
  ToolResultEvent,
  TurnEndEvent,
} from "@mariozechner/pi-coding-agent";
import { BuddyCommandService } from "../../core/command-service.ts";
import { PiIdentityProvider } from "./identity.ts";

import { PiBuddyLogger } from "./logger.ts";
import { PiBuddyStorage } from "./storage.ts";
import { PiBuddyUI } from "./ui.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "openai-completions",
    provider: "openai",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

const companion: Companion = {
  bones: {
    species: "snail",
    rarity: "common",
    shiny: false,
    eye: "·",
    hat: "none",
    peak: "PATIENCE",
    dump: "CHAOS",
    stats: {
      DEBUGGING: 60,
      PATIENCE: 88,
      CHAOS: 12,
      WISDOM: 55,
      SNARK: 34,
    },
  },
  name: "Ember",
  personality: "A patient snail.",
  hatchedAt: 0,
  userId: "user-123",
};

describe("getNameReaction", () => {
  test("uses Claude-style species-specific name reactions", () => {
    const reaction = getNameReaction(companion.bones.species);
    expect([
      "*slow head extension*",
      "...mmm?",
      "*trails slowly toward you*",
      "*antenna twitches*",
    ]).toContain(reaction);
  });
});

describe("getSuccessReaction", () => {
  test("uses Claude-style species-specific success reactions", () => {
    const reaction = getSuccessReaction(companion.bones.species);
    expect([
      "*slow satisfied nod*",
      "good things take time.",
      "*leaves victory slime*",
      "see? no rush was needed.",
    ]).toContain(reaction);
  });
});

describe("resolveTurnCommentModel", () => {
  test("prefers configured buddy model override when found", () => {
    const model = getModels("google")[0];
    const sessionModel = getModels("openai-codex")[0];
    if (!model || !sessionModel) throw new Error("Expected Pi model fixtures.");
    const ctx = {
      model: sessionModel,
      modelRegistry: {
        find(provider: string, id: string) {
          return provider === model.provider && id === model.id ? model : undefined;
        },
      },
    } satisfies PiTurnCommentModelContext;

    expect(resolveTurnCommentModel(ctx, undefined, {
      provider: model.provider,
      model: model.id,
    })).toMatchObject({ provider: model.provider, id: model.id });
  });

  test("falls back to session model when configured override is missing", () => {
    const sessionModel = getModels("openai-codex")[0];
    if (!sessionModel) throw new Error("Expected a Pi session model fixture.");
    const ctx = {
      model: sessionModel,
      modelRegistry: {
        find() {
          return undefined;
        },
      },
    } satisfies PiTurnCommentModelContext;

    expect(resolveTurnCommentModel(ctx, undefined, {
      provider: "google",
      model: "does-not-exist",
    })).toMatchObject({ provider: sessionModel.provider, id: sessionModel.id });
  });
  test("uses configured model from a custom stateDir", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "pi-buddy-model-config-"));
    temporaryDirectories.push(stateDir);
    const storage = new PiBuddyStorage(stateDir);
    storage.savePiConfig({ turnCommentModel: { provider: "openai", model: "custom-buddy-model" } });

    const model = getModels("openai")[0];
    if (!model) throw new Error("Expected a Pi model fixture.");
    const ctx = {
      model: undefined,
      modelRegistry: {
        find(provider: string, id: string) {
          return provider === "openai" && id === "custom-buddy-model" ? { ...model, id: "custom-buddy-model" } : undefined;
        },
      },
    } as unknown as PiTurnCommentModelContext;

    const configured = storage.loadPiConfig().turnCommentModel;
    const result = resolveTurnCommentModel(ctx, undefined, configured);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ provider: "openai", id: "custom-buddy-model" });
  });

  test("explicit override takes precedence over session model", () => {
    const sessionModel = getModels("openai-codex")[0];
    const overrideModel = getModels("google")[0];
    if (!sessionModel || !overrideModel) throw new Error("Expected Pi model fixtures.");
    const ctx = {
      model: sessionModel,
      modelRegistry: {
        find(provider: string, id: string) {
          return provider === overrideModel.provider && id === overrideModel.id ? overrideModel : undefined;
        },
      },
    } satisfies PiTurnCommentModelContext;

    expect(resolveTurnCommentModel(ctx, undefined, {
      provider: overrideModel.provider,
      model: overrideModel.id,
    })).toMatchObject({ provider: overrideModel.provider, id: overrideModel.id });
  });
});
describe("generateTurnComment", () => {
  test("uses configured model override from custom stateDir and logs bounded previews", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "pi-buddy-payload-config-"));
    temporaryDirectories.push(stateDir);
    const storage = new PiBuddyStorage(stateDir);
    const model = getModels("openai")[0];
    if (!model) throw new Error("Expected a Pi model fixture.");
    storage.savePiConfig({ turnCommentModel: { provider: model.provider, model: model.id } });

    const longAssistant = "a".repeat(5000);
    const longTool = "b".repeat(5000);
    const longUser = "c".repeat(5000);

    const event = {
      type: "turn_end",
      turnIndex: 1,
      message: assistantMessage(longAssistant),
      toolResults: [
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "bash",
          content: [{ type: "text", text: longTool }],
          isError: false,
          details: { exitCode: 0 },
          timestamp: 0,
        },
      ],
    } satisfies TurnEndEvent;

    const branchEntry = {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: longUser }],
      },
    };

    const ctx = {
      ui: { notify() {}, setStatus() {}, setWidget() {} },
      model: undefined,
      modelRegistry: {
        find(provider: string, id: string) {
          return provider === model.provider && id === model.id ? model : undefined;
        },
        async getApiKeyAndHeaders() {
          return { ok: true, apiKey: "secret-key", headers: {} };
        },
      },
      sessionManager: {
        getBranch() {
          return [branchEntry];
        },
      },
    } as unknown as ExtensionContext;

    const logs: Array<{ level: string; event: string; data: Record<string, unknown> }> = [];
    const logger: PiBuddyLog = {
      info(event, data) { logs.push({ level: "info", event, data: data ?? {} }); },
      warn(event, data) { logs.push({ level: "warn", event, data: data ?? {} }); },
      error(event, data) { logs.push({ level: "error", event, data: data ?? {} }); },
      debug(event, data) { logs.push({ level: "debug", event, data: data ?? {} }); },
    };

    const fakeComplete = async () => assistantMessage("*nods* done.");

    const result = await generateTurnComment(
      ctx,
      companion,
      event,
      logger,
      fakeComplete,
      storage.loadPiConfig().turnCommentModel,
    );

    expect(result).toEqual({ comment: "*nods* done.", source: "llm" });

    const attempt = logs.find((l) => l.event === "turn_comment_llm_attempt");
    expect(attempt).toBeDefined();
    expect(attempt!.data.assistantText).toBeUndefined();
    expect(attempt!.data.toolResultsText).toBeUndefined();
    expect(attempt!.data.userText).toBeUndefined();
    expect(attempt!.data.assistantPreview).toBe(longAssistant.slice(0, 200));
    expect(attempt!.data.toolPreview).toBe(longTool.slice(0, 200));
    expect(attempt!.data.userTextPreview).toBe(longUser.slice(0, 200));
    expect(attempt!.data.assistantLength).toBe(longAssistant.length);
    expect(attempt!.data.toolLength).toBe(Math.min(longTool.length, 4000));
    expect(attempt!.data.userTextLength).toBe(Math.min(longUser.length, 4000));

    const prompt = logs.find((l) => l.event === "turn_comment_llm_prompt");
    expect(prompt).toBeDefined();
    expect(prompt!.data.assistantText).toBeUndefined();
    expect(prompt!.data.toolResultsText).toBeUndefined();
    expect(prompt!.data.userText).toBeUndefined();
    expect(prompt!.data.assistantPreview).toBe(longAssistant.slice(0, 200));
    expect(prompt!.data.toolPreview).toBe(longTool.slice(0, 200));
    expect(prompt!.data.userTextPreview).toBe(longUser.slice(0, 200));
    expect(prompt!.data.assistantLength).toBe(longAssistant.length);
    expect(prompt!.data.toolLength).toBe(Math.min(longTool.length, 4000));
    expect(prompt!.data.userTextLength).toBe(Math.min(longUser.length, 4000));
    if (typeof prompt!.data.systemPromptPreview === "string") {
      expect(prompt!.data.systemPromptPreview.length).toBeLessThanOrEqual(800);
    }
    if (typeof prompt!.data.promptPreview === "string") {
      expect(prompt!.data.promptPreview.length).toBeLessThanOrEqual(1200);
    }

    const resultLog = logs.find((l) => l.event === "turn_comment_llm_result");
    expect(resultLog).toBeDefined();
    expect(resultLog!.data.normalized).toBe("*nods* done.");
  });
});

describe("deriveTurnComment", () => {
  test("extracts file-aware comments from assistant text", () => {
    const comment = deriveTurnComment(
      companion,
      assistantMessage("I updated adapters/pi/events.ts to stop random turn chatter."),
    );

    expect(comment).toContain("adapters/pi/events.ts");
  });

  test("uses contextual test wording when tests are mentioned", () => {
    const comment = deriveTurnComment(
      companion,
      assistantMessage("I added a regression test and verified the tests pass."),
    );

    expect(comment).toBe("*nods slowly* good. keep the tests honest.");
  });

  test("returns null when there is no assistant text", () => {
    const comment = deriveTurnComment(companion, assistantMessage(""));

    expect(comment).toBeNull();
  });
});

type PiEventHandler = (event: unknown, context: ExtensionContext) => unknown | Promise<unknown>;

function createPiHarness(stateDir: string) {
  const handlers = new Map<string, PiEventHandler>();

  const api = {
    on(event: string, handler: PiEventHandler) {
      handlers.set(event, handler);
    },
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const ctx = {
    ui: {
      setStatus() {},
      setWidget() {},
      notify() {},
    },
  } as unknown as ExtensionContext;

  const storage = new PiBuddyStorage(stateDir);
  const identity = new PiIdentityProvider(storage);
  const logger = new PiBuddyLogger(storage);
  const service = new BuddyCommandService({
    identity,
    buddies: storage,
    reactions: storage,
    config: storage,
    events: storage,
  });
  const ui = new PiBuddyUI(storage);

  registerBuddyEvents(api, { service, storage, ui, logger });
  return { handlers, ctx, storage };
}

async function emitPi(
  handlers: Map<string, PiEventHandler>,
  name: string,
  event: unknown,
  context: ExtensionContext,
): Promise<void> {
  const handler = handlers.get(name);
  expect(handler).toBeDefined();
  await handler?.(event, context);
}

describe("Pi extension event behavior", () => {
  test("session_start increments sessions and active-day counters once", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "pi-buddy-session-count-"));
    temporaryDirectories.push(stateDir);
    const harness = createPiHarness(stateDir);
    const storage = harness.storage;
    storage.savePiConfig({ commentCooldown: 0 });

    await emitPi(harness.handlers, "session_start", { type: "session_start" } as SessionStartEvent, harness.ctx);
    expect(storage.loadCounters().sessions).toBe(1);
    expect(storage.loadCounters().days_active).toBe(1);

    await emitPi(harness.handlers, "session_start", { type: "session_start" } as SessionStartEvent, harness.ctx);
    expect(storage.loadCounters().sessions).toBe(2);
  });

  test("matches name mentions for punctuation and emoji-ending names", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "pi-buddy-name-mention-"));
    temporaryDirectories.push(stateDir);
    const harness = createPiHarness(stateDir);
    const storage = harness.storage;
    storage.savePiConfig({ commentCooldown: 0 });

    await emitPi(harness.handlers, "session_start", { type: "session_start" } as SessionStartEvent, harness.ctx);
    const companion = storage.loadActive();
    expect(companion).not.toBeNull();

    await emitPi(
      harness.handlers,
      "input",
      { type: "input", source: "interactive", text: `${companion?.name}! you rock` } as InputEvent,
      harness.ctx,
    );
    expect(storage.loadLatest()?.reason).toBe("turn");

    await emitPi(
      harness.handlers,
      "input",
      { type: "input", source: "interactive", text: `look at ${companion?.name}✨` } as InputEvent,
      harness.ctx,
    );
    expect(storage.loadLatest()?.reason).toBe("turn");
  });

  test("classifies bash test failures before generic tool errors", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "pi-buddy-test-failure-"));
    temporaryDirectories.push(stateDir);
    const harness = createPiHarness(stateDir);
    const storage = harness.storage;
    storage.savePiConfig({ commentCooldown: 0 });

    await emitPi(harness.handlers, "session_start", { type: "session_start" } as SessionStartEvent, harness.ctx);

    const bashResult = {
      type: "tool_result",
      toolCallId: "tool-2",
      toolName: "bash",
      input: { command: "bun test" },
      content: [{ type: "text", text: "2 tests failed" }],
      isError: true,
      details: undefined,
    } satisfies ToolResultEvent;
    await emitPi(harness.handlers, "tool_result", bashResult, harness.ctx);

    expect(storage.loadLatest()?.reason).toBe("test-fail");
    expect(storage.loadCounters().tests_failed).toBe(1);
    expect(storage.loadCounters().errors_seen).toBe(0);
  });

  test("gates test/diff/success heuristics to bash results", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "pi-buddy-non-execution-"));
    temporaryDirectories.push(stateDir);
    const harness = createPiHarness(stateDir);
    const storage = harness.storage;
    storage.savePiConfig({ commentCooldown: 0 });

    await emitPi(harness.handlers, "session_start", { type: "session_start" } as SessionStartEvent, harness.ctx);

    const readResult = {
      type: "tool_result",
      toolCallId: "tool-3",
      toolName: "read",
      input: { path: "/dev/null" },
      content: [{ type: "text", text: "2 tests failed" }],
      isError: false,
      details: undefined,
    } satisfies ToolResultEvent;
    await emitPi(harness.handlers, "tool_result", readResult, harness.ctx);
    expect(storage.loadCounters().tests_failed).toBe(0);
    expect(storage.loadCounters().errors_seen).toBe(0);

    const readError = {
      type: "tool_result",
      toolCallId: "tool-4",
      toolName: "read",
      input: { path: "/dev/null" },
      content: [{ type: "text", text: "command failed at line 17" }],
      isError: true,
      details: undefined,
    } satisfies ToolResultEvent;
    await emitPi(harness.handlers, "tool_result", readError, harness.ctx);
    expect(storage.loadLatest()?.reason).toBe("error");
    expect(storage.loadCounters().errors_seen).toBe(1);
    expect(storage.loadCounters().tests_failed).toBe(0);
  });
});
