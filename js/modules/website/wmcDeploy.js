'use strict';
/* ══════════════════════════════════════════════════════
   WMC Deployment Center — Section 9 (Phase 28)
   Entry points: _wmcRenderDeploy(), _dcRefresh()
   Depends on: wmcCore.js (_padZ, _wmcFmtRelative, WMCPermissions)
   ══════════════════════════════════════════════════════ */

var _DC_EXPORT_KEYS = [
  'hm_hero', 'hm_footer', 'hm_faq', 'hm_company_rows', 'hm_prices',
  'hm_blog_posts',
  'hm_version', 'hm_git_commit',
];

/* ── Log helpers ── */
function _dcAddLog(msg, level) {
  var logs = [];
  try { logs = JSON.parse(localStorage.getItem('hm_dc_log') || '[]'); } catch (_) {}
  logs.unshift({ ts: new Date().toISOString(), msg: msg, level: level || 'ok' });
  if (logs.length > 50) logs.length = 50;
  localStorage.setItem('hm_dc_log', JSON.stringify(logs));
}

function _dcClearLog() {
  localStorage.removeItem('hm_dc_log');
  _wmcRenderDeploy();
  if (typeof toast !== 'undefined') toast('ログをクリアしました');
}

function _dcRefresh() {
  _wmcRenderDeploy();
  if (typeof toast !== 'undefined') toast('デプロイ情報を更新しました');
}

/* ── Export / Import ── */
function _dcExportConfig() {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('export_data')) {
    if (typeof toast !== 'undefined') toast('この操作には管理者権限が必要です'); return;
  }
  var data = { _exported: new Date().toISOString(), _tool: 'Hello Moving WMC', _version: '4.0', config: {} };
  _DC_EXPORT_KEYS.forEach(function (k) { var v = localStorage.getItem(k); if (v) data.config[k] = v; });
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'hello-moving-config-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  _dcAddLog('設定をエクスポートしました', 'ok');
  _wmcRenderDeploy();
  if (typeof toast !== 'undefined') toast('設定をダウンロードしました');
}

function _dcImportConfig(input) {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('import_data')) {
    if (typeof toast !== 'undefined') toast('この操作には管理者権限が必要です'); return;
  }
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!data.config) throw new Error('無効なフォーマット');
      var count = 0;
      Object.keys(data.config).forEach(function (k) {
        if (_DC_EXPORT_KEYS.indexOf(k) !== -1) { localStorage.setItem(k, data.config[k]); count++; }
      });
      _dcAddLog(count + '件の設定をインポートしました', 'ok');
      _wmcRenderDeploy();
      if (typeof toast !== 'undefined') toast(count + '件の設定をインポートしました');
    } catch (err) {
      _dcAddLog('インポートエラー: ' + err.message, 'err');
      if (typeof toast !== 'undefined') toast('インポートに失敗しました: ' + err.message);
    }
    input.value = '';
  };
  reader.readAsText(file);
}

/* ── Backups ── */
function _dcBackup() {
  var name = window.prompt('バックアップ名を入力してください:', '手動バックアップ ' + new Date().toLocaleDateString('ja-JP'));
  if (!name || !name.trim()) return;
  var backups = [];
  try { backups = JSON.parse(localStorage.getItem('hm_dc_backups') || '[]'); } catch (_) {}
  var snapshot = { id: Date.now(), name: name.trim(), ts: new Date().toISOString(), data: {} };
  _DC_EXPORT_KEYS.forEach(function (k) { var v = localStorage.getItem(k); if (v) snapshot.data[k] = v; });
  backups.unshift(snapshot);
  if (backups.length > 10) backups.length = 10;
  localStorage.setItem('hm_dc_backups', JSON.stringify(backups));
  _dcAddLog('バックアップを作成: ' + name.trim(), 'ok');
  _wmcRenderDeploy();
  if (typeof toast !== 'undefined') toast('バックアップを作成しました');
}

function _dcRestoreBackup(id) {
  var backups = [];
  try { backups = JSON.parse(localStorage.getItem('hm_dc_backups') || '[]'); } catch (_) {}
  var s = backups.find(function (b) { return b.id === id; });
  if (!s || !confirm('「' + s.name + '」を復元しますか？現在の設定は上書きされます。')) return;
  Object.keys(s.data).forEach(function (k) { localStorage.setItem(k, s.data[k]); });
  _dcAddLog('バックアップを復元: ' + s.name, 'ok');
  _wmcRenderDeploy();
  if (typeof toast !== 'undefined') toast('バックアップを復元しました');
}

