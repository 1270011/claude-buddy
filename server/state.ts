// Compatibility layer for legacy server/* imports.
// Claude-specific state, identity, and status-line helpers now live under
// adapters/claude/storage/*.
export * from "../adapters/claude/storage/state.ts";
export { resolveUserId } from "../adapters/claude/storage/identity.ts";
export { setBuddyStatusLine, unsetBuddyStatusLine, cleanupPluginState } from "../adapters/claude/storage/settings.ts";
