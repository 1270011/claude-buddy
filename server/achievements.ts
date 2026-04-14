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
