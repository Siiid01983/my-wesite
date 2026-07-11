#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  slot-safe-drive.sh — Smart Booking Engine controlled validation, SAFELY.
#
#  Hard guarantee: it will NOT write a single test booking unless it has first
#  PROVEN that slot locking is active at runtime. Two gates:
#    Gate 1 (preflight, no writes): opcache_reset + slot_lock_enabled==true
#                                   + booking_slots table + fresh code_build.
#    Gate 2 (single probe):         create ONE booking; abort (and cancel it)
#                                   unless availability flips am→reserved.
#  Only if BOTH pass does it run the 409 matrix. Everything it creates is
#  cancelled at the end and printed for your SQL DELETE.
#
#  It does NOT touch _config.php (flag on/off is your cPanel action) and does
#  NOT delete rows (delete is staff-gated / destructive → your SQL).
#
#  Usage:
#    HM_KEY=<api_key> HM_TOKEN=<admin_setup_token> bash tests/slot-safe-drive.sh
#  Env: HM_DATE (default 2026-09-01), MATRIX=1 to run the full matrix after the
#       probe (default: probe-only, stop for human confirmation).
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail
RB="https://hello-moving.com/hm-api"
KEY="${HM_KEY:?set HM_KEY to window.API_KEY}"
TOKEN="${HM_TOKEN:?set HM_TOKEN to admin_setup_token}"
DATE="${HM_DATE:-2026-09-01}"
EXPECT_BUILD="phase2-slice2"
EMAIL="slot-validation@hello-moving.com"
H=(-H "X-API-KEY: $KEY" -H "Content-Type: application/json")
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
CREATED=()   # ids to cancel at the end

say(){ printf '%s\n' "$*"; }
post(){ curl -s -X POST "$RB/rest.php" "${H[@]}" --data-binary "$1"; }
avail(){ curl -s "${H[@]}" "$RB/availability.php?date=$DATE"; }
cancel(){ post "{\"table\":\"bookings\",\"action\":\"update\",\"values\":{\"status\":\"cancelled\"},\"filters\":[{\"col\":\"id\",\"op\":\"eq\",\"val\":\"$1\"}]}" >/dev/null; }
cancel_all(){ say "── cancelling all created test rows ──"; for id in "${CREATED[@]:-}"; do [ -n "$id" ] && { cancel "$id"; say "  cancelled $id"; }; done; }
abort(){ say ""; say "🛑 ABORT: $*"; cancel_all; say ""; say "Flag is UNCHANGED (still whatever you set). Recommend setting it OFF in cPanel."; say "Created ids (for SQL DELETE): ${CREATED[*]:-none}"; exit 2; }

# ── GATE 1: preflight (NO writes) ───────────────────────────────────────────
say "=== GATE 1 — preflight (opcache reset + verify locking active) ==="
curl -s "$RB/slot-preflight.php?token=$TOKEN&reset=1" >/dev/null      # reset affects NEXT request
PF="$(curl -s "$RB/slot-preflight.php?token=$TOKEN")"                 # read post-reset state
say "  $PF"
echo "$PF" | grep -q '"ok":true'                          || abort "preflight not reachable / forbidden (check token)."
echo "$PF" | grep -q '"slot_lock_enabled":true'           || abort "slot_lock_enabled is NOT true after opcache reset — flag not effective. NO bookings created."
echo "$PF" | grep -q '"booking_slots_table":true'         || abort "booking_slots table missing."
echo "$PF" | grep -q "\"code_build\":\"$EXPECT_BUILD\""   || abort "code_build mismatch — stale deploy/opcache. Expected $EXPECT_BUILD."
say "  ✅ GATE 1 PASS — locking active, table present, code fresh."

