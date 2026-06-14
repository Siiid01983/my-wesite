'use strict';

/* ════════════════════════════════════════════════════════
   CSV EXPORT / IMPORT / REPORT
   ════════════════════════════════════════════════════════ */
function exportCSV() {
  const bk = Adapter.getBookings();
  if (!bk.length) { toast('エクスポートするデータがありません'); return; }
  const h = ['予約番号','ステータス','サービス','引越し日','希望時間帯','お客様名','メール','引越し元','引越し先','備考','受付日時'];
  const rows = bk.map(b=>[b.id,b.status,b.service,b.date,b.time,b.name,b.email,b.fromAddr,b.toAddr,b.notes,b.createdAt]
    .map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(','));
  const csv = '﻿' + [h.join(','),...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download = `hello-moving-${todayStr()}.csv`;
  a.click(); toast('CSVをエクスポートしました');
}

function importCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.replace(/^﻿/,'').split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { toast('有効なCSVファイルではありません'); return; }
    let count = 0;
    lines.slice(1).forEach(line => {
      const cols = line.split(',').map(c => c.replace(/^"|"$/g,'').replace(/""/g,'"'));
      if (cols[0] && cols[5]) {
        Adapter.addBooking({id:cols[0],status:cols[1]||'新規',service:cols[2]||'',date:cols[3]||'',time:cols[4]||'',name:cols[5]||'',email:cols[6]||'',fromAddr:cols[7]||'',toAddr:cols[8]||'',notes:cols[9]||'',createdAt:cols[10]||new Date().toISOString()});
        count++;
      }
    });
    e.target.value = '';
    toast(`${count}件をインポートしました`);
    renderDash();
  };
  reader.readAsText(file, 'UTF-8');
}

function generateReport() {
  const bk = Adapter.getBookings();
  const prices = Adapter.getPrices();
  const s = calcStats();

  const byStatus = {新規:0,確認中:0,確定:0,完了:0,キャンセル:0};
  const bySvc = {};
  let revenue = 0;
  bk.forEach(b => {
    if (byStatus[b.status]!==undefined) byStatus[b.status]++;
    bySvc[b.service] = (bySvc[b.service]||0) + 1;
    const p2 = prices[b.service];
    if (b.status !== 'キャンセル') revenue += (typeof p2 === 'number' ? p2 : (p2 && p2.base) || 0);
  });

  const rows = (obj) => Object.entries(obj).map(([k,v])=>`<tr><td style="padding:7px 10px;color:var(--gray-1);font-size:12px">${esc(k)}</td><td style="padding:7px 10px;font-weight:600;font-size:13px">${v}</td></tr>`).join('');

  document.getElementById('reportBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div><div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--ink)">売上サマリー</div>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:7px 10px;color:var(--gray-1);font-size:12px">総予約数</td><td style="padding:7px 10px;font-weight:600">${bk.length}</td></tr>
          <tr><td style="padding:7px 10px;color:var(--gray-1);font-size:12px">今月</td><td style="padding:7px 10px;font-weight:600">${s.monthBk}件</td></tr>
          <tr><td style="padding:7px 10px;color:var(--gray-1);font-size:12px">売上予測</td><td style="padding:7px 10px;font-weight:600;color:var(--green)">¥${revenue.toLocaleString()}</td></tr>
        </table>
      </div>
      <div><div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--ink)">ステータス別</div>
        <table style="width:100%;border-collapse:collapse">${rows(byStatus)}</table>
      </div>
      <div style="grid-column:1/-1"><div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--ink)">サービス別</div>
        <table style="width:100%;border-collapse:collapse">${rows(bySvc)}</table>
      </div>
    </div>
    <div style="margin-top:16px;display:flex;gap:8px">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('reportModal').classList.remove('open')">閉じる</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadPDFReport()">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>PDF
      </button>
      <button class="btn btn-ghost btn-sm" onclick="printReport()">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>印刷
      </button>
    </div>
  `;
  document.getElementById('reportModal').classList.add('open');
}

function printReport() {
  const bk     = Adapter.getBookings();
  const prices = Adapter.getPrices();
  const s      = calcStats();
  const e      = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const byStatus = {新規:0,確認中:0,確定:0,完了:0,キャンセル:0};
  const bySvc    = {};
  let revenue    = 0;
  bk.forEach(b => {
    if (byStatus[b.status] !== undefined) byStatus[b.status]++;
    bySvc[b.service] = (bySvc[b.service]||0) + 1;
    const p = prices[b.service];
    if (b.status !== 'キャンセル') revenue += (typeof p === 'number' ? p : (p && p.base) || 0);
  });

  const completed  = byStatus['完了']  || 0;
  const cancelled  = byStatus['キャンセル'] || 0;
  const active     = (byStatus['新規']||0) + (byStatus['確認中']||0) + (byStatus['確定']||0);
  const compRate   = bk.length > 0 ? Math.round((completed / bk.length) * 100) : 0;

  const tableRows = (obj, valueUnit='') => Object.entries(obj)
    .map(([k, v], i) => `<tr style="${i%2===1?'background:#fafafa':''}">
      <td style="padding:7px 12px;font-size:12px;color:#374151;border-bottom:1px solid #f0f2f5">${e(k)}</td>
      <td style="padding:7px 12px;font-size:13px;font-weight:600;color:#0b0f17;border-bottom:1px solid #f0f2f5;text-align:right">${e(v)}${valueUnit}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>売上レポート — Hello Moving</title>
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
    <div style="font-size:18px;font-weight:700;color:#0a1f44">売上レポート</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px">
  ${[
    ['総予約数',   bk.length+'件',              '#0b0f17'],
    ['今月の予約', s.monthBk+'件',              '#2563eb'],
    ['完了率',     compRate+'%',               '#059669'],
    ['売上予測',   '¥'+revenue.toLocaleString(),'#059669'],
  ].map(([l,v,c])=>`<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px">
    <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${l}</div>
    <div style="font-size:18px;font-weight:700;color:${c}">${v}</div>
  </div>`).join('')}
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
  <div>
    <div style="font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin-bottom:2px">ステータス別</div>
    <table style="width:100%;border-collapse:collapse">${tableRows(byStatus,'件')}</table>
  </div>
  <div>
    <div style="font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin-bottom:2px">予約概況</div>
    <table style="width:100%;border-collapse:collapse">
      ${tableRows({'今日':s.todayBk+'件','今週':s.weekBk+'件','今月':s.monthBk+'件','対応中':active+'件','完了':completed+'件','キャンセル':cancelled+'件'})}
    </table>
  </div>
</div>

<div style="margin-bottom:24px">
  <div style="font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin-bottom:2px">サービス別予約数</div>
  <table style="width:100%;border-collapse:collapse">${tableRows(bySvc,'件')}</table>
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

  const w = window.open('','_blank','width=820,height=720');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}

function clearAllData() {
  if (!confirm('全予約データ・空き状況データを完全に消去しますか？\nこの操作は取り消せません。')) return;
  ['hm_admin_bookings','hm_admin_avail','hm_booked','hm_counts'].forEach(k => localStorage.removeItem(k));
  toast('全データを消去しました');
  renderDash();
}
