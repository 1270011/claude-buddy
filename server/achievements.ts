// Compatibility layer for legacy server/* imports.
// Static achievement definitions live in core/achievements.ts, while the
// Claude-specific persistence and rendering helpers now live under
// adapters/claude/storage/achievements.ts.
export {
  ACHIEVEMENTS,
  COUNTER_KEYS,
  GLOBAL_KEYS,
  SLOT_KEYS,
  type Achievement,
  type EventCounters,
  type GlobalCounters,
  type SlotCounters,
} from "../core/achievements.ts";
export type { UnlockedAchievement } from "../core/model.ts";
export {
  loadUnlocked,
  loadEvents,
  incrementEvent,
  checkAndAward,
  trackActiveDay,
  renderAchievementsCard,
  renderAchievementsCardMarkdown,
} from "../adapters/claude/storage/achievements.ts";
