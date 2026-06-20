'use strict';

/* ════════════════════════════════════════════════════════
   CUSTOMER MANAGEMENT
   ════════════════════════════════════════════════════════ */
function _custKey(b) {
  return b.email ? b.email.trim().toLowerCase() : 'nomail_' + (b.name||'').trim().toLowerCase();
}

function _syncCustomers() {
  const bookings = Adapter.getBookings();
  const stored   = Adapter.getCustomers();
  const byKey    = new Map(stored.map(c => [c._key, c]));
  let   dirty    = false;

  bookings.forEach(b => {
    const _key = _custKey(b);
    if (!byKey.has(_key)) {
      const d  = new Date(b.createdAt || Date.now());
      const id = `CUST-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      const c  = { id, _key, name: b.name||'', email: b.email||'', phone:'', postalCode:'', address:'', registeredAt: b.createdAt||new Date().toISOString(), deleted:false };
      stored.push(c);
      byKey.set(_key, c);
      dirty = true;
    }
  });
  if (dirty) Adapter.saveCustomers(stored);
  return stored;
}

function _renderCustomersUI() {
  const all      = _syncCustomers();
  const bookings = Adapter.getBookings();
  const filter   = document.getElementById('custFilter')?.value || '';
  const q        = (document.getElementById('custSearch')?.value || '').toLowerCase();

  const enriched = all
    .filter(c => !c.deleted)
    .map(c => {
      const bks = bookings.filter(b => _custKey(b) === c._key);
      return { ...c, bkCount: bks.length, latestBk: bks[0] || null };
    });

  let list = enriched;
  if (filter === 'with')  list = list.filter(c => c.bkCount > 0);
  if (filter === 'none')  list = list.filter(c => c.bkCount === 0);
  if (q) list = list.filter(c =>
    (c.name||'').toLowerCase().includes(q) ||
    (c.email||'').toLowerCase().includes(q) ||
    (c.phone||'').includes(q) ||
    (c.id||'').toLowerCase().includes(q)
  );
  list.sort((a, b) => (b.registeredAt||'') > (a.registeredAt||'') ? 1 : -1);

  const statsEl = document.getElementById('custStatsBar');
  if (statsEl) statsEl.innerHTML =
    `<span>合計 <strong>${enriched.length}</strong> 名</span>` +
    `<span>予約あり <strong>${enriched.filter(c=>c.bkCount>0).length}</strong> 名</span>` +
    `<span>表示中 <strong>${list.length}</strong> 件</span>`;

  if (!list.length) {
    document.getElementById('customersWrap').innerHTML = emptyHTML('該当する顧客がいません');
    return;
  }

  const rows = list.map(c => {
    const init = (c.name||'?').trim().charAt(0);
    const bkBadge = c.bkCount > 0
      ? `<span class="badge badge-confirmed">${c.bkCount}件</span>`
      : `<span class="badge badge-done">なし</span>`;
    const lastContact = window.CommModule ? CommModule.getLastContact(c.email) : null;
    const commCount   = window.CommModule ? CommModule.getCount(c.email) : 0;
    const lastContactCell = lastContact
      ? `<span class="td-mono" style="font-size:11px">${fmtDT(lastContact)}</span>`
      : `<span style="font-size:11px;color:var(--gray-2)">—</span>`;
    const commCountCell = commCount > 0
      ? `<span class="badge badge-confirmed">${commCount}件</span>`
      : `<span style="font-size:11px;color:var(--gray-2)">0</span>`;
    return `<tr>
      <td class="td-mono" style="font-size:11px">${esc(c.id)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:9px">
          <div class="cust-avatar" style="width:28px;height:28px;font-size:12px;border-radius:7px">${esc(init)}</div>
          <strong>${esc(c.name||'—')}</strong>
        </div>
      </td>
      <td class="td-sm">${esc(c.phone||'—')}</td>
      <td class="td-sm">${esc(c.email||'—')}</td>
      <td>${bkBadge}</td>
      <td>${commCountCell}</td>
      <td>${lastContactCell}</td>
      <td class="td-mono" style="font-size:11px">${fmtDT(c.registeredAt)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm btn-icon" title="プロフィール" onclick="openCustModal('${esc(c.id)}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          </button>
          <button class="btn btn-primary btn-sm btn-icon" title="返信" onclick="if(window.CommModule)CommModule.openQuickReply('${esc(c.email)}','${esc(c.name)}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" title="削除" onclick="deleteCust('${esc(c.id)}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('customersWrap').innerHTML = `
    <table>
      <thead><tr>
        <th>顧客ID</th><th>お客様名</th><th>電話番号</th><th>メール</th><th>予約数</th><th>連絡数</th><th>最終連絡日</th><th>登録日時</th><th>操作</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderCustomers() {
  _renderCustomersUI();
  if (window.CommModule) {
    CommModule.prefetchStats().then(() => {
      if (document.getElementById('view-customers')?.classList.contains('active')) {
        _renderCustomersUI();
      }
    });
  }
}

function _syncCustomersFromApi() {
  if (!Adapter.apiReady) return;
  /* Sync both customer profiles and bookings — booking counts enrich the customer list */
  Promise.all([
    window.DataProvider.read('hm_data', {key:'hm_customers'}),
    window.DataProvider.read('bookings'),
  ]).then(([custRes, bkRes]) => {
    const custOk = custRes.source === 'api';
    const bkOk   = bkRes.source   === 'api';
    if (!custOk && !bkOk) return;
    Promise.all([
      custOk ? Adapter.syncCustomers() : Promise.resolve(false),
      bkOk   ? Adapter.syncBookings()  : Promise.resolve(false),
    ]).then(() => {
      if (document.getElementById('view-customers').classList.contains('active')) {
        _renderCustomersUI();
      }
    });
  });
}

function openCustModal(id) {
  const stored   = Adapter.getCustomers();
  const c        = stored.find(c => c.id === id);
  if (!c) return;
  const bookings = Adapter.getBookings()
    .filter(b => _custKey(b) === c._key)
    .sort((a, b) => (b.date||'') > (a.date||'') ? 1 : -1);

  const init = (c.name||'?').trim().charAt(0);
  document.getElementById('custAvatarLg').textContent = init;
  document.getElementById('custModalName').textContent = c.name || '—';
  document.getElementById('custModalId').textContent   = c.id;

  const row = (l, v) => `<div class="cust-detail-row">
    <span class="cust-detail-label">${l}</span>
    <span class="cust-detail-val">${esc(v||'—')}</span>
  </div>`;
  document.getElementById('custModalBody').innerHTML =
    row('メール',    c.email) +
    row('電話番号',  c.phone) +
    row('郵便番号',  c.postalCode) +
    row('住所',      c.address) +
    row('登録日時',  fmtDT(c.registeredAt));

  let histHTML = `<div class="cust-hist-title">予約履歴 <span style="font-weight:400;color:var(--gray-2);font-size:12px">${bookings.length}件</span></div>`;
  if (bookings.length) {
    const bkRows = bookings.map(b => `<tr>
      <td class="td-mono" style="font-size:11px">${esc(b.id||'—')}</td>
      <td style="font-size:12px">${fmtD(b.date)}</td>
      <td style="font-size:12px">${esc(b.service||'—')}</td>
      <td>${badge(b.status||'新規')}</td>
      <td>
        <button class="btn btn-ghost btn-sm btn-icon" title="予約詳細" onclick="closeCustModal();openDetail('${esc(b.id)}')">
          <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        </button>
      </td>
    </tr>`).join('');
    histHTML += `<div class="table-wrap" style="max-height:200px;overflow-y:auto;border:1px solid var(--line);border-radius:10px">
      <table>
        <thead><tr><th>予約番号</th><th>日付</th><th>サービス</th><th>ステータス</th><th></th></tr></thead>
        <tbody>${bkRows}</tbody>
      </table>
    </div>`;
  } else {
    histHTML += `<div class="empty" style="padding:18px 0"><p>予約履歴がありません</p></div>`;
  }
  document.getElementById('custModalHistory').innerHTML = histHTML;

  document.getElementById('custModalPdfBtn').onclick   = () => downloadPDFCustomer(id);
  document.getElementById('custModalPrintBtn').onclick = () => printCustomer(id);
  document.getElementById('custModalDelBtn').onclick   = () => { closeCustModal(); deleteCust(id); };

  const replyBtn = document.getElementById('custModalReplyBtn');
  if (replyBtn) {
    replyBtn.onclick = () => {
      if (window.CommModule) CommModule.openQuickReply(c.email, c.name, c.name);
    };
    replyBtn.style.display = c.email ? '' : 'none';
  }

  if (window.CommModule) {
    CommModule.renderCustomerTimeline(c.email, 'custCommHistory');
  }

  document.getElementById('custModal').classList.add('open');
}

function closeCustModal() {
  document.getElementById('custModal').classList.remove('open');
}

function printCustomer(id) {
  const stored   = Adapter.getCustomers();
  const c        = stored.find(c => c.id === id); if (!c) return;
  const bookings = Adapter.getBookings()
    .filter(b => _custKey(b) === c._key)
    .sort((a, b) => (b.date||'') > (a.date||'') ? 1 : -1);
  const e = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const STATUS_COLOR = { '新規':'#2563eb','確認中':'#b45309','確定':'#059669','完了':'#4b5563','キャンセル':'#b91c1c' };
  const STATUS_BG    = { '新規':'#eff6ff','確認中':'#fffbeb','確定':'#f0fdf4','完了':'#f9fafb','キャンセル':'#fef2f2' };

  const init    = (c.name||'?').trim().charAt(0).toUpperCase();
  const total   = bookings.length;
  const done    = bookings.filter(b => b.status === '完了').length;
  const active  = bookings.filter(b => b.status === '確定' || b.status === '確認中').length;
  const cancelled = bookings.filter(b => b.status === 'キャンセル').length;

  const bkRows = bookings.map(b => {
    const st = b.status || '新規';
    return `<tr>
      <td style="font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;color:#6b7280">${e(b.id)}</td>
      <td style="white-space:nowrap">${e(fmtD(b.date))}</td>
      <td>${e(b.service)}</td>
      <td><span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${STATUS_BG[st]||'#f9fafb'};color:${STATUS_COLOR[st]||'#374151'};border:1px solid ${STATUS_COLOR[st]||'#d1d5db'}33">${e(st)}</span></td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>顧客プロフィール — ${e(c.name||'')}</title>
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
    <div style="font-size:18px;font-weight:700;color:#0a1f44">顧客プロフィール</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
  <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-size:24px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${e(init)}</div>
  <div>
    <div style="font-size:20px;font-weight:700;color:#0b0f17;line-height:1.2">${e(c.name||'—')}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:3px;font-variant-numeric:tabular-nums">${e(c.id)}</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px">
  ${[['総予約数',total+'件'],['完了',done+'件'],['対応中',active+'件'],['キャンセル',cancelled+'件']].map(([l,v])=>
    `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${l}</div>
      <div style="font-size:20px;font-weight:700;color:#0b0f17">${v}</div>
    </div>`).join('')}
</div>

<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px">
  ${[['メール',c.email],['電話番号',c.phone],['郵便番号',c.postalCode],['住所',c.address],['登録日時',fmtDT(c.registeredAt)]].map(([l,v])=>
    `<tr>
      <td style="width:130px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;padding:9px 14px;border-bottom:1px solid #f0f2f5;white-space:nowrap">${e(l)}</td>
      <td style="font-size:13px;color:#0b0f17;padding:9px 14px;border-bottom:1px solid #f0f2f5">${e(v||'—')}</td>
    </tr>`).join('')}
</table>

${bookings.length ? `
<div style="font-size:13px;font-weight:700;color:#0b0f17;margin-bottom:10px">予約履歴 <span style="font-weight:400;color:#9ca3af;font-size:12px">${bookings.length}件</span></div>
<table style="width:100%;border-collapse:collapse;font-size:11px">
  <thead><tr>
    <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">予約番号</th>
    <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">引越し日</th>
    <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">サービス</th>
    <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">ステータス</th>
  </tr></thead>
  <tbody>${bkRows}</tbody>
</table>` : `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px">予約履歴がありません</div>`}

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb;margin-top:24px">
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

function deleteCust(id) {
  const stored = Adapter.getCustomers();
  const c = stored.find(c => c.id === id);
  if (!c) return;
  if (!confirm(`「${c.name||'この顧客'}」を削除しますか？\n※予約データは削除されません`)) return;
  c.deleted = true;
  Adapter.saveCustomers(stored);
  toast('顧客を削除しました');
  renderCustomers();
}
