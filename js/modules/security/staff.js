'use strict';

/* ════════════════════════════════════════════════════════
   STAFF MANAGEMENT  (Phase 20)
   Admin-only view for managing additional staff accounts.
   Roles: admin (fixed) | staff | read-only
   ════════════════════════════════════════════════════════ */

function renderStaff() {
  const el = document.getElementById('staffContent');
  if (!el) return;

  const staffList = Auth.getStaff();
  const adminEmail = (Auth._getCreds() || {}).user || 'admin@hello-moving.com';

  const _roleBadge = role => {
    const map = {
      admin:       'rgba(37,99,235,.12);color:#1d4ed8',
      staff:       'rgba(16,185,129,.1);color:#059669',
      'read-only': 'rgba(107,114,128,.12);color:#6b7280',
    };
    const label = { admin:'管理者', staff:'スタッフ', 'read-only':'読み取り専用' };
    return `<span style="font-size:11px;padding:2px 9px;border-radius:12px;font-weight:600;background:${map[role]||map.staff}">${label[role]||role}</span>`;
  };

  const adminRow = `
    <tr style="border-bottom:1px solid var(--line-2)">
      <td style="padding:11px 14px;font-size:13px;font-weight:600">${esc(adminEmail.split('@')[0])}</td>
      <td style="padding:11px 14px;font-size:13px;color:var(--gray-1)">${esc(adminEmail)}</td>
      <td style="padding:11px 14px">${_roleBadge('admin')}</td>
      <td style="padding:11px 14px"><span style="font-size:11px;font-weight:600;color:var(--green)">● アクティブ</span></td>
      <td style="padding:11px 14px;font-size:11px;color:var(--gray-2)">—</td>
      <td style="padding:11px 14px;font-size:11px;color:var(--gray-2)">変更不可</td>
    </tr>`;

  const staffRows = staffList.map(s => `
    <tr style="border-bottom:1px solid var(--line-2)">
      <td style="padding:11px 14px;font-size:13px;font-weight:600">${esc(s.name)}</td>
      <td style="padding:11px 14px;font-size:13px;color:var(--gray-1)">${esc(s.email)}</td>
      <td style="padding:11px 14px">${_roleBadge(s.role)}</td>
      <td style="padding:11px 14px">
        <span style="font-size:11px;font-weight:600;color:${s.active?'var(--green)':'var(--gray-2)'}">
          ${s.active?'● アクティブ':'○ 無効'}
        </span>
      </td>
      <td style="padding:11px 14px;font-size:11px;color:var(--gray-2)">${s.lastLogin ? fmtDT(s.lastLogin) : '—'}</td>
      <td style="padding:11px 14px">
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="openEditStaff('${esc(s.id)}')">編集</button>
          <button class="btn btn-ghost btn-sm" onclick="resetStaffPasswordPrompt('${esc(s.id)}')">PW変更</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteStaff('${esc(s.id)}')">削除</button>
        </div>
      </td>
    </tr>`).join('');

  const emptyRow = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--gray-2);font-size:13px">
    スタッフアカウントがありません — 「スタッフを追加」で作成してください
  </td></tr>`;

  el.innerHTML = `
<div class="panel">
  <div class="panel-head">
    <span class="panel-title">スタッフ管理</span>
    <button class="btn btn-primary btn-sm" onclick="openAddStaff()">+ スタッフを追加</button>
  </div>
  <div class="panel-body" style="padding:0;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;min-width:640px">
      <thead>
        <tr style="border-bottom:2px solid var(--line)">
          ${['名前','メールアドレス','ロール','状態','最終ログイン','操作'].map(h =>
            `<th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em">${h}</th>`
          ).join('')}
        </tr>
      </thead>
      <tbody>${adminRow}${staffRows || emptyRow}</tbody>
    </table>
  </div>
</div>

<div class="settings-grid" style="margin-top:12px">
  ${[
    ['管理者', 'admin', '全機能にアクセス可能。設定変更・スタッフ管理・バックアップを含む。'],
    ['スタッフ', 'staff', '予約・カレンダー・顧客・分析・レビューを管理可能。システム設定は不可。'],
    ['読み取り専用', 'read-only', '全データを閲覧可能。書き込み操作はすべて無効。'],
  ].map(([lbl, role, desc]) => `
    <div class="panel">
      <div class="panel-body">
        <div style="margin-bottom:6px">${_roleBadge(role)}</div>
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">${lbl}</div>
        <div style="font-size:12px;color:var(--gray-2);line-height:1.55">${desc}</div>
      </div>
    </div>`).join('')}
</div>