# ── pre-test: date must be clear ────────────────────────────────────────────
C="$(post "{\"table\":\"bookings\",\"action\":\"select\",\"count\":\"exact\",\"head\":true,\"filters\":[{\"col\":\"booking_date\",\"op\":\"eq\",\"val\":\"$DATE\"}]}")"
echo "$C" | grep -q '"count":0' || abort "$DATE is not clear of bookings: $C"
avail | grep -q '"am":"available"' || abort "am not available at baseline."
say "  ✅ $DATE is clear (0 bookings, am available)."

# ── GATE 2: single probe (create ONE, must flip) ────────────────────────────
say "=== GATE 2 — single probe ==="
cat > "$WORK/probe.json" <<EOF
{"table":"bookings","action":"insert","returning":true,"values":{"customer_name":"SLOT PROBE — DELETE ME","customer_email":"$EMAIL","customer_phone":"09000000000","booking_date":"$DATE","status":"pending","notes":"[HM_EXTRAS]\\ntime:午前（9:00〜12:00）\\n"}}
EOF
PR="$(curl -s -X POST "$RB/rest.php" "${H[@]}" --data-binary @"$WORK/probe.json")"
AM_ID="$(echo "$PR" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)"
[ -n "$AM_ID" ] && CREATED+=("$AM_ID")
say "  probe booking id=$AM_ID"
if avail | grep -q '"am":"reserved"'; then
  say "  ✅ GATE 2 PASS — am flipped to reserved. Locking VERIFIED end-to-end."
else
  abort "am did NOT flip to reserved after a real booking — locking not effective."
fi

if [ "${MATRIX:-0}" != "1" ]; then
  say ""; say "Probe passed. Re-run with MATRIX=1 to execute the full 409 matrix."
  say "Leaving the probe booking cancelled now:"; cancel_all
  say "Created ids (for SQL DELETE): ${CREATED[*]}"; exit 0
fi

# ── FULL MATRIX (only reached when both gates passed) ───────────────────────
say "=== MATRIX ==="
say "-- duplicate am (expect 409) --"
curl -s -w '  HTTP:%{http_code}\n' -o /dev/null -X POST "$RB/rest.php" "${H[@]}" --data-binary @"$WORK/probe.json"
say "-- admin insert am (expect 409) --"
curl -s -w '  HTTP:%{http_code}\n' -o /dev/null -X POST "$RB/rest.php" "${H[@]}" --data-binary @"$WORK/probe.json"

say "-- create pm (expect 200) --"
cat > "$WORK/pm.json" <<EOF
{"table":"bookings","action":"insert","returning":true,"values":{"customer_name":"SLOT PM — DELETE ME","customer_email":"$EMAIL","customer_phone":"09000000000","booking_date":"$DATE","status":"pending","notes":"[HM_EXTRAS]\\ntime:午後（12:00〜15:00）\\n"}}
EOF
PM="$(curl -s -X POST "$RB/rest.php" "${H[@]}" --data-binary @"$WORK/pm.json")"
PM_ID="$(echo "$PM" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)"
[ -n "$PM_ID" ] && CREATED+=("$PM_ID"); say "  pm id=$PM_ID"

say "-- reschedule pm→am occupied (expect 409, pm stays) --"
cat > "$WORK/re.json" <<EOF
{"table":"bookings","action":"update","values":{"notes":"[HM_EXTRAS]\\ntime:午前（9:00〜12:00）\\n"},"filters":[{"col":"id","op":"eq","val":"$PM_ID"}]}
EOF
curl -s -w '  HTTP:%{http_code}\n' -o /dev/null -X POST "$RB/rest.php" "${H[@]}" --data-binary @"$WORK/re.json"
say "  availability after reschedule attempt: $(avail)"

say "-- cancel am (expect release) --"; cancel "$AM_ID"
say "  availability after cancel am: $(avail)"

say "=== MATRIX COMPLETE — cancelling all, reporting ids ==="
cancel_all
say "Created ids (for SQL DELETE by date+email): ${CREATED[*]}"
say "Remember: set slot_lock_enabled OFF in cPanel when done."
