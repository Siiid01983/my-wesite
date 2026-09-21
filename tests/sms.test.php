<?php
// ════════════════════════════════════════════════════════════════════════════
//  tests/sms.test.php — unit + source-contract tests for the MANUAL SMS feature
//
//  Deterministic + OFFLINE. Verifies the CONTENT BUILDER (SmsService) and asserts,
//  by static source inspection, that the feature is MANUAL only: the server builds
//  the text but NEVER sends SMS (no provider / transport / credentials / delivery
//  log), the Ops UI opens the device SMS app or a copy fallback, and never claims
//  the SMS was "sent". Never contacts a provider, never needs a database.
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
t('chatUrl does NOT contain the customer name',         strpos($LINK, $NAME) === false);
t('chat link still carries the ref (identifies the conversation)', strpos($LINK, $REF) !== false);

// ── 2. Rendered body: Company + Name + reason + prompt + Link, per intent ─────
$bodyEstim   = SmsService::render('estimate',          $NAME, $REF, $LINK);
$bodyConfirm = SmsService::render('booking_confirmed', $NAME, $REF, $LINK);
$bodyResched = SmsService::render('reschedule',        $NAME, $REF, $LINK);
$bodyStaff   = SmsService::render('staff_message',     $NAME, $REF, $LINK);

t('company name is exactly "ハローMoving"',          SmsService::COMPANY === 'ハローMoving');
t('body starts with "ハローMoving"',                 strpos($bodyEstim, 'ハローMoving') === 0);
t('body no longer uses "Hello Moving"',              strpos($bodyEstim, 'Hello Moving') === false);
t('body includes the customer name + honorific',     strpos($bodyEstim, $NAME . ' 様') !== false);
t('body includes the chat prompt line',              strpos($bodyEstim, 'チャットをご確認ください。') !== false);
t('body ends with the exact chat link',              strpos($bodyEstim, $LINK) !== false);

// The reference / reservation wording must NOT appear in the BODY (only in the link).
foreach (['estimate' => $bodyEstim, 'booking' => $bodyConfirm, 'reschedule' => $bodyResched, 'staff' => $bodyStaff] as $k => $bd) {
  t("[$k] body does NOT show 予約番号",  strpos($bd, '予約番号') === false);
}
// The ref string appears ONLY inside the link line, never as a standalone body line.
$estimNoLink = trim(str_replace($LINK, '', $bodyEstim));
t('ref does NOT appear in the body outside the link', strpos($estimNoLink, $REF) === false);

// Context-specific reason lines.
t('ESTIMATE reason line',      strpos($bodyEstim,   'お見積もりをご案内しました。') !== false);
t('estimate omits booking wording', strpos($bodyEstim, 'ご予約') === false && strpos($bodyEstim, '予約日時') === false);
t('BOOKING reason line',       strpos($bodyConfirm, 'ご予約ありがとうございます。') !== false);
t('RESCHEDULE reason line',    strpos($bodyResched, 'ご予約日時が変更されました。') !== false);
t('STAFF-MESSAGE reason line', strpos($bodyStaff,   '新しいメッセージがあります。') !== false);
t('body never leaks the email',   strpos($bodyEstim, '@') === false);
t('all required elements present (company + name + reason + chat link)',
  strpos($bodyEstim, 'ハローMoving') !== false && strpos($bodyEstim, $NAME) !== false &&
  strpos($bodyEstim, 'お見積もりをご案内しました。') !== false && strpos($bodyEstim, $LINK) !== false);
t('blank name → お客様 fallback (never invents a name)', strpos(SmsService::render('estimate', '', $REF, $LINK), 'お客様 様') !== false);

// ── 3. Intent allow-list ─────────────────────────────────────────────────────
t('valid intents accepted', SmsService::isValidIntent('estimate') && SmsService::isValidIntent('booking_confirmed') && SmsService::isValidIntent('reschedule') && SmsService::isValidIntent('staff_message'));
t('unknown intent rejected', !SmsService::isValidIntent('marketing') && !SmsService::isValidIntent(''));

