/* ══════════════════════════════════════════════════════════════
   Overlay Bookings — reads bookings saved by save_booking.php
   (submitted via the booking overlay on index.html)
   ══════════════════════════════════════════════════════════════ */

function renderOverlayBookings() {
  var el = document.getElementById('view-overlay-bookings');
  if (!el) return;

  el.innerHTML = '<div class="panel">'
    + '<div class="panel-head">'
    + '<span class="panel-title">フォーム予約一覧</span>'
    + '<button class="btn btn-ghost btn-sm" onclick="renderOverlayBookings()">'
    + '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>更新</button>'
    + '</div>'
    + '<div id="ob-wrap"><p style="padding:24px 20px;color:var(--gray-1)">読み込み中...</p></div>'
    + '</div>';

  var _url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost/save_booking.php?action=list'
    : 'save_booking.php?action=list';
  console.log('[OverlayBookings] fetching:', _url, '| origin:', window.location.origin);

  fetch(_url)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var wrap = document.getElementById('ob-wrap');
      if (!wrap) return;
      var list = data.bookings || [];

      if (!list.length) {
        wrap.innerHTML = '<p style="padding:24px 20px;color:var(--gray-1)">まだ予約がありません。</p>';
        return;
      }

      var rows = list.map(function (b) {
        var dt = b.created ? new Date(b.created).toLocaleString('ja-JP') : '—';
        var statusColor = { '新規': 'var(--blue)', '確定': 'var(--green)', 'キャンセル': 'var(--red)' }[b.status] || 'var(--gray-1)';
        return '<tr>'
          + '<td style="font-weight:700;color:var(--blue);font-size:12px">' + esc(b.ref || '—') + '</td>'
          + '<td style="font-weight:600">' + esc(b.name || '—') + '</td>'
          + '<td>' + esc(b.email || '—') + '</td>'
          + '<td>' + esc(b.phone || '—') + '</td>'
          + '<td>' + esc(b.service || '—') + '</td>'
          + '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(b.from) + '">' + esc(b.from || '—') + '</td>'
          + '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(b.to) + '">' + esc(b.to || '—') + '</td>'
          + '<td>' + esc(b.date || '未定') + '</td>'
          + '<td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(b.items) + '">' + esc(b.items || '—') + '</td>'
          + '<td style="color:' + statusColor + ';font-weight:600">' + esc(b.status || '新規') + '</td>'
          + '<td style="font-size:12px;color:var(--gray-1)">' + dt + '</td>'
          + '</tr>';
      }).join('');

      wrap.innerHTML = '<div class="table-wrap"><table style="width:100%;border-collapse:collapse;font-size:13px">'
        + '<thead><tr style="border-bottom:2px solid var(--line)">'
        + ['受付番号', 'お名前', 'メール', '電話', 'サービス', '現住所', '引越し先', '希望日', '荷物', 'ステータス', '受付日時']
            .map(function (h) { return '<th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-1);white-space:nowrap">' + h + '</th>'; })
            .join('')
        + '</tr></thead>'
        + '<tbody>' + rows + '</tbody>'
        + '</table></div>';

      // Style data rows
      wrap.querySelectorAll('tbody tr').forEach(function (tr) {
        tr.style.borderBottom = '1px solid var(--line)';
        tr.querySelectorAll('td').forEach(function (td) { td.style.padding = '10px 10px'; });
      });
    })
    .catch(function (err) {
      var wrap = document.getElementById('ob-wrap');
      if (!wrap) return;
      var isGhPages = window.location.hostname.indexOf('github.io') !== -1;
      var isLocal   = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isGhPages) {
        wrap.innerHTML = '<div style="padding:24px 20px">'
          + '<p style="color:var(--orange,#f59e0b);font-weight:700;margin-bottom:8px">⚠ GitHub Pages では PHP が動作しません</p>'
          + '<p style="color:var(--gray-1);font-size:13px">このページは <strong>cPanel サーバー上</strong>（hellomovingjapan.com）でのみ機能します。<br>'
          + 'GitHub Pages はPHPをサポートしていないため、<code>save_booking.php</code> は実行できません。</p>'
          + '<p style="color:var(--gray-1);font-size:12px;margin-top:8px">ドメインをcPanelに接続後にご確認ください。</p>'
          + '</div>';
      } else if (isLocal) {
        wrap.innerHTML = '<div style="padding:24px 20px">'
          + '<p style="color:var(--orange,#f59e0b);font-weight:700;margin-bottom:8px">⚠ ローカル PHP サーバーが必要です</p>'
          + '<p style="color:var(--gray-1);font-size:13px">ローカルテストには XAMPP / WAMP を起動して <code>http://localhost/</code> でアクセスしてください。</p>'
          + '<small style="color:var(--gray-2)">' + String(err) + '</small>'
          + '</div>';
      } else {
        wrap.innerHTML = '<p style="padding:24px 20px;color:var(--red)">読み込みエラー。save_booking.php がサーバー上に存在するか確認してください。<br><small>' + String(err) + '</small></p>';
      }
    });
}

window.renderOverlayBookings = renderOverlayBookings;
