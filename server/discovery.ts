/**
 * Self-announcing discovery (game-feel FR-E4): the buddy mentions a new system
 * once — transiently, via the celebration channel — then never again. No
 * permanent status-line chrome is added (NFR6). State is a tiny set of announced
 * ids in discovery.json, account-scoped via buddyStateDir().
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "./path.ts";

interface DiscoveryState {
  announced: string[];
}

function discoveryFile(): string {
  return join(buddyStateDir(), "discovery.json");
}

function load(): DiscoveryState {
  try {
    const p = JSON.parse(
      readFileSync(discoveryFile(), "utf8"),
    ) as Partial<DiscoveryState>;
    return { announced: Array.isArray(p.announced) ? p.announced : [] };
  } catch {
    return { announced: [] };
  }
}

function save(state: DiscoveryState): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const file = discoveryFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(state));
  }
}

/**
 * Returns true exactly once per id (and records it), false every time after.
 * Best-effort: any I/O error yields false so a discovery never breaks a write.
 */
export function announceOnce(id: string): boolean {
  try {
    const state = load();
    if (state.announced.includes(id)) return false;
    state.announced.push(id);
    save(state);
    return true;
  } catch {
    return false;
  }
}

/** Whether an id has already been announced (no mutation). */
export function alreadyAnnounced(id: string): boolean {
  return load().announced.includes(id);
}
