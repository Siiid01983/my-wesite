/* ══════════════════════════════════════════════════════════════
   Overlay Bookings — reads all bookings from Supabase via Adapter
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

  Promise.resolve()
    .then(function () {
      if (window.Adapter && typeof Adapter.getBookings === 'function') {
        return Adapter.getBookings();
      }
      throw new Error('Adapter not available — check script loading order');
    })
    .then(function (list) {
      var wrap = document.getElementById('ob-wrap');
      if (!wrap) return;

      if (!list || !list.length) {
        wrap.innerHTML = '<p style="padding:24px 20px;color:var(--gray-1)">まだ予約がありません。</p>';
        return;
      }

      var rows = list.map(function (b) {
        var dt = b.createdAt ? new Date(b.createdAt).toLocaleString('ja-JP') : '—';
        var statusColor = { '新規': 'var(--blue)', '確定': 'var(--green)', 'キャンセル': 'var(--red)', '確認中': 'var(--orange,#f59e0b)', '完了': 'var(--gray-1)' }[b.status] || 'var(--gray-1)';
        return '<tr>'
          + '<td style="font-weight:700;color:var(--blue);font-size:12px">' + esc(b.id || '—') + '</td>'
          + '<td style="font-weight:600">' + esc(b.name || '—') + '</td>'
          + '<td>' + esc(b.email || '—') + '</td>'
          + '<td>' + esc(b.phone || '—') + '</td>'
          + '<td>' + esc(b.service || '—') + '</td>'
          + '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(b.fromAddr || '') + '">' + esc(b.fromAddr || '—') + '</td>'
          + '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(b.toAddr || '') + '">' + esc(b.toAddr || '—') + '</td>'
          + '<td>' + esc(b.date || '未定') + '</td>'
          + '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(b.notes || '') + '">' + esc(b.notes || '—') + '</td>'
          + '<td style="color:' + statusColor + ';font-weight:600">' + esc(b.status || '新規') + '</td>'
          + '<td style="font-size:12px;color:var(--gray-1)">' + dt + '</td>'
          + '</tr>';
      }).join('');

      wrap.innerHTML = '<div class="table-wrap"><table style="width:100%;border-collapse:collapse;font-size:13px">'
        + '<thead><tr style="border-bottom:2px solid var(--line)">'
        + ['受付番号', 'お名前', 'メール', '電話', 'サービス', '現住所', '引越し先', '希望日', '荷物/備考', 'ステータス', '受付日時']
            .map(function (h) { return '<th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-1);white-space:nowrap">' + h + '</th>'; })
            .join('')
        + '</tr></thead>'
        + '<tbody>' + rows + '</tbody>'
        + '</table></div>';

      wrap.querySelectorAll('tbody tr').forEach(function (tr) {
        tr.style.borderBottom = '1px solid var(--line)';
        tr.querySelectorAll('td').forEach(function (td) { td.style.padding = '10px 10px'; });
      });
    })
    .catch(function (err) {
      var wrap = document.getElementById('ob-wrap');
      if (wrap) {
        wrap.innerHTML = '<p style="padding:24px 20px;color:var(--red)">読み込みエラー: ' + esc(String(err)) + '</p>';
      }
      console.error('[OverlayBookings]', err);
    });
}

window.renderOverlayBookings = renderOverlayBookings;
