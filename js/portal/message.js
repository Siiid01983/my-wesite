// js/portal/message.js → window.PortalMessage
// Customer → company message submission from the マイページ portal.
//
// Sends the customer's message to hm-api/contact.php, which is the single
// server-side intake for the contact@ channel. contact.php:
//   • writes an inbox_messages row with mailbox = contact@hello-moving.com
//     → the message shows up instantly in the admin Inbox under the contact@ tab
//     as a NEW thread (thread_id = its own message_id);
//   • sends the notification email + LINE alert.
// The contact@ mailbox is fixed server-side (contact.php hardcodes it), so a
// portal message always lands on the restricted contact@ channel — the client
// cannot route it anywhere else.
//
// This module only SENDS. The portal's read-only history (portalComms.js) reads
// the separate `communications` table, so a freshly sent message won't appear in
// that history list; it appears in the admin Inbox, which is the goal.

(function () {
  'use strict';

  function _base() { return (window.API_BASE || '').replace(/\/$/, ''); }

  // Send one message. `opts`:
  //   name    — sender display name (from the session; falls back to お客様)
  //   email   — sender email (the session email; used as Reply-To by the server)
  //   subject — optional subject; a booking-reference default is used if blank
  //   message — required message body
  //   ref     — booking reference, embedded in the default subject for context
  //
  // Returns { ok:true } on success, or { ok:false, error } on failure.
  async function send(opts) {
    opts = opts || {};
    var base    = _base();
    var email   = String(opts.email || '').trim();
    var message = String(opts.message || '').trim();
    var name    = String(opts.name || '').trim() || 'お客様';
    var ref     = String(opts.ref || '').trim();

    if (!base)     return { ok: false, error: 'no-endpoint' };
    if (!email)    return { ok: false, error: 'no-email' };
    if (!message)  return { ok: false, error: 'empty' };

    var subject = String(opts.subject || '').trim();
    if (!subject) {
      subject = ref ? ('マイページからのお問い合わせ（予約番号 ' + ref + '）')
                    : 'マイページからのお問い合わせ';
    } else if (ref) {
      subject = subject + '（予約番号 ' + ref + '）';
    }

    var result;
    try {
      var res = await fetch(base + '/contact.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
        body: JSON.stringify({
          name:    name,
          email:   email,
          subject: subject,
          message: message
        })
      });
      result = await res.json().catch(function () {
        return { ok: false, error: { message: 'HTTP ' + res.status } };
      });
    } catch (err) {
      console.error('[PortalMessage] send failed:', err);
      return { ok: false, error: 'network' };
    }

    if (result && result.ok) return { ok: true };
    var e = result && result.error;
    return { ok: false, error: (e && (e.code || e.message)) || 'failed' };
  }

  window.PortalMessage = { send: send };
})();
