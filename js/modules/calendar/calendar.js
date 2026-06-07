'use strict';

/* ════════════════════════════════════════════════════════
   BOOKINGS TABLE
   ════════════════════════════════════════════════════════ */

let _calV = new Date(); _calV.setDate(1);
let _bulkMode = false;
let _bulkSel = new Set();

/* ── UI Layer ── */
function renderCalendar() {
  const avail = CalendarService.getAvailability();
  const y = _calV.getFullYear(), m = _calV.getMonth();
  const first = new Date(y,m,1).getDay(), total = new Date(y,m+1,0).getDate();
  const nowM = new Date(); nowM.setDate(1);
  document.getElementById('calMonth').textContent = `${y}年${MN[m]}`;
  document.getElementById('calPrev').disabled = y===nowM.getFullYear() && m<=nowM.getMonth();

  const today = todayStr();
  let h = DN.map((d,i)=>`<div class="cal-dow" style="${i===0?'color:#ef4444':i===6?'color:#2563eb':''}">${d}</div>`).join('');
  for(let i=0;i<first;i++) h+='<div class="cal-day cal-empty"></div>';
  for(let d=1;d<=total;d++){
    const ds=`${y}-${pad(m+1)}-${pad(d)}`;
    const past=isPast(ds), isT=ds===today;
    const st=avail[ds]||'available';
    const sym=st==='available'?'○':st==='limited'?'△':'×';
    const sc=st==='available'?'sym-a':st==='limited'?'sym-l':'sym-b';
    const dow=new Date(y,m,d).getDay();
    const nc=dow===0?'#ef4444':dow===6?'#2563eb':'';
    const sel=_bulkSel.has(ds);
    let cls='cal-day';
    if(past)cls+=' cal-past';else if(isT)cls+=' cal-today';
    if(st==='limited')cls+=' cal-limited';
    if(st==='booked')cls+=' cal-booked';
    if(st==='available'&&!past)cls+=' cal-avail';
    if(sel)cls+=' cal-selected';
    h+=`<button class="${cls}" type="button" ${past?'disabled':''} onclick="calClick('${ds}')">
      <span class="c-num" ${nc?`style="color:${nc}"`:''}}>${d}</span>
      <span class="c-sym ${sc}">${sym}</span>
    </button>`;
  }
  document.getElementById('calGrid').innerHTML = h;
  updateCalendarCounters();
}

function refreshCalendarUI() { renderCalendar(); }

/* Sync calendar_availability + bookings from Supabase, rebuild counts, re-render.
   Called only on navigation to the calendar view — not on every date-click event. */
function _syncCalendarFromSupabase() {
  if (!Adapter.supabaseReady) return;
  Promise.all([
    window.DataProvider.read('calendar_availability'),
    window.DataProvider.read('bookings'),
  ]).then(([calRes, bkRes]) => {
    if (!document.getElementById('view-calendar').classList.contains('active')) return;
    const calOk = calRes.source === 'supabase';
    const bkOk  = bkRes.source  === 'supabase';
    if (!calOk && !bkOk) return;
    Promise.all([
      calOk ? Adapter.syncAvailability() : Promise.resolve(false),
      bkOk  ? Adapter.syncBookings()     : Promise.resolve(false),
    ]).then(([, freshBkOk]) => {
      if (!document.getElementById('view-calendar').classList.contains('active')) return;
      if (freshBkOk) {
        /* Rebuild booking counts from fresh data so limited/booked thresholds are accurate */
        const counts = {};
        Adapter.getBookings().forEach(bk => {
          if (bk.date && bk.status !== 'キャンセル') counts[bk.date] = (counts[bk.date] || 0) + 1;
        });
        try { localStorage.setItem('hm_counts', JSON.stringify(counts)); } catch(e) {}
      }
      renderCalendar();
    });
  });
}

function updateCalendarCounters() {
  document.getElementById('bulkCount').textContent = _bulkMode ? `${_bulkSel.size}日選択中` : '';
}

