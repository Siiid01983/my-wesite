'use strict';

/* ════════════════════════════════════════════════════════
   AUTO FOLLOW-UP EMAILS  (Phase 18)
   ════════════════════════════════════════════════════════
   Sends a customer follow-up email X days after a booking's
   move_date when status is 完了.

   Uses the same EmailJS credentials as the admin notifications
   (serviceId, publicKey from getEmailSettings()) but a
   separate template configured here (templateId).

   Emails go to the CUSTOMER, not the admin.

   checkAndSend() runs automatically after login (appBootstrap)
   and can be triggered manually from the settings panel.

   Follow-up template variables:
     {{to_email}}      customer email
     {{customer_name}} customer name
     {{reference_id}}  booking reference
     {{move_date}}     formatted move date (e.g. 6月7日（日）)
     {{company_name}}  Hello Moving
   ════════════════════════════════════════════════════════ */

window.FollowUp = (function () {
  'use strict';

  /* ── Core: check bookings and send pending follow-ups ── */
  //  EmailJS has been removed; _send() no longer dispatches email, so this flow
  //  is inert until rebuilt on the send-email.php gateway.
  async function checkAndSend(silent) {
    const cfg      = Adapter.getFollowUpSettings();
    if (!cfg.enabled || !cfg.templateId) return 0;

    const emailCfg = Adapter.getEmailSettings();
    if (!emailCfg.enabled) return 0;

    const bookings = Adapter.getBookings();
    const sent     = Adapter.getFollowUpSent();
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    let count      = 0;

    for (const bk of bookings) {
      if (bk.status !== '完了')        continue;
      if (!bk.email || !bk.date)      continue;
      if (sent[bk.id])                 continue; // already sent

      const moveDate    = new Date(bk.date + 'T00:00:00');
      const triggerDate = new Date(moveDate);
      triggerDate.setDate(triggerDate.getDate() + cfg.delayDays);

      if (triggerDate > today) continue; // not yet time

      const ok = await _send(bk, emailCfg, cfg);
      if (ok) count++;
    }

    if (count > 0) toast(`フォローアップメール ${count}件 送信しました`);
    else if (!silent) toast('送信対象の未送信フォローアップはありません');

    if (document.getElementById('followUpContent')) renderFollowUpPanel();
    return count;
  }

  async function _send(bk, emailCfg, cfg) {
    const ts = new Date().toLocaleString('ja-JP');
    // EmailJS has been removed. This customer follow-up flow is DISABLED pending
    // a rebuild on the send-email.php gateway; it no longer sends any email.
    Adapter.pushFollowUpLog({ ts, refId: bk.id, name: bk.name, email: bk.email, ok: false, status: 'disabled (EmailJS removed)' });
    return false;
  }

  /* ── UI ─────────────────────────────────────────────── */
  function renderFollowUpPanel() {
    const el = document.getElementById('followUpContent');
    if (!el) return;

    const cfg   = Adapter.getFollowUpSettings();
    const sent  = Adapter.getFollowUpSent();
    const total = Object.keys(sent).length;

    el.innerHTML = `
<div class="panel" style="margin-top:16px">
  <div class="panel-head">
    <div style="display:flex;align-items:center;gap:8px">
      <svg viewBox="0 0 24 24" width="18" height="18" style="color:var(--blue);flex-shrink:0"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
      <span class="panel-title">フォローアップメール</span>
      ${total ? `<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(16,185,129,.1);color:#059669;font-weight:600">${total}件 送信済み</span>` : ''}
    </div>
    <label class="toggle" title="${cfg.enabled?'無効にする':'有効にする'}">
      <input type="checkbox" id="fuEnabled" ${cfg.enabled?'checked':''} onchange="saveFollowUpSettings()" />
      <div class="toggle-track"></div><div class="toggle-thumb"></div>
    </label>
  </div>
  ${cfg.enabled ? `
  <div class="panel-body">
    <div class="m-row">
      <div class="m-field">
        <label class="m-label">送信タイミング</label>
        <select class="sel" id="fuDelayDays" onchange="saveFollowUpSettings()">
          ${[1,2,3,5,7,14].map(d => `<option value="${d}" ${cfg.delayDays===d?'selected':''}>引越し日から ${d}日後</option>`).join('')}
        </select>
      </div>
      <div class="m-field">
        <label class="m-label">フォローアップ Template ID</label>
        <input class="input" id="fuTemplateId" type="text" value="${esc(cfg.templateId)}"
          placeholder="template_xxxxxxx" style="font-family:monospace;font-size:12px" />
        <div style="font-size:11px;color:var(--gray-2);margin-top:4px">
          EmailJS で別途作成した顧客向けテンプレートの ID
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <button class="btn btn-primary btn-sm" onclick="saveFollowUpSettings()">保存</button>
      <button class="btn btn-ghost btn-sm" id="fuCheckBtn" onclick="triggerFollowUpCheck()">今すぐ確認 &amp; 送信</button>
    </div>

    <!-- Template variables -->
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
      <div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">テンプレート変数</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px">
        ${[
          ['to_email',      '顧客メールアドレス'],
          ['customer_name', '顧客名'],
          ['reference_id',  '予約番号'],
          ['move_date',     '引越し日（日本語形式）'],
          ['company_name',  '会社名（Hello Moving）'],
        ].map(([v, desc]) => `
          <div style="background:var(--bg-soft-2);border:1px solid var(--line);border-radius:6px;padding:7px 10px">
            <code style="font-size:11px;color:var(--blue)">{{${v}}}</code>
            <div style="font-size:11px;color:var(--gray-2);margin-top:2px">${desc}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Sent log -->
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em">送信ログ</div>
        <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="Adapter.clearFollowUpLog();renderFollowUpPanel()">クリア</button>
      </div>
      ${_renderLog()}
    </div>
  </div>
  ` : `
  <div class="panel-body" style="color:var(--gray-1);font-size:12px;padding:12px 16px">
    有効にすると、引越し完了後 X 日に顧客へ自動フォローアップメールを送信します。
    EmailJS の顧客向けテンプレートが別途必要です。
  </div>
  `}
</div>`;
  }

  function _renderLog() {
    const log = Adapter.getFollowUpLog();
    if (!log.length) return '<div style="color:var(--gray-2);font-size:12px;padding:8px 0">まだ送信履歴がありません</div>';
    return log.slice(0, 10).map(e => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">
        <span style="flex-shrink:0;display:inline-flex;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;
          ${e.ok
            ? 'background:rgba(16,185,129,.1);color:#059669;border:1px solid rgba(16,185,129,.2)'
            : 'background:rgba(239,68,68,.08);color:#b91c1c;border:1px solid rgba(239,68,68,.18)'}">
          ${e.ok ? '✓ 成功' : '✗ 失敗'}
        </span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--ink)">${esc(e.name || e.refId || '')}</div>
          <div style="font-size:11px;color:var(--gray-2);margin-top:2px">
            ${esc(e.email || '')} · ${esc(e.ts)} · HTTP ${esc(String(e.status))}
          </div>
        </div>
      </div>`).join('');
  }

  function saveFollowUpSettings() {
    const prev      = Adapter.getFollowUpSettings();
    const enabled   = document.getElementById('fuEnabled')?.checked ?? prev.enabled;
    const delayDays = parseInt(document.getElementById('fuDelayDays')?.value, 10) || prev.delayDays;
    const templateId = document.getElementById('fuTemplateId')?.value.trim() || prev.templateId;
    Adapter.saveFollowUpSettings({ ...prev, enabled, delayDays, templateId });
    toast('フォローアップ設定を保存しました');
    renderFollowUpPanel();
  }

  async function triggerFollowUpCheck() {
    const btn = document.getElementById('fuCheckBtn');
    if (btn) { btn.disabled = true; btn.textContent = '確認中…'; }
    try { await checkAndSend(false); }
    finally {
      if (btn) { btn.disabled = false; btn.textContent = '今すぐ確認 & 送信'; }
    }
  }

  return { checkAndSend, renderFollowUpPanel, saveFollowUpSettings, triggerFollowUpCheck };

})();
