'use strict';

/* ════════════════════════════════════════════════════════
   FAQ MANAGEMENT
   ════════════════════════════════════════════════════════ */
let _faqId = null;

function _renderFaqUI() {
  const meta = Adapter.getFaqMeta();
  document.getElementById('faqMetaEyebrow').value = meta.eyebrow || '';
  document.getElementById('faqMetaTitle').value   = meta.title   || '';
  document.getElementById('faqMetaLead').value    = meta.lead    || '';
  const items = Adapter.getFaq();
  if (!items.length) {
    document.getElementById('faqListWrap').innerHTML = emptyHTML('FAQがありません');
  } else {
    const rows = items.map((f, i) => `<tr>
      <td style="text-align:center;font-weight:700;color:var(--gray-2);width:36px">${i+1}</td>
      <td class="td-truncate" style="max-width:240px"><strong>${esc(f.question||'—')}</strong></td>
      <td class="td-truncate td-sm" style="max-width:240px">${esc(f.answer||'—')}</td>
      <td>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="moveFaqItem('${esc(f.id)}',-1)" ${i===0?'disabled':''} title="上へ">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="moveFaqItem('${esc(f.id)}',1)" ${i===items.length-1?'disabled':''} title="下へ">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openFaqEdit('${esc(f.id)}')">編集</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="delFaqItem('${esc(f.id)}')" title="削除">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
    document.getElementById('faqListWrap').innerHTML = `
      <table><thead><tr>
        <th style="width:36px">#</th><th>質問</th><th>回答</th><th>操作</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }
  liveFaqPreview();
  renderFaqHistory();
}

function renderFaq() { _renderFaqUI(); }

function _syncFaqFromSupabase() {
  if (!Adapter.supabaseReady) return;
  _dpSync('hm_data', {key:'hm_faq'}, () => Adapter.syncFaq(), 'view-faq', _renderFaqUI);
}

function liveFaqPreview() {
  const get = id => document.getElementById(id);
  get('faqPrevEyebrow').textContent = get('faqMetaEyebrow').value;
  get('faqPrevTitle').textContent   = get('faqMetaTitle').value;
  get('faqPrevLead').textContent    = get('faqMetaLead').value;
  const items = Adapter.getFaq();
  get('faqPrevItems').innerHTML = items.length
    ? items.map(f =>
        `<div class="faq-prev-item">
           <div class="faq-prev-q">${esc(f.question||'—')}</div>
           <div class="faq-prev-a">${esc(f.answer||'')}</div>
         </div>`
      ).join('')
    : '<div style="font-size:11px;color:var(--gray-2);padding:8px 0">FAQがありません。</div>';
}

function moveFaqItem(id, dir) {
  const items = Adapter.getFaq();
  const idx   = items.findIndex(f => f.id === id);
  if (idx < 0) return;
  const next = idx + dir;
  if (next < 0 || next >= items.length) return;
  [items[idx], items[next]] = [items[next], items[idx]];
  Adapter.saveFaq(items);
  renderFaq();
}

function openFaqModal() {
  _faqId = null;
  document.getElementById('faqModalTitle').textContent = 'FAQ を追加';
  document.getElementById('faqQ').value = '';
  document.getElementById('faqA').value = '';
  updateFaqModalPrev();
  document.getElementById('faqModal').classList.add('open');
}

function openFaqEdit(id) {
  const f = Adapter.getFaq().find(f => f.id === id); if (!f) return;
  _faqId = id;
  document.getElementById('faqModalTitle').textContent = 'FAQ を編集';
  document.getElementById('faqQ').value = f.question || '';
  document.getElementById('faqA').value = f.answer   || '';
  updateFaqModalPrev();
  document.getElementById('faqModal').classList.add('open');
}

function closeFaqModal() { document.getElementById('faqModal').classList.remove('open'); }

function updateFaqModalPrev() {
  document.getElementById('faqPrevModalQ').textContent = document.getElementById('faqQ').value || '（質問）';
  document.getElementById('faqPrevModalA').textContent = document.getElementById('faqA').value || '';
}

function saveFaqItem() {
  const question = document.getElementById('faqQ').value.trim();
  const answer   = document.getElementById('faqA').value.trim();
  if (!question) { alert('質問を入力してください'); return; }
  if (!answer)   { alert('回答を入力してください'); return; }
  const items = Adapter.getFaq();
  if (_faqId) {
    const idx = items.findIndex(f => f.id === _faqId);
    if (idx >= 0) items[idx] = { ...items[idx], question, answer };
    Adapter.saveFaq(items);
    toast('FAQを更新しました');
  } else {
    items.push({ id: 'FAQ-' + Date.now(), question, answer });
    Adapter.saveFaq(items);
    toast('FAQを追加しました');
  }
  closeFaqModal();
  renderFaq();
}

function delFaqItem(id) {
  if (!confirm('このFAQを削除しますか？')) return;
  Adapter.saveFaq(Adapter.getFaq().filter(f => f.id !== id));
  toast('削除しました');
  renderFaq();
}

function saveFaqAll() {
  const meta = {
    eyebrow: document.getElementById('faqMetaEyebrow').value.trim(),
    title:   document.getElementById('faqMetaTitle').value.trim(),
    lead:    document.getElementById('faqMetaLead').value.trim()
  };
  Adapter.pushFaqHistory({ meta: Adapter.getFaqMeta(), items: Adapter.getFaq() });
  Adapter.saveFaqMeta(meta);
  renderFaqHistory();
  const ind = document.getElementById('faqSaveInd');
  ind.style.opacity = '1';
  clearTimeout(ind._t);
  ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
}

function renderFaqHistory() {
  const hist = Adapter.getFaqHistory();
  const el   = document.getElementById('faqHistoryList');
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
        <div class="hhist-snap">${esc(snap)} — ${(entry.items||[]).length}件</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreFaqVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreFaqVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getFaqHistory();
  if (!hist[idx]) return;
  Adapter.pushFaqHistory({ meta: Adapter.getFaqMeta(), items: Adapter.getFaq() });
  Adapter.saveFaqMeta(hist[idx].meta);
  Adapter.saveFaq(hist[idx].items);
  renderFaq();
  toast('バージョンを復元しました');
}

/* ── Public review form ── */
let _pubRating = 5, _pubBooking = null;

function showPublicReviewForm() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminApp').style.display   = 'none';
  document.getElementById('reviewPublicForm').style.display = 'flex';
  document.getElementById('pubBookingId').addEventListener('keydown', e => {
    if (e.key === 'Enter') verifyPubBooking();
  });
}

function setPubStars(n) {
  _pubRating = n;
  document.querySelectorAll('.pub-star-btn').forEach((btn, i) => btn.classList.toggle('on', i < n));
}

function verifyPubBooking() {
  const bkId = document.getElementById('pubBookingId').value.trim().toUpperCase();
  const hint  = document.getElementById('pubBookingHint');
  const btn   = document.getElementById('pubVerifyBtn');

  hint.style.display = 'none';
  document.getElementById('pubBookingId').classList.remove('has-error');

  if (!bkId) {
    document.getElementById('pubBookingId').classList.add('has-error');
    hint.textContent = '予約IDを入力してください';
    hint.style.display = 'block'; return;
  }

  btn.disabled = true; btn.classList.add('loading');
  btn.querySelector('.login-btn-text').textContent = '確認中...';

  setTimeout(() => {
    btn.disabled = false; btn.classList.remove('loading');
    btn.querySelector('.login-btn-text').textContent = '予約を確認する';

    const booking = Adapter.getBookings().find(b => b.id.toUpperCase() === bkId);
    if (!booking) {
      document.getElementById('pubBookingId').classList.add('has-error');
      hint.textContent = '予約IDが見つかりません。正しいIDをご確認ください。';
      hint.style.display = 'block'; return;
    }
    if (booking.status !== '完了') {
      document.getElementById('pubBookingId').classList.add('has-error');
      hint.textContent = 'サービス完了後にレビューをご投稿いただけます。';
      hint.style.display = 'block'; return;
    }
    const already = Adapter.getReviews().find(r => r.bookingId === booking.id);
    if (already) {
      document.getElementById('pubBookingId').classList.add('has-error');
      hint.textContent = 'この予約のレビューは既に投稿されています。';
      hint.style.display = 'block'; return;
    }

    _pubBooking = booking;
    document.getElementById('pubVerifiedName').textContent = booking.name || '';
    document.getElementById('pubVerifiedSvc').textContent  = booking.service + ' — ' + (booking.date||'');
    document.getElementById('pubName').value = booking.name || '';
    document.getElementById('pubStep1').style.display = 'none';
    document.getElementById('pubStep2').style.display = 'block';
  }, 600);
}

function submitPubReview() {
  const name = document.getElementById('pubName').value.trim();
  const text = document.getElementById('pubText').value.trim();
  const textHint = document.getElementById('pubTextHint');
  textHint.style.display = 'none';
  if (!text) { textHint.style.display = 'block'; return; }

  const btn = document.getElementById('pubSubmitBtn');
  btn.disabled = true; btn.classList.add('loading');
  btn.querySelector('.login-btn-text').textContent = '送信中...';

  setTimeout(() => {
    Adapter.addReview({
      id: 'REV-' + Date.now(),
      name: name || (_pubBooking?.name||'匿名'),
      rating: _pubRating, text,
      bookingId: _pubBooking?.id || null,
      status: 'pending', published: false, source: 'customer',
      createdAt: new Date().toISOString()
    });
    document.getElementById('pubStep2').style.display = 'none';
    document.getElementById('pubSuccess').style.display = 'block';
    btn.disabled = false; btn.classList.remove('loading');
  }, 700);
}
