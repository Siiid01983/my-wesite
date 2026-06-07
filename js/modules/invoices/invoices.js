'use strict';

/* ════════════════════════════════════════════════════════
   INVOICE MANAGER — Phase 22A
   Generate, preview, print and download PDF invoices from bookings.

   Storage key : hm_invoices  →  { version, counter, records: { [bookingId]: {number, issuedAt} } }
   Depends on  : Adapter.getBookings(), Adapter.getPrices()
                 _capturePrintHtml(), _pdfDownload()  (js/utils/pdf.js)
   ════════════════════════════════════════════════════════ */

window.InvoiceManager = (function () {

  var STORAGE_KEY = 'hm_invoices';

  var COMPANY = {
    name:    'ハロームービング',
    nameEn:  'Hello Moving',
    license: '第 431320058126 号',
  };

  /* ── Storage ── */

  function _load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    return { version: 1, counter: 0, records: {} };
  }

  function _persist(d) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (_) {}
  }

  function _pad(n, len) { return String(n).padStart(len, '0'); }

  /* ── Generate invoice data (idempotent — same number on repeat calls) ── */

  function generate(bookingId) {
    var store  = _load();
    var record = store.records[bookingId];

    if (!record) {
      store.counter++;
      var now     = new Date();
      var ds      = now.getFullYear() + _pad(now.getMonth() + 1, 2) + _pad(now.getDate(), 2);
      var number  = 'INV-' + ds + '-' + _pad(store.counter, 4);
      var issued  = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
      record = { number: number, issuedAt: issued };
      store.records[bookingId] = record;
      _persist(store);
    }

    /* Booking lookup — prefer BookingService (real-time), fall back to Adapter */
    var bk = null;
    if (window.BookingService) bk = BookingService.getBookings().find(function (b) { return b.id === bookingId; });
    if (!bk && window.Adapter)  bk = Adapter.getBookings().find(function (b) { return b.id === bookingId; });
    if (!bk) return null;

    /* Pricing */
    var prices = window.Adapter ? Adapter.getPrices() : {};
    var p      = prices[bk.service];
    var base   = p ? (typeof p === 'number' ? p : (p.base || 0)) : 0;
    var tax    = Math.round(base * 0.1);

    return { number: record.number, issuedAt: record.issuedAt,
             booking: bk, base: base, tax: tax, total: base + tax };
  }

  /* ── Modal preview ── */

  function openModal(bookingId) {
    var existing = document.getElementById('invoiceModal');
    if (existing) existing.remove();

    var data = generate(bookingId);
    if (!data) { if (typeof toast === 'function') toast('予約データが見つかりません'); return; }

    var overlay = document.createElement('div');
    overlay.id        = 'invoiceModal';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML =
      '<div class="modal" style="max-width:600px;padding:0;overflow:hidden">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;' +
             'padding:20px 24px 16px;border-bottom:1px solid var(--line)">' +
          '<div class="modal-title" style="margin:0">請求書 — ' + _esc(data.number) + '</div>' +
          '<button class="btn btn-ghost btn-sm" onclick="InvoiceManager.closeModal()">閉じる</button>' +
        '</div>' +
        '<div style="padding:24px;max-height:55vh;overflow-y:auto">' + _preview(data) + '</div>' +
        '<div class="m-actions" style="padding:16px 24px;border-top:1px solid var(--line)">' +
          '<button class="btn btn-ghost" onclick="InvoiceManager.print(\'' + bookingId + '\')" ' +
            'style="gap:6px">' +
            '<svg viewBox="0 0 24 24" width="13" height="13">' +
              '<path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3z' +
                'm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>' +
            '</svg>印刷' +
          '</button>' +
          '<button class="btn btn-primary" onclick="InvoiceManager.download(\'' + bookingId + '\')" ' +
            'style="gap:6px">' +
            '<svg viewBox="0 0 24 24" width="13" height="13">' +
              '<path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>' +
            '</svg>PDF ダウンロード' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) InvoiceManager.closeModal();
    });
  }

  function closeModal() {
    var el = document.getElementById('invoiceModal');
    if (el) el.remove();
  }

  /* ── Print (captured by _capturePrintHtml for PDF) ── */

  function printInvoice(bookingId) {
    var data = generate(bookingId);
    if (!data) return;
    var w = window.open('', '_blank');
    w.document.write(_printHTML(data));
    w.document.close();
  }

  /* ── PDF download ── */

  function download(bookingId) {
    if (typeof _capturePrintHtml !== 'function' || typeof _pdfDownload !== 'function') {
      if (typeof toast === 'function') toast('PDFライブラリが読み込まれていません');
      return;
    }
    var h = _capturePrintHtml(function () { printInvoice(bookingId); });
    if (h) _pdfDownload(h, '請求書_' + bookingId + '.pdf');
  }

  /* ── Helpers ── */

  function _esc(s) { return typeof esc === 'function' ? esc(String(s || '')) : String(s || '').replace(/[&<>"']/g, function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function _fmt(n) { return '¥' + (n || 0).toLocaleString('ja-JP'); }
  function _fmtDate(ds) {
    if (!ds) return '—';
    var p = String(ds).split('-');
    return p.length === 3 ? p[0] + '年' + parseInt(p[1]) + '月' + parseInt(p[2]) + '日' : ds;
  }

  function _row(l, v) {
    return '<div style="display:flex;padding:7px 0;border-bottom:1px solid var(--line-2);gap:12px">' +
      '<span style="font-size:12px;color:var(--gray-1);width:100px;flex-shrink:0">' + l + '</span>' +
      '<span style="font-size:13px;color:var(--ink);word-break:break-all">' + _esc(String(v || '—')) + '</span></div>';
  }

  /* ── Preview HTML (modal) ── */

  function _preview(data) {
    var bk = data.booking;
    return (
      /* Header */
      '<div style="display:grid;grid-template-columns:1fr auto;gap:12px;margin-bottom:20px">' +
        '<div>' +
          '<div style="font-weight:700;font-size:16px;color:var(--ink)">' + _esc(COMPANY.name) + '</div>' +
          '<div style="font-size:11px;color:var(--gray-1);margin-top:3px">国土交通省 認可 ' + COMPANY.license + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:22px;font-weight:700;color:var(--ink);letter-spacing:.06em">請求書</div>' +
          '<div style="font-size:11px;color:var(--gray-1);margin-top:3px">' + _esc(data.number) + '</div>' +
          '<div style="font-size:11px;color:var(--gray-1)">発行日: ' + _esc(data.issuedAt) + '</div>' +
        '</div>' +
      '</div>' +

      /* Customer */
      '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;' +
           'color:var(--gray-2);margin-bottom:6px">請求先</div>' +
      _row('お客様名', bk.name) +
      _row('メール', bk.email) +
      (bk.phone ? _row('電話番号', bk.phone) : '') +

      /* Service */
      '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;' +
           'color:var(--gray-2);margin:16px 0 6px">サービス内容</div>' +
      _row('サービス', bk.service) +
      _row('引越し日', typeof fmtD === 'function' ? fmtD(bk.date) : bk.date) +
      _row('時間帯', bk.time) +
      _row('引越し元', bk.fromAddr) +
      _row('引越し先', bk.toAddr) +
      (bk.notes ? _row('備考', bk.notes) : '') +

      /* Pricing */
      '<div style="background:var(--bg-soft);border-radius:8px;padding:14px 16px;margin-top:20px">' +
        '<div style="display:flex;justify-content:space-between;padding:7px 0;' +
             'border-bottom:1px solid var(--line-2);font-size:13px">' +
          '<span style="color:var(--gray-1)">基本料金</span>' +
          '<span style="font-weight:600">' + _fmt(data.base) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:7px 0;' +
             'border-bottom:1px solid var(--line-2);font-size:13px">' +
          '<span style="color:var(--gray-1)">消費税（10%）</span>' +
          '<span>' + _fmt(data.tax) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:10px 0 2px;' +
             'font-size:15px;font-weight:700">' +
          '<span>合計金額</span>' +
          '<span style="color:var(--blue)">' + _fmt(data.total) + '</span></div>' +
      '</div>'
    );
  }

  /* ── Full standalone print HTML ── */

  function _printHTML(data) {
    var bk = data.booking;
    var r = function (l, v) {
      return '<tr>' +
        '<td style="padding:8px 12px;background:#f8f9fa;font-size:12px;color:#6b7280;' +
             'width:130px;vertical-align:top;border-bottom:1px solid #e5e7eb">' + l + '</td>' +
        '<td style="padding:8px 12px;font-size:13px;color:#0b0f17;border-bottom:1px solid #e5e7eb">' +
             String(v || '—') + '</td></tr>';
    };

    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
      '<title>請求書 ' + data.number + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=swap" rel="stylesheet">' +
      '<style>' +
        'body{font-family:"Noto Sans JP",sans-serif;margin:0;padding:40px;color:#0b0f17;font-size:14px;-webkit-print-color-adjust:exact}' +
        'table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}' +
        '@media print{body{padding:20px}@page{margin:15mm}}' +
      '</style></head><body>' +

      /* Header */
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
           'margin-bottom:32px;padding-bottom:20px;border-bottom:3px solid #0a1f44">' +
        '<div>' +
          '<div style="font-size:22px;font-weight:700;color:#0a1f44">' + COMPANY.name + '</div>' +
          '<div style="font-size:12px;color:#9ca3af;margin-top:2px">' + COMPANY.nameEn + '</div>' +
          '<div style="font-size:11px;color:#9ca3af;margin-top:6px">国土交通省 認可 ' + COMPANY.license + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:32px;font-weight:700;color:#0a1f44;letter-spacing:.1em">請求書</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:6px">番号: ' + data.number + '</div>' +
          '<div style="font-size:12px;color:#6b7280">発行日: ' + data.issuedAt + '</div>' +
          '<div style="font-size:12px;color:#6b7280">予約番号: ' + bk.id + '</div>' +
        '</div>' +
      '</div>' +

      /* Customer */
      '<div style="margin-bottom:24px">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;' +
             'color:#6b7280;margin-bottom:8px">請求先</div>' +
        '<table><tbody>' +
          r('お客様名', bk.name) + r('メールアドレス', bk.email) +
          (bk.phone ? r('電話番号', bk.phone) : '') +
        '</tbody></table></div>' +

      /* Service */
      '<div style="margin-bottom:24px">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;' +
             'color:#6b7280;margin-bottom:8px">サービス内容</div>' +
        '<table><tbody>' +
          r('サービス', bk.service) + r('引越し日', _fmtDate(bk.date)) +
          r('希望時間帯', bk.time) + r('引越し元', bk.fromAddr) +
          r('引越し先', bk.toAddr) + (bk.notes ? r('備考', bk.notes) : '') +
        '</tbody></table></div>' +

      /* Totals */
      '<div style="margin-bottom:32px">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;' +
             'color:#6b7280;margin-bottom:8px">お支払い金額</div>' +
        '<table><tbody>' +
          '<tr><td style="padding:10px 12px;background:#f8f9fa;font-size:13px;color:#6b7280;' +
               'border-bottom:1px solid #e5e7eb">基本料金</td>' +
               '<td style="padding:10px 12px;text-align:right;font-size:13px;border-bottom:1px solid #e5e7eb">' +
               _fmt(data.base) + '</td></tr>' +
          '<tr><td style="padding:10px 12px;background:#f8f9fa;font-size:13px;color:#6b7280;' +
               'border-bottom:1px solid #e5e7eb">消費税（10%）</td>' +
               '<td style="padding:10px 12px;text-align:right;font-size:13px;border-bottom:1px solid #e5e7eb">' +
               _fmt(data.tax) + '</td></tr>' +
          '<tr style="background:#0a1f44">' +
               '<td style="padding:14px 12px;font-size:16px;font-weight:700;color:#fff">合計金額</td>' +
               '<td style="padding:14px 12px;text-align:right;font-size:16px;font-weight:700;color:#fff">' +
               _fmt(data.total) + '</td></tr>' +
        '</tbody></table></div>' +

      /* Footer */
      '<div style="text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px">' +
        'ご利用いただきありがとうございます — ' + COMPANY.name +
      '</div>' +

      '<script>window.onload=function(){window.print();}<\/script>' +
      '</body></html>';
  }

  return {
    generate:     generate,
    openModal:    openModal,
    closeModal:   closeModal,
    download:     download,
    print:        function (id) { printInvoice(id); },
    printInvoice: printInvoice,
  };

}());
