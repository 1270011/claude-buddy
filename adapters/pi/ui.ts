import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Achievement } from "../../core/achievements.ts";
import type { Companion, ReactionState } from "../../core/model.ts";
import { renderAchievementsSummary, renderBuddyStatus, renderBuddyWidget } from "./renderers.ts";
import { PiBuddyStorage } from "./storage.ts";

export class PiBuddyUI {
  constructor(private readonly storage: PiBuddyStorage) {}

  refresh(
    ctx: ExtensionContext,
    companion: Companion,
    reaction?: ReactionState | null,
    achievements: Achievement[] = [],
  ): void {
    const muted = this.storage.isMuted();
    const status = renderBuddyStatus(companion, muted ? null : reaction);
    ctx.ui.setStatus("buddy", muted ? `${status} [muted]` : status);
    ctx.ui.setWidget(
      "buddy",
      renderBuddyWidget(companion, muted ? null : reaction, achievements),
    );
  }

  notifyAchievements(ctx: ExtensionContext, achievements: Achievement[]): void {
    for (const achievement of achievements) {
      ctx.ui.notify(`Unlocked: ${achievement.icon} ${achievement.name}`, "info");
    }
  }

  showAchievements(
    ctx: ExtensionContext,
    unlocked: Array<{ achievement: Achievement; unlockedAt: number; slot?: string }>,
    remaining: Achievement[],
  ): void {
    ctx.ui.setWidget("buddy", renderAchievementsSummary(unlocked, remaining));
    ctx.ui.notify(`Achievements: ${unlocked.length} unlocked`, "info");
  }
}
