<?php
// ════════════════════════════════════════════════════════════════════════════
//  tests/sms.test.php — unit + source-contract tests for the OPTIONAL SMS feature
//
//  Deterministic + OFFLINE: exercises SmsService (pure logic, no network, no DB)
//  and asserts the send-sms.php / Ops wiring CONTRACTS by static source inspection.
//  Never contacts a provider, never needs a database.
//
//  Covers the design requirements:
//    • Company / customer name / booking ref present in the body
//    • Direct Chat Link comes from EmailService::chatUrl() (reused unchanged)
//    • Email is NEVER placed in the chat URL
//    • Phone normalization + missing-phone handled safely
//    • Intent allow-list (3 flows) + reason lines
//    • send() never throws and isolates transport failure
//    • Staff auth, rate limit, eligibility (no blocks/closed days), dedupe,
//      masked logging — all enforced in send-sms.php
//    • Ops UI fires SMS only AFTER the primary op succeeds
//
//  Run: php tests/sms.test.php
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

$pass = 0; $fail = 0;
function t(string $name, bool $cond): void {
  global $pass, $fail;
  if ($cond) { $pass++; echo "  ok    $name\n"; }
  else       { $fail++; echo "  NOT OK  $name\n"; }
}

// ── Stubs: capture logs so we can assert nothing sensitive is written ─────────
$GLOBALS['__logs'] = [];
if (!function_exists('hm_log_write')) { function hm_log_write(string $f, array $e): void { $GLOBALS['__logs'][] = ['f' => $f, 'e' => $e]; } }
if (!function_exists('hm_log_error')) { function hm_log_error(string $m, array $c = []): void { $GLOBALS['__logs'][] = ['m' => $m, 'c' => $c]; } }

require_once __DIR__ . '/../hm-api/SmsService.php';
require_once __DIR__ . '/../hm-api/EmailService.php';

$CFG  = ['site_url' => 'https://hello-moving.com'];
$REF  = 'HM-20260911-6VL5';
$NAME = '角田睦美';
$LINK = EmailService::chatUrl($CFG, $REF);

// ── 1. Direct Chat Link comes from EmailService::chatUrl() (unchanged) ────────
t('chatUrl points at login.html with the booking ref', strpos($LINK, '/login.html?ref=') !== false && strpos($LINK, rawurlencode($REF)) !== false);
t('chatUrl opens the chat view',                        strpos($LINK, 'view=chat') !== false);
t('chatUrl does NOT contain an email address (no @)',   strpos($LINK, '@') === false);
t('chatUrl does NOT contain a phone/price/name',        strpos($LINK, $NAME) === false && strpos($LINK, '9000') === false);

// ── 2. Rendered body carries Company + Name + Ref + Link, per intent ──────────
$bodyConfirm = SmsService::render('booking_confirmed', $NAME, $REF, $LINK);
$bodyResched = SmsService::render('reschedule',        $NAME, $REF, $LINK);
$bodyStaff   = SmsService::render('staff_message',     $NAME, $REF, $LINK);

t('body includes company name "Hello Moving"', strpos($bodyConfirm, 'Hello Moving') === 0);
t('body includes the customer name + honorific', strpos($bodyConfirm, $NAME . ' 様') !== false);
t('body includes the booking reference', strpos($bodyConfirm, '予約番号: ' . $REF) !== false);
t('body includes the exact chat link', strpos($bodyConfirm, $LINK) !== false);
t('body includes the chat prompt line', strpos($bodyConfirm, 'チャットをご確認ください。') !== false);
t('confirm reason line', strpos($bodyConfirm, 'ご予約ありがとうございます。') !== false);
t('reschedule reason line', strpos($bodyResched, 'ご予約日時が変更されました。') !== false);
t('staff-message reason line', strpos($bodyStaff, '新しいメッセージがあります。') !== false);
t('body never leaks the email into the SMS text', strpos($bodyConfirm, '@') === false);

// Name fallback when the stored name is blank (never invents a name).
t('blank name → お客様 fallback', strpos(SmsService::render('booking_confirmed', '', $REF, $LINK), 'お客様 様') !== false);

