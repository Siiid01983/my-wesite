'use strict';

/* ════════════════════════════════════════════════════════
   ANALYTICS (v2) — KPI cards + period filter + Canvas charts
   ════════════════════════════════════════════════════════ */

function _renderQuotesUI() {
  const svcFilter = document.getElementById('qtSvcFilter')?.value || '';
  const sort      = document.getElementById('qtSort')?.value || 'desc';
  const q         = (document.getElementById('qtSearch')?.value || '').toLowerCase();

  let quotes = Adapter.getQuotes();

  // Filter
  if (svcFilter) quotes = quotes.filter(qt => qt.service === svcFilter);
  if (q) quotes = quotes.filter(qt =>
    (qt.name||'').toLowerCase().includes(q) ||
    (qt.email||'').toLowerCase().includes(q) ||
    (qt.service||'').toLowerCase().includes(q)
  );

  // Sort by 受付日 (createdAt)
  quotes.sort((a, b) => {
    const da = new Date(a.createdAt||0), db = new Date(b.createdAt||0);
    return sort === 'asc' ? da - db : db - da;
  });

  if (!quotes.length) {
    document.getElementById('quotesWrap').innerHTML = emptyHTML('見積りリクエストがありません');
    return;
  }

  const rows = quotes.map(qt => `<tr>
    <td class="td-mono">${fmtDT(qt.createdAt)}</td>
    <td><strong>${esc(qt.name||'—')}</strong></td>
    <td class="td-sm">${esc(qt.email||'—')}</td>
    <td>${esc(qt.service||'—')}</td>
    <td>${qt.moveDate ? fmtD(qt.moveDate) : '<span class="td-sm">未定</span>'}</td>
    <td class="td-sm">${esc(qt.fromAddr||'—')}</td>
    <td class="td-sm">${esc(qt.toAddr||'—')}</td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-primary btn-sm" onclick="convertToBooking('${esc(qt.id)}')" title="予約に変換">予約化</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="downloadPDFQuote('${esc(qt.id)}')" title="PDFダウンロード">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="printQuote('${esc(qt.id)}')" title="印刷">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
        </button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteQuote('${esc(qt.id)}')" title="削除">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </td>
  </tr>`).join('');

  document.getElementById('quotesWrap').innerHTML = `
    <table>
      <thead><tr>
        <th>受付日時</th><th>お客様名</th><th>メール</th><th>サービス</th>
        <th>希望引越し日</th><th>引越し元</th><th>引越し先</th><th>操作</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderQuotes() { _renderQuotesUI(); }

function _syncQuotesFromApi() {
  if (!Adapter.apiReady) return;
  _dpSync('hm_data', {key:'hm_quotes'}, () => Adapter.syncQuotes(), 'view-quotes', _renderQuotesUI);
}

function deleteQuote(id) {
  if (!confirm('この見積りリクエストを削除しますか？')) return;
  Adapter.deleteQuote(id);
  toast('削除しました');
  renderQuotes();
}

function convertToBooking(id) {
  const qt = Adapter.getQuotes().find(q => q.id === id);
  if (!qt) return;
  // Pre-fill the booking add modal from the quote data
  _editId = null;
  document.getElementById('editModalTitle').textContent = '見積りから予約を作成';
  document.getElementById('mName').value  = qt.name  || '';
  document.getElementById('mEmail').value = qt.email || '';
  document.getElementById('mSvc').value   = qt.service || '単身引越し';
  document.getElementById('mStatus').value = '確認中';
  document.getElementById('mDate').value  = qt.moveDate || '';
  document.getElementById('mTime').value  = qt.time || '午前 8:00〜12:00';
  document.getElementById('mFrom').value  = qt.fromAddr || '';
  document.getElementById('mTo').value    = qt.toAddr   || '';
  document.getElementById('mNotes').value = qt.notes    || '';
  go('bookings');
  document.getElementById('editModal').classList.add('open');
}

function printQuote(id) {
  const qt = Adapter.getQuotes().find(q => q.id === id); if (!qt) return;
  const e  = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const row = (label, value) => `
    <tr>
      <td style="width:130px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;padding:9px 14px;border-bottom:1px solid #f0f2f5;vertical-align:top;white-space:nowrap">${e(label)}</td>
      <td style="font-size:13px;color:#0b0f17;padding:9px 14px;border-bottom:1px solid #f0f2f5">${e(value||'—')}</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>見積り確認書 ${e(qt.id||'')}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:13px;color:#0b0f17;background:#fff;padding:32px 36px}
@media print{body{padding:0}@page{margin:16mm 14mm;size:A4 portrait}}
</style></head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #0a1f44;margin-bottom:24px">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:40px;height:40px;border-radius:10px;background:#1D9E75;color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>
    <div>
      <div style="font-size:17px;font-weight:700;color:#0a1f44;line-height:1.2">Hello Moving</div>
      <div style="font-size:10px;color:#6b7280;margin-top:1px">ハローム―ビング</div>
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;color:#0a1f44">見積り確認書</div>
    <div style="font-size:11px;color:#6b7280;margin-top:3px">受付日時: ${e(fmtDT(qt.createdAt))}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:2px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="display:inline-flex;align-items:center;gap:6px;background:#fef9ec;border:1px solid #f59e0b33;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;color:#b45309;margin-bottom:20px">
  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
  見積りリクエスト受付済み
</div>

<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:28px">
  ${row('お客様名',    qt.name)}
  ${row('メールアドレス', qt.email)}
  ${row('サービス',    qt.service)}
  ${row('希望引越し日', qt.moveDate ? fmtD(qt.moveDate) : '未定')}
  ${row('希望時間帯',  qt.time)}
  ${row('引越し元住所', qt.fromAddr)}
  ${row('引越し先住所', qt.toAddr)}
  ${row('備考・ご要望', qt.notes)}
  ${row('受付日時',    fmtDT(qt.createdAt))}
</table>

<div style="background:#f0fdf4;border:1px solid #10b98133;border-radius:10px;padding:16px 20px;font-size:11px;color:#374151;line-height:1.9;margin-bottom:28px">
  <div style="font-weight:700;color:#059669;margin-bottom:6px;font-size:12px">お見積りについて</div>
  <div>・ご依頼内容を確認後、担当者よりメールまたはお電話にてご連絡いたします。</div>
  <div>・お見積りは無料です。内容に変更がある場合はお気軽にご連絡ください。</div>
  <div>・希望引越し日の空き状況によっては、ご希望に添えない場合がございます。</div>
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7">
    <div>Hello Moving — 引越し専門サービス</div>
    <div>このドキュメントは管理システムから自動生成されました</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7">
    <div style="font-weight:600;color:#0b0f17">Hello Moving</div>
    <div>contact@hello-moving.com</div>
  </div>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=780,height=680');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}

function exportQuotesCSV() {
  const quotes = Adapter.getQuotes();
  if (!quotes.length) { toast('エクスポートするデータがありません'); return; }
  const heads = ['受付日時','お客様名','メール','サービス','希望引越し日','引越し元住所','引越し先住所','備考'];
  const rows = quotes.map(qt =>
    [fmtDT(qt.createdAt), qt.name, qt.email, qt.service, qt.moveDate, qt.fromAddr, qt.toAddr, qt.notes]
    .map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')
  );
  const csv = '﻿' + [heads.join(','), ...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
  a.download = `hello-moving-quotes-${todayStr()}.csv`;
  a.click();
  toast('CSVをエクスポートしました');
}
