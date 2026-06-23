/**
 * Memory-narrated milestones (game-feel FR-E3): occasional in-character lines
 * that reference REAL shared history — the lifetime event counters and the
 * streak record — so the companion reads as something that *witnesses* your
 * work rather than a generic flair generator. This is the compounding, never-
 * exhausted well: the more history exists, the more it can say.
 *
 * Gated to gameFeel=full by the caller (it's chattier than core reactions). This
 * module only produces a line — or null when history is too thin (fresh install)
 * — and avoids repeating the previous line back-to-back.
 */

import { loadEvents } from "./achievements.ts";
import { loadStreak } from "./streak.ts";

let lastCallback: string | null = null; // per-process; avoids an immediate repeat

/** Candidate callbacks drawn from real recorded history (counters + streak). */
export function historyCandidates(): string[] {
  const out: string[] = [];
  try {
    const e = loadEvents();
    if (e.bugs_resolved >= 1) {
      const n = e.bugs_resolved;
      out.push(`*remembers* we've squashed ${n} bug${n === 1 ? "" : "s"} together.`);
    }
    if (e.commits_made >= 10) {
      out.push(`${e.commits_made} commits and counting. we make a decent team.`);
    }
    if (e.errors_seen >= 25) {
      out.push(`we've stared down ${e.errors_seen} errors side by side.`);
    }
    if (e.large_diffs >= 10) {
      out.push(`${e.large_diffs} big refactors deep. brave of us.`);
    }
    if (e.days_active >= 7) {
      out.push(`*counts on tiny spines* ${e.days_active} days together now.`);
    }
  } catch {
    // Event counters optional on a fresh install.
  }
  try {
    const s = loadStreak();
    if (s.longest >= 3) {
      out.push(`our best run was ${s.longest} sessions straight. legendary.`);
    }
  } catch {
    // Streak state optional.
  }
  return out;
}

/**
 * A history-grounded callback line, or null when there isn't enough shared
 * history yet — in which case the caller falls back to its normal reaction
 * pool. `rng` is injectable for deterministic tests.
 */
export function historyCallback(rng: () => number = Math.random): string | null {
  const pool = historyCandidates();
  if (pool.length === 0) return null;
  const fresh = pool.filter((l) => l !== lastCallback);
  const choices = fresh.length > 0 ? fresh : pool;
  const pick = choices[Math.floor(rng() * choices.length)] ?? null;
  lastCallback = pick;
  return pick;
}
