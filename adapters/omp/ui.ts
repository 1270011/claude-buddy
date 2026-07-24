import type { OmpBuddyUiContext } from "./context.ts";
import type { Achievement } from "../../core/achievements.ts";
import type { Companion, ReactionState } from "../../core/model.ts";
import { renderAchievementsSummary, renderBuddyStatus, renderBuddyWidget } from "./renderers.ts";
import { OmpBuddyStorage } from "./storage.ts";

export class OmpBuddyUI {
  constructor(private readonly storage: OmpBuddyStorage) {}

  refresh(
    ctx: OmpBuddyUiContext,
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

  notifyAchievements(ctx: OmpBuddyUiContext, achievements: Achievement[]): void {
    for (const achievement of achievements) {
      ctx.ui.notify(`Unlocked: ${achievement.icon} ${achievement.name}`, "info");
    }
  }

  showAchievements(
    ctx: OmpBuddyUiContext,
    unlocked: Array<{ achievement: Achievement; unlockedAt: number; slot?: string }>,
    remaining: Achievement[],
  ): void {
    ctx.ui.setWidget("buddy", renderAchievementsSummary(unlocked, remaining));
    ctx.ui.notify(`Achievements: ${unlocked.length} unlocked`, "info");
  }
}
