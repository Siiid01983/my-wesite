/* ════════════════════════════════════════════════════════════════════════════
   addressPrivacy.js — shared address-privacy helper (staff surfaces)

   Single source of truth for the "full address only after confirmation" rule on
   the Admin panel (admin-bookings.js). The Ops dispatch app (ops/js/ops-core.js)
   ships the SAME algorithm inline (util.maskAddress / Ops.addrText) — keep the two
   in sync if either changes. The customer Portal intentionally does NOT mask (a
   customer sees their own full address). Load this BEFORE the consumer script.

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

  /* Before 確定, show only the SERVICE AREA — 都道府県 + the first 市/区/町/村
     (e.g. 東京都新宿区 / 埼玉県川口市 / 神奈川県横浜市). Street/番地, building,
     apartment, floor and postal code are dropped so dispatchers know the area
     without seeing the exact address. */
  function maskAddress(a) {
    a = String(a == null ? '' : a).trim();
    if (!a) return '';
    // Drop a leading postal code (〒123-4567 / 123-4567) — never shown pre-確定.
    a = a.replace(/^〒?\s*[0-9０-９]{3}[-‐ー－]?[0-9０-９]{4}\s*/, '').trim();
    // JP: 都道府県 (optional) + up to and including the FIRST 市/区/町/村.
    var m = a.match(/^\s*([^0-9０-９]*?[都道府県])?\s*([^0-9０-９]*?[市区町村])/);
    if (m && m[2]) return ((m[1] || '') + m[2]).replace(/\s+/g, '');
    // Western fallback: keep the last two locality parts (city, region) — no street.
    if (a.indexOf(',') >= 0) {
      var p = a.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return p.length > 2 ? p.slice(-2).join(', ') : p.join(', ');
    }
    // Last resort: keep text up to the first number (drops the street number on).
    var n = a.match(/^([^0-9０-９]+)/);
    return n && n[1].trim().length >= 2 ? n[1].trim() : '';
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
    HINT_JA: '詳細住所は確定後に表示されます',
    HINT_EN: 'Full address is shown after confirmation',
  };
})();
