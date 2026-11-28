#!/usr/bin/env bash
set -euo pipefail

site="${SITE_URL:-https://melnixdev.github.io/seo-crawl-audit}"
site="${site%/}"
host="${site#https://}"
host="${host%%/*}"
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
nonce="$(date -u +%s)-$$"
failures=0
resolve_args=()
if [[ -n "${ORIGIN_IP:-}" ]]; then
  resolve_args=(--resolve "$host:443:$ORIGIN_IP")
fi

check() {
  local expected="$1" path="$2" status
  local base="${3:-$site}"
  if ! status="$(curl -q --proto '=https' --silent --show-error \
      --connect-timeout 8 --max-time 20 --retry 2 --max-filesize 25000000 \
      --header 'Cache-Control: no-cache' ${resolve_args[@]+"${resolve_args[@]}"} \
      --output "$body" --write-out '%{http_code}' "$base$path?security-smoke=$nonce")"; then
    printf 'FAIL %s (request failed)\n' "$path" >&2
    failures=$((failures + 1))
    return
  fi
  if [[ ! "$status" =~ ^($expected)$ ]]; then
    printf 'FAIL %s (expected %s, got %s)\n' "$path" "$expected" "$status" >&2
    failures=$((failures + 1))
  elif [[ "$expected" == '403|404' ]] && LC_ALL=C grep -aqE '<\?php|^[[:space:]]*(RewriteEngine|parameters:|\$databases|"require"[[:space:]]*:|DB_PASSWORD=|CREATE TABLE|\[core\])' "$body"; then
    printf 'FAIL %s (source or configuration marker in response)\n' "$path" >&2
    failures=$((failures + 1))
  else
    printf 'OK   %s (%s)\n' "$path" "$status"
  fi
}

for path in / /plugins/ /demo/ /report.html /regression-demo/failed.html /regression-demo/passed.html \
    /site.css /agent-prompt.js /plugins/installation-prompts.js /media/logo.png \
    /media/native-report-pages.png /robots.txt /sitemap.xml; do
  check 200 "$path"
done

for path in /.htaccess /.env /.env.local /.git/HEAD /.git/config /backup.zip \
    /dump.sql /error.log /index.html.bak /index.html.old /.index.html.swp /.vscode/settings.json \
    /src/ /src/index.ts /config.json /seo-audit.config.json /.seo-guard.json \
    /package.json /package-lock.json /yarn.lock /pnpm-lock.yaml /node_modules/ \
    /packages/cli/src/cli.ts /media/demo-fixture.mjs /agent-prompt.js.map /site.css.map \
    /composer.json /composer.lock; do
  check '403|404' "$path"
done

check 404 "/missing-security-smoke-$nonce"
# This Pages project does not publish a security.txt. 404 means absent and 403 means blocked.
check '200|404' '/.well-known/'
check '200|404' '/.well-known/security.txt'
check '200|404' '/.well-known/' "https://$host"
check '200|404' '/.well-known/security.txt' "https://$host"

if (( failures > 0 )); then
  printf 'Production security smoke failed (%s checks).\n' "$failures" >&2
  exit 1
fi
printf 'Production security smoke passed.\n'
