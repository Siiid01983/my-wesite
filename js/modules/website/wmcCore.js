'use strict';
/* ══════════════════════════════════════════════════════
   WMC Core — Phase 28
   Provides: window.WMCPermissions, _padZ(), _wmcFmtRelative()

   localStorage schema (Phase 28):
     hm_wmc_users     — [{id,name,email,role,createdAt}]
     hm_wmc_role      — sessionStorage, current simulated role
     hm_dc_log        — [{ts,msg,level}]  deployment log (max 50)
     hm_dc_backups    — [{id,name,ts,data{}}]  snapshots (max 10)
     hm_version       — "v4.0"
     hm_git_commit    — "abc1234..."
   ══════════════════════════════════════════════════════ */

/* Shared date/number utilities used by all WMC modules */
function _padZ(n) { return String(n).padStart(2, '0'); }

function _wmcFmtRelative(d) {
  if (!d) return '—';
  var diff = Date.now() - d.getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'たった今';
  if (mins < 60) return mins + '分前';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24)  return hrs + '時間前';
  var days = Math.floor(hrs / 24);
  if (days < 30) return days + '日前';
  return d.getFullYear() + '/' + _padZ(d.getMonth() + 1) + '/' + _padZ(d.getDate());
}

/* ── Permissions ────────────────────────────────────── */
window.WMCPermissions = (function () {

  var ROLES = {
    admin    : { label: '管理者',   color: '#2563eb', badge: 'blue'  },
    staff    : { label: 'スタッフ', color: '#10b981', badge: 'green' },
    readonly : { label: '閲覧のみ', color: '#6b7280', badge: 'gray'  },
  };

  /* key → { roles[], label, group } */
  var MATRIX = {
    delete_pages    : { roles: ['admin'],                      label: 'ページを削除する',            group: 'ページ管理' },
    publish_pages   : { roles: ['admin'],                      label: 'ページを公開・非公開にする',   group: 'ページ管理' },
    modify_settings : { roles: ['admin'],                      label: 'サイト設定を変更する',          group: '設定' },
    manage_theme    : { roles: ['admin'],                      label: 'テーマをカスタマイズする',      group: '設定' },
    manage_deploy   : { roles: ['admin'],                      label: 'デプロイ操作を実行する',        group: '設定' },
    manage_users    : { roles: ['admin'],                      label: 'ユーザーと権限を管理する',      group: '管理' },
    export_data     : { roles: ['admin'],                      label: 'データをエクスポートする',      group: '管理' },
    import_data     : { roles: ['admin'],                      label: 'データをインポートする',        group: '管理' },
    edit_content    : { roles: ['admin', 'staff'],             label: 'コンテンツを編集する',          group: 'コンテンツ' },
    create_content  : { roles: ['admin', 'staff'],             label: 'コンテンツを新規作成する',      group: 'コンテンツ' },
    view_analytics  : { roles: ['admin', 'staff'],             label: '統計・分析を閲覧する',          group: 'コンテンツ' },
    view_content    : { roles: ['admin', 'staff', 'readonly'], label: 'コンテンツを閲覧する',          group: '基本' },
    view_pages      : { roles: ['admin', 'staff', 'readonly'], label: 'ページ一覧を見る',              group: '基本' },
  };

  function _getRole() {
    var r = sessionStorage.getItem('hm_wmc_role');
    return (r && ROLES[r]) ? r : 'admin';
  }

  function _setRole(role) {
    if (!ROLES[role]) return false;
    sessionStorage.setItem('hm_wmc_role', role);
    return true;
  }

  function _can(action) {
    var def = MATRIX[action];
    if (!def) return true;
    return def.roles.indexOf(_getRole()) !== -1;
  }

  function _getRoleInfo(role) {
    return ROLES[role || _getRole()] || ROLES.readonly;
  }

  function _getUsers() {
    try { return JSON.parse(localStorage.getItem('hm_wmc_users') || '[]'); } catch (_) { return []; }
  }

  function _saveUsers(list) {
    localStorage.setItem('hm_wmc_users', JSON.stringify(list));
  }

  function _audit(action, entity, id, detail) {
    try {
      if (typeof AuditLog !== 'undefined') AuditLog.record(action, entity, id || '-', detail || '');
    } catch (_) {}
  }

  /* Overlay a lock screen when current role lacks the required permission */
  function _applyRestriction(viewId, action) {
    var viewEl = document.getElementById('wmc-view-' + viewId);
    if (!viewEl) return;
    var overlay = viewEl.querySelector('.wmc-perm-overlay');
    if (_can(action)) {
      if (overlay) overlay.style.display = 'none';
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'wmc-perm-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;background:var(--bg);z-index:20;display:flex;align-items:center;justify-content:center;border-radius:inherit';
      overlay.innerHTML =
        '<div style="text-align:center;padding:40px 24px">' +
          '<div style="font-size:40px;opacity:.35;margin-bottom:14px">🔒</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">アクセス制限</div>' +
          '<div style="font-size:13px;color:var(--gray-1);max-width:300px;line-height:1.6">' +
            'このセクションは<strong>管理者</strong>のみアクセスできます。<br>' +
            '現在の権限: <strong>' + _getRoleInfo().label + '</strong>' +
          '</div>' +
        '</div>';
      viewEl.style.position = 'relative';
      viewEl.prepend(overlay);
    }
    overlay.style.display = 'flex';
  }

  return {
    ROLES            : ROLES,
    MATRIX           : MATRIX,
    getRole          : _getRole,
    setRole          : _setRole,
    can              : _can,
    getRoleInfo      : _getRoleInfo,
    getUsers         : _getUsers,
    saveUsers        : _saveUsers,
    audit            : _audit,
    applyRestriction : _applyRestriction,
  };
}());
