#!/usr/bin/env bash
# PostToolUse-hook: rask statisk sjekk etter at en kildefil er endret.
#
# Leser hook-payloaden på stdin, plukker ut filstien, og kjører `npm run check`
# (~1 s) bare når endringen faktisk berører noe sjekken dekker — js/, css/,
# data/sources/ eller index.html. Alt annet (markdown, tester, fixtures)
# hopper rett ut, så hooken er usynlig når den ikke trengs.
#
# Exit 2 = blokkerende feil: stderr sendes tilbake til Claude, som må rette
# opp før den blir ferdig. Exit 0 ellers.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)

[ -z "$file" ] && exit 0

case "$file" in
  */js/*|*/css/*|*/data/sources/*|*/index.html) ;;
  *) exit 0 ;;
esac

output=$(cd "$ROOT" && npm run check 2>&1)
status=$?

if [ $status -ne 0 ]; then
  {
    echo "npm run check feilet etter endring i $file:"
    echo
    echo "$output"
  } >&2
  exit 2
fi

exit 0
