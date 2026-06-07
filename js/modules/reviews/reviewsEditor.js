'use strict';

/* ════════════════════════════════════════════════════════
   REVIEW MANAGEMENT
   ════════════════════════════════════════════════════════ */
let _revId = null, _revRating = 5, _revTab = 'pending';

const _starH = n =>
  `<span style="color:#f59e0b">${'★'.repeat(n)}</span><span style="color:var(--gray-2)">${'★'.repeat(5-n)}</span>`;

function switchRevTab(tab) {
  _revTab = tab;
  ['pending','approved','rejected'].forEach(t => {
    document.getElementById('revTab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
  });
  renderReviews();
}

function _renderReviewsUI() {
  const meta = Adapter.getRevMeta();
  document.getElementById('revMetaEyebrow').value   = meta.eyebrow   || '';
  document.getElementById('revMetaTitle').value     = meta.title     || '';
  document.getElementById('revMetaLead').value      = meta.lead      || '';
  document.getElementById('revMetaGmbScore').value  = meta.gmb_score || '';
  document.getElementById('revMetaGmbCount').value  = meta.gmb_count || '';

  const all       = Adapter.getReviews();
  const pending   = all.filter(r => r.status === 'pending');
  const approved  = all.filter(r => r.status === 'approved');
  const rejected  = all.filter(r => r.status === 'rejected');
  const published = approved.filter(r => r.published);

  document.getElementById('revCntPending').textContent  = pending.length  || '';
  document.getElementById('revCntApproved').textContent = approved.length || '';
  document.getElementById('revCntRejected').textContent = rejected.length || '';

  document.getElementById('revStatsBar').innerHTML =
    `<span>保留中 <strong class="${pending.length?'warn':''}">${pending.length}</strong></span>` +
    `<span>承認済み <strong>${approved.length}</strong></span>` +
    `<span>公開中 <strong style="color:var(--green)">${published.length}</strong></span>` +
    `<span>却下 <strong>${rejected.length}</strong></span>`;

  const list = _revTab==='pending' ? pending : _revTab==='approved' ? approved : rejected;

  if (!list.length) {
    document.getElementById('reviewsWrap').innerHTML = emptyHTML(
      _revTab==='pending' ? '保留中のレビューはありません' :
      _revTab==='approved' ? '承認済みのレビューはありません' : '却下されたレビューはありません'
    );
    liveRevPreview();
    renderRevHistory();
    return;
  }

  const rows = list.map(r => {
    const srcBadge = r.source === 'customer'
      ? `<span class="rev-st rev-st-pending" style="font-size:10px;padding:2px 7px">顧客投稿</span>`
      : `<span class="rev-st rev-st-approved" style="font-size:10px;padding:2px 7px;background:rgba(37,99,235,.08);color:var(--blue);border-color:rgba(37,99,235,.2)">管理者</span>`;
    const pubBadge = r.status==='approved'
      ? (r.published
          ? `<span class="rev-st rev-st-approved" style="font-size:10px;padding:2px 7px"><span class="rev-pub-dot"></span>公開中</span>`
          : `<span class="rev-st rev-st-pending" style="font-size:10px;padding:2px 7px">非公開</span>`)
      : '';

    let actions = '';
    if (_revTab === 'pending') {
      actions = `
        <button class="btn btn-green btn-sm" onclick="approveRev('${r.id}')">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>承認
        </button>
        <button class="btn btn-ghost btn-sm" style="border-color:rgba(239,68,68,.3);color:var(--red)" onclick="rejectRev('${r.id}')">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>却下
        </button>`;
    } else if (_revTab === 'approved') {
      actions = `
        <button class="btn ${r.published?'btn-ghost':'btn-primary'} btn-sm" onclick="publishRev('${r.id}',${!r.published})">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="${r.published?'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z':'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'}"/></svg>${r.published?'非公開にする':'公開する'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openRevEdit('${r.id}')">編集</button>
        <button class="btn btn-ghost btn-sm" style="border-color:rgba(239,68,68,.3);color:var(--red)" onclick="rejectRev('${r.id}')">却下</button>`;
    } else {
      actions = `<button class="btn btn-ghost btn-sm" onclick="approveRev('${r.id}')">承認に戻す</button>`;
    }
    actions += `
      <button class="btn btn-ghost btn-sm btn-icon" onclick="downloadPDFReview('${r.id}')" title="PDFダウンロード">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
      </button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="printReview('${r.id}')" title="印刷">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
      </button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="delRev('${r.id}')" title="削除">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>`;

    return `<tr>
      <td>
        <strong>${esc(r.name||'—')}</strong><br>
        <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap">${srcBadge}${pubBadge}</div>
      </td>
      <td style="font-size:14px;letter-spacing:1px;white-space:nowrap">${_starH(r.rating||5)}</td>
      <td class="td-truncate" style="max-width:180px">${esc(r.headline || r.text||'—')}</td>
      <td class="td-truncate td-sm" style="max-width:140px">${esc(r.text||'—')}</td>
      <td class="td-mono td-sm">${fmtDT(r.createdAt)}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">${actions}</div></td>
    </tr>`;
  }).join('');

  document.getElementById('reviewsWrap').innerHTML = `
    <table><thead><tr>
      <th>お客様名</th><th>評価</th><th>見出し</th><th>本文</th><th>投稿日時</th><th>操作</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  liveRevPreview();
  renderRevHistory();
}

function renderReviews() { _renderReviewsUI(); }

function _syncReviewsFromSupabase() {
  if (!Adapter.supabaseReady) return;
  _dpSync('reviews', null, () => Adapter.syncReviews(), 'view-reviews', _renderReviewsUI);
}

function approveRev(id) {
  Adapter.updateReview(id, { status:'approved', published:false });
  toast('承認しました');
  renderReviews(); renderDash();
}

function rejectRev(id) {
  Adapter.updateReview(id, { status:'rejected', published:false });
  toast('却下しました');
  renderReviews(); renderDash();
}

function publishRev(id, pub) {
  Adapter.updateReview(id, { published: pub });
  toast(pub ? '公開しました' : '非公開にしました');
  renderReviews();
}

function openRevModal() {
  _revId = null; _revRating = 5;
  document.getElementById('revModalTitle').textContent = 'レビューを追加（管理者）';
  ['rName','rText','rBookingId','rHeadline','rService','rDateLabel','rLocation'].forEach(id => {
    document.getElementById(id).value = '';
  });
  setRevStars(5);
  document.getElementById('revModal').classList.add('open');
}

function openRevEdit(id) {
  const r = Adapter.getReviews().find(r => r.id === id); if (!r) return;
  _revId = id; _revRating = r.rating || 5;
  document.getElementById('revModalTitle').textContent  = 'レビューを編集';
  document.getElementById('rName').value      = r.name       || '';
  document.getElementById('rText').value      = r.text       || '';
  document.getElementById('rBookingId').value = r.bookingId  || '';
  document.getElementById('rHeadline').value  = r.headline   || '';
  document.getElementById('rService').value   = r.service    || '';
  document.getElementById('rDateLabel').value = r.date_label || '';
  document.getElementById('rLocation').value  = r.location   || '';
  setRevStars(r.rating || 5);
  document.getElementById('revModal').classList.add('open');
}

function closeRevModal() { document.getElementById('revModal').classList.remove('open'); }

function setRevStars(n) {
  _revRating = n;
  document.querySelectorAll('#revModalStars .star-btn').forEach((btn, i) => btn.classList.toggle('on', i < n));
  updateRevPreview();
}

function updateRevPreview() {
  const name      = document.getElementById('rName').value.trim()     || 'お客様名';
  const text      = document.getElementById('rText').value.trim()     || 'レビュー内容がここに表示されます...';
  const headline  = document.getElementById('rHeadline').value.trim() || text.substring(0, 28) + (text.length > 28 ? '…' : '');
  const service   = document.getElementById('rService').value.trim();
  const dateLabel = document.getElementById('rDateLabel').value.trim();
  const location  = document.getElementById('rLocation').value.trim();
  const stars = '★'.repeat(_revRating) + '★'.repeat(5 - _revRating);
  const metaParts = [service, dateLabel ? 'ご利用日：' + dateLabel : ''].filter(Boolean).join(' • ');
  document.getElementById('previewStars').textContent     = stars;
  document.getElementById('revModalMetaLine').textContent = metaParts;
  document.getElementById('previewHeadline').textContent  = headline;
  document.getElementById('previewText').textContent      = text;
  document.getElementById('previewName').textContent      = '— ' + name + (location ? ' / ' + location : '');
}

function saveReview() {
  const name       = document.getElementById('rName').value.trim();
  const text       = document.getElementById('rText').value.trim();
  if (!name) { alert('お客様名を入力してください'); return; }
  if (!text) { alert('レビュー内容を入力してください'); return; }
  const existing = _revId ? Adapter.getReviews().find(r => r.id === _revId) : null;
  const r = {
    id:         _revId || ('REV-' + Date.now()),
    name,       rating:     _revRating,  text,
    headline:   document.getElementById('rHeadline').value.trim(),
    service:    document.getElementById('rService').value.trim(),
    date_label: document.getElementById('rDateLabel').value.trim(),
    location:   document.getElementById('rLocation').value.trim(),
    bookingId:  document.getElementById('rBookingId').value.trim() || null,
    status: 'approved', published: existing?.published || false, source: 'admin',
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  if (_revId) { Adapter.updateReview(_revId, r); toast('レビューを更新しました'); }
  else { Adapter.addReview(r); toast('レビューを追加しました（承認済み）'); }
  closeRevModal();
  _revTab = 'approved';
  renderReviews(); renderDash();
}

function delRev(id) {
  if (!confirm('このレビューを削除しますか？')) return;
  Adapter.deleteReview(id);
  toast('削除しました');
  renderReviews(); renderDash();
}

function printReview(id) {
  const r = Adapter.getReviews().find(r => r.id === id); if (!r) return;
  const e = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const stars     = r.rating || 5;
  const starsFull = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  const STATUS_LABEL = { pending:'保留中', approved:'承認済み', rejected:'却下' };
  const STATUS_COLOR = { pending:'#b45309', approved:'#059669', rejected:'#b91c1c' };
  const STATUS_BG    = { pending:'#fffbeb', approved:'#f0fdf4', rejected:'#fef2f2' };
  const st = r.status || 'pending';

  const meta = (label, value) => value
    ? `<tr>
        <td style="width:130px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;padding:8px 14px;border-bottom:1px solid #f0f2f5;vertical-align:top;white-space:nowrap">${e(label)}</td>
        <td style="font-size:12px;color:#0b0f17;padding:8px 14px;border-bottom:1px solid #f0f2f5">${e(value)}</td>
       </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>レビュー確認 — ${e(r.name||'')}</title>
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
    <div style="font-size:18px;font-weight:700;color:#0a1f44">レビュー確認</div>
    <div style="font-size:11px;color:#6b7280;margin-top:3px">投稿日時: ${e(fmtDT(r.createdAt))}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:2px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="display:inline-flex;align-items:center;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;background:${STATUS_BG[st]};color:${STATUS_COLOR[st]};border:1px solid ${STATUS_COLOR[st]}33;margin-bottom:20px">
  ${e(STATUS_LABEL[st]||st)}
</div>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:24px;background:#fafafa">
  <div style="font-size:22px;letter-spacing:2px;color:#f59e0b;margin-bottom:8px">${starsFull}</div>
  ${r.headline ? `<div style="font-size:16px;font-weight:700;color:#0b0f17;margin-bottom:10px;line-height:1.4">${e(r.headline)}</div>` : ''}
  <div style="font-size:13px;color:#374151;line-height:1.75;font-style:italic;margin-bottom:14px">"${e(r.text||'—')}"</div>
  <div style="font-size:12px;font-weight:600;color:#6b7280">— ${e(r.name||'匿名')}${r.location ? `、${e(r.location)}` : ''}</div>
</div>

<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:28px">
  ${meta('サービス',   r.service)}
  ${meta('引越し時期', r.date_label)}
  ${meta('投稿元',     r.source === 'customer' ? '顧客フォーム' : '管理者登録')}
  ${meta('公開状態',   r.status === 'approved' ? (r.published ? '公開中' : '非公開') : '—')}
  ${meta('関連予約ID', r.bookingId)}
  ${meta('投稿日時',   fmtDT(r.createdAt))}
</table>

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7">
    <div>Hello Moving — 引越し専門サービス</div>
    <div>このドキュメントは管理システムから自動生成されました</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7">
    <div style="font-weight:600;color:#0b0f17">Hello Moving</div>
    <div>info@hello-moving.com</div>
  </div>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=780,height=680');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}

function copyRevFormLink() {
  const link = window.location.href.split('#')[0] + '#review';
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(() => toast('投稿リンクをコピーしました'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = link; ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('投稿リンクをコピーしました'); } catch(e) {}
    document.body.removeChild(ta);
  }
}

function liveRevPreview() {
  const get = id => document.getElementById(id);
  get('revPrevEyebrow').textContent   = get('revMetaEyebrow').value;
  get('revPrevTitle').textContent     = get('revMetaTitle').value;
  get('revPrevLead').textContent      = get('revMetaLead').value;
  get('revPrevGmbScore').textContent  = get('revMetaGmbScore').value;
  get('revPrevGmbCount').textContent  = get('revMetaGmbCount').value;
  const published = Adapter.getReviews().filter(r => r.status === 'approved' && r.published);
  get('revPrevCards').innerHTML = published.length
    ? published.slice(0, 4).map(r => {
        const hl  = r.headline || r.text.substring(0, 28) + (r.text.length > 28 ? '…' : '');
        const meta = [r.service, r.date_label ? 'ご利用日：' + r.date_label : ''].filter(Boolean).join(' • ');
        const avtr = (r.name || '?').charAt(0);
        const footer = r.name + (r.location ? ' — ' + r.location : '');
        return `<div class="rev-prev-rcard">
          <div class="rev-prev-stars">${'★'.repeat(r.rating||5)}</div>
          ${meta ? `<div style="font-size:9px;color:var(--gray-2);margin-bottom:4px">${esc(meta)}</div>` : ''}
          <div class="rev-prev-headline">${esc(hl)}</div>
          <div class="rev-prev-text">${esc(r.text)}</div>
          <div class="rev-prev-footer">${esc(footer)}</div>
        </div>`;
      }).join('')
    : '<div style="font-size:11px;color:var(--gray-2);padding:8px 0">公開中のレビューがありません。承認済みのレビューを「公開する」に設定すると表示されます。</div>';
}

function saveReviewsAll() {
  const meta = {
    eyebrow:   document.getElementById('revMetaEyebrow').value.trim(),
    title:     document.getElementById('revMetaTitle').value.trim(),
    lead:      document.getElementById('revMetaLead').value.trim(),
    gmb_score: document.getElementById('revMetaGmbScore').value.trim(),
    gmb_count: document.getElementById('revMetaGmbCount').value.trim()
  };
  Adapter.pushRevHistory({ meta: Adapter.getRevMeta() });
  Adapter.saveRevMeta(meta);
  renderRevHistory();
  const ind = document.getElementById('revSaveInd');
  ind.style.opacity = '1';
  clearTimeout(ind._t);
  ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
}

function renderRevHistory() {
  const hist = Adapter.getRevHistory();
  const el   = document.getElementById('revHistoryList');
  if (!hist.length) {
    el.innerHTML = '<div class="empty" style="padding:16px 0"><p>まだバージョンがありません</p></div>';
    return;
  }
  el.innerHTML = hist.map((entry, i) => {
    const d  = new Date(entry.ts);
    const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const snap = (entry.meta && entry.meta.title) || '（タイトルなし）';
    return `<div class="hhist-item">
      <div class="hhist-meta">
        <div class="hhist-time">${ts}</div>
        <div class="hhist-snap">${esc(snap)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreRevVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreRevVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getRevHistory();
  if (!hist[idx]) return;
  Adapter.pushRevHistory({ meta: Adapter.getRevMeta() });
  Adapter.saveRevMeta(hist[idx].meta);
  renderReviews();
  toast('バージョンを復元しました');
}
