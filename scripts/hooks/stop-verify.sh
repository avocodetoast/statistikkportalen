#!/usr/bin/env bash
# Stop-hook: full verifisering når Claude er ferdig med et svar.
#
# Kjører `npm run verify` (check + enhetstester + E2E, ~15 s), men BARE hvis
# arbeidstreet faktisk har ucommittede endringer i kode. Uten den porten ville
# hver rene spørsmål-og-svar-runde kostet 15 sekunder til ingen nytte.
#
# Er treet skittent i js/, css/, data/, scripts/, tests/ eller index.html, er
# det nettopp da en regresjon kan ligge ute — så da kjøres hele suiten.
#
# Exit 2 = blokkerende feil: stderr sendes tilbake til Claude, som må rette
# opp. Exit 0 ellers.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0

# Kjører vi allerede FORDI denne hooken blokkerte forrige gang? Da må vi slippe
# taket. Uten denne porten blir en verify-feil modellen ikke får fikset — flaky
# nettleser, eller en halvferdig endring brukeren selv ba om å få stå — en runde
# som ikke kan avsluttes.
payload=$(cat)
if [ "$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  exit 0
fi

# Ingen git = ingen måte å vite hva som er endret; kjør heller ikke noe.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changed=$(git status --porcelain -- js css data scripts tests index.html package.json 2>/dev/null)
[ -z "$changed" ] && exit 0

output=$(npm run verify 2>&1)
status=$?

if [ $status -ne 0 ]; then
  {
    echo "npm run verify feilet. Rett opp før du avslutter."
    echo
    echo "$output" | tail -60
  } >&2
  exit 2
fi

exit 0
