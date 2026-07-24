import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BashToolResultEvent,
  ExtensionAPI,
  ToolResultEvent,
  TurnEndEvent,
} from "@oh-my-pi/pi-coding-agent";
import type { AssistantMessage, Model } from "@oh-my-pi/pi-ai";
import { getBundledModels } from "@oh-my-pi/pi-catalog";
import type { Companion } from "../../core/model.ts";
import registerOmpBuddyExtension from "./index.ts";
import {
  deriveTurnComment,
  generateTurnComment,
  isOmpBashToolResult,
  type OmpBuddyLog,
  type TurnCommentCompleter,
} from "./events.ts";
import type { OmpBuddyContext, OmpBuddyUiContext } from "./context.ts";
import { OmpBuddyStorage } from "./storage.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type EventHandler = (event: unknown, context: OmpBuddyContext) => unknown | Promise<unknown>;
type CommandHandler = (args: string, context: OmpBuddyUiContext) => unknown | Promise<unknown>;
function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
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


function createHarness(stateDir: string) {
  const handlers = new Map<string, EventHandler>();
  const commands = new Map<string, CommandHandler>();
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  const widgets: Array<{ key: string; content: string[] | undefined }> = [];
  const notifications: Array<{ message: string; type: string | undefined }> = [];

  const extensionApi = {
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    registerCommand(
      name: string,
      command: { handler: CommandHandler },
    ) {
      commands.set(name, command.handler);
    },
  } as ExtensionAPI;

  const context = {
    ui: {
      setStatus(key: string, text: string | undefined) {
        statuses.push({ key, text });
      },
      setWidget(key: string, content: string[] | undefined) {
        widgets.push({ key, content });
      },
      notify(message: string, type?: "info" | "warning" | "error") {
        notifications.push({ message, type });
      },
    },
    model: undefined,
    modelRegistry: {
      find() {
        return undefined;
      },
      async getApiKey() {
        return undefined;
      },
      getProviderHeaders() {
        return undefined;
      },
    },
    sessionManager: {
      getBranch() {
        return [];
      },
    },
  } satisfies OmpBuddyContext;

  registerOmpBuddyExtension(extensionApi, { stateDir });
  return { commands, context, handlers, notifications, statuses, widgets };
}

async function emit(
  handlers: Map<string, EventHandler>,
  name: string,
  event: unknown,
  context: OmpBuddyContext,
): Promise<void> {
  const handler = handlers.get(name);
  expect(handler).toBeDefined();
  await handler?.(event, context);
}

describe("OMP extension behavior", () => {
  test("registers the command and all four lifecycle handlers", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omp-buddy-registration-"));
    temporaryDirectories.push(stateDir);
    const harness = createHarness(stateDir);

    expect([...harness.commands.keys()]).toEqual(["buddy"]);
    expect([...harness.handlers.keys()].sort()).toEqual([
      "input",
      "session_start",
      "tool_result",
      "turn_end",
    ]);
  });

  test("handles session, input, tool-result, turn-end, and command dispatch with native UI rendering", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omp-buddy-lifecycle-"));
    temporaryDirectories.push(stateDir);
    const harness = createHarness(stateDir);
    const storage = new OmpBuddyStorage(stateDir);
    storage.saveOmpConfig({ commentCooldown: 0 });

    await emit(harness.handlers, "session_start", { type: "session_start" }, harness.context);
    const companion = storage.loadActive();
    expect(companion).not.toBeNull();
    expect(harness.statuses.at(-1)?.key).toBe("buddy");
    expect(harness.widgets.at(-1)?.content?.join("\n")).toContain(companion?.name ?? "");
    expect(harness.notifications.some(({ message }) => message.includes("hatched"))).toBe(true);

    await emit(
      harness.handlers,
      "input",
      { type: "input", source: "interactive", text: `hello ${companion?.name}` },
      harness.context,
    );
    expect(storage.loadLatest()?.reason).toBe("turn");

    const bashResult: BashToolResultEvent = {
      type: "tool_result",
      toolCallId: "tool-1",
      toolName: "bash",
      input: { command: "bun test" },
      content: [{ type: "text", text: "command failed at line 17" }],
      isError: false,
      details: { exitCode: 1 },
    };
    expect(isOmpBashToolResult(bashResult)).toBe(true);
    await emit(harness.handlers, "tool_result", bashResult, harness.context);
    expect(storage.loadLatest()?.reason).toBe("error");

    const turnEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: assistantMessage(
        "The focused tests now pass for `adapters/omp/events.ts`.",
      ),
      toolResults: [],
    } satisfies TurnEndEvent;
    await emit(harness.handlers, "turn_end", turnEvent, harness.context);
    expect(storage.loadLatest()?.reaction).toContain("adapters/omp/events.ts");

    const buddyCommand = harness.commands.get("buddy");
    expect(buddyCommand).toBeDefined();
    await buddyCommand?.("pet", harness.context);
    expect(storage.loadLatest()?.reason).toBe("pet");
    expect(harness.statuses.length).toBeGreaterThanOrEqual(5);
    expect(harness.widgets.length).toBeGreaterThanOrEqual(5);
  });

  test("session_start increments sessions and active-day counters once", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omp-buddy-session-count-"));
    temporaryDirectories.push(stateDir);
    const harness = createHarness(stateDir);
    const storage = new OmpBuddyStorage(stateDir);
    storage.saveOmpConfig({ commentCooldown: 0 });

    await emit(harness.handlers, "session_start", { type: "session_start" }, harness.context);
    expect(storage.loadCounters().sessions).toBe(1);
    expect(storage.loadCounters().days_active).toBe(1);

    await emit(harness.handlers, "session_start", { type: "session_start" }, harness.context);
    expect(storage.loadCounters().sessions).toBe(2);
  });

  test("matches name mentions for punctuation and emoji-ending names", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omp-buddy-name-mention-"));
    temporaryDirectories.push(stateDir);
    const harness = createHarness(stateDir);
    const storage = new OmpBuddyStorage(stateDir);
    storage.saveOmpConfig({ commentCooldown: 0 });

    await emit(harness.handlers, "session_start", { type: "session_start" }, harness.context);
    const companion = storage.loadActive();
    expect(companion).not.toBeNull();

    await emit(
      harness.handlers,
      "input",
      { type: "input", source: "interactive", text: `${companion?.name}! you rock` },
      harness.context,
    );
    expect(storage.loadLatest()?.reason).toBe("turn");

    await emit(
      harness.handlers,
      "input",
      { type: "input", source: "interactive", text: `look at ${companion?.name}✨` },
      harness.context,
    );
    expect(storage.loadLatest()?.reason).toBe("turn");
  });

  test("classifies bash test failures before generic tool errors", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omp-buddy-test-failure-"));
    temporaryDirectories.push(stateDir);
    const harness = createHarness(stateDir);
    const storage = new OmpBuddyStorage(stateDir);
    storage.saveOmpConfig({ commentCooldown: 0 });

    await emit(harness.handlers, "session_start", { type: "session_start" }, harness.context);

    const bashResult: BashToolResultEvent = {
      type: "tool_result",
      toolCallId: "tool-2",
      toolName: "bash",
      input: { command: "bun test" },
      content: [{ type: "text", text: "2 tests failed" }],
      isError: true,
      details: { exitCode: 1 },
    };
    await emit(harness.handlers, "tool_result", bashResult, harness.context);

    expect(storage.loadLatest()?.reason).toBe("test-fail");
    expect(storage.loadCounters().tests_failed).toBe(1);
    expect(storage.loadCounters().errors_seen).toBe(0);
  });

  test("gates test/diff/success heuristics to bash results", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omp-buddy-non-execution-"));
    temporaryDirectories.push(stateDir);
    const harness = createHarness(stateDir);
    const storage = new OmpBuddyStorage(stateDir);
    storage.saveOmpConfig({ commentCooldown: 0 });

    await emit(harness.handlers, "session_start", { type: "session_start" }, harness.context);

    const readResult = {
      type: "tool_result",
      toolCallId: "tool-3",
      toolName: "read",
      input: { path: "/dev/null" },
      content: [{ type: "text", text: "2 tests failed" }],
      isError: false,
      details: undefined,
    } satisfies ToolResultEvent;
    await emit(harness.handlers, "tool_result", readResult, harness.context);
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
    await emit(harness.handlers, "tool_result", readError, harness.context);
    expect(storage.loadLatest()?.reason).toBe("error");
    expect(storage.loadCounters().errors_seen).toBe(1);
    expect(storage.loadCounters().tests_failed).toBe(0);
  });
});