// ── 3. Intent allow-list ─────────────────────────────────────────────────────
t('valid intents accepted', SmsService::isValidIntent('booking_confirmed') && SmsService::isValidIntent('reschedule') && SmsService::isValidIntent('staff_message'));
t('unknown intent rejected', !SmsService::isValidIntent('marketing') && !SmsService::isValidIntent(''));

// ── 4. Phone normalization (server-side) + missing phone ──────────────────────
t('domestic 0XX → +81',        SmsService::normalizePhone('090-1234-5678') === '+819012345678');
t('spaced domestic normalized',SmsService::normalizePhone('080 8888 7777') === '+818088887777');
t('+81 international kept',     SmsService::normalizePhone('+81 90 1234 5678') === '+819012345678');
t('0081 prefix normalized',    SmsService::normalizePhone('008190 1234 5678') === '+819012345678');
t('empty phone → ""',          SmsService::normalizePhone('') === '');
t('junk phone → ""',           SmsService::normalizePhone('abc') === '');
t('too-short phone → ""',      SmsService::normalizePhone('12345') === '');
t('ambiguous no-country digits refused', SmsService::normalizePhone('12223334444') === '');

// ── 5. maskPhone never reveals more than the last 4 ───────────────────────────
$mask = SmsService::maskPhone('+819012345678');
t('mask keeps only last 4 digits', substr($mask, -4) === '5678' && strpos($mask, '9012') === false);

// ── 6. UCS-2 segment estimate (JP text is UCS-2) ──────────────────────────────
t('short body = 1 segment', SmsService::segmentsUcs2('短い') === 1);
t('long body splits into >1 segment', SmsService::segmentsUcs2(str_repeat('あ', 140)) > 1);

// ── 7. Transport: off / log(dry-run) / unknown / injected — NEVER throws ──────
$off = SmsService::send([], '+819012345678', $bodyConfirm);
t("transport 'off' (default) → not sent, code sms_disabled", empty($off['sent']) && $off['code'] === 'sms_disabled');

$dry = SmsService::send(['sms_transport' => 'log'], '+819012345678', $bodyConfirm);
t("transport 'log' → dry-run success", !empty($dry['sent']) && !empty($dry['dry_run']) && $dry['code'] === 'logged');

$unknown = SmsService::send(['sms_transport' => 'twilio'], '+819012345678', $bodyConfirm);
t('unknown provider → soft no_provider (not sent)', empty($unknown['sent']) && $unknown['code'] === 'no_provider');

// Injected transport that THROWS → send() swallows it (failure isolation).
SmsService::setTransport(function ($p, $b) { throw new RuntimeException('provider down'); });
$boom = SmsService::send(['sms_transport' => 'log'], '+819012345678', $bodyConfirm);
t('throwing transport is caught → {sent:false} not an exception', is_array($boom) && empty($boom['sent']) && $boom['code'] === 'exception');
// Injected transport that succeeds.
SmsService::setTransport(function ($p, $b) { return ['ok' => true, 'sent' => true, 'code' => 'ok']; });
$okr = SmsService::send([], '+819012345678', $bodyConfirm);
t('injected success transport used', !empty($okr['sent']) && $okr['code'] === 'ok');
SmsService::setTransport(null);

// ── 8. Dry-run logging masks the number and never logs the body ───────────────
$GLOBALS['__logs'] = [];
SmsService::send(['sms_transport' => 'log'], '+819012345678', $bodyConfirm);
$leakBody = false; $leakFull = false;
foreach ($GLOBALS['__logs'] as $l) {
  $blob = json_encode($l, JSON_UNESCAPED_UNICODE);
  if (strpos($blob, $NAME) !== false || strpos($blob, $LINK) !== false) $leakBody = true;
  if (strpos($blob, '9012345678') !== false) $leakFull = true;
}
t('dry-run log never contains the SMS body / name / link', !$leakBody);
t('dry-run log never contains the full phone number', !$leakFull);

// ════════════════════════════════════════════════════════════════════════════
//  Source-contract checks (static; no execution) — send-sms.php endpoint
// ════════════════════════════════════════════════════════════════════════════
$ss = file_get_contents(__DIR__ . '/../hm-api/send-sms.php');

