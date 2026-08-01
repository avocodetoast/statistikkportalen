#!/usr/bin/env bash
#
# Oppdaterer ÉN kilde i katalogindeksen og regenererer SEO-sidene.
#
# HVORFOR PER KILDE: SSB, Norges Bank og FHI publiserer på ulike tidspunkt, og
# hver kilde har derfor sin egen cron-oppføring. Byggeren tar --source og bærer
# de øvrige kildenes shards videre uendret, så en kjøring for én kilde rører
# aldri de andre.
#
# HVORFOR PÅ SERVEREN OG IKKE I GITHUB ACTIONS: data/sources/ må overleve
# mellom kjøringer. I Actions ville det krevd en commit per kjøring — med ti
# kjøringer i døgnet blir det tusenvis i året. Serveren har filsystemet
# allerede, og cron treffer et tidspunkt (GitHubs scheduler er «best effort»
# og kan bli forsinket titalls minutter).
#
# Bruk:
#   bin/refresh.sh ssb|nb|fhi
#
# Konfigurasjon leses fra en .env ved siden av repoet (samme mappe som denne
# fila ligger i overordnet til):
#   SITE_URL=https://statistikkportalen.no      (påkrevd)
#   CF_API_TOKEN=...                            (valgfri — cache-purge)
#   CF_ZONE_ID=...                              (valgfri — cache-purge)
#   HEALTHCHECK_SSB=https://hc-ping.com/<uuid>  (valgfri — dead man's switch)
#   HEALTHCHECK_NB=...
#   HEALTHCHECK_FHI=...
#
# Cron (tidspunktene er eksempler — juster etter kildenes publisering):
#   15 6,10,14 * * *  cd ~/statistikkportalen && bin/refresh.sh ssb >> log/ssb.log 2>&1
#   15 7,15    * * *  cd ~/statistikkportalen && bin/refresh.sh nb  >> log/nb.log  2>&1
#   45 5       * * 0  cd ~/statistikkportalen && bin/refresh.sh fhi >> log/fhi.log 2>&1

set -euo pipefail

SOURCE="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  . "$ROOT/.env"
fi

log() { printf '[refresh:%s] %s — %s\n' "${SOURCE:-?}" "$(date -Is)" "$*"; }
fail() { printf '[refresh:%s] FEIL: %s\n' "${SOURCE:-?}" "$*" >&2; exit 1; }

# Argumentet valideres før konfigurasjonen: en typo i cron-oppføringen skal gi
# en lesbar feil, ikke en klage over en .env som er helt i orden.
case "$SOURCE" in
  ssb|nb|fhi) ;;
  *) fail "ukjent kilde «${SOURCE}». Bruk: $0 ssb|nb|fhi" ;;
esac

[ -n "${SITE_URL:-}" ] || fail "SITE_URL er ikke satt (se .env)."

log "start"

# ---------------------------------------------------------------------------
# 1) Kildedata. SSB har ingen byggetidsfil — /tables hentes live av byggeren.
# ---------------------------------------------------------------------------
case "$SOURCE" in
  ssb)
    ;;
  nb)
    node scripts/update-nb-periods.mjs
    ;;
  fhi)
    if [ -f data/sources/fhi-catalog.json ]; then
      node scripts/update-fhi-catalog.mjs --incremental --rate 120
    else
      # Førstegangskjøring: --incremental har ingen katalog å sammenlikne mot.
      log "ingen fhi-catalog.json — kjører full build (~740 kall)"
      node scripts/update-fhi-catalog.mjs --rate 120
    fi
    ;;
esac

# ---------------------------------------------------------------------------
# 2) Indeks + sider. Feiler byggeren, er ingenting skrevet, og set -e stopper
#    før SEO-steget — ellers ville sidene bygget mot en indeks som ikke ble
#    oppdatert.
# ---------------------------------------------------------------------------
node scripts/build-catalog-index.mjs --webroot . --source "$SOURCE"
node scripts/generate-seo-pages.mjs --webroot . --site "$SITE_URL"

# ---------------------------------------------------------------------------
# 3) Cache. Kun manifestet og sitemap tømmes — shardene er innholdshashet og
#    ligger under «immutable», så en full purge ti ganger i døgnet ville bare
#    revet ned treffraten på alt annet uten å gjøre noen nytte.
# ---------------------------------------------------------------------------
if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_ZONE_ID:-}" ]; then
  response=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"files\":[\"${SITE_URL}/data/index/catalog-manifest.json\",\"${SITE_URL}/sitemap.xml\"]}")
  if printf '%s' "$response" | grep -q '"success":true'; then
    log "cache tømt (manifest + sitemap)"
  else
    # Sida er oppdatert uansett — en feilet purge skal ikke felle kjøringen.
    log "ADVARSEL: cache-purge feilet: $response"
  fi
fi

# ---------------------------------------------------------------------------
# 4) Dead man's switch. Actions varsler på feilede jobber; cron er stille — og
#    en cron som slutter å kjøre er den farligste feilen her, for portalen ser
#    frisk ut med gamle tall. Pinges denne ikke innen forventet vindu, varsler
#    tjenesten. Den dekker både «scriptet feilet» og «cron kjørte aldri».
# ---------------------------------------------------------------------------
hc_var="HEALTHCHECK_$(printf '%s' "$SOURCE" | tr '[:lower:]' '[:upper:]')"
hc_url="${!hc_var:-}"
if [ -n "$hc_url" ]; then
  curl -fsS -m 10 --retry 3 "$hc_url" > /dev/null && log "pinget $hc_var"
fi

log "ferdig"