/* ── Calendar event listeners ── */
document.addEventListener('calendar:updated',          () => refreshCalendarUI());
document.addEventListener('calendar:blocked',          () => refreshCalendarUI());
document.addEventListener('calendar:capacity-changed', () => refreshCalendarUI());

function calClick(ds) {
  Auth.touch();
  if (_bulkMode) {
    if (_bulkSel.has(ds)) _bulkSel.delete(ds); else _bulkSel.add(ds);
    refreshCalendarUI(); return;
  }
  const avail = CalendarService.getAvailability();
  const cur = avail[ds]||'available';
  const next = cur==='available'?'limited':cur==='limited'?'booked':'available';
  CalendarService.updateAvailability(ds, next);
  toast(`${ds}: ${next==='available'?'空き':next==='limited'?'残りわずか':'満了'}`);
}

function calMove(dir) { _calV.setMonth(_calV.getMonth()+dir); refreshCalendarUI(); }

function printCalendar() {
  const avail  = Adapter.getAvail();
  const cap    = Adapter.getCapacity();
  const bk     = Adapter.getBookings();
  const y      = _calV.getFullYear();
  const m      = _calV.getMonth();
  const total  = new Date(y, m+1, 0).getDate();
  const firstDow = new Date(y, m, 1).getDay();
  const today  = todayStr();
  const DN_FULL = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];

  const ST = { available:'available', limited:'limited', booked:'booked' };
  const ST_LABEL  = { available:'○ 空き', limited:'△ 残りわずか', booked:'× 満了' };
  const ST_COLOR  = { available:'#059669', limited:'#b45309', booked:'#b91c1c' };
  const ST_BG     = { available:'#f0fdf4', limited:'#fffbeb', booked:'#fef2f2' };
  const ST_BORDER = { available:'#10b98133', limited:'#f59e0b55', booked:'#ef444433' };

  /* count bookings per day this month */
  const bkCount = {};
  bk.forEach(b => { if (b.date && b.date.startsWith(`${y}-${pad(m+1)}`)) bkCount[b.date] = (bkCount[b.date]||0) + 1; });

  /* month summary */
  let cntA=0, cntL=0, cntB=0;
  for (let d=1; d<=total; d++) {
    const ds = `${y}-${pad(m+1)}-${pad(d)}`;
    const st = avail[ds] || 'available';
    if (st==='available') cntA++; else if (st==='limited') cntL++; else cntB++;
  }

  /* build 7-col grid cells */
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<td style="border:1px solid #f0f2f5;background:#fafafa"></td>');
  for (let d = 1; d <= total; d++) {
    const ds  = `${y}-${pad(m+1)}-${pad(d)}`;
    const st  = avail[ds] || 'available';
    const dow = new Date(y, m, d).getDay();
    const isToday   = ds === today;
    const isPast    = ds < today;
    const bookCount = bkCount[ds] || 0;
    const weekendStyle = dow===0||dow===6 ? 'background-color:#fafffe;' : '';
    const borderStyle  = isToday ? 'border:2px solid #2563eb;' : 'border:1px solid #e5e7eb;';
    const opacity      = isPast ? 'opacity:.45;' : '';
    cells.push(`<td style="${borderStyle}${weekendStyle}${opacity}padding:6px 8px;vertical-align:top;min-width:40px">
      <div style="font-size:13px;font-weight:700;color:${isToday?'#2563eb':(dow===0?'#ef4444':dow===6?'#2563eb':'#0b0f17')};margin-bottom:4px">${d}</div>
      <div style="font-size:9px;font-weight:700;color:${ST_COLOR[st]}">${ST_LABEL[st]}</div>
      ${bookCount ? `<div style="font-size:9px;color:#6b7280;margin-top:2px">予約 ${bookCount}件</div>` : ''}
    </td>`);
  }
  /* pad end */
  const remainder = cells.length % 7;
  if (remainder) for (let i = remainder; i < 7; i++) cells.push('<td style="border:1px solid #f0f2f5;background:#fafafa"></td>');

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(`<tr>${cells.slice(i,i+7).join('')}</tr>`);

  const statCard = (label, value, color) =>
    `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px">
      <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color}">${value}</div>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>${y}年${m+1}月 カレンダー — Hello Moving</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:13px;color:#0b0f17;background:#fff;padding:28px 32px}
table{border-collapse:collapse;width:100%}
@media print{body{padding:0}@page{margin:14mm 12mm;size:A4 landscape}}
</style></head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #0a1f44;margin-bottom:20px">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:38px;height:38px;border-radius:9px;background:#1D9E75;color:#fff;font-size:19px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>
    <div>
      <div style="font-size:16px;font-weight:700;color:#0a1f44;line-height:1.2">Hello Moving</div>
      <div style="font-size:10px;color:#6b7280;margin-top:1px">ハローム―ビング</div>
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:20px;font-weight:700;color:#0a1f44">${y}年${m+1}月</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:3px">空き状況カレンダー・出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:18px">
  ${statCard('表示月', `${y}年${m+1}月`, '#0b0f17')}
  ${statCard('○ 空き', cntA+'日', '#059669')}
  ${statCard('△ 残りわずか', cntL+'日', '#b45309')}
  ${statCard('× 満了', cntB+'日', '#b91c1c')}
  ${statCard('1日最大予約', cap.max+'件', '#0b0f17')}
</div>

<table>
  <thead><tr>${DN_FULL.map((d,i)=>`<th style="padding:8px 4px;text-align:center;font-size:11px;font-weight:600;color:${i===0?'#ef4444':i===6?'#2563eb':'#6b7280'};border-bottom:2px solid #e5e7eb">${d}</th>`).join('')}</tr></thead>
  <tbody>${weeks.join('')}</tbody>
</table>

<div style="display:flex;align-items:center;gap:16px;margin-top:14px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280">
  <span style="font-weight:600;color:#374151">凡例:</span>
  <span style="color:#059669;font-weight:600">○ 空き</span>
  <span style="color:#b45309;font-weight:600">△ 残りわずか</span>
  <span style="color:#b91c1c;font-weight:600">× 満了</span>
  <span style="margin-left:auto">出力日: ${new Date().toLocaleDateString('ja-JP')} — Hello Moving 管理システム</span>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=1000,height=760');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}

function resetAvail() {
  if (!confirm('全ての空き状況設定をリセットしますか？')) return;
  Adapter.clearAvail();
  document.dispatchEvent(new CustomEvent('calendar:updated', { detail: { cleared: true } }));
  toast('リセットしました');
}

function toggleBulk() {
  _bulkMode = !_bulkMode;
  _bulkSel.clear();
  document.getElementById('bulkToggle').textContent = _bulkMode ? '一括選択を終了' : '一括選択';
  document.getElementById('bulkStatus').style.display = _bulkMode ? '' : 'none';
  document.getElementById('bulkApply').style.display = _bulkMode ? '' : 'none';
  document.getElementById('calHint').textContent = _bulkMode ? '日付をクリックして選択、「適用」ボタンで一括変更' : 'クリックして空き状況を変更（○→△→×→○）';
  refreshCalendarUI();
}

function applyBulk() {
  const status = document.getElementById('bulkStatus').value;
  const dates = [..._bulkSel];
  const count = dates.length;
  _bulkSel.clear();
  CalendarService.setBlockedDates(dates, status);
  toast(`${count}件を更新しました`);
}

function showFullBooked() {
  const avail = Adapter.getAvail();
  const dates = Object.entries(avail).filter(([,v])=>v==='booked').map(([d])=>fmtD(d));
  alert(dates.length ? `満了日:\n${dates.join('\n')}` : '満了日はありません');
}