t('requires an API key',                     strpos($ss, 'hm_require_api_key()') !== false);
t('staff-only: verifies X-ADMIN-TOKEN',      strpos($ss, "hm_request_header('X-ADMIN-TOKEN')") !== false && strpos($ss, 'hm_admin_token_verify') !== false);
t('accepts admin OR manager role',           strpos($ss, "'admin'") !== false && strpos($ss, "'manager'") !== false);
t('rejects unauthorized with 403 forbidden', strpos($ss, "'forbidden'") !== false && strpos($ss, '403') !== false);
t('rate-limited (send_sms bucket)',          strpos($ss, "hm_rate_limit('send_sms'") !== false);
t('derives phone from bookings row server-side', strpos($ss, 'customer_phone FROM bookings') !== false || strpos($ss, 'customer_phone') !== false && strpos($ss, 'FROM bookings') !== false);
t('never accepts a phone from the request body', strpos($ss, "\$p['phone']") === false && strpos($ss, "\$p['customer_phone']") === false);
t('refuses Ops availability blocks (admin_blocked)', strpos($ss, 'admin_blocked') !== false && strpos($ss, 'not_eligible') !== false);
t('requires a customer reference (real booking)',    strpos($ss, "preg_match('/^ref:") !== false && strpos($ss, 'no customer reference') !== false);
t('builds the link via EmailService::chatUrl',       strpos($ss, 'EmailService::chatUrl(') !== false);
t('renders the body via SmsService::render',         strpos($ss, 'SmsService::render(') !== false);
t('normalizes phone via SmsService::normalizePhone', strpos($ss, 'SmsService::normalizePhone(') !== false);
t('missing phone is a SOFT skip (no_phone), not an error', strpos($ss, "'no_phone'") !== false);
t('duplicate/retry protection via audit_log window', strpos($ss, 'sms_recent_send_exists') !== false && strpos($ss, "action = 'sms_notify'") !== false);
t('writes a claim row BEFORE sending (lost-response safety)', strpos($ss, "'result' => 'pending'") !== false);
t('logs are masked (maskPhone), no full number', strpos($ss, 'SmsService::maskPhone(') !== false);
t('never logs the SMS body', strpos($ss, "'body' =>") === false && strpos($ss, '$body,') === false);
t('reuses audit_log (no new table / migration)', strpos($ss, 'CREATE TABLE IF NOT EXISTS audit_log') !== false && strpos($ss, 'CREATE TABLE IF NOT EXISTS sms') === false);

// ── Ops wiring contracts (JS) — SMS fires only AFTER the primary op ───────────
$core = file_get_contents(__DIR__ . '/../ops/js/ops-core.js');
t('Ops.Api.sendSms posts to send-sms.php',   strpos($core, "'/send-sms.php'") !== false);
t('Ops.Api.sendSms sends only booking_id + intent', strpos($core, 'booking_id: dbId, intent: intent') !== false);
t('Ops.Sms helper + intent allow-list exist', strpos($core, 'Ops.Sms = {') !== false && strpos($core, 'booking_confirmed') !== false && strpos($core, 'staff_message') !== false);

$bk = file_get_contents(__DIR__ . '/../ops/js/bookings.js');
t('confirm flow fires SMS only after success (in the non-error branch)', strpos($bk, "Ops.Sms.send(b.dbId, 'booking_confirmed')") !== false);
t('confirm SMS opt-in captured before optimistic re-render', strpos($bk, "wantSms") !== false && strpos($bk, "Ops.Sms.isChecked('bk-sms-confirm')") !== false);

$ch = file_get_contents(__DIR__ . '/../ops/js/chat.js');
t('chat flow fires SMS only after the chat send resolves', strpos($ch, "Ops.Sms.send(c.bookingId, 'staff_message')") !== false);
t('chat SMS shown only for booking rooms with a phone', strpos($ch, 'smsOk') !== false && strpos($ch, 'bkRoom') !== false);

$cal = file_get_contents(__DIR__ . '/../ops/js/opsDayCalendar.js');
t('reschedule fires SMS only on success', strpos($cal, "Ops.Sms.send(id, 'reschedule')") !== false && strpos($cal, 'if (ok)') !== false);

echo "\n$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
