#!/usr/bin/env bun
/**
 * Grant the name-caller easter egg (game-feel FR-D3): a hidden cosmetic flag
 * plus a one-shot discovery celebration. Invoked by hooks/name-react.sh once the
 * user has called the buddy by name enough times (the hook guards the count and
 * touches a sentinel so this fires only once). The flag grant is idempotent.
 */

import { grantCosmeticFlag } from "./xp";
import { loadCompanion, writeStatusState } from "./state";

grantCosmeticFlag("namecaller");

const companion = loadCompanion();
if (companion) {
  writeStatusState(companion, {
    celebration: {
      text: "🎁 you really like saying my name — secret unlocked!",
      kind: "discovery",
      at: Date.now(),
    },
    cause: undefined,
  });
}

console.log("easter egg granted: namecaller");
