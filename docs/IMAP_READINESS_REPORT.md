# IMAP Readiness Report — Phase 2 Prerequisites

**Date:** 2026-07-02
**Purpose:** verify readiness for IMAP-polling inbound ingestion (Email Center Phase 2).
**Method note:** probes below were run **from the Claude Code environment**, not from the
production PHP server. Network/TLS reachability is therefore authoritative for "the IMAP service
is live and TLS-valid"; anything requiring a **server shell** (php-imap extension, server→IMAP
egress) or **mailbox credentials** (per-mailbox login) is marked **UNVERIFIABLE HERE** — it needs
to be run on the cPanel host. No code was modified.

**Legend:** ✅ PASS · ⛔ UNVERIFIABLE (needs server shell / credentials)

---

## PASS / FAIL

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | **php-imap extension installed** | ⛔ UNVERIFIABLE HERE | Needs server: `php -m \| grep -i imap` (or `php -r "var_dump(function_exists('imap_open'));"`). No shell/admin token available; no endpoint reports PHP modules. |
| 2 | **IMAP connectivity to mail.hello-moving.com** | ✅ PASS | DNS `mail.hello-moving.com` → `157.90.129.171` (alias of hello-moving.com). TCP **993 OPEN**, TCP **143 OPEN**. Server greeting: `* OK … Dovecot ready.` |
| 3 | **SSL/TLS support** | ✅ PASS | TLS handshake on **993** succeeded; valid **Let's Encrypt** cert `CN=hello-moving.com`, **Verify return code: 0 (ok)**, validity `2026-06-11 … 2026-09-09`. IMAPS (implicit TLS) working. |
| 4 | **Recommended host/port** | ✅ PASS (recommendation) | **`mail.hello-moving.com`, port `993`, implicit SSL/TLS** (`imap_secure=ssl`). Server is **Dovecot**, `IMAP4rev1`, capabilities `IDLE ENABLE SASL-IR AUTH=PLAIN AUTH=LOGIN`. Port 143 (STARTTLS) also open but 993 is preferred. |
| 5 | **Cron support** | ⛔ UNVERIFIABLE HERE | cPanel standard feature; confirm in cPanel → Cron Jobs, or `crontab -l` on the host. Matches the existing `deploy.yml`/cPanel setup, so almost certainly available — but not provable from here. |
| 6 | **Can read booking@hello-moving.com** | ⛔ UNVERIFIABLE HERE | Requires an authenticated `imap_open('{mail.hello-moving.com:993/imap/ssl}INBOX', 'booking@hello-moving.com', <pass>)`. No mailbox password available; no unauthenticated login was attempted. |
| 7 | **Can read support@hello-moving.com** | ⛔ UNVERIFIABLE HERE | Same as #6 with `support@` credentials. |
| 8 | **Can read contact@hello-moving.com** | ⛔ UNVERIFIABLE HERE | Same as #6 with `contact@` credentials. |

---

## What is proven vs. what remains

**Proven from here (✅):** the IMAP service exists, is reachable, and presents valid TLS —
Dovecot on `mail.hello-moving.com:993` with a trusted Let's Encrypt certificate. This confirms the
**transport half** of Phase 2 (host/port/security in `INBOX_EMAIL_CENTER_PLAN.md` §2.7 are correct:
`imap_host=mail.hello-moving.com`, `imap_port=993`, `imap_secure=ssl`).

**Still to confirm on the server (⛔):** the **PHP-side half** — that the host has the `imap`
extension, can egress to its own IMAP port, has cron, and that the three mailbox credentials
authenticate and expose an INBOX.

### Server-side commands to close the ⛔ items
Run on the cPanel host (SSH/Terminal); paste results back to finalize this report:

```bash
# 1. php-imap extension
php -m | grep -i imap            # expect: imap

# 5. cron
crontab -l 2>/dev/null; ls /usr/bin/crontab   # or cPanel → Cron Jobs

# 6–8. per-mailbox read test (repeat per mailbox; needs the mailbox password)
php -r '$m=imap_open("{mail.hello-moving.com:993/imap/ssl}INBOX","booking@hello-moving.com","PASSWORD");
        var_dump($m!==false); echo $m?imap_num_msg($m):imap_last_error(),"\n"; $m&&imap_close($m);'
```

*(If `allow_url_fopen`/functions are restricted, or php-imap is absent, the Phase 2 fallback is a
cPanel email-pipe or an inbound webhook provider — see the plan.)*

---

## Summary

| Category | Status |
|----------|--------|
| IMAP reachability + TLS (network) | ✅ **READY** |
| Recommended host/port/security | ✅ `mail.hello-moving.com:993` SSL (Dovecot) |
| php-imap extension | ⛔ verify on server |
| Cron | ⛔ verify on server |
| Mailbox authentication (booking/support/contact) | ⛔ verify on server (needs passwords) |

**Verdict:** transport layer is **READY**; Phase 2 implementation is unblocked **once** the three
server-side items (php-imap, cron, mailbox credentials) are confirmed on the cPanel host.
