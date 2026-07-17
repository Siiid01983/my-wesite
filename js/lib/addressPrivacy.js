/* ════════════════════════════════════════════════════════════════════════════
   addressPrivacy.js — shared address-privacy helper (Admin + Customer surfaces)

   Single source of truth for the "full address only after confirmation" rule so
   the Admin panel (admin-bookings.js) and the customer Portal (portalV2.js) mask
   identically. The Ops dispatch app (ops/js/ops-core.js) ships the SAME algorithm
   inline (util.maskAddress / Ops.addrText) — keep the two in sync if either
   changes. Load this BEFORE the consumer script.

   Rule: before a booking is CONFIRMED (確定) or COMPLETED (完了) only the locality
   is shown — banchi / building / apartment are masked. Privacy-first: an uncertain
   parse masks MORE. Western (comma) addresses keep the last two locality parts.

   View-layer only — no DB change, no server enforcement (matches the P1 model).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.HMAddrPrivacy) return;

  /* Accepts every status vocabulary in the codebase: canonical DB values
     (confirmed|completed), Japanese labels (確定|完了), and 'done'. */
  function confirmed(status) {
    var raw = String(status == null ? '' : status).trim();
    var s = raw.toLowerCase();
    return s === 'confirmed' || s === 'completed' || s === 'done'
        || raw === '確定' || raw === '完了';
  }

  function maskAddress(a) {
    a = String(a == null ? '' : a).trim();
    if (!a) return '';
    if (a.indexOf(',') >= 0) {                                   // western: keep last 2 locality parts
      var p = a.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return (p.length > 2 ? p.slice(-2).join(', ') : p.join(', ')) + ' …';
    }
    var m = a.match(/^(.*?[0-9０-９]+\s*丁目)/);                   // JP: keep through chōme
    if (m) return m[1].trim() + ' …';
    m = a.match(/^([^0-9０-９]+)/);                               // else keep up to the first number
    if (m && m[1].trim().length >= 2) return m[1].trim() + ' …';
    return a.slice(0, 6) + ' …';
  }

  /* Full address only when confirmed; otherwise the masked locality. */
  function addrText(fullAddr, status) {
    var full = String(fullAddr == null ? '' : fullAddr);
    if (!full) return '';
    return confirmed(status) ? full : maskAddress(full);
  }

  window.HMAddrPrivacy = {
    confirmed: confirmed,
    maskAddress: maskAddress,
    addrText: addrText,
    /* i18n-free note strings (Admin/Portal are JP-first). */
    HINT_JA: '住所の詳細は予約確定後に表示されます',
    HINT_EN: 'Full address is shown after the booking is confirmed',
  };
})();
