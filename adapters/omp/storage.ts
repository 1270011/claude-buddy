import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileBuddyStorage,
  slugifySlot,
  type FileBuddyConfig,
} from "../shared/file-storage.ts";

export const DEFAULT_OMP_BUDDY_STATE_DIR = join(homedir(), ".omp", "agent", "buddy");

export class OmpBuddyStorage extends FileBuddyStorage {
  constructor(stateDir = DEFAULT_OMP_BUDDY_STATE_DIR) {
    super(stateDir);
  }

  loadOmpConfig(): FileBuddyConfig {
    return this.loadHostConfig();
  }

  saveOmpConfig(config: Partial<FileBuddyConfig>): FileBuddyConfig {
    return this.saveHostConfig(config);
  }
}

export { slugifySlot };
