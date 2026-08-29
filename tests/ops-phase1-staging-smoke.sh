#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  ops-phase1-staging-smoke.sh — Phase 1 live matrix (STAGING).
#
#  Exercises the parts that CANNOT run on a dev box (need PHP + MySQL + a real
#  admin session): inquiry reply, attachment upload → customer-visible, internal-
#  note hiding, quote persistence, and unauthorized-access rejection — over HTTP.
#
#  Run ON staging (or anywhere that can reach the staging URL). It CREATES a test
#  Contact Chat conversation tagged with a MARKER so it can be removed afterward
#  via hm-api/cleanup-test-data.php. NOTHING here touches production.
#
#  USAGE:
#     BASE='https://staging.hello-moving.com/hm-api' \
#     API_KEY='<page api key or empty>' \
#     EMAIL='admin@hello-moving.com' PASS='<admin password>' \
#     TEST_EMAIL='qa+phase1@example.com' \
#     [BOOKING_ID='<uuid of a staging booking to test the quote path>'] \
#     bash tests/ops-phase1-staging-smoke.sh
#
#  Exit 0 only if every check passes. After a run, clean up with:
#     php hm-api/cleanup-test-data.php "<MARKER printed below>" --apply
# ════════════════════════════════════════════════════════════════════════════
set -u
P=0; F=0
ok(){  echo "  PASS  $1"; P=$((P+1)); }
bad(){ echo "  FAIL  $1"; F=$((F+1)); }
hdr(){ echo; echo "── $1 ──"; }
# Extract a top-level-ish JSON string value: jget <json> <key>
jget(){ printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; }

BASE="${BASE:?set BASE to the staging hm-api URL}"
API_KEY="${API_KEY:-}"
EMAIL="${EMAIL:?set EMAIL}"; PASS="${PASS:?set PASS}"
TEST_EMAIL="${TEST_EMAIL:-qa+phase1@example.com}"
BOOKING_ID="${BOOKING_ID:-}"
MARKER="PH1-SMOKE-$(date +%s)"
AK=(-H "X-API-KEY: ${API_KEY}")
JSON=(-H 'Content-Type: application/json')

echo "Staging Phase-1 smoke · BASE=$BASE · MARKER=$MARKER"