<!-- Add / Edit modal -->
<div id="staffModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:20px">
  <div style="background:var(--bg);border-radius:16px;padding:28px;width:100%;max-width:420px;box-shadow:0 24px 60px rgba(0,0,0,.3)">
    <h3 id="staffModalTitle" style="font-size:16px;font-weight:700;margin-bottom:20px">スタッフを追加</h3>
    <input type="hidden" id="staffEditId" />
    <div class="m-field">
      <label class="m-label">名前</label>
      <input class="input" id="staffName" placeholder="山田 太郎" />
    </div>
    <div class="m-field">
      <label class="m-label">メールアドレス</label>
      <input class="input" id="staffEmail" type="email" placeholder="staff@hello-moving.com" />
    </div>
    <div class="m-field" id="staffPassField">
      <label class="m-label">パスワード <span style="font-weight:400;color:var(--gray-2)">（8文字以上）</span></label>
      <input class="input" id="staffPass" type="password" placeholder="••••••••" />
    </div>
    <div class="m-field">
      <label class="m-label">ロール</label>
      <select class="sel" id="staffRole" style="width:100%">
        <option value="staff">スタッフ</option>
        <option value="read-only">読み取り専用</option>
      </select>
    </div>
    <div class="m-field" id="staffActiveField" style="display:none">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <input type="checkbox" id="staffActive" />
        <span class="m-label" style="margin:0">アクティブ</span>
      </label>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button class="btn btn-ghost btn-sm" onclick="closeStaffModal()">キャンセル</button>
      <button class="btn btn-primary btn-sm" onclick="saveStaffForm()">保存</button>
    </div>
  </div>
</div>`;

  if (window.I18n) I18n.applyToDOM(el);
}

/* ── Modal helpers ──────────────────────────────────── */
function openAddStaff() {
  document.getElementById('staffModalTitle').textContent = 'スタッフを追加';
  document.getElementById('staffEditId').value = '';
  document.getElementById('staffName').value = '';
  document.getElementById('staffEmail').value = '';
  document.getElementById('staffPass').value = '';
  document.getElementById('staffRole').value = 'staff';
  document.getElementById('staffPassField').style.display = '';
  document.getElementById('staffActiveField').style.display = 'none';
  document.getElementById('staffModal').style.display = 'flex';
  setTimeout(() => document.getElementById('staffName').focus(), 50);
}

function openEditStaff(id) {
  const s = Auth.getStaff().find(m => m.id === id);
  if (!s) return;
  document.getElementById('staffModalTitle').textContent = 'スタッフを編集';
  document.getElementById('staffEditId').value = id;
  document.getElementById('staffName').value = s.name;
  document.getElementById('staffEmail').value = s.email;
  document.getElementById('staffPass').value = '';
  document.getElementById('staffRole').value = s.role;
  document.getElementById('staffPassField').style.display = 'none';
  document.getElementById('staffActiveField').style.display = '';
  document.getElementById('staffActive').checked = s.active;
  document.getElementById('staffModal').style.display = 'flex';
}

function closeStaffModal() {
  document.getElementById('staffModal').style.display = 'none';
}

async function saveStaffForm() {
  const id    = document.getElementById('staffEditId').value;
  const name  = document.getElementById('staffName').value.trim();
  const email = document.getElementById('staffEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('staffPass').value;
  const role  = document.getElementById('staffRole').value;
  const active = document.getElementById('staffActive')?.checked ?? true;

  if (!name)              { toast('名前を入力してください'); return; }
  if (!email)             { toast('メールアドレスを入力してください'); return; }
  if (!id && !pass)       { toast('パスワードを入力してください'); return; }
  if (pass && pass.length < 8) { toast('パスワードは8文字以上で設定してください'); return; }

  const adminEmail = (Auth._getCreds() || {}).user || '';
  if (email === adminEmail.toLowerCase()) { toast('管理者のメールアドレスは使用できません'); return; }
  if (Auth.getStaff().some(s => s.email.toLowerCase() === email && s.id !== id)) {
    toast('このメールアドレスは既に使用されています'); return;
  }

  if (id) {
    Auth.updateStaffMember(id, { name, email, role, active });
    toast('スタッフ情報を更新しました');
  } else {
    await Auth.addStaffMember({ name, email, role, password: pass });
    toast('スタッフを追加しました');
  }

  closeStaffModal();
  renderStaff();
}

async function resetStaffPasswordPrompt(id) {
  const s = Auth.getStaff().find(m => m.id === id);
  if (!s) return;
  const newPass = prompt(`${s.name} の新しいパスワードを入力してください（8文字以上）:`);
  if (!newPass) return;
  if (newPass.length < 8) { toast('パスワードは8文字以上で設定してください'); return; }
  await Auth.resetStaffPassword(id, newPass);
  toast('パスワードをリセットしました');
}

function deleteStaff(id) {
  const s = Auth.getStaff().find(m => m.id === id);
  if (!s) return;
  if (!confirm(`${s.name} を削除しますか？この操作は取り消せません。`)) return;
  Auth.deleteStaffMember(id);
  toast('スタッフを削除しました');
  renderStaff();
}
