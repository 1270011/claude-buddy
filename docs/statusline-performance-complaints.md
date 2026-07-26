# Statusline Performance Complaint Ledger

## 2026-07-26 — Follow-up 4

- Complaint: the deterministic statusline state regressed from the previously verified ~0.91–1.00 seconds to ~2.79–2.95 seconds at `COLUMNS=93`, risking Claude Code killing the statusline and blanking the companion.
- Scope: preserve deterministic width resolution and TTY/non-TTY test parity; do not touch dirty `adapters/` or `core/` work.
- Acceptance: three `COLUMNS=93` timings at or below 1.0 seconds, `bun test` green, and `script -q /dev/null bun test statusline/` green.
- Status: resolved; compressed emoji ranges removed the hot-path regression. Fresh timings were 0.76s, 0.72s, and 0.82s; `bun test` passed 417/417 and the TTY statusline suite passed 17/17.
