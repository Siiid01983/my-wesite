#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  ops-phase1-booking-smoke.sh — Phase 1 PRODUCTION smoke, BOOKING-ONLY path.
#
#  Exercises the full Phase-1 write matrix against a SINGLE disposable booking
#  (thread_id = chat:<bookingId>). It NEVER touches contact_conversations and
#  therefore needs NO server CLI cleanup — every test record is removable through
#  the existing admin API (rest.php delete + storage.php remove).
#
#  SAFETY
#   • Credentials come from ENV VARS only and are NEVER echoed.
#   • Every record is tagged PHASE1_TEST and uses TEST_EMAIL only.
#   • BEFORE creating anything it (a) requires creds and (b) pre-flights that an
#     admin-authorized delete works — if cleanup can't be proven, it STOPS.
#   • It does not enable workers, change config, deploy, or merge.
#
#  USAGE (run on any shell that can reach prod; creds as env vars):
#     BASE='https://hello-moving.com/hm-api' \
#     EMAIL='<admin email>' PASS='<admin password>' \
#     API_KEY='<page api key or leave unset>' \
#     TEST_EMAIL='qa+phase1@example.com' \
#     bash tests/ops-phase1-booking-smoke.sh
#
#  Exit 0 only if every capability PASSED and zero PHASE1_TEST residue remains.
# ════════════════════════════════════════════════════════════════════════════
set -u
P=0; F=0
ok(){  echo "  PASS  $1"; P=$((P+1)); }
bad(){ echo "  FAIL  $1"; F=$((F+1)); }
hdr(){ echo; echo "── $1 ──"; }
die(){ echo; echo "STOP: $1"; exit 2; }

# ── Config / credentials (env only; never printed) ───────────────────────────
BASE="${BASE:-https://hello-moving.com/hm-api}"
EMAIL="${EMAIL:-}"; PASS="${PASS:-}"
API_KEY="${API_KEY:-}"
TEST_EMAIL="${TEST_EMAIL:-qa+phase1@example.com}"
UA='Mozilla/5.0 (compatible; HelloMovingPhase1Smoke/1.0)'

[ -n "$EMAIL" ] && [ -n "$PASS" ] || die "EMAIL and PASS must be set (admin session). Nothing created."
[ -n "$BASE" ] || die "BASE must be set."

# ── HTTP helpers ─────────────────────────────────────────────────────────────
BODY=""; CODE=""
# jpost <url> <json> [extra headers...]   (adds API key + admin token)
jpost(){ local url="$1" data="$2"; shift 2
  local resp; resp=$(curl -sk -A "$UA" -H 'Content-Type: application/json' \
    ${API_KEY:+-H "X-API-KEY: $API_KEY"} ${TOKEN:+-H "X-ADMIN-TOKEN: $TOKEN"} "$@" \
    -w $'\n%{http_code}' --max-time 30 -X POST "$url" -d "$data" 2>/dev/null)
  CODE="${resp##*$'\n'}"; BODY="${resp%$'\n'*}"; }
