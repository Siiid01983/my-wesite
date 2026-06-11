'use strict';
/* ══════════════════════════════════════════════════════
   WMC Pages — Page management view (Phase 28)
   Entry point: _wmcRenderPages()
   Depends on: wmcCore.js (WMCPermissions)
   ══════════════════════════════════════════════════════ */

var _WMC_PAGES = [
  { name: '公開サイト (index.html)',     path: '/',                      desc: '顧客向けメインサイト。予約フォームを含む。',     status: 'online', edit: null },
  { name: '管理パネル (admin.html)',     path: '/admin.html',            desc: '全機能搭載の管理者ダッシュボード。',             status: 'online', edit: 'admin.html' },
  { name: 'レビュー投稿 (review.html)', path: '/review.html',           desc: '顧客がレビューを投稿するための公開フォーム。',   status: 'online', edit: null },
  { name: 'レビュー印刷 (admin-reviews)', path: '/admin-reviews.html',  desc: 'レビューの印刷・PDF出力用ページ。',             status: 'online', edit: null },
  { name: 'WMC (wmc/wmcDashboard.html)', path: '/wmc/wmcDashboard.html', desc: 'Website Management Center（このページ）。', status: 'online', edit: null },
];

function _wmcRenderPages() {
  var el = document.getElementById('wmcPagesContent');
  if (!el) return;

  var canDelete  = typeof WMCPermissions !== 'undefined' ? WMCPermissions.can('delete_pages')  : true;
  var canPublish = typeof WMCPermissions !== 'undefined' ? WMCPermissions.can('publish_pages') : true;

  var permNote = '';
  if (typeof WMCPermissions !== 'undefined' && !canDelete) {
    permNote =
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:8px;margin-bottom:14px;font-size:12px;color:var(--ink)">' +
        '<span>🔒</span>' +
        '<span>現在の権限 (<strong>' + WMCPermissions.getRoleInfo().label + '</strong>) ではページの削除・公開操作ができません。</span>' +
      '</div>';
  }

  el.innerHTML = permNote +
    '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden">' +
      '<div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-weight:700;font-size:13px;color:var(--ink)">ページ一覧</span>' +
        '<span style="font-size:11px;color:var(--gray-2)">' + _WMC_PAGES.length + ' ページ</span>' +
      '</div>' +
      '<div style="overflow-x:auto">' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr style="background:var(--bg-soft-2)">' +
            _thCell('ページ名') + _thCell('説明') + _thCell('状態') + _thCell('操作') +
          '</tr></thead>' +
          '<tbody>' +
          _WMC_PAGES.map(function (p) {
            return '<tr style="border-bottom:1px solid var(--line-2)">' +
              '<td style="padding:12px 16px;font-size:13px;font-weight:500;color:var(--ink)">' + esc(p.name) + '</td>' +
              '<td style="padding:12px 16px;font-size:12px;color:var(--gray-1)">' + esc(p.desc) + '</td>' +
              '<td style="padding:12px 16px">' + _pageStatusBadge(p.status) + '</td>' +
              '<td style="padding:12px 16px">' +
                '<div style="display:flex;gap:6px;align-items:center">' +
                  '<a href="' + esc(p.path) + '" target="_blank" class="btn btn-ghost btn-sm">表示</a>' +
                  (p.edit ? '<a href="' + esc(p.edit) + '" class="btn btn-ghost btn-sm">管理</a>' : '') +
                  (canPublish ? '<button class="btn btn-ghost btn-sm" onclick="_wmcTogglePublish(\'' + esc(p.path) + '\')" style="color:var(--green)">公開設定</button>' : '') +
                  (canDelete  ? '<button class="btn btn-ghost btn-sm" onclick="_wmcConfirmDelete(\'' + esc(p.name) + '\')" style="color:var(--red)">削除</button>' : '') +
                '</div>' +
              '</td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
}

function _thCell(label) {
  return '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">' + label + '</th>';
}

function _pageStatusBadge(status) {
  return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#059669;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);border-radius:20px;padding:2px 8px">' +
    '<span style="width:5px;height:5px;border-radius:50%;background:#10b981;display:inline-block"></span>' +
    (status === 'online' ? '公開中' : '非公開') +
  '</span>';
}

function _wmcTogglePublish(path) {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('publish_pages')) {
    if (typeof toast !== 'undefined') toast('この操作には管理者権限が必要です');
    return;
  }
  if (typeof toast !== 'undefined') toast('公開設定を変更しました: ' + path);
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('update', 'page', path, 'ページ公開設定を変更');
}

function _wmcConfirmDelete(name) {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('delete_pages')) {
    if (typeof toast !== 'undefined') toast('この操作には管理者権限が必要です');
    return;
  }
  if (!confirm('「' + name + '」を削除しますか？この操作は取り消せません。')) return;
  if (typeof toast !== 'undefined') toast('削除しました: ' + name);
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('delete', 'page', name, 'ページを削除');
}