# ── 0. Admin login → token ───────────────────────────────────────────────────
hdr "admin login"
LOGIN=$(curl -sk "${AK[@]}" "${JSON[@]}" -X POST "$BASE/admin-login.php" \
  -d "{\"action\":\"login\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(jget "$LOGIN" token)
[ -n "$TOKEN" ] && ok "admin login returns a token" || { bad "admin login failed: $LOGIN"; echo "ABORT"; exit 1; }
AT=(-H "X-ADMIN-TOKEN: ${TOKEN}")

# ── 1. Customer starts an inquiry (creates a conversation) ───────────────────
hdr "inquiry created (お問い合わせ)"
START=$(curl -sk "${AK[@]}" "${JSON[@]}" -X POST "$BASE/contact-chat.php?action=start" \
  -d "{\"name\":\"$MARKER QA\",\"email\":\"$TEST_EMAIL\",\"category\":\"見積もり\",\"message\":\"$MARKER staging attachment test\"}")
CODE=$(jget "$START" public_contact_id)
[ -n "$CODE" ] && ok "inquiry created, Contact ID=$CODE" || { bad "start failed: $START"; echo "ABORT"; exit 1; }
THREAD="contact:$CODE"

# ── 2. Upload an attachment to THIS conversation's folder ────────────────────
hdr "attachment upload (item 3)"
TMPIMG="$(mktemp).png"
# 1x1 PNG
printf '\211PNG\r\n\032\n\0\0\0\rIHDR\0\0\0\1\0\0\0\1\10\6\0\0\0\37\25\304\211\0\0\0\nIDATx\234c\370\17\0\1\1\1\0\30\335\215\260\0\0\0\0IEND\256B\140\202' > "$TMPIMG"
UPATH="contact/$CODE/$(date +%s)-qa.png"
UP=$(curl -sk "${AK[@]}" "${AT[@]}" -X POST "$BASE/storage.php?action=upload" \
  -F "bucket=chat" -F "path=$UPATH" -F "file=@$TMPIMG;type=image/png")
RPATH=$(jget "$UP" path)
[ -n "$RPATH" ] && ok "uploaded to $RPATH" || bad "upload failed: $UP"

# ── 3. Ops replies to the inquiry WITH the attachment (conversations.php) ─────
hdr "Ops reply with attachment"
REPLY=$(curl -sk "${AK[@]}" "${AT[@]}" "${JSON[@]}" -X POST "$BASE/conversations.php?action=reply" \
  -d "{\"thread_id\":\"$THREAD\",\"message\":\"$MARKER reply with photo\",\"attachments\":[{\"path\":\"$UPATH\",\"name\":\"qa.png\",\"mime\":\"image/png\",\"size\":100}]}")
echo "$REPLY" | grep -q '"ok":true' && ok "reply accepted" || bad "reply failed: $REPLY"

# ── 4. Customer can SEE the attachment (list + signed GET) ───────────────────
hdr "customer sees the attachment"
LIST=$(curl -sk "${AK[@]}" "${JSON[@]}" -X POST "$BASE/contact-chat.php?action=list" \
  -d "{\"contact_id\":\"$CODE\",\"email\":\"$TEST_EMAIL\"}")
echo "$LIST" | grep -q '"attachments"' && ok "list returns attachments[]" || bad "no attachments in list: $LIST"
SIGNED=$(printf '%s' "$LIST" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's/\\\//\//g')
if [ -n "$SIGNED" ]; then
  ST=$(curl -sk -o /dev/null -w '%{http_code}' "$SIGNED")
  [ "$ST" = "200" ] && ok "signed attachment URL fetches (HTTP 200)" || bad "signed URL returned HTTP $ST"
else bad "no signed url in list"; fi

# ── 5. Internal note is NOT visible to the customer ──────────────────────────
hdr "internal note stays staff-only"
curl -sk "${AK[@]}" "${AT[@]}" "${JSON[@]}" -X POST "$BASE/conversations.php?action=note" \
  -d "{\"thread_id\":\"$THREAD\",\"text\":\"$MARKER INTERNAL secret\"}" >/dev/null
LIST2=$(curl -sk "${AK[@]}" "${JSON[@]}" -X POST "$BASE/contact-chat.php?action=list" \
  -d "{\"contact_id\":\"$CODE\",\"email\":\"$TEST_EMAIL\"}")
echo "$LIST2" | grep -q "INTERNAL secret" && bad "LEAK: internal note visible to customer" || ok "internal note hidden from customer"

# ── 6. Unauthorized access is rejected ───────────────────────────────────────
hdr "authorization"
NOAUTH=$(curl -sk "${AK[@]}" "${JSON[@]}" -o /dev/null -w '%{http_code}' -X POST "$BASE/conversations.php?action=list" -d '{}')
[ "$NOAUTH" = "401" ] || [ "$NOAUTH" = "403" ] && ok "conversations.php without admin token → $NOAUTH" || bad "expected 401/403, got $NOAUTH"
BADTOK=$(curl -sk "${AK[@]}" -H 'X-ADMIN-TOKEN: not.a.token' "${JSON[@]}" -o /dev/null -w '%{http_code}' -X POST "$BASE/conversations.php?action=list" -d '{}')
[ "$BADTOK" = "401" ] || [ "$BADTOK" = "403" ] && ok "conversations.php with forged token → $BADTOK" || bad "forged token got $BADTOK"

# ── 7. Quote persistence (optional — needs a staging booking) ────────────────
if [ -n "$BOOKING_ID" ]; then
  hdr "quote (見積) → labels.quote + agreed_price"
  Q=$(curl -sk "${AK[@]}" "${AT[@]}" "${JSON[@]}" -X POST "$BASE/conversations.php?action=quote" \
    -d "{\"thread_id\":\"chat:$BOOKING_ID\",\"price\":35000,\"expiry\":\"2026-12-31\",\"terms\":\"$MARKER terms\"}")
  echo "$Q" | grep -q '"ok":true' && ok "quote saved (labels.quote + agreed_price)" || bad "quote failed: $Q"
else
  hdr "quote (見積) — SKIPPED (set BOOKING_ID to test)"
fi

# ── 8. Manual-only items (need a real browser / inbound email) ───────────────
hdr "manual verification still required"
echo "  • Ops UI: open the Communication Center, confirm the reply + image render, and the 見積 panel."
echo "  • Email-thread reply: reply to an inbound (IMAP) email thread in Ops and confirm it threads"
echo "    (needs a real inbound email in staging inbox_messages)."
echo "  • admin.html Inbox 見積送信 still works (unchanged)."

echo
echo "════════════════════════════════════════════"
echo "Phase-1 staging smoke: $P passed, $F failed"
echo "CLEANUP:  php hm-api/cleanup-test-data.php \"$MARKER\" --apply"
rm -f "$TMPIMG" 2>/dev/null
[ "$F" -eq 0 ] || exit 1
