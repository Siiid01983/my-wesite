#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  staging-auth-smoke.sh — staging gate for the MySQL admin-auth migration.
#
#  Runs the matrix that CANNOT be executed on a dev box without PHP/MySQL:
#  PHP lint → migration → seed → login/logout/password-change/role/token/session.
#  Run ON the staging cPanel host (php + uploaded hm-api/ + curl). The HTTP
#  section can also run from anywhere that can reach the staging URL.
#
#  USAGE (staging host, from the site root):
#     BASE='https://staging.hello-moving.com/hm-api' \
#     API_KEY='' \
#     EMAIL='admin@hello-moving.com'      PASS='<admin password>' \
#     MGR_EMAIL='manager@hello-moving.com' MGR_PASS='<manager password>' \
#     bash tests/staging-auth-smoke.sh
#
#  Exit 0 only if every check passes. Nothing here touches production.
# ════════════════════════════════════════════════════════════════════════════
set -u
PASScount=0; FAILcount=0
ok(){   echo "  PASS  $1"; PASScount=$((PASScount+1)); }
bad(){  echo "  FAIL  $1"; FAILcount=$((FAILcount+1)); }
hdr(){  echo; echo "── $1 ──"; }

BASE="${BASE:?set BASE to the staging hm-api URL}"
API_KEY="${API_KEY:-}"
EMAIL="${EMAIL:?set EMAIL}"; PASS="${PASS:?set PASS}"
MGR_EMAIL="${MGR_EMAIL:-}"; MGR_PASS="${MGR_PASS:-}"

# Dedicated endpoints (centralized server auth).
LOGIN_EP="$BASE/admin-login.php"     # login + force_change_password
LOGOUT_EP="$BASE/admin-logout.php"   # logout
SESS_EP="$BASE/admin-session.php"    # verify / current session
USERS_EP="$BASE/admin-users.php"     # list/create/update/reset/delete/change_password

H_JSON='-H Content-Type:application/json'
H_KEY="-H X-API-KEY:${API_KEY}"
jqget(){ grep -oP "\"$1\":\s*\"?\K[^\",}]+" | head -1; }   # tiny JSON field extractor

# ── 1. PHP lint (host-side; skipped automatically if php is absent) ───────────
hdr "1. PHP lint (php -l)"
if command -v php >/dev/null 2>&1; then
  for f in hm-api/_admin_users.php hm-api/admin-login.php hm-api/admin-logout.php \
           hm-api/admin-session.php hm-api/admin-users.php hm-api/admin-migrate.php hm-api/_lib.php; do
    if php -l "$f" >/dev/null 2>&1; then ok "lint $f"; else bad "lint $f"; php -l "$f"; fi
  done
else
  echo "  SKIP  php not on PATH — run this section on the staging host"
fi

# ── 2. MySQL migration + seed (host-side) ─────────────────────────────────────
hdr "2. Migration + admin_users seed"
if command -v php >/dev/null 2>&1; then
  OUT="$(php hm-api/admin-migrate.php 2>&1)"; echo "$OUT" | sed 's/^/    /'
  echo "$OUT" | grep -Eq 'seeded|already_provisioned' && ok "migrate ran" || bad "migrate failed"
else
  echo "  SKIP  run: php hm-api/admin-migrate.php  (on the staging host)"
fi

# ── 3. Login (valid) → admin-login.php ────────────────────────────────────────
hdr "3. login (valid)"
LOGIN="$(curl -s -X POST "$LOGIN_EP" $H_JSON $H_KEY -c /tmp/hm_cookies.txt \
  -d "{\"action\":\"login\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")"
TOKEN="$(echo "$LOGIN" | jqget token)"
echo "$LOGIN" | grep -q '"ok":true' && [ -n "$TOKEN" ] && ok "valid login → token minted" || { bad "valid login"; echo "    $LOGIN"; }
grep -qi 'hm_admin_sid' /tmp/hm_cookies.txt && ok "session cookie set" || bad "session cookie missing"
echo "$LOGIN" | grep -qiE 'pass_hash|admin_session_secret|\$2y\$' && bad "secret leaked in login body" || ok "no hash/secret in login body"

# ── 4. Login (invalid password) ───────────────────────────────────────────────
hdr "4. login (invalid password)"
BAD="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LOGIN_EP" $H_JSON $H_KEY \
  -d "{\"action\":\"login\",\"email\":\"$EMAIL\",\"password\":\"wrong-$RANDOM\"}")"
[ "$BAD" = "401" ] && ok "invalid password → 401" || bad "invalid password got HTTP $BAD"

# ── 5. Token validation → admin-session.php ───────────────────────────────────
hdr "5. token validation"
V1="$(curl -s -X POST "$SESS_EP" $H_JSON $H_KEY -H "X-ADMIN-TOKEN: $TOKEN" -d '{"action":"verify"}')"
echo "$V1" | grep -q '"valid":true' && ok "good token → valid:true" || bad "good token not valid"
V2="$(curl -s -X POST "$SESS_EP" $H_JSON $H_KEY -H "X-ADMIN-TOKEN: forged.deadbeef" -d '{"action":"verify"}')"
echo "$V2" | grep -q '"valid":false' && ok "forged token → valid:false" || bad "forged token accepted"

# ── 6. list_users never exposes hashes (admin) → admin-users.php ──────────────
hdr "6. list_users (admin) — no hashes"
LU="$(curl -s -X POST "$USERS_EP" $H_JSON $H_KEY -H "X-ADMIN-TOKEN: $TOKEN" -d '{"action":"list_users"}')"
echo "$LU" | grep -q '"ok":true' && ok "admin list_users ok" || bad "admin list_users failed"
echo "$LU" | grep -qi 'pass_hash' && bad "pass_hash present in list_users!" || ok "no pass_hash in list_users"

