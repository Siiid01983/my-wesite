# Email → Authenticated SMTP — Deployment Report

**Project:** Hello Moving (hello-moving.com)
**Change:** Real authenticated SMTP delivery, dependency-free (no Composer/PHPMailer), replacing the silent `mail()` fallback.
**Environment:** Shared cPanel, no Composer, no `vendor/`, API at `/public_html/hm-api`.
**Scope guard:** No changes to admin auth, `admin_users`, booking schema, or API authentication.

---

## 1. Audit of the previous `send-email.php`

- SMTP "support" existed only as **dead code** — gated behind `is_file('vendor/autoload.php')` + the `PHPMailer` class, neither of which exist here.
- Result: with `mail_mode='smtp'`, execution **always fell through to `@mail()`** — unauthenticated, poor SPF/DKIM alignment. That is the deliverability bug being fixed.
- `send-email.php` is the **only** outbound mail path. Frontend consumers: `admin-bookings.js` `_sendBookingEmail`, `communications.js` `_deliver` — both read `result.ok`, `result.messageId`, and a **string** `result.error`.

---

## 2. Architecture

```
admin-bookings.js / communications.js
        │  POST {from_account,to,subject,message,booking_id}   (X-API-KEY)
        ▼
hm-api/send-email.php
        │  mode = _config.php['mail_mode']
        ├── 'mail'  → PHP mail()                       (unchanged path)
        └── 'smtp'  → hm_smtp_send()  ── hm-api/_smtp.php
                          │  fsockopen → 220
                          │  EHLO → STARTTLS → EHLO     (secure='tls', port 587)
                          │  AUTH LOGIN (PLAIN fallback)
                          │  MAIL FROM / RCPT TO / DATA (multipart/alternative, base64 UTF-8)
                          ▼  ['messageId','response','transport']
        On ANY smtp failure: hm_log_error() + structured JSON error. NEVER mail().
```

