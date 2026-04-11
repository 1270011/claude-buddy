#!/usr/bin/env bash
# claude-buddy popup entry point -- runs INSIDE the tmux popup
#
# Architecture:
#   - Render loop runs in BACKGROUND (only writes to stdout, never reads stdin)
#   - Input forwarder runs in FOREGROUND (owns stdin exclusively)
#
# The reopen loop in popup-manager.sh handles:
#   - ESC forwarding (when tmux closes popup on ESC)
#   - CC pane death detection
#   - Dynamic resizing on reopen
#
# Env vars (set by popup-manager.sh via -e):
#   CC_PANE    -- tmux pane ID for Claude Code (e.g. %0)
#   BUDDY_DIR  -- ~/.claude-buddy
#   BUDDY_SID  -- session ID (sanitized pane number, e.g. "0")
# Args: $1 = SID (fallback for tmux < 3.4 without -e support)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Session ID: from env (tmux 3.4+), $1 arg, or "default"
BUDDY_SID="${BUDDY_SID:-${1:-default}}"

# On tmux 3.2-3.3, env vars are passed via file (no -e flag support)
ENV_FILE="${HOME}/.claude-buddy/popup-env.$BUDDY_SID"
if [ -z "${CC_PANE:-}" ] && [ -f "$ENV_FILE" ]; then
  . "$ENV_FILE"
fi

if [ -z "${CC_PANE:-}" ]; then
  echo "Error: CC_PANE not set" >&2
  sleep 2
  exit 1
fi

# ─── Cleanup on exit ─────────────────────────────────────────────────────────
cleanup() {
  [ -n "${RENDER_PID:-}" ] && kill "$RENDER_PID" 2>/dev/null
  tput cnorm 2>/dev/null
  stty sane 2>/dev/null
}
trap cleanup EXIT INT TERM HUP

# Hide cursor
tput civis 2>/dev/null

# ─── Render loop in BACKGROUND (stdout only, no stdin) ───────────────────────
"$SCRIPT_DIR/buddy-render.sh" </dev/null &
RENDER_PID=$!

# ─── Input forwarder in FOREGROUND ───────────────────────────────────────────
# Raw mode: all bytes pass through without terminal interpretation.
# No SIGINT on Ctrl-C, no EOF on Ctrl-D, no CR-to-NL on Enter.
stty raw -echo 2>/dev/null

# Use perl for raw byte forwarding. bash's read -n1 internally overrides
# terminal settings on each call (saves/restores tty mode), which undoes
# stty raw and re-enables signal processing. perl's sysread doesn't touch
# the terminal at all -- it reads raw bytes from the file descriptor.
#
# Batching: first byte is a blocking read, then non-blocking drain of any
# remaining bytes (paste arrives as a burst). The batch is sent to CC in
# a single tmux send-keys call for efficiency.
exec perl -e '
  use Fcntl qw(F_GETFL F_SETFL O_NONBLOCK);
  my $pane = $ENV{CC_PANE};
  while (1) {
    my $buf;
    my $n = sysread(STDIN, $buf, 1);
    last unless $n;
    # Non-blocking drain for paste batching
    my $flags = fcntl(STDIN, F_GETFL, 0);
    fcntl(STDIN, F_SETFL, $flags | O_NONBLOCK);
    while (sysread(STDIN, my $more, 4096)) {
      $buf .= $more;
    }
    fcntl(STDIN, F_SETFL, $flags);

    # F12 (\e[24~) = close popup and enter scroll mode
    if ($buf =~ /\e\[24~/) {
      my $buddy_dir = $ENV{BUDDY_DIR} || "$ENV{HOME}/.claude-buddy";
      my $sid = $ENV{BUDDY_SID} // "default";
      open(my $fh, ">", "$buddy_dir/popup-scroll.$sid");
      close($fh) if $fh;
      exit 0;
    }

    system("tmux", "send-keys", "-t", $pane, "-l", "--", $buf);
  }
'
