import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { BuddyCommandService } from "../../core/command-service.ts";
import { renderBuddyStats } from "./renderers.ts";
import { PiBuddyStorage, slugifySlot } from "./storage.ts";
import { PiBuddyUI } from "./ui.ts";

interface RegisterBuddyCommandsDeps {
  service: BuddyCommandService;
  storage: PiBuddyStorage;
  ui: PiBuddyUI;
}

export function registerBuddyCommands(pi: ExtensionAPI, deps: RegisterBuddyCommandsDeps): void {
  pi.registerCommand("buddy", {
    description: "Manage your coding buddy",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const input = args.trim();
      const [command, ...rest] = input ? input.split(/\s+/) : [];
      const remainder = rest.join(" ").trim();

      try {
        switch (command) {
          case undefined:
          case "show": {
            const result = deps.service.ensureCompanion();
            deps.service.incrementCommandsRun();
            const reaction = deps.storage.loadLatest();
            deps.ui.refresh(ctx, result.companion, reaction, result.achievements);
            if (result.created) {
              ctx.ui.notify(`Meet ${result.companion.name}!`, "info");
            } else {
              ctx.ui.notify(deps.service.formatCompanionSummary(result.companion), "info");
            }
            return;
          }

          case "pet": {
            deps.service.incrementCommandsRun();
            const result = deps.service.petBuddy();
            deps.ui.refresh(ctx, result.companion, result.state, result.achievements);
            ctx.ui.notify(`${result.companion.name} seems pleased.`, "info");
            deps.ui.notifyAchievements(ctx, result.achievements);
            return;
          }

          case "stats": {
            deps.service.incrementCommandsRun();
            const result = deps.service.ensureCompanion();
            ctx.ui.setWidget("buddy", renderBuddyStats(result.companion));
            ctx.ui.notify(`${result.companion.name}'s stats`, "info");
            return;
          }

          case "rename": {
            if (!remainder) throw new Error("Usage: /buddy rename <name>");
            deps.service.incrementCommandsRun();
            const companion = deps.service.renameBuddy(remainder);
            deps.ui.refresh(ctx, companion, deps.storage.loadLatest());
            ctx.ui.notify(`Buddy renamed to ${companion.name}.`, "info");
            return;
          }

          case "personality": {
            if (!remainder) throw new Error("Usage: /buddy personality <text>");
            deps.service.incrementCommandsRun();
            const companion = deps.service.setPersonality(remainder);
            deps.ui.refresh(ctx, companion, deps.storage.loadLatest());
            ctx.ui.notify(`${companion.name}'s personality was updated.`, "info");
            return;
          }

          case "off": {
            deps.service.incrementCommandsRun();
            deps.storage.setMuted(true);
            const result = deps.service.ensureCompanion();
            deps.ui.refresh(ctx, result.companion, null);
            ctx.ui.notify(`${result.companion.name} goes quiet.`, "info");
            return;
          }

          case "on": {
            deps.service.incrementCommandsRun();
            deps.storage.setMuted(false);
            const result = deps.service.recordComment("*stretches* I'm back!");
            deps.ui.refresh(ctx, result.companion, result.state, result.achievements);
            ctx.ui.notify(`${result.companion.name} is back.`, "info");
            deps.ui.notifyAchievements(ctx, result.achievements);
            return;
          }

          case "save": {
            deps.service.incrementCommandsRun();
            const result = deps.service.saveBuddy(remainder || undefined);
            deps.ui.refresh(ctx, result.companion, deps.storage.loadLatest());
            ctx.ui.notify(`Saved ${result.companion.name} to [${result.slot}].`, "info");
            return;
          }

          case "summon": {
            deps.service.incrementCommandsRun();
            const result = deps.service.summonBuddy(remainder || undefined);
            if (!result) throw new Error("No saved buddy found for that slot.");
            deps.ui.refresh(ctx, result.companion, deps.storage.loadLatest());
            ctx.ui.notify(`${result.companion.name} arrives from [${result.slot}].`, "info");
            return;
          }

          case "list": {
            deps.service.incrementCommandsRun();
            const active = deps.storage.loadActiveSlot();
            const companions = deps.service.listCompanions();
            if (companions.length === 0) {
              ctx.ui.notify("No saved buddies yet.", "info");
              return;
            }
            ctx.ui.setWidget(
              "buddy",
              companions.map(({ slot, companion }) => {
                const marker = slot === active ? " ← active" : "";
                return `${companion.name} [${slot}] — ${companion.bones.rarity} ${companion.bones.species}${marker}`;
              }),
            );
            ctx.ui.notify(`Saved buddies: ${companions.length}`, "info");
            return;
          }

          case "dismiss": {
            if (!remainder) throw new Error("Usage: /buddy dismiss <slot>");
            deps.service.incrementCommandsRun();
            const result = deps.service.dismissBuddy(remainder);
            const active = deps.service.ensureCompanion();
            deps.ui.refresh(ctx, active.companion, deps.storage.loadLatest());
            ctx.ui.notify(`Dismissed ${result.companion.name} [${result.slot}].`, "info");
            return;
          }

          case "achievements": {
            deps.service.incrementCommandsRun();
            const activeSlot = deps.storage.loadActiveSlot() ?? undefined;
            const progress = deps.service.getAchievementProgress(activeSlot);
            deps.ui.showAchievements(ctx, progress.unlocked, progress.remaining);
            return;
          }

          case "help":
          default: {
            ctx.ui.setWidget("buddy", [
              "/buddy",
              "/buddy pet",
              "/buddy stats",
              "/buddy rename <name>",
              "/buddy personality <text>",
              "/buddy off | on",
              "/buddy save [slot]",
              "/buddy summon [slot]",
              "/buddy list",
              "/buddy dismiss <slot>",
              "/buddy achievements",
            ]);
            ctx.ui.notify("Buddy commands ready.", "info");
            return;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
        if (command === "save" && remainder) {
          ctx.ui.notify(`Try a different slot, for example: ${slugifySlot(remainder)}-2`, "info");
        }
      }
    },
  });
}
