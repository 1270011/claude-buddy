import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Achievement } from "../../core/achievements.ts";
import type { Companion, ReactionState } from "../../core/model.ts";
import { renderAchievementsSummary, renderBuddyStatus, renderBuddyWidget } from "./renderers.ts";
import { PiBuddyStorage } from "./storage.ts";

type PiBuddyUiContext = ExtensionContext & {
  setTimeout?: (callback: () => void, ms?: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

export class PiBuddyUI {
  private readonly timers: Array<{ timer: Timer; clear: (timer: Timer) => void }> = [];

  constructor(private readonly storage: PiBuddyStorage) {}

  cancelTimers(): void {
    for (const { timer, clear } of this.timers.splice(0)) {
      try {
        clear(timer);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }

  refresh(
    ctx: PiBuddyUiContext,
    companion: Companion,
    reaction?: ReactionState | null,
    achievements: Achievement[] = [],
  ): void {
    const currentReaction = reaction ?? null;
    const muted = this.storage.isMuted();
    const status = renderBuddyStatus(companion, muted ? null : currentReaction);
    ctx.ui.setStatus("buddy", muted ? `${status} [muted]` : status);
    ctx.ui.setWidget(
      "buddy",
      renderBuddyWidget(companion, muted ? null : currentReaction, achievements),
    );

    this.cancelTimers();
    if (!currentReaction) return;

    const ttl = this.storage.loadConfig().reactionTTL;
    if (ttl <= 0) return;

    const scheduler = getScheduler(ctx);
    if (!scheduler) return;

    const reactionTimestamp = currentReaction.timestamp;
    const delay = Math.max(0, reactionTimestamp + ttl * 1000 + 1 - Date.now());
    const timer = scheduler.setTimeout(() => {
      const latest = this.storage.loadLatest();
      if (latest && latest.timestamp >= reactionTimestamp) {
        this.refresh(ctx, companion, latest, []);
      } else {
        this.refresh(ctx, companion, null, []);
      }
    }, delay);
    this.timers.push({ timer, clear: scheduler.clearTimer });
  }

  notifyAchievements(ctx: PiBuddyUiContext, achievements: Achievement[]): void {
    for (const achievement of achievements) {
      ctx.ui.notify(`Unlocked: ${achievement.icon} ${achievement.name}`, "info");
    }
  }

  showAchievements(
    ctx: PiBuddyUiContext,
    unlocked: Array<{ achievement: Achievement; unlockedAt: number; slot?: string }>,
    remaining: Achievement[],
  ): void {
    ctx.ui.setWidget("buddy", renderAchievementsSummary(unlocked, remaining));
    ctx.ui.notify(`Achievements: ${unlocked.length} unlocked`, "info");
  }
}

function getScheduler(
  ctx: PiBuddyUiContext,
): { setTimeout: (callback: () => void, ms?: number) => Timer; clearTimer: (timer: Timer) => void } | null {
  if (typeof ctx.setTimeout === "function" && typeof ctx.clearTimer === "function") {
    return { setTimeout: ctx.setTimeout, clearTimer: ctx.clearTimer };
  }
  if (typeof globalThis.setTimeout === "function" && typeof globalThis.clearTimeout === "function") {
    return { setTimeout: globalThis.setTimeout, clearTimer: globalThis.clearTimeout };
  }
  return null;
}