// ── 4. Phone normalization (server-side) + missing phone ──────────────────────
t('domestic 0XX → +81',          SmsService::normalizePhone('090-1234-5678') === '+819012345678');
t('spaced domestic normalized',  SmsService::normalizePhone('080 8888 7777') === '+818088887777');
t('+81 international kept',       SmsService::normalizePhone('+81 90 1234 5678') === '+819012345678');
t('0081 prefix normalized',      SmsService::normalizePhone('008190 1234 5678') === '+819012345678');
t('empty phone → ""',            SmsService::normalizePhone('') === '');
t('junk phone → ""',             SmsService::normalizePhone('abc') === '');
t('too-short phone → ""',        SmsService::normalizePhone('12345') === '');
t('ambiguous no-country refused',SmsService::normalizePhone('12223334444') === '');

// ── 5. Segment estimate (advisory only) ───────────────────────────────────────
t('short body = 1 segment', SmsService::segmentsUcs2('短い') === 1);
t('long body > 1 segment',  SmsService::segmentsUcs2(str_repeat('あ', 140)) > 1);

// ── 6. SmsService is a PURE BUILDER — no sending API remains ──────────────────
t('SmsService has NO send() method',      !method_exists('SmsService', 'send'));
t('SmsService has NO transport injection', !method_exists('SmsService', 'setTransport'));

// ════════════════════════════════════════════════════════════════════════════
//  Source-contract checks — the server NEVER sends SMS
// ════════════════════════════════════════════════════════════════════════════
$svc = file_get_contents(__DIR__ . '/../hm-api/SmsService.php');
t('SmsService.php makes no network call (no curl)', stripos($svc, 'curl_') === false);
t('SmsService.php references no provider',          stripos($svc, 'twilio') === false && stripos($svc, 'vonage') === false && stripos($svc, 'nexmo') === false && stripos($svc, 'sns') === false);

t('legacy send-sms.php has been REMOVED', !is_file(__DIR__ . '/../hm-api/send-sms.php'));

$cm = file_get_contents(__DIR__ . '/../hm-api/sms-compose.php');
t('compose requires an API key',                     strpos($cm, 'hm_require_api_key()') !== false);
t('compose is staff-only (X-ADMIN-TOKEN)',           strpos($cm, "hm_request_header('X-ADMIN-TOKEN')") !== false && strpos($cm, 'hm_admin_token_verify') !== false);
t('compose accepts admin OR manager',                strpos($cm, "'admin'") !== false && strpos($cm, "'manager'") !== false);
t('compose rejects unauthorized (403 forbidden)',    strpos($cm, "'forbidden'") !== false && strpos($cm, '403') !== false);
t('compose is rate-limited',                         strpos($cm, "hm_rate_limit('sms_compose'") !== false);
t('compose is gated by sms_compose_enabled (default off)', strpos($cm, "sms_compose_enabled'] ?? false") !== false && strpos($cm, "'sms_disabled'") !== false);
t('flag checked AFTER staff auth (not disclosed to anon)', strpos($cm, 'sms_compose_enabled') > strpos($cm, "hm_request_header('X-ADMIN-TOKEN')"));
$cfgex = file_get_contents(__DIR__ . '/../hm-api/_config.example.php');
t('sms_compose_enabled documented in _config.example.php (default false)', strpos($cfgex, "'sms_compose_enabled' => false") !== false);
t('compose derives phone from the bookings row',     strpos($cm, 'customer_phone') !== false && strpos($cm, 'FROM bookings') !== false);
t('compose never accepts a phone from the request',  strpos($cm, "\$p['phone']") === false && strpos($cm, "\$p['customer_phone']") === false);
t('compose refuses Ops blocks (admin_blocked)',      strpos($cm, 'admin_blocked') !== false && strpos($cm, 'not_eligible') !== false);
t('compose requires a customer reference',           strpos($cm, "preg_match('/^ref:") !== false && strpos($cm, 'no customer reference') !== false);
t('compose builds the link via EmailService::chatUrl', strpos($cm, 'EmailService::chatUrl(') !== false);
t('compose renders body via SmsService::render',     strpos($cm, 'SmsService::render(') !== false);
t('compose returns phone + body (no send)',          strpos($cm, "'phone'") !== false && strpos($cm, "'body'") !== false);
t('compose makes NO network / provider call',        stripos($cm, 'curl_') === false && stripos($cm, 'twilio') === false);
t('compose never claims the SMS was sent',           stripos($cm, "'sent'") === false && stripos($cm, 'delivered') === false);
t('compose writes NO delivery log / audit row',      strpos($cm, 'audit_log') === false && strpos($cm, "hm_log_write('info") === false);
t('compose creates NO table / migration',            stripos($cm, 'CREATE TABLE') === false);

