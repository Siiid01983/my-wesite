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

  /* The full address (and a clickable map link) is revealed ONLY while a booking
     is CONFIRMED (確定). Completed and cancelled bookings are terminal and privacy-
     restricted — see restricted() — so they are intentionally EXCLUDED here. */
  function confirmed(status) {
    var raw = String(status == null ? '' : status).trim();
    return raw.toLowerCase() === 'confirmed' || raw === '確定';
  }

  /* Privacy-restricted (terminal) states — CANCELLED or COMPLETED. These hide the
     phone, email, full address, maps and notes across every staff surface; only the
     identity (booking id / name / city / service / status) stays visible. */
  function restricted(status) {
    var raw = String(status == null ? '' : status).trim();
    var s = raw.toLowerCase();
    return s === 'cancelled' || s === 'canceled' || s === 'completed' || s === 'done'
        || raw === 'キャンセル' || raw === '却下' || raw === '完了';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* Keyless Google Maps search URL for an address (no API key, works everywhere). */
  function mapsUrl(addr) {
    return addr ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr) : '';
  }
  /* HTML for an address cell: once CONFIRMED the full address becomes a clickable
     link that opens Google Maps (Issue 4 — no buttons, the text itself is the link);
     before confirmation only the masked locality is shown as plain text. Returns ''
     for an empty address so callers can omit the row. */
  function addrHtml(fullAddr, status) {
    var full = String(fullAddr == null ? '' : fullAddr);
    if (!full) return '';
    if (confirmed(status)) {
      return '<a href="' + esc(mapsUrl(full)) + '" target="_blank" rel="noopener" ' +
        'title="Google マップで開く" style="color:inherit;text-decoration:underline;text-underline-offset:2px">' +
        esc(full) + '</a>';
    }
    return esc(maskAddress(full));
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
    restricted: restricted,
    maskAddress: maskAddress,
    addrText: addrText,
    addrHtml: addrHtml,
    mapsUrl: mapsUrl,
    /* i18n-free note strings (Admin/Portal are JP-first). */
    HINT_JA: '詳細住所は確定後に表示されます',
    HINT_EN: 'Full address will be visible after booking confirmation.',
  };
})();