const completionCompanion: Companion = {
  bones: {
    species: "owl",
    rarity: "common",
    shiny: false,
    eye: "·",
    hat: "none",
    peak: "WISDOM",
    dump: "CHAOS",
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 5, WISDOM: 90, SNARK: 40 },
  },
  name: "Nimbus",
  personality: "Careful and concise.",
  hatchedAt: 0,
  userId: "test-user",
};

describe("OMP turn-comment adaptation", () => {
  test("uses OMP getApiKey and provider headers for contextual completion", async () => {
    const calls: string[] = [];
    let completionOptions: Parameters<TurnCommentCompleter>[2] | undefined;
    const model = getBundledModels("openai")[0];
    if (!model) throw new Error("Expected an OpenAI model fixture.");
    const context = {
      ui: {
        notify() {},
        setStatus() {},
        setWidget() {},
      },
      model,
      modelRegistry: {
        find() {
          return model;
        },
        async getApiKey(selectedModel: Model) {
          calls.push(`key:${selectedModel.id}`);
          return "secret-key";
        },
        getProviderHeaders(provider: string) {
          calls.push(`headers:${provider}`);
          return { "x-provider-header": "present" };
        },
      },
      sessionManager: {
        getBranch() {
          return [];
        },
      },
    } satisfies OmpBuddyContext;
    const completeTurnComment: TurnCommentCompleter = async (selectedModel, _request, options) => {
      completionOptions = options;
      const response: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "*nods* the provider header made it through." }],
        api: selectedModel.api,
        provider: selectedModel.provider,
        model: selectedModel.id,
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
      return response;
    };
    const logger = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } satisfies OmpBuddyLog;
    const event = {
      type: "turn_end",
      turnIndex: 2,
      message: assistantMessage(
        "Updated the OMP credential adapter and verified the headers.",
      ),
      toolResults: [],
    } satisfies TurnEndEvent;

    const result = await generateTurnComment(
      context,
      completionCompanion,
      event,
      logger,
      completeTurnComment,
    );

    expect(calls).toEqual([`key:${model.id}`, "headers:openai"]);
    expect(completionOptions).toEqual({
      apiKey: "secret-key",
      headers: { "x-provider-header": "present" },
    });
    expect(result).toEqual({
      comment: "*nods* the provider header made it through.",
      source: "llm",
    });
  });

  test("falls back deterministically when no completion model is available", () => {
    const message = assistantMessage(
      "The focused tests for `core/engine.ts` now pass.",
    );

    const first = deriveTurnComment(completionCompanion, message);
    const second = deriveTurnComment(completionCompanion, message);
    expect(first).toBe("*takes note* core/engine.ts got the attention this turn.");
    expect(second).toBe(first);
  });
});