# ── 7. Admin role: create a throwaway manager → admin-users.php ───────────────
hdr "7. admin role — create_user"
TMP_EMAIL="smoke+$RANDOM@hello-moving.com"; TMP_PASS="Smoke-$RANDOM-pw!"
CU="$(curl -s -X POST "$USERS_EP" $H_JSON $H_KEY -H "X-ADMIN-TOKEN: $TOKEN" \
  -d "{\"action\":\"create_user\",\"name\":\"Smoke\",\"email\":\"$TMP_EMAIL\",\"password\":\"$TMP_PASS\",\"role\":\"manager\"}")"
NEWID="$(echo "$CU" | jqget id)"
echo "$CU" | grep -q '"ok":true' && [ -n "$NEWID" ] && ok "admin created manager ($TMP_EMAIL)" || { bad "create_user"; echo "    $CU"; }

# ── 8. Manager role enforcement: must NOT manage accounts ────────────────────
hdr "8. manager role enforcement"
if [ -n "$MGR_EMAIL" ] && [ -n "$MGR_PASS" ]; then
  MLOG="$(curl -s -X POST "$LOGIN_EP" $H_JSON $H_KEY \
    -d "{\"action\":\"login\",\"email\":\"$MGR_EMAIL\",\"password\":\"$MGR_PASS\"}")"
  MTOK="$(echo "$MLOG" | jqget token)"
  echo "$MLOG" | grep -q '"ok":true' && ok "manager login ok" || bad "manager login"
  MCODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$USERS_EP" $H_JSON $H_KEY \
    -H "X-ADMIN-TOKEN: $MTOK" -d "{\"action\":\"create_user\",\"name\":\"X\",\"email\":\"x+$RANDOM@h.com\",\"password\":\"abcd1234\",\"role\":\"manager\"}")"
  [ "$MCODE" = "403" ] && ok "manager create_user → 403 forbidden" || bad "manager create_user got HTTP $MCODE (expected 403)"
else
  echo "  SKIP  set MGR_EMAIL/MGR_PASS to test manager enforcement"
fi

# ── 9. Password change (own) → admin-users.php ───────────────────────────────
hdr "9. change_password (own)"
NP="Rotated-$RANDOM-pw!"
CP="$(curl -s -X POST "$USERS_EP" $H_JSON $H_KEY -H "X-ADMIN-TOKEN: $TOKEN" \
  -d "{\"action\":\"change_password\",\"current\":\"$PASS\",\"new\":\"$NP\"}")"
echo "$CP" | grep -q '"ok":true' && ok "password changed" || { bad "change_password"; echo "    $CP"; }
OLD="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LOGIN_EP" $H_JSON $H_KEY -d "{\"action\":\"login\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")"
[ "$OLD" = "401" ] && ok "old password rejected after change" || bad "old password still works (HTTP $OLD)"
NEWTOK="$(curl -s -X POST "$LOGIN_EP" $H_JSON $H_KEY -d "{\"action\":\"login\",\"email\":\"$EMAIL\",\"password\":\"$NP\"}" | jqget token)"
[ -n "$NEWTOK" ] && ok "new password works" || bad "new password rejected"
curl -s -X POST "$USERS_EP" $H_JSON $H_KEY -H "X-ADMIN-TOKEN: $NEWTOK" \
  -d "{\"action\":\"change_password\",\"current\":\"$NP\",\"new\":\"$PASS\"}" >/dev/null && ok "restored original password"

# ── 10. Token revocation: delete the throwaway manager; its token must die ────
hdr "10. token revocation on delete (account-expiry proxy)"
if [ -n "$NEWID" ]; then
  TLOG="$(curl -s -X POST "$LOGIN_EP" $H_JSON $H_KEY -d "{\"action\":\"login\",\"email\":\"$TMP_EMAIL\",\"password\":\"$TMP_PASS\"}")"
  TTOK="$(echo "$TLOG" | jqget token)"
  curl -s -X POST "$USERS_EP" $H_JSON $H_KEY -H "X-ADMIN-TOKEN: $TOKEN" \
    -d "{\"action\":\"delete_user\",\"id\":\"$NEWID\"}" >/dev/null
  REV="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$USERS_EP" $H_JSON $H_KEY \
    -H "X-ADMIN-TOKEN: $TTOK" -d '{"action":"list_users"}')"
  [ "$REV" = "401" ] && ok "deleted account's token → 401 (revoked)" || bad "deleted token still valid (HTTP $REV)"
fi

# ── 11. Logout destroys session → admin-logout.php ───────────────────────────
hdr "11. logout"
LO="$(curl -s -X POST "$LOGOUT_EP" $H_JSON $H_KEY -b /tmp/hm_cookies.txt -c /tmp/hm_cookies.txt -d '{"action":"logout"}')"
echo "$LO" | grep -q 'loggedOut' && ok "logout destroyed session" || bad "logout"

# ── Session expiration note ───────────────────────────────────────────────────
hdr "session expiration"
echo "  NOTE  true token/session TTL expiry is time-based (admin_session_ttl)."
echo "        To assert deterministically: set admin_session_ttl=300 in the staging"
echo "        _config.php, wait >5 min, and re-run step 5 expecting valid:false."

echo; echo "════════ RESULT: $PASScount passed, $FAILcount failed ════════"
[ "$FAILcount" -eq 0 ]
