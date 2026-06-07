'use strict';

/* ════════════════════════════════════════════════════════
   CAPACITY SETTINGS
   ════════════════════════════════════════════════════════ */
function _loadCapacityUI() {
  const c = Adapter.getCapacity();
  document.getElementById('capMax').value = c.max || 5;
  document.getElementById('capLimited').value = c.limited || 3;
}

function loadCapacity() { _loadCapacityUI(); }

function _syncCapacityFromSupabase() {
  if (!Adapter.supabaseReady) return;
  _dpSync('hm_data', {key:'hm_capacity'}, () => Adapter.syncCapacity(), 'view-capacity', _loadCapacityUI);
}

function saveCapacity() {
  const max = parseInt(document.getElementById('capMax').value) || 5;
  const limited = parseInt(document.getElementById('capLimited').value) || 3;
  CalendarService.setCapacity(max, limited);
  toast('容量設定を保存しました');
}

function printCapacity() {
  const cap   = Adapter.getCapacity();
  const avail = Adapter.getAvail();
  const today = todayStr();
  const e = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* upcoming 60 days availability */
  const upcoming = [];
  for (let i = 0; i < 60; i++) {
    const d  = new Date(); d.setDate(d.getDate() + i);
    const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const st = avail[ds] || 'available';
    upcoming.push({ date: ds, dow: _DOW_JP[d.getDay()], status: st });
  }

  const countByStatus = { available: 0, limited: 0, booked: 0 };
  upcoming.forEach(u => { countByStatus[u.status] = (countByStatus[u.status]||0) + 1; });

  const ST_LABEL = { available:'○ 空き', limited:'△ 残りわずか', booked:'× 満了' };
  const ST_COLOR = { available:'#059669', limited:'#b45309', booked:'#b91c1c' };
  const ST_BG    = { available:'#f0fdf4', limited:'#fffbeb', booked:'#fef2f2' };
  const ST_BORDER= { available:'#10b98133', limited:'#f59e0b33', booked:'#ef444433' };

  const pill = st =>
    `<span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${ST_BG[st]};color:${ST_COLOR[st]};border:1px solid ${ST_BORDER[st]}">${ST_LABEL[st]||st}</span>`;

  const avRows = upcoming.map((u, fi) => {
    const bg = fi % 2 === 1 ? 'background:#fafafa' : '';
    return `<tr>
      <td style="padding:6px 12px;font-size:11px;font-variant-numeric:tabular-nums;border:1px solid #f0f2f5;${bg};white-space:nowrap">${u.date}</td>
      <td style="padding:6px 12px;font-size:11px;text-align:center;border:1px solid #f0f2f5;${bg}">${u.dow}曜日</td>
      <td style="padding:6px 12px;border:1px solid #f0f2f5;${bg}">${pill(u.status)}</td>
    </tr>`;
  }).join('');

  const statCard = (label, value, color='#0b0f17') =>
    `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
      <div style="font-size:20px;font-weight:700;color:${color}">${value}</div>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>容量設定レポート — Hello Moving</title>
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
    <div style="font-size:18px;font-weight:700;color:#0a1f44">容量設定レポート</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin-bottom:12px">現在の設定</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px">
  ${statCard('1日の最大予約数', cap.max+'件')}
  ${statCard('残りわずか閾値', cap.limited+'件以上', '#b45309')}
  ${statCard('満了ライン', cap.max+'件以上', '#b91c1c')}
</div>

<div style="font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin-bottom:12px">今後60日間の空き状況サマリー</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
  ${statCard('○ 空き', countByStatus.available+'日', '#059669')}
  ${statCard('△ 残りわずか', countByStatus.limited+'日', '#b45309')}
  ${statCard('× 満了', countByStatus.booked+'日', '#b91c1c')}
</div>

<div style="font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin-bottom:4px">日別空き状況（今後60日間）</div>
<table style="width:100%;border-collapse:collapse">
  <thead><tr>
    <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 12px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">日付</th>
    <th style="background:#f8f9fa;font-weight:600;text-align:center;padding:7px 12px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">曜日</th>
    <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 12px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">空き状況</th>
  </tr></thead>
  <tbody>${avRows}</tbody>
</table>

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb;margin-top:24px">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7">
    <div>Hello Moving — 管理システム</div>
    <div>このドキュメントは管理システムから自動生成されました</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7">
    <div style="font-weight:600;color:#0b0f17">Hello Moving</div>
    <div>info@hello-moving.com</div>
  </div>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=740,height=780');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}