**`hm-api/_smtp.php` (new, dependency-free):**
- **Transport / TLS** (verification enabled — certificate **and** hostname):
  - `secure='tls'` (587, recommended): plain connect via **`fsockopen()`**, then STARTTLS via `stream_socket_enable_crypto()`. Because `fsockopen()` cannot carry a stream context, the verification options (`verify_peer`, `verify_peer_name`, `allow_self_signed=false`, `SNI_enabled`, `peer_name=host`) are applied to the stream's context with **`stream_context_set_option()`** immediately before the handshake.
  - `secure='ssl'` (465, implicit TLS): handshake happens at connect, so the same options are passed via a context to **`stream_socket_client('ssl://…', …, $ctx)`** (fsockopen can't, for this branch).
  - `secure=''` (25): plain, no encryption.
- **AUTH LOGIN** (PLAIN fallback from advertised `EHLO` caps).
- **Recipient validation** in `hm_smtp_send()` (and the self-test send): rejects CR/LF and non-`FILTER_VALIDATE_EMAIL` addresses → `invalid_recipient`, blocking SMTP/header injection for every caller.
- **UTF-8 + HTML**: `multipart/alternative` (plain+HTML), base64 bodies, MIME-encoded Subject/From — safe for Japanese.
- **Response validation** on every command (220/250/334/235/354); **full-payload write loop** (handles partial `fwrite`, throws `smtp_send` if the socket closes mid-DATA); **timeouts** via `stream_set_timeout` + connect timeout; typed `HM_SMTP_Exception` carrying a `->smtpCode`.
- Public API: `hm_smtp_send(...)`, `hm_smtp_selftest(...)`, plus helpers `hm_smtp_build_message`, `hm_smtp_opts`, `hm_smtp_public_msg`. Whole file wrapped in `if (!class_exists('HM_SMTP_Exception'))` to be re-include-safe.

**Response envelope (additive — backward compatible):**
- Success: `{ ok:true, data:{from,messageId,transport}, error:null, from, messageId, transport }`
- Failure: `{ ok:false, data:null, error:"<string>", error_detail:{message,code} }`
- Legacy string `error` + top-level `from`/`messageId` preserved → **frontend needs no edits**.
- Error codes: `bad_recipient`, `empty_message`, `smtp_config`, `smtp_dns`, `smtp_connect`, `smtp_tls`, `smtp_auth`, `smtp_send`, `smtp_unavailable`, `smtp_error`, `mail_send`.

**Self-test:** `GET|POST <API_BASE>/send-email.php?action=selftest[&send=1[&to=addr]]` (API-key + admin-gated, separately rate-limited). Runs **DNS resolution → connect → STARTTLS → auth** (+ optional send):
```json
{ "ok": true, "data": { "dns": "1.2.3.4", "smtp": "connected", "starttls": "ok", "auth": "success" } }
```
```json
{ "ok": false, "data": {…partial…}, "error": "SMTP authentication failed",
  "error_detail": { "message": "SMTP authentication failed", "code": "smtp_auth" } }
```

**Logging (`hm_log_error` → `hm-api/logs/error.log`, JSON):** connection (`smtp_connect`), TLS (`smtp_tls`), auth (`smtp_auth`), send (`smtp_send`), `mail()` failures, self-test failures, and `_smtp.php`-missing (`smtp_unavailable`). AUTH credentials are never logged.

---

## 3. Resilience — cannot fatal if `_smtp.php` is missing (Requirement 10)

`send-email.php` does **not** hard-`require` `_smtp.php`. It loads it guarded:
```php
$HM_SMTP_READY = false;
if (is_file(__DIR__ . '/_smtp.php')) {
  require_once __DIR__ . '/_smtp.php';
  $HM_SMTP_READY = function_exists('hm_smtp_send') && function_exists('hm_smtp_selftest');
}
```
- `mail_mode='smtp'` + `_smtp.php` missing → **structured 500** `smtp_unavailable`, logged. **No fatal. No silent mail() fallback.**
- `mail_mode='mail'` → unaffected even if `_smtp.php` is absent.
- The `catch (HM_SMTP_Exception …)` and the PHPMailer adapter are only reached **after** the `$HM_SMTP_READY` guard, so the class is always loaded when referenced.

**Verified include/require paths:** `_lib.php` ✅, `_ratelimit.php` ✅ (hard requires, pre-existing & present), `_smtp.php` ✅ (guarded by `is_file`), `vendor/autoload.php` ✅ (guarded by `is_file`, absent → native client used).

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| Half-deploy (`send-email.php` without `_smtp.php`) | Guarded load → `smtp_unavailable`, no fatal. Still: **deploy both files together.** |
| Wrong `smtp_host`/port/secure | Self-test surfaces exact failing stage + code before real sends. |
| Port 587/465 blocked by host firewall | `smtp_connect` error + log; ask cPanel host to allow outbound SMTP, or use `mail` mode. |
| TLS cert/SNI/hostname mismatch | `verify_peer` + `verify_peer_name` + `SNI_enabled` + `peer_name` enforced (via context for `ssl://`, via `stream_context_set_option()` before STARTTLS); a bad/mismatched cert fails the handshake → `smtp_tls` error + log (no silent downgrade). |
| Recipient-based SMTP/header injection | `hm_smtp_send()` rejects CR/LF + invalid addresses (`invalid_recipient`, HTTP 400) before any socket write. |
| Frontend regression | Envelope is additive; legacy fields kept; no frontend edit needed. |
| Self-test abuse / open-relay probing | API-key + admin-token gated, rate-limited `5/min`, default test recipient is `smtp_user` (self). |

---

## 5. Deployment steps (cPanel)

1. Upload **both** files to `/public_html/hm-api/` (atomically / together):
   - `hm-api/_smtp.php`
   - `hm-api/send-email.php`
   (Optional) `hm-api/_config.example.php` for documentation.
2. In `/public_html/hm-api/_config.php` confirm:
   ```php
   'mail_mode'   => 'smtp',
   'smtp_host'   => 'mail.hello-moving.com',
   'smtp_port'   => 587,
   'smtp_user'   => 'booking@hello-moving.com',
   'smtp_pass'   => '<configured>',   // REQUIRED — auth mandatory
   'smtp_secure' => 'tls',
   ```
3. Lint on the server:
   ```bash
   php -l /home/<cpaneluser>/public_html/hm-api/_smtp.php
   php -l /home/<cpaneluser>/public_html/hm-api/send-email.php
   ```
4. Self-test (no mail): `https://hello-moving.com/hm-api/send-email.php?action=selftest`
5. Self-test (sends to `smtp_user`): add `&send=1`.
6. Send one real booking email from the admin and confirm receipt + `logs/error.log` is clean.

---

## 6. Rollback steps

- **Fastest (no redeploy):** set `'mail_mode' => 'mail'` in `_config.php`. SMTP path is bypassed; `mail()` resumes. `_smtp.php` can stay in place.
- **Full revert of the endpoint:** restore the previous `send-email.php`:
  ```bash
  git checkout origin/main -- hm-api/send-email.php   # pre-SMTP version (no _smtp dependency)
  ```
  (The old version has no `_smtp.php` requirement, so removing `_smtp.php` is safe afterward.)
- Either way: no DB/schema/auth changes were made, so there is nothing else to roll back.

---

## 7. Validation checklist

- [ ] `php -l` passes for `_smtp.php` and `send-email.php` on the server.
- [ ] `?action=selftest` → `{ok:true, data:{dns, smtp:"connected", starttls:"ok", auth:"success"}}`.
- [ ] `?action=selftest&send=1` → test mail received at `booking@hello-moving.com`.
- [ ] Real admin booking email (new / confirmed / complete) received; `From` correct per `from_account`.
- [ ] Bad password (temporarily) → `{ok:false, error:"SMTP authentication failed", error_detail:{code:"smtp_auth"}}` + `error.log` entry; **no** `mail()` fallback.
- [ ] Rename `_smtp.php` temporarily, POST a send → `{ok:false, error_detail:{code:"smtp_unavailable"}}`, HTTP 500, **no PHP fatal** in logs. Restore the file.
- [ ] `mail_mode='mail'` still works with `_smtp.php` absent.
- [ ] Frontend: `admin-bookings.js` toast shows a readable string on failure (not `[object Object]`).
- [ ] No credentials appear in `logs/error.log`.

---

## 8. Final patch — files changed

| File | Status |
|---|---|
| `hm-api/_smtp.php` | **NEW** — fsockopen SMTP client, STARTTLS, AUTH LOGIN, UTF-8/HTML, DNS self-test. |
| `hm-api/send-email.php` | **MODIFIED** — guarded `_smtp.php` load (no-fatal), smtp/mail routing, no silent fallback, self-test w/ DNS, structured logging, additive envelope. HTML template unchanged. |
| `hm-api/_config.example.php` | **MODIFIED (docs)** — `mail_mode`/`smtp_secure` notes, self-test URLs, optional `smtp_timeout`/`smtp_helo`. |
| `EMAIL_SMTP_DEPLOYMENT_REPORT.md` | **NEW** — this report. |

> ⚠️ **Honest status:** no PHP runtime exists in this dev environment, so I could **not** run `php -l` or a live SMTP handshake locally — the code is written and statically reviewed only. Run the §5 lint + §7 checklist on the server before trusting production sends. These files are currently **untracked/modified and not committed or pushed** — commit and deploy `_smtp.php` and `send-email.php` **together**.