// ── Ops wiring contracts (JS) — manual open, never "sent" ─────────────────────
$core = file_get_contents(__DIR__ . '/../ops/js/ops-core.js');
t('Ops.Api.composeSms posts to sms-compose.php',     strpos($core, "'/sms-compose.php'") !== false);
t('Ops.Api sends only booking_id + intent',          strpos($core, 'booking_id: dbId, intent: intent') !== false);
t('no server-send endpoint referenced (send-sms.php gone)', strpos($core, 'send-sms.php') === false);
t('Ops.Sms builds an sms: URI',                      strpos($core, "'sms:'") !== false);
t('sms: body is percent-encoded',                    strpos($core, 'encodeURIComponent(body') !== false);
t('Ops.Sms has a desktop copy fallback',             strpos($core, '_fallbackSheet') !== false && strpos($core, 'Ops.Sms.copy') !== false);
t('Ops.Sms distinguishes open from sent (未送信)',    strpos($core, '未送信') !== false);
// Scope the "never claims sent" check to the Ops.Sms helper block (the file also
// contains an unrelated chat-attachment placeholder that legitimately uses 送信しました).
$smsBlock = '';
if (preg_match('/Ops\.Sms\s*=\s*\{.*?\n  \};/s', $core, $mb)) $smsBlock = $mb[0];
t('Ops.Sms block was located', $smsBlock !== '');
t('Ops.Sms NEVER prints 送信しました / 送信済み',       strpos($smsBlock, '送信しました') === false && strpos($smsBlock, '送信済み') === false);
t('Ops.Sms mobile detection present',                strpos($core, 'isMobile') !== false);

t('client intent allow-list includes estimate', strpos($core, 'estimate: 1') !== false);

$bk = file_get_contents(__DIR__ . '/../ops/js/bookings.js');
t('bookings SMS button shown only for real bookings (ref + not admin_blocked)', strpos($bk, "b.ref && b.statusRaw !== 'admin_blocked'") !== false);
t('bookings SMS intent is context-specific (estimate vs booking_confirmed by status)',
  strpos($bk, "'pending' || b.statusRaw === 'checking'") !== false && strpos($bk, "'estimate'") !== false && strpos($bk, "'booking_confirmed'") !== false);
t('bookings no longer auto-sends after confirm', strpos($bk, 'Ops.Sms.send(') === false && strpos($bk, 'wantSms') === false);

$ch = file_get_contents(__DIR__ . '/../ops/js/chat.js');
t('chat uses the manual SMS button (staff_message)', strpos($ch, "buttonHtml(c.bookingId, 'staff_message'") !== false);
t('chat SMS only for booking rooms with a ref',      strpos($ch, 'smsOk') !== false && strpos($ch, 'c.bookingId && c.ref') !== false);
t('chat no longer auto-sends SMS after chat send',   strpos($ch, 'Ops.Sms.send(') === false && strpos($ch, 'wantSms') === false);

$cal = file_get_contents(__DIR__ . '/../ops/js/opsDayCalendar.js');
t('reschedule uses the manual SMS button (reschedule intent)', strpos($cal, "buttonHtml(id, 'reschedule'") !== false);
t('reschedule no longer auto-sends SMS on save',     strpos($cal, 'Ops.Sms.send(') === false && strpos($cal, 'wantSms') === false);

echo "\n$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