function _dcDeleteBackup(id) {
  var backups = [];
  try { backups = JSON.parse(localStorage.getItem('hm_dc_backups') || '[]'); } catch (_) {}
  var idx = backups.findIndex(function (b) { return b.id === id; });
  if (idx === -1) return;
  var name = backups[idx].name;
  backups.splice(idx, 1);
  localStorage.setItem('hm_dc_backups', JSON.stringify(backups));
  _dcAddLog('バックアップを削除: ' + name, 'warn');
  _wmcRenderDeploy();
}

function _dcSaveVersion() {
  var vEl = document.getElementById('dcVersionInput');
  var cEl = document.getElementById('dcCommitInput');
  if (vEl && vEl.value.trim()) localStorage.setItem('hm_version',    vEl.value.trim());
  if (cEl && cEl.value.trim()) localStorage.setItem('hm_git_commit', cEl.value.trim());
  _dcAddLog('バージョン情報を更新: ' + (vEl ? vEl.value.trim() : ''), 'ok');
  _wmcRenderDeploy();
  if (typeof toast !== 'undefined') toast('バージョン情報を保存しました');
}

/* ── Main render ── */
function _wmcRenderDeploy() {
  var version   = localStorage.getItem('hm_version')    || 'v4.0';
  var gitCommit = localStorage.getItem('hm_git_commit') || '—';
  var deployTs  = localStorage.getItem('hm_last_deploy');
  var deployText = deployTs ? _wmcFmtRelative(new Date(deployTs)) : '未記録';

  var totalBytes = 0;
  for (var k in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, k) && k.slice(0, 3) === 'hm_') {
      totalBytes += (localStorage.getItem(k) || '').length * 2;
    }
  }
  var backups = [];
  try { backups = JSON.parse(localStorage.getItem('hm_dc_backups') || '[]'); } catch (_) {}

  /* Info cards */
  var infoCards = [
    { icon: '🏷', label: '現在バージョン', value: version, meta: 'Hello Moving Admin', badge: { cls: 'blue', text: '最新' } },
    { icon: '📌', label: 'Gitコミット', value: gitCommit !== '—' ? gitCommit.slice(0, 7) : '—', meta: '最新コミットハッシュ', badge: gitCommit !== '—' ? { cls: 'green', text: '設定済み' } : { cls: 'yellow', text: '未設定' } },
    { icon: '🚀', label: 'ビルド状態', value: '本番環境', meta: 'Production', badge: { cls: 'green', text: '稼働中' } },
    { icon: '📅', label: '最終デプロイ', value: deployText, meta: deployTs ? new Date(deployTs).toLocaleDateString('ja-JP') : '—', badge: deployTs ? { cls: 'green', text: '記録済み' } : { cls: 'yellow', text: '未記録' } },
    { icon: '💾', label: 'データ使用量', value: (totalBytes / 1024).toFixed(1) + ' KB', meta: 'localStorage (hm_*)', badge: { cls: totalBytes > 500000 ? 'yellow' : 'green', text: totalBytes > 500000 ? '容量注意' : '正常' } },
  ];

  var gridEl = document.getElementById('dcInfoGrid');
  if (gridEl) {
    gridEl.innerHTML = infoCards.map(function (c) {
      var b = c.badge;
      return '<div class="dc-card">' +
        '<div class="dc-card-label">' + c.icon + ' ' + esc(c.label) + '</div>' +
        '<div class="dc-card-value">' + esc(String(c.value)) + '</div>' +
        '<div class="dc-card-meta">' + esc(c.meta) + '</div>' +
        (b ? '<div class="wmc-stat-badge ' + b.cls + '" style="margin-top:8px">' + esc(b.text) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  /* Actions */
  var actEl = document.getElementById('dcActionsGrid');
  if (actEl) {
    actEl.innerHTML = [
      _dcActionCard('📤', '設定をエクスポート', 'ヒーロー・FAQ・テーマなどサイト設定をまとめて JSON ファイルとして保存します。', '<button class="btn btn-primary btn-sm" onclick="_dcExportConfig()">ダウンロード</button>'),
      _dcActionCard('📥', '設定をインポート', 'エクスポートした JSON ファイルを読み込み、サイト設定を一括復元します。',
        '<label class="btn btn-ghost btn-sm" style="cursor:pointer">ファイルを選択<input type="file" accept=".json" style="display:none" onchange="_dcImportConfig(this)"></label>'),
      _dcActionCard('🗄', 'バックアップを作成', '現在の設定のスナップショットをブラウザ内に保存します（最大10件まで）。',
        '<button class="btn btn-ghost btn-sm" onclick="_dcBackup()">スナップショット作成</button>'),
      '<div class="dc-action">' +
        '<div class="dc-action-head"><div class="dc-action-icon" style="background:rgba(139,92,246,.1)">🏷</div><div class="dc-action-title">バージョン情報</div></div>' +
        '<div class="dc-action-desc">バージョン番号と Git コミットハッシュを手動で記録します。</div>' +
        '<div class="dc-version-row">' +
          '<input id="dcVersionInput" placeholder="v4.0" value="' + esc(version) + '" style="font-family:inherit">' +
          '<input id="dcCommitInput" placeholder="abc1234..." value="' + esc(gitCommit === '—' ? '' : gitCommit) + '">' +
          '<button class="btn btn-primary btn-sm" onclick="_dcSaveVersion()">保存</button>' +
        '</div>' +
      '</div>',
    ].join('');
  }

  /* Backups list */
  var bkEl = document.getElementById('dcBackupsList');
  if (bkEl) {
    if (backups.length === 0) { bkEl.innerHTML = ''; }
    else {
      bkEl.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:12px">保存済みバックアップ (' + backups.length + '/10)</div>' +
        '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden">' +
        backups.map(function (b, i) {
          var d = new Date(b.ts);
          var ds = d.toLocaleDateString('ja-JP') + ' ' + _padZ(d.getHours()) + ':' + _padZ(d.getMinutes());
          var last = i === backups.length - 1;
          return '<div style="padding:11px 16px;' + (last ? '' : 'border-bottom:1px solid var(--line-2);') + 'display:flex;align-items:center;gap:12px">' +
            '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--ink)">' + esc(b.name) + '</div><div style="font-size:10px;color:var(--gray-2);margin-top:2px">' + ds + '</div></div>' +
            '<button class="btn btn-ghost btn-sm" onclick="_dcRestoreBackup(' + b.id + ')">復元</button>' +
            '<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="_dcDeleteBackup(' + b.id + ')">削除</button>' +
          '</div>';
        }).join('') +
        '</div>';
    }
  }

  /* Log */
  var logEl = document.getElementById('dcLogBody');
  if (logEl) {
    var logs = [];
    try { logs = JSON.parse(localStorage.getItem('hm_dc_log') || '[]'); } catch (_) {}
    var sys = [];
    if (localStorage.getItem('hm_last_deploy'))           sys.push({ ts: localStorage.getItem('hm_last_deploy'),           msg: 'サイト起動を初回記録', level: 'ok' });
    if (localStorage.getItem('hm_last_content_update'))   sys.push({ ts: localStorage.getItem('hm_last_content_update'),   msg: 'コンテンツ更新',       level: 'ok' });
    var all = logs.concat(sys).sort(function (a, b) { return b.ts > a.ts ? 1 : -1; }).slice(0, 30);
    if (all.length === 0) { logEl.innerHTML = '<div style="color:var(--gray-2);padding:6px 0">ログがありません</div>'; }
    else {
      logEl.innerHTML = all.map(function (l) {
        var d = new Date(l.ts);
        var ts = d.getFullYear() + '/' + _padZ(d.getMonth() + 1) + '/' + _padZ(d.getDate()) + ' ' + _padZ(d.getHours()) + ':' + _padZ(d.getMinutes());
        var cls = l.level === 'err' ? 'dc-log-err' : l.level === 'warn' ? 'dc-log-warn' : 'dc-log-ok';
        return '<div class="dc-log-line"><span class="dc-log-ts">' + ts + '</span><span class="dc-log-msg ' + cls + '">' + esc(l.msg) + '</span></div>';
      }).join('');
    }
  }
}

function _dcActionCard(icon, title, desc, actionHtml) {
  return '<div class="dc-action">' +
    '<div class="dc-action-head"><div class="dc-action-icon" style="background:rgba(37,99,235,.1)">' + icon + '</div><div class="dc-action-title">' + esc(title) + '</div></div>' +
    '<div class="dc-action-desc">' + esc(desc) + '</div>' +
    actionHtml +
  '</div>';
}