# code_only <method> <url> [curl-args...] → prints http code (no creds unless passed)
code_only(){ local m="$1" url="$2"; shift 2; curl -sk -A "$UA" -o /dev/null -w '%{http_code}' --max-time 30 -X "$m" "$@" "$url" 2>/dev/null; }
# jget <key> — first "key":"value" string in BODY
jget(){ printf '%s' "$BODY" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; }
# jnum <key> — first "key":number in BODY
jnum(){ printf '%s' "$BODY" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1; }
# jesc <string> — JSON-escape a value (backslash + double-quote) so a credential that
# contains " or \ can't corrupt the request body. Matches the UI's JSON.stringify;
# the shell-interpolation the login previously used would break on those characters.
jesc(){ printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
uuid(){ if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid; \
        elif command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'; \
        else printf '%s-%s-4%s-8%s-%s' "$(date +%s)" "$RANDOM$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM$RANDOM"; fi; }

TS=$(date +%s)
MARKER="PHASE1_TEST"
BID="$(uuid)"
REF="PH1T${TS}"
# FIX 2 — a blank/garbled id was the root cause of the earlier run's failures
# (empty id → rest.php generates its own → thread/quote/select all diverge). Refuse
# to proceed unless we have a well-formed non-empty UUID BEFORE creating anything.
case "$BID" in
  *[!0-9a-fA-F-]* | "" ) die "generated booking id is empty/invalid ('$BID'). Nothing created." ;;
esac
[ ${#BID} -ge 8 ] || die "generated booking id too short ('$BID'). Nothing created."
# THREAD / APATH are derived AFTER the create response confirms the authoritative id
# (FIX 1) — do not compute them from the client id yet.
echo "Phase-1 BOOKING-ONLY smoke · BASE=$BASE"
echo "  proposed booking id : $BID"
echo "  test reference      : $REF   (tag: $MARKER · email: $TEST_EMAIL)"

# ── 0) Admin login → token (never printed) ───────────────────────────────────
hdr "admin login"
# Body built with jesc (JSON-safe), exactly like the UI's JSON.stringify — so a
# credential containing " or \ can't corrupt it. EMAIL/PASS are NEVER echoed.
jpost "$BASE/admin-login.php" "{\"action\":\"login\",\"email\":\"$(jesc "$EMAIL")\",\"password\":\"$(jesc "$PASS")\"}"
TOKEN="$(jget token)"
if [ -z "$TOKEN" ]; then
  # admin-login.php returns HTTP 401 code=invalid for BOTH wrong creds AND EMPTY creds.
  # The commonest cause of a curl-only 401 (while the UI logs in fine) is that
  # EMAIL/PASS are not populated in THIS shell (e.g. they were passed inline to the
  # smoke invocation and never exported). Report which, without printing values.
  hint="check EMAIL/PASS values"
  { [ -z "$EMAIL" ] || [ -z "$PASS" ]; } && hint="EMAIL and/or PASS is EMPTY in this shell — export them (not just inline) before running"
  [ -z "$API_KEY" ] && hint="$hint; API_KEY is also empty (the login endpoint requires X-API-KEY)"
  die "admin login failed (HTTP $CODE, no token). $hint. Nothing created."
fi
ok "admin session established (token hidden)"

# ── PRE-FLIGHT: prove admin-authorized cleanup works BEFORE creating anything ─
hdr "cleanup pre-flight (no data touched)"
jpost "$BASE/rest.php" "{\"table\":\"bookings\",\"action\":\"delete\",\"filters\":[{\"col\":\"id\",\"op\":\"eq\",\"val\":\"PREFLIGHT-${TS}-nonexistent\"}],\"returning\":true}"
if [ "$CODE" = "200" ]; then ok "admin delete authorized (0 rows matched) — cleanup is possible"
else die "admin delete NOT authorized (HTTP $CODE). Refusing to create data that could not be cleaned up."; fi

# ══ CREATION + TESTS ═════════════════════════════════════════════════════════

# 1) Create the disposable booking (rest.php insert; API-key path). notes carries
#    'ref:<REF>' so the customer chat endpoint can resolve it, and PHASE1_TEST tag.
hdr "1) create disposable test booking"
NOTES="${MARKER} disposable booking / [HM_EXTRAS] / ref:${REF} / service:${MARKER}"
jpost "$BASE/rest.php" "{\"table\":\"bookings\",\"action\":\"insert\",\"returning\":true,\"values\":{\"id\":\"$BID\",\"customer_name\":\"${MARKER} QA\",\"customer_email\":\"$TEST_EMAIL\",\"customer_phone\":\"000-0000-0000\",\"booking_date\":\"2099-12-31\",\"service_id\":\"${MARKER}\",\"status\":\"pending\",\"notes\":\"$NOTES\"}}"
if [ "$CODE" != "200" ]; then die "booking insert HTTP $CODE: $BODY (nothing to clean up)"; fi
# FIX 1 (authoritative id) — neither the client-proposed id nor the create response can
# be trusted (the server may honor, generate, or normalize the id). Resolve the booking's
# REAL DB id EXACTLY as chat.php does — by its unique reference in notes (ref:<REF>) — and
# key EVERYTHING off it, so the Ops path and the customer path provably use one id.
jpost "$BASE/rest.php" "{\"table\":\"bookings\",\"action\":\"select\",\"columns\":\"id\",\"filters\":[{\"col\":\"notes\",\"op\":\"like\",\"val\":\"%ref:${REF}%\"}],\"order\":[{\"col\":\"created_at\",\"ascending\":false}],\"limit\":1}"
REALID="$(jget id)"
[ -n "$REALID" ] || die "created booking could not be resolved by ref ($REF): $BODY"
[ "$REALID" != "$BID" ] && echo "  note: server-stored id differs from the proposed id — using the real DB id"
BID="$REALID"
THREAD="chat:${BID}"
APATH="${BID}/${TS}-phase1test.png"
ok "booking created + resolved authoritative id=$BID"
echo "  thread          : $THREAD"

# 2) Customer-side message (chat.php send: email + reference) → inbound row
hdr "2/3) customer message path (chat.php send)"
jpost "$BASE/chat.php?action=send" "{\"email\":\"$TEST_EMAIL\",\"reference\":\"$REF\",\"message\":\"${MARKER} ${REF} customer hello\"}"
CUST_MID="$(jget id)"
echo "$BODY" | grep -q '"ok":true' && ok "customer message accepted (id=$CUST_MID)" || bad "customer send HTTP $CODE: $BODY"

# 3) Ops text reply via conversations.php
hdr "4) Ops reply (conversations.php reply)"
jpost "$BASE/conversations.php?action=reply" "{\"thread_id\":\"$THREAD\",\"message\":\"${MARKER} ${REF} ops reply\"}"
OPS_MID="$(jget id)"
echo "$BODY" | grep -q '"ok":true' && ok "Ops reply sent (message id=$OPS_MID)" || bad "reply HTTP $CODE: $BODY"

# 4) Upload an attachment to THIS booking's folder (storage.php upload)
hdr "5) attachment upload (storage.php)"
TMPIMG="$(mktemp 2>/dev/null || echo "./ph1_$TS.png")"; TMPIMG="${TMPIMG%.png}.png"
# FIX 2 — a GUARANTEED-valid 1x1 PNG via base64 (immune to printf-escape / redirect
# byte-mangling that produced an invalid image before). Falls back to openssl if the
# base64 CLI lacks -d.
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
printf '%s' "$PNG_B64" | base64 -d > "$TMPIMG" 2>/dev/null \
  || printf '%s' "$PNG_B64" | base64 --decode > "$TMPIMG" 2>/dev/null \
  || printf '%s' "$PNG_B64" | openssl base64 -d -A > "$TMPIMG" 2>/dev/null
[ -s "$TMPIMG" ] || die "could not generate the PNG test fixture (base64 decode failed)"
UP=$(curl -sk -A "$UA" ${API_KEY:+-H "X-API-KEY: $API_KEY"} -H "X-ADMIN-TOKEN: $TOKEN" \
  -F "bucket=chat" -F "path=$APATH" -F "file=@$TMPIMG;type=image/png" --max-time 60 "$BASE/storage.php?action=upload" 2>/dev/null)
RPATH=$(printf '%s' "$UP" | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
# FIX 3 — success = the server returned a stored path (do NOT require it to equal the
# requested path; storage.php sanitize_path may normalize it). Use the SERVER-returned
# path (SENTPATH) for the reply + cleanup so they always reference the real file on disk.
# On failure the raw $UP body (e.g. a 415 bad_mime) is surfaced for diagnosis.
if [ -n "$RPATH" ]; then SENTPATH="$RPATH"; ok "attachment uploaded → $SENTPATH"; else SENTPATH="$APATH"; bad "upload failed (no stored path returned): $UP"; fi

# 5) Ops reply WITH the attachment
hdr "6) Ops reply with attachment"
jpost "$BASE/conversations.php?action=reply" "{\"thread_id\":\"$THREAD\",\"message\":\"${MARKER} ${REF} photo\",\"attachments\":[{\"path\":\"$SENTPATH\",\"name\":\"phase1test.png\",\"mime\":\"image/png\",\"size\":100}]}"
ATT_MID="$(jget id)"
echo "$BODY" | grep -q '"ok":true' && ok "attachment reply sent (message id=$ATT_MID)" || bad "attach reply HTTP $CODE: $BODY"

# 6) Customer retrieval + attachment security (chat.php list → signed GET 200)
hdr "7) customer sees attachment + signed-URL security"
jpost "$BASE/chat.php?action=list" "{\"email\":\"$TEST_EMAIL\",\"reference\":\"$REF\"}"
echo "$BODY" | grep -q '"attachments"' && ok "customer list returns attachments[]" || bad "no attachments in list: $BODY"
SIGNED=$(printf '%s' "$BODY" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's/\\\//\//g')
if [ -n "$SIGNED" ]; then
  st=$(code_only GET "$SIGNED"); [ "$st" = "200" ] && ok "signed attachment URL fetches (HTTP 200)" || bad "signed GET HTTP $st"
  # tamper: mangle the signature → must be rejected
  stt=$(code_only GET "${SIGNED%&sig=*}&sig=deadbeef"); [ "$stt" = "403" ] && ok "tampered signature rejected (HTTP 403)" || bad "tampered sig gave HTTP $stt (expected 403)"
else bad "no signed url present"; fi

# 7) 見積 — quote persist (labels.quote + agreed_price)
hdr "8/9/10) 見積 quote + agreed_price"
jpost "$BASE/conversations.php?action=quote" "{\"thread_id\":\"$THREAD\",\"price\":35000,\"expiry\":\"2099-12-31\",\"terms\":\"${MARKER} ${REF} terms\"}"
echo "$BODY" | grep -q '"ok":true' && ok "quote saved (labels.quote written)" || bad "quote HTTP $CODE: $BODY"
# verify agreed_price on the booking
jpost "$BASE/rest.php" "{\"table\":\"bookings\",\"action\":\"select\",\"columns\":\"id,agreed_price\",\"filters\":[{\"col\":\"id\",\"op\":\"eq\",\"val\":\"$BID\"}]}"
AP="$(jnum agreed_price)"
[ "$AP" = "35000" ] && ok "agreed_price persisted (=35000)" || bad "agreed_price=$AP (expected 35000): $BODY"

# 8) Quote SEND via the existing send-email.php (to TEST_EMAIL only)
hdr "11) quote email (send-email.php)"
jpost "$BASE/send-email.php" "{\"to\":\"$TEST_EMAIL\",\"from_account\":\"booking\",\"subject\":\"[Hello Moving] ${MARKER} お見積り\",\"message\":\"${MARKER} ${REF} お見積金額 35,000円\",\"booking_id\":\"$BID\",\"thread_id\":\"$THREAD\",\"log_inbox\":true}"
QFROM="$(jget from)"; QMID="$(jget messageId)"
if echo "$BODY" | grep -q '"ok":true'; then ok "quote email sent (from set; messageId captured)"; else bad "email send HTTP $CODE: $BODY"; fi

# 9) conversations.php reads (list + thread)
hdr "12) conversations.php reads"
jpost "$BASE/conversations.php?action=thread" "{\"thread_id\":\"$THREAD\"}"
MSGN=$(printf '%s' "$BODY" | grep -o '"id"' | wc -l | tr -d ' ')
echo "$BODY" | grep -q '"messages"' && ok "thread read returns messages (approx $MSGN entries)" || bad "thread read HTTP $CODE: $BODY"

# 10) Authorization boundaries (valid API key + missing/forged admin token → 403)
hdr "13) authorization boundaries"
na=$(code_only POST "$BASE/conversations.php?action=reply" ${API_KEY:+-H "X-API-KEY: $API_KEY"} -H 'Content-Type: application/json' -d "{\"thread_id\":\"$THREAD\",\"message\":\"nope\"}")
[ "$na" = "403" ] || [ "$na" = "401" ] && ok "no admin token → HTTP $na (rejected)" || bad "no-token reply got HTTP $na"
fg=$(code_only POST "$BASE/conversations.php?action=reply" ${API_KEY:+-H "X-API-KEY: $API_KEY"} -H 'X-ADMIN-TOKEN: forged.nope.sig' -H 'Content-Type: application/json' -d "{\"thread_id\":\"$THREAD\",\"message\":\"nope\"}")
[ "$fg" = "403" ] && ok "forged token → HTTP 403 (rejected)" || bad "forged-token reply got HTTP $fg"

# 11) Regression (read-only)
hdr "14) regression (read-only)"
ri=$(code_only GET "${BASE%/hm-api}/index.html"); [ "$ri" = "200" ] && ok "index.html 200" || bad "index.html HTTP $ri"
ra=$(code_only GET "${BASE%/hm-api}/admin.html"); [ "$ra" = "200" ] && ok "admin.html 200" || bad "admin.html HTTP $ra"

# ══ CLEANUP (admin API only) ═════════════════════════════════════════════════
# FIX 3 — cleanup is REFERENCE/MARKER-aware, not id-assumption-based: every created
# record carries the run-unique REF, so cleanup removes this run's data even if the
# server returned/normalized a different booking id or thread.
hdr "CLEANUP — delete messages, attachment, booking (admin API)"
# a) delete this thread's messages (by the resolved authoritative thread)…
jpost "$BASE/rest.php" "{\"table\":\"inbox_messages\",\"action\":\"delete\",\"returning\":true,\"filters\":[{\"col\":\"thread_id\",\"op\":\"eq\",\"val\":\"$THREAD\"}]}"
[ "$CODE" = "200" ] && ok "deleted inbox_messages for $THREAD" || bad "inbox delete HTTP $CODE: $BODY"
# a2) …and belt-and-suspenders: any message tagged with this run's REF (any thread).
jpost "$BASE/rest.php" "{\"table\":\"inbox_messages\",\"action\":\"delete\",\"returning\":true,\"filters\":[{\"col\":\"body_text\",\"op\":\"like\",\"val\":\"%${REF}%\"}]}"
[ "$CODE" = "200" ] && ok "deleted any inbox_messages tagged ${REF}" || bad "inbox ref-delete HTTP $CODE: $BODY"
# b) delete the attachment file
jpost "$BASE/storage.php?action=remove" "{\"bucket\":\"chat\",\"paths\":[\"$SENTPATH\"]}"
[ "$CODE" = "200" ] && ok "removed attachment file $SENTPATH" || bad "storage remove HTTP $CODE: $BODY"
# c) delete the disposable booking by its UNIQUE reference (id-independent)
jpost "$BASE/rest.php" "{\"table\":\"bookings\",\"action\":\"delete\",\"returning\":true,\"filters\":[{\"col\":\"notes\",\"op\":\"like\",\"val\":\"%ref:${REF}%\"}]}"
[ "$CODE" = "200" ] && ok "deleted booking(s) with ref:${REF}" || bad "booking delete HTTP $CODE: $BODY"

# ══ ZERO-RESIDUE VERIFICATION (reference-aware — id-independent) ══════════════
hdr "ZERO-RESIDUE verification"
# booking: by UNIQUE reference (catches it regardless of the stored id)
jpost "$BASE/rest.php" "{\"table\":\"bookings\",\"action\":\"select\",\"columns\":\"id\",\"filters\":[{\"col\":\"notes\",\"op\":\"like\",\"val\":\"%ref:${REF}%\"}]}"
echo "$BODY" | grep -qE '"id"' && bad "RESIDUE: booking with ref:${REF} still present" || ok "booking gone (by ref)"
# messages: by resolved thread AND by run-unique REF (either non-empty = residue)
jpost "$BASE/rest.php" "{\"table\":\"inbox_messages\",\"action\":\"select\",\"columns\":\"id\",\"filters\":[{\"col\":\"thread_id\",\"op\":\"eq\",\"val\":\"$THREAD\"}]}"
echo "$BODY" | grep -qE '"id"' && bad "RESIDUE: thread messages still present ($THREAD)" || ok "thread messages gone"
jpost "$BASE/rest.php" "{\"table\":\"inbox_messages\",\"action\":\"select\",\"columns\":\"id\",\"filters\":[{\"col\":\"body_text\",\"op\":\"like\",\"val\":\"%${REF}%\"}]}"
echo "$BODY" | grep -qE '"id"' && bad "RESIDUE: messages tagged ${REF} still present" || ok "no messages tagged ${REF} remain"
if [ -n "${SIGNED:-}" ]; then st=$(code_only GET "$SIGNED"); { [ "$st" = "404" ] || [ "$st" = "403" ]; } && ok "attachment file gone (HTTP $st)" || bad "RESIDUE: attachment still fetchable (HTTP $st)"; fi
rm -f "$TMPIMG" 2>/dev/null

echo
echo "════════════════════════════════════════════"
echo "Phase-1 booking smoke: $P passed, $F failed"
echo "created (now removed): booking=$BID · thread=$THREAD · attachment=$SENTPATH"
[ "$F" -eq 0 ] && echo "RESULT: ALL PASS · ZERO RESIDUE" || echo "RESULT: FAILURES PRESENT — review above (residue check ran regardless)"
[ "$F" -eq 0 ] || exit 1
