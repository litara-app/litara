#!/usr/bin/env bash
# Shared by check.sh and e2e.sh: stop early, with a clear message, when a port the browser tests need is taken.
# (A leftover local server on 8091/8092/8098/8099 otherwise makes tests hit the wrong application.)
require_free_ports() {
  local busy=""
  for p in "$@"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then busy="$busy $p"; fi
  done
  if [ -n "$busy" ]; then
    echo "error: port(s)$busy on 127.0.0.1 are already in use. Stop the local server using them and retry." >&2
    exit 2
  fi
}
