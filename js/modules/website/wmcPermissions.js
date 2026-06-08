'use strict';
/* ══════════════════════════════════════════════════════
   WMC Permissions — Section 10 (Phase 28)
   Entry point: _wmcRenderPermissions()
   Depends on: wmcCore.js (WMCPermissions)
   ══════════════════════════════════════════════════════ */

function _wmcRenderPermissions() {
  var el = document.getElementById('wmcPermissionsContent');
  if (!el || typeof WMCPermissions === 'undefined') return;

  var role     = WMCPermissions.getRole();
  var roleInfo = WMCPermissions.getRoleInfo(role);
  var isAdmin  = WMCPermissions.can('manage_users');
  var users    = WMCPermissions.getUsers();

  /* ── Role banner ── */
  var icons = { admin: '👑', staff: '✏️', readonly: '👁' };
  var bannerBg = {
    admin    : { bg: 'rgba(37,99,235,.07)',  border: 'rgba(37,99,235,.2)'  },
    staff    : { bg: 'rgba(16,185,129,.07)', border: 'rgba(16,185,129,.2)' },
    readonly : { bg: 'rgba(107,114,128,.07)',border: 'rgba(107,114,128,.2)'},
  };
  var bb = bannerBg[role] || bannerBg.readonly;

  var roleBannerHtml =
    '<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:12px;border:1px solid ' + bb.border + ';background:' + bb.bg + ';margin-bottom:22px">' +
      '<div style="width:42px;height:42px;border-radius:10px;background:' + roleInfo.color + '22;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">' + (icons[role] || '👤') + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-weight:700;font-size:14px;color:var(--ink)">現在の権限: ' + esc(roleInfo.label) + '</div>' +
        '<div style="font-size:11px;color:var(--gray-1);margin-top:2px">' +
          (role === 'admin'    ? 'すべての操作が可能です。設定変更・デプロイ・ユーザー管理が含まれます。' :
           role === 'staff'    ? 'コンテンツの閲覧・編集が可能です。設定変更・デプロイは制限されています。' :
                                 'コンテンツの閲覧のみ可能です。編集・設定変更はできません。') +
        '</div>' +
      '</div>' +
      '<span class="wmc-stat-badge ' + roleInfo.badge + '">' + esc(roleInfo.label) + '</span>' +
    '</div>';

  /* ── Simulation controls (admin only) ── */
  var simHtml = '';
  if (isAdmin) {
    simHtml =
      '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:22px">' +
        '<div style="font-weight:700;font-size:13px;color:var(--ink);margin-bottom:4px">権限シミュレーション</div>' +
        '<div style="font-size:11px;color:var(--gray-1);margin-bottom:14px">別の権限でサイトがどう見えるかを確認できます。実際のデータへの影響はありません。</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          Object.keys(WMCPermissions.ROLES).map(function (r) {
            var ri = WMCPermissions.ROLES[r];
            return '<button class="btn ' + (role === r ? 'btn-primary' : 'btn-ghost') + ' btn-sm" onclick="_wmcSimRole(\'' + r + '\')">' +
              (icons[r] || '') + ' ' + esc(ri.label) +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  /* ── Permission matrix ── */
  var groups = {};
  Object.keys(WMCPermissions.MATRIX).forEach(function (k) {
    var def = WMCPermissions.MATRIX[k];
    if (!groups[def.group]) groups[def.group] = [];
    groups[def.group].push({ key: k, def: def });
  });
  var roleKeys = Object.keys(WMCPermissions.ROLES);

  var matrixRows = '';
  Object.keys(groups).forEach(function (grp) {
    matrixRows +=
      '<tr><td colspan="' + (roleKeys.length + 1) + '" ' +
        'style="padding:8px 16px 4px;font-size:10px;font-weight:700;color:var(--gray-2);text-transform:uppercase;letter-spacing:.08em;background:var(--bg-soft-2)">' +
        esc(grp) + '</td></tr>';
    groups[grp].forEach(function (item) {
      matrixRows += '<tr style="border-bottom:1px solid var(--line-2)">' +
        '<td style="padding:10px 16px;font-size:12px;color:var(--ink)">' + esc(item.def.label) + '</td>' +
        roleKeys.map(function (r) {
          var ok = item.def.roles.indexOf(r) !== -1;
          return '<td style="padding:10px 16px;text-align:center">' +
            (ok
              ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,.12);color:#059669;font-size:11px;font-weight:700">✓</span>'
              : '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,.07);color:#b91c1c;font-size:11px">✕</span>') +
          '</td>';
        }).join('') +
      '</tr>';
    });
  });

  var matrixHtml =
    '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:22px">' +
      '<div style="padding:12px 16px;border-bottom:1px solid var(--line)">' +
        '<span style="font-weight:700;font-size:13px;color:var(--ink)">権限マトリックス</span>' +
      '</div>' +
      '<div style="overflow-x:auto">' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr style="background:var(--bg-soft-2)">' +
            '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">操作</th>' +
            roleKeys.map(function (r) {
              return '<th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);white-space:nowrap">' +
                (icons[r] || '') + ' ' + esc(WMCPermissions.ROLES[r].label) + '</th>';
            }).join('') +
          '</tr></thead>' +
          '<tbody>' + matrixRows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';

  /* ── User management (admin only) ── */
  var usersHtml = '';
  if (isAdmin) {
    var userRows = users.length === 0
      ? '<div style="padding:24px;text-align:center;color:var(--gray-2);font-size:13px">追加のWMCユーザーはいません</div>'
      : users.map(function (u) {
          var ri = WMCPermissions.getRoleInfo(u.role);
          return '<div style="padding:12px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px">' +
            '<div style="width:34px;height:34px;border-radius:50%;background:' + ri.color + '22;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">' + (icons[u.role] || '👤') + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:600;color:var(--ink)">' + esc(u.name || u.email) + '</div>' +
              '<div style="font-size:11px;color:var(--gray-2)">' + esc(u.email) + ' · 登録: ' + new Date(u.createdAt).toLocaleDateString('ja-JP') + '</div>' +
            '</div>' +
            '<span class="wmc-stat-badge ' + ri.badge + '">' + esc(ri.label) + '</span>' +
            '<select class="tc-select" style="max-width:110px;font-size:11px" onchange="_wmcChangeUserRole(\'' + esc(u.id) + '\',this.value)">' +
              Object.keys(WMCPermissions.ROLES).map(function (r) {
                return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + esc(WMCPermissions.ROLES[r].label) + '</option>';
              }).join('') +
            '</select>' +
            '<button class="btn btn-ghost btn-sm" style="color:var(--red);flex-shrink:0" onclick="_wmcDeleteUser(\'' + esc(u.id) + '\')">削除</button>' +
          '</div>';
        }).join('');

    usersHtml =
      '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:22px">' +
        '<div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
          '<span style="font-weight:700;font-size:13px;color:var(--ink)">WMCユーザー管理</span>' +
          '<button class="btn btn-primary btn-sm" onclick="_wmcShowAddUser()">+ ユーザーを追加</button>' +
        '</div>' +
        userRows +
        '<div id="wmcAddUserForm" style="display:none;padding:16px;border-top:1px solid var(--line);background:var(--bg-soft-2)">' +
          '<div style="font-weight:600;font-size:13px;color:var(--ink);margin-bottom:12px">新規ユーザーを追加</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
            '<input id="wmcNewUserName" placeholder="表示名" style="padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-family:inherit;color:var(--ink);background:var(--bg)">' +
            '<input id="wmcNewUserEmail" type="email" placeholder="メールアドレス" style="padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-family:inherit;color:var(--ink);background:var(--bg)">' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<select id="wmcNewUserRole" class="tc-select">' +
              '<option value="staff">スタッフ</option>' +
              '<option value="readonly">閲覧のみ</option>' +
            '</select>' +
            '<button class="btn btn-primary btn-sm" onclick="_wmcAddUser()">追加</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'wmcAddUserForm\').style.display=\'none\'">キャンセル</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  el.innerHTML = roleBannerHtml + simHtml + matrixHtml + usersHtml;
  WMCPermissions.audit('other', 'wmc_permissions', 'view', '権限管理ページを表示');
}

/* ── Actions ── */
function _wmcSimRole(role) {
  WMCPermissions.setRole(role);
  _wmcRenderPermissions();
  var restricted = { theme:'manage_theme', deploy:'manage_deploy', settings:'modify_settings', permissions:'manage_users' };
  Object.keys(restricted).forEach(function (v) { WMCPermissions.applyRestriction(v, restricted[v]); });
  if (typeof toast !== 'undefined') toast('権限を「' + WMCPermissions.getRoleInfo(role).label + '」に切り替えました');
  WMCPermissions.audit('update', 'wmc_permissions', 'sim', '権限シミュレーション: ' + role);
}

function _wmcShowAddUser() {
  var f = document.getElementById('wmcAddUserForm');
  if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

function _wmcAddUser() {
  var name  = (document.getElementById('wmcNewUserName')  || {}).value || '';
  var email = (document.getElementById('wmcNewUserEmail') || {}).value || '';
  var role  = (document.getElementById('wmcNewUserRole')  || {}).value || 'staff';
  name = name.trim(); email = email.trim();
  if (!name || !email) { if (typeof toast !== 'undefined') toast('名前とメールアドレスを入力してください'); return; }
  var users = WMCPermissions.getUsers();
  if (users.some(function (u) { return u.email === email; })) {
    if (typeof toast !== 'undefined') toast('このメールアドレスはすでに登録されています');
    return;
  }
  var newUser = { id: 'WU-' + Date.now().toString(36).toUpperCase(), name: name, email: email, role: role, createdAt: new Date().toISOString() };
  users.push(newUser);
  WMCPermissions.saveUsers(users);
  WMCPermissions.audit('add', 'wmc_user', newUser.id, '新規WMCユーザー: ' + email + ' [' + role + ']');
  if (typeof toast !== 'undefined') toast('ユーザーを追加しました');
  _wmcRenderPermissions();
}

function _wmcChangeUserRole(userId, newRole) {
  var users = WMCPermissions.getUsers();
  var user = users.find(function (u) { return u.id === userId; });
  if (!user) return;
  var old = user.role;
  user.role = newRole;
  WMCPermissions.saveUsers(users);
  WMCPermissions.audit('update', 'wmc_user', userId, '権限変更: ' + old + ' → ' + newRole);
  if (typeof toast !== 'undefined') toast('権限を変更しました');
  _wmcRenderPermissions();
}

function _wmcDeleteUser(userId) {
  var users = WMCPermissions.getUsers();
  var user  = users.find(function (u) { return u.id === userId; });
  if (!user || !confirm('「' + (user.name || user.email) + '」を削除しますか？')) return;
  WMCPermissions.saveUsers(users.filter(function (u) { return u.id !== userId; }));
  WMCPermissions.audit('delete', 'wmc_user', userId, 'WMCユーザー削除: ' + user.email);
  if (typeof toast !== 'undefined') toast('ユーザーを削除しました');
  _wmcRenderPermissions();
}
