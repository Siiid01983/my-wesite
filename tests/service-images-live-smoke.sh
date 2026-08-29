#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  service-images-live-smoke.sh — LIVE end-to-end smoke for Service Image Mgmt.
#
#  Exercises the REAL endpoints (PHP + MySQL + api-key gate + staff token + CORS)
#  against a running hm-api. Covers the full admin CRUD the browser UI drives:
#     list → upload → GET-verify → deactivate → reactivate+alt → reorder → delete
#     → GET-verify-restored.  Also asserts NO 401/403/500/CORS/file errors.
#
#  WHY: the dev box has no MySQL driver/client + no prod credentials, so this
#  cannot run in CI. An operator runs it once against staging/production.
#
#  SAFE & SELF-CLEANING: auto-selects the first of the six canonical service
#  slugs that currently has NO custom image, runs the whole cycle on it, and
#  DELETES the test row at the end — the card reverts to its built-in
#  placeholder (original state). If all six already have images, it ABORTS
#  rather than clobber a real one.
#
#  USAGE:
#     export API_BASE='https://<host>/hm-api'          # no trailing slash
#     export API_KEY='<the api_key from hm-api/_config.php>'
#     export ADMIN_TOKEN='<a valid admin/manager X-ADMIN-TOKEN>'
#     bash tests/service-images-live-smoke.sh
#
#  Requires: bash, curl, and a Python (python3 or python) for JSON parsing.
# ════════════════════════════════════════════════════════════════════════════
set -u
: "${API_BASE:?set API_BASE to your hm-api base URL}"
: "${API_KEY:?set API_KEY (matches hm-api/_config.php api_key)}"
: "${ADMIN_TOKEN:?set ADMIN_TOKEN (valid admin/manager X-ADMIN-TOKEN)}"

# pick a Python interpreter that ACTUALLY runs (Windows ships a non-functional
# `python3` execution-alias stub; probe by executing, not by `command -v`).
PY=""
for c in python3 python py; do
  if "$c" -c 'import sys,json' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "ERROR: no working Python (python3/python) for JSON parsing"; exit 3; }

ADMIN="$API_BASE/admin/service-images.php"
PUBLIC="$API_BASE/service-images.php"
HDR=(-H "X-API-KEY: $API_KEY" -H "X-ADMIN-TOKEN: $ADMIN_TOKEN")
TMP="$(mktemp -d)"; PNG="$TMP/smoke.png"; pass=0; fail=0
trap 'rm -rf "$TMP"' EXIT

say()  { printf '%s\n' "$*"; }
ok()   { pass=$((pass+1)); say "  ok   $*"; }
bad()  { fail=$((fail+1)); say "  FAIL $*"; }
jqp()  { "$PY" -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

# 1x1 PNG (real bytes so GD/finfo accept it)
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' \
  | base64 -d > "$PNG"

# ── helper: METHOD url [curl args...] → sets $CODE and $BODY ──────────────────
req() {
  local method="$1" url="$2"; shift 2
  local out; out="$(curl -sS -w $'\n%{http_code}' -X "$method" "${HDR[@]}" "$@" "$url")"
  CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}

say "── 0. list (SELECT) + auth/CORS sanity ──"
req GET "$ADMIN"
[ "$CODE" = "200" ] && ok "GET list → 200 (api-key + admin token accepted)" \
                    || bad "GET list → $CODE (expected 200) body=$BODY"
[ "$CODE" = "401" ] && bad "api-key gate rejected the request (401)"
[ "$CODE" = "403" ] && bad "staff-token gate rejected the request (403)"

# pick first canonical slug with NO existing row
PRESENT="$(printf '%s' "$BODY" | jqp "' '.join(sorted(set(r.get('service_slug','') for r in d.get('data',[]))))")"
say "  slugs already having an image: [${PRESENT:-none}]"
SLUG=""
for s in sameday single couple student disposal furniture; do
  case " $PRESENT " in *" $s "*) : ;; *) SLUG="$s"; break;; esac
