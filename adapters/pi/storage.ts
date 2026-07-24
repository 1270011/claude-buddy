import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileBuddyStorage,
  slugifySlot,
  type FileBuddyConfig,
} from "../shared/file-storage.ts";

export const DEFAULT_PI_BUDDY_STATE_DIR = join(homedir(), ".pi", "agent", "buddy");

export class PiBuddyStorage extends FileBuddyStorage {
  constructor(stateDir = DEFAULT_PI_BUDDY_STATE_DIR) {
    super(stateDir);
  }

  loadPiConfig(): FileBuddyConfig {
    return this.loadHostConfig();
  }

  savePiConfig(config: Partial<FileBuddyConfig>): FileBuddyConfig {
    return this.saveHostConfig(config);
  }
}

export { slugifySlot };
