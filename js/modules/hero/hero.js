'use strict';

/* ════════════════════════════════════════════════════════
   HERO CONTENT MANAGER
   ════════════════════════════════════════════════════════ */
function _readHeroFromForm() {
  /* Quote CTA, trust badges and background image were removed from the public
     hero by the booking-architecture lock (single CTA, static trust strip), so
     their editor fields were dropped — they are no longer read/persisted here. */
  return {
    headline_ja:   document.getElementById('heroHdJa').value,
    headline_en:   document.getElementById('heroHdEn').value,
    sub_primary:   document.getElementById('heroSubP').value,
    sub_secondary: document.getElementById('heroSubS').value,
    cta_book_sup:  document.getElementById('heroCtaBookSup').value,
    cta_book_lbl:  document.getElementById('heroCtaBookLbl').value,
    cta_line:      document.getElementById('heroCtaLineInp').value
  };
}

function _renderHeroUI() {
  const h = Adapter.getHero();
  document.getElementById('heroHdJa').value        = h.headline_ja   || '';
  document.getElementById('heroHdEn').value        = h.headline_en   || '';
  document.getElementById('heroSubP').value        = h.sub_primary   || '';
  document.getElementById('heroSubS').value        = h.sub_secondary || '';
  document.getElementById('heroCtaBookSup').value  = h.cta_book_sup  || '';
  document.getElementById('heroCtaBookLbl').value  = h.cta_book_lbl  || '';
  document.getElementById('heroCtaLineInp').value  = h.cta_line      || '';
  _updateHeroPrev(h);
  renderHeroHistory();
}

function renderHero() { _renderHeroUI(); }

function _syncHeroFromApi() {
  if (!Adapter.apiReady) return;
  _dpSync('hm_data', {key:'hm_hero'}, () => Adapter.syncHero(), 'view-hero', _renderHeroUI);
}

function saveHero() {
  const h = _readHeroFromForm();
  Adapter.pushHeroHistory(Adapter.getHero());
  Adapter.saveHero(h);
  _updateHeroPrev(h);
  renderHeroHistory();
  const ind = document.getElementById('heroSaveInd');
  ind.style.opacity = '1';
  clearTimeout(ind._t);
  ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
}

function liveHeroPreview() {
  _updateHeroPrev(_readHeroFromForm());
}

function _updateHeroPrev(h) {
  const get = id => document.getElementById(id);
  get('prevHdJa').textContent     = h.headline_ja   || '（日本語見出し）';
  get('prevHdEn').textContent     = h.headline_en   || '';
  get('prevSubP').textContent     = h.sub_primary   || '';
  get('prevSubS').textContent     = h.sub_secondary || '';
  get('prevBookSup').textContent  = h.cta_book_sup  || '';
  get('prevBookLbl').textContent  = h.cta_book_lbl  || '';
  get('prevLineText').textContent = h.cta_line      || 'LINE';
}

function renderHeroHistory() {
  const hist = Adapter.getHeroHistory();
  const el   = document.getElementById('heroHistoryList');
  if (!hist.length) {
    el.innerHTML = '<div class="empty" style="padding:16px 0"><p>まだバージョンがありません</p></div>';
    return;
  }
  el.innerHTML = hist.map((entry, i) => {
    const d = new Date(entry.ts);
    const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const snap = (entry.data.headline_ja || entry.data.headline || '（見出しなし）');
    return `<div class="hhist-item">
      <div class="hhist-meta">
        <div class="hhist-time">${ts}</div>
        <div class="hhist-snap">${snap}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreHeroVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreHeroVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getHeroHistory();
  if (!hist[idx]) return;
  Adapter.pushHeroHistory(Adapter.getHero());
  Adapter.saveHero(hist[idx].data);
  renderHero();
  toast('バージョンを復元しました');
}