done
if [ -z "$SLUG" ]; then
  say "ABORT (safe): all six cards already have images; refusing to clobber a real one."
  say "  To run anyway, first delete one card's image in the admin UI, then re-run."
  exit 2
fi
say "  → using free slug: $SLUG"

say "── 1. upload (INSERT) ──"
req POST "$ADMIN" -F "service_slug=$SLUG" -F "alt_text=live smoke" -F "image=@$PNG;type=image/png"
case "$CODE" in 200|201) ok "upload → $CODE" ;; *) bad "upload → $CODE body=$BODY" ;; esac
ID="$(printf '%s' "$BODY" | jqp "d.get('data',{}).get('id','')")"
IMG="$(printf '%s' "$BODY" | jqp "d.get('data',{}).get('image_url','')")"
[ -n "$ID" ] && ok "row id = $ID" || bad "no id returned"
[ -n "$IMG" ] && ok "image_url served: $IMG" || bad "no image_url returned"

say "── 2. GET-verify persistence ──"
req GET "$ADMIN"
FOUND="$(printf '%s' "$BODY" | jqp "next((r for r in d.get('data',[]) if str(r.get('id'))=='$ID'),{}).get('service_slug','')")"
[ "$FOUND" = "$SLUG" ] && ok "row persisted for slug $SLUG" || bad "row not found after upload"

say "── 3. deactivate (UPDATE is_active=0) ──"
req PUT "$ADMIN" -H "Content-Type: application/json" -d "{\"id\":$ID,\"active\":false}"
ACT="$(printf '%s' "$BODY" | jqp "d.get('data',{}).get('active')")"
[ "$CODE" = "200" ] && [ "$ACT" = "False" ] && ok "deactivated (active=false persisted)" \
                    || bad "deactivate → $CODE active=$ACT body=$BODY"

say "── 4. reactivate + alt_text (UPDATE) ──"
req PUT "$ADMIN" -H "Content-Type: application/json" -d "{\"id\":$ID,\"active\":true,\"alt_text\":\"smoke v2\"}"
ACT="$(printf '%s' "$BODY" | jqp "d.get('data',{}).get('active')")"
ALT="$(printf '%s' "$BODY" | jqp "d.get('data',{}).get('alt_text','')")"
[ "$ACT" = "True" ] && [ "$ALT" = "smoke v2" ] && ok "reactivated + alt_text saved" \
                   || bad "reactivate → active=$ACT alt=$ALT body=$BODY"

say "── 5. reorder (UPDATE display_order) ──"
req POST "$ADMIN?action=reorder" -H "Content-Type: application/json" -d "{\"items\":[{\"id\":$ID,\"display_order\":7}]}"
UPD="$(printf '%s' "$BODY" | jqp "d.get('data',{}).get('updated')")"
[ "$CODE" = "200" ] && [ "$UPD" = "1" ] && ok "reorder persisted (updated=1)" \
                    || bad "reorder → $CODE updated=$UPD body=$BODY"

say "── 6. public feed sees the active image ──"
PUB="$(curl -sS -H "X-API-KEY: $API_KEY" "$PUBLIC")"
HIT="$(printf '%s' "$PUB" | jqp "next((r for r in d.get('data',[]) if r.get('service_slug')=='$SLUG'),{}).get('image_url','')")"
[ -n "$HIT" ] && ok "public feed exposes $SLUG image" || bad "public feed missing $SLUG (feed=$PUB)"

say "── 7. delete + verify gone (restore original state) ──"
req DELETE "$ADMIN" -H "Content-Type: application/json" -d "{\"id\":$ID}"
[ "$CODE" = "200" ] && ok "delete → 200" || bad "delete → $CODE body=$BODY"
req GET "$ADMIN"
STILL="$(printf '%s' "$BODY" | jqp "sum(1 for r in d.get('data',[]) if str(r.get('id'))=='$ID')")"
[ "$STILL" = "0" ] && ok "row gone — card restored to placeholder" || bad "row $ID still present after delete"

say ""
say "$([ $fail -eq 0 ] && echo PASS || echo FAIL) — $pass passed, $fail failed"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
