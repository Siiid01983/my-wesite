'use strict';

/* ════════════════════════════════════════════════════════
   ADMIN CALENDAR — Google-Calendar sync panel + month print
   ════════════════════════════════════════════════════════
   The Timeline (js/modules/calendar/timelineCalendar.js) is the ONE and ONLY
   admin availability calendar. The legacy ○△× month grid, its bulk-edit tools,
   and the calendar_availability sync (renderCalendar / calClick / _syncCalendarFromApi
   / toggleBulk / applyBulk …) were REMOVED in the timeline final-migration —
   there is no second availability source and no dormant fallback grid.

   What remains here:
     • renderGCalPanel() + helpers — the Google-Calendar integration panel that sits
       alongside the timeline in #view-calendar (rendered by navigation.js go('calendar')).
   ════════════════════════════════════════════════════════ */

let _calV = new Date(); _calV.setDate(1);   // month cursor for GCalSync.syncMonth

/* ════════════════════════════════════════════════════════
   GOOGLE CALENDAR PANEL
   ════════════════════════════════════════════════════════ */

function renderGCalPanel() {
  const el = document.getElementById('gcalPanel');
  if (!el) return;
  const cfg       = Adapter.getGcalSettings();
  const connected = window.GCalSync ? GCalSync.isConnected() : false;
  const lastSync  = cfg.lastSync ? fmtDT(cfg.lastSync) : 'なし';

  el.innerHTML = `
<div class="panel" style="margin-top:14px">
  <div class="panel-head" style="background:rgba(37,99,235,.04);border-bottom-color:rgba(37,99,235,.2)">
    <div style="display:flex;align-items:center;gap:8px">
      <svg viewBox="0 0 24 24" width="18" height="18" style="color:#2563eb;flex-shrink:0"><path fill="currentColor" d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10zm0-12H5V5h14v2zM7 11h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>
      <span class="panel-title">Google カレンダー連携</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:11px;padding:3px 9px;border-radius:20px;font-weight:600;
        background:${connected?'rgba(16,185,129,.12)':'rgba(107,114,128,.1)'};
        color:${connected?'#059669':'var(--gray-1)'}">
        ${connected ? '● 接続中' : '○ 未接続'}
      </span>
      <label class="toggle" title="${cfg.enabled?'無効にする':'有効にする'}">
        <input type="checkbox" id="gcalEnabled" ${cfg.enabled?'checked':''} onchange="saveGcalSettings()" />
        <div class="toggle-track"></div><div class="toggle-thumb"></div>
      </label>
    </div>
  </div>
  ${cfg.enabled ? `
  <div class="panel-body">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="m-field" style="margin:0">
        <label class="m-label">OAuth クライアントID</label>
        <div style="display:flex;gap:6px">
          <input class="input" id="gcalClientId" type="password" value="${esc(cfg.clientId)}"
            placeholder="xxxxxxxx.apps.googleusercontent.com"
            style="font-family:monospace;font-size:11px;flex:1" />
          <button class="btn btn-ghost btn-sm" style="flex-shrink:0;white-space:nowrap"
            onclick="var f=document.getElementById('gcalClientId');f.type=f.type==='password'?'text':'password'">表示</button>
        </div>
        <div style="font-size:10px;color:var(--gray-2);margin-top:4px">
          Google Cloud Console で作成した OAuth 2.0 クライアント ID
        </div>
      </div>
      <div class="m-field" style="margin:0">
        <label class="m-label">カレンダーID <span style="font-weight:400;color:var(--gray-2)">（省略時: primary）</span></label>
        <input class="input" id="gcalCalId" value="${esc(cfg.calendarId)}" placeholder="primary" />
        <div style="font-size:10px;color:var(--gray-2);margin-top:4px">
          Googleカレンダーの設定 → カレンダーID で確認
        </div>
      </div>
    </div>
    <div class="m-field" style="margin-bottom:12px">
      <label class="m-label">同期方向</label>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${[['both','双方向（推奨）'],['push','プッシュのみ → Google'],['pull','プルのみ ← Google']].map(([v,lbl])=>`
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px">
            <input type="radio" name="gcalDir" value="${v}" ${cfg.syncDir===v?'checked':''} onchange="saveGcalSettings()" />
            ${lbl}
          </label>`).join('')}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${connected ? `
        <button class="btn btn-primary btn-sm" onclick="syncGCalNow()">今すぐ同期</button>
        <button class="btn btn-ghost btn-sm" onclick="GCalSync.disconnect()">切断</button>
      ` : `
        <button class="btn btn-primary btn-sm" onclick="saveGcalSettings();GCalSync.connect()">
          <svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:-2px;margin-right:4px"><path fill="currentColor" d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748z"/></svg>
          Googleで認証
        </button>
      `}
      <button class="btn btn-ghost btn-sm" onclick="saveGcalSettings()">設定を保存</button>
      <span style="font-size:11px;color:var(--gray-2);margin-left:auto">最終同期: ${lastSync}</span>
    </div>
    ${_renderGCalLog()}
  </div>
  ` : `
  <div class="panel-body" style="color:var(--gray-1);font-size:12px;padding:12px 16px">
    有効にするとGoogleカレンダーとの連携設定が表示されます。
  </div>
  `}
</div>`;
}

function _renderGCalLog() {
  if (!window.GCalSync) return '';
  const log = GCalSync.getLog().slice(0, 5);
  if (!log.length) return '';
  const rows = log.map(e => {
    const dir   = e.dir === 'push' ? '→ Google' : e.dir === 'pull' ? '← Google' : '認証';
    const ts    = e.ts ? e.ts.slice(0,16).replace('T',' ') : '';
    const detail = e.date ? e.date
                 : e.month ? e.month + '月'
                 : e.blocked != null ? `${e.blocked}件インポート`
                 : '';
    return `<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid var(--line-2);font-size:11px">
      <span style="color:${e.ok?'var(--green)':'var(--red)'}">${e.ok?'✓':'✗'}</span>
      <span style="color:var(--gray-2);min-width:110px">${ts}</span>
      <span>${dir}</span>
      <span style="color:var(--gray-1)">${esc(detail)}</span>
      ${!e.ok && e.error ? `<span style="color:var(--red);font-size:10px">${esc(String(e.error).slice(0,40))}</span>` : ''}
    </div>`;
  }).join('');
  return `
<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
  <div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">同期ログ（直近${log.length}件）</div>
  ${rows}
</div>`;
}

function saveGcalSettings() {
  const prev    = Adapter.getGcalSettings();
  const clientId = document.getElementById('gcalClientId')?.value  ?? prev.clientId;
  const calId    = document.getElementById('gcalCalId')?.value     ?? prev.calendarId;
  const enabled  = document.getElementById('gcalEnabled')?.checked ?? prev.enabled;
  const dir      = document.querySelector('input[name="gcalDir"]:checked')?.value ?? prev.syncDir;
  Adapter.saveGcalSettings({ ...prev, clientId, calendarId: calId, enabled, syncDir: dir });
  toast('Google Calendar設定を保存しました');
  renderGCalPanel();
}

async function syncGCalNow() {
  const btn = document.querySelector('#gcalPanel button[onclick="syncGCalNow()"]');
  if (btn) { btn.disabled = true; btn.textContent = '同期中…'; }
  try {
    await GCalSync.syncMonth(_calV.getFullYear(), _calV.getMonth());
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '今すぐ同期'; }
  }
}
