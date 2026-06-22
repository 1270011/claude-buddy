#!/usr/bin/env bash
# statusline/combined-status.sh
# "Combined" mode entrypoint. The metrics row (model/context/usage/reset) is
# now built natively inside buddy-status.sh's own stats column — gated on
# config.useCombinedStatus — so this just delegates straight through.
exec "$(dirname "${BASH_SOURCE[0]}")/buddy-status.sh"
