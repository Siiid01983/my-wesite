'use strict';

/* ════════════════════════════════════════════════════════
   HERO CONTENT MANAGER
   ════════════════════════════════════════════════════════ */
function _readHeroFromForm() {
  return {
    headline_ja:   document.getElementById('heroHdJa').value,
    headline_en:   document.getElementById('heroHdEn').value,
    sub_primary:   document.getElementById('heroSubP').value,
    sub_secondary: document.getElementById('heroSubS').value,
    cta_book_sup:  document.getElementById('heroCtaBookSup').value,
    cta_book_lbl:  document.getElementById('heroCtaBookLbl').value,
    cta_quote_sup: document.getElementById('heroCtaQuoteSup').value,
    cta_quote_lbl: document.getElementById('heroCtaQuoteLbl').value,
    cta_line:      document.getElementById('heroCtaLineInp').value,
    trust_badges:  Array.from(document.querySelectorAll('.hbadge-inp')).map(i => i.value).filter(v => v.trim()),
    bg_image:      document.getElementById('heroBgUrl').value.trim()
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
  document.getElementById('heroCtaQuoteSup').value = h.cta_quote_sup || '';
  document.getElementById('heroCtaQuoteLbl').value = h.cta_quote_lbl || '';
  document.getElementById('heroCtaLineInp').value  = h.cta_line      || '';
  document.getElementById('heroBgUrl').value       = h.bg_image      || '';
  _renderHeroBadgeList(h.trust_badges || []);
  _updateHeroBgThumb(h.bg_image || '');
  _updateHeroPrev(h);
  renderHeroHistory();
}

function renderHero() { _renderHeroUI(); }

function _syncHeroFromApi() {
  if (!Adapter.apiReady) return;
  _dpSync('hm_data', {key:'hm_hero'}, () => Adapter.syncHero(), 'view-hero', _renderHeroUI);
}

function _renderHeroBadgeList(badges) {
  const list = document.getElementById('heroBadgeList');
  if (!badges.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--gray-2);padding:4px 0">バッジがありません。「追加」で追加できます。</div>';
    return;
  }
  list.innerHTML = badges.map((b, i) =>
    `<div class="hbadge-row">
       <input class="hbadge-inp" value="${b.replace(/[<>"&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;','&':'&amp;'}[c]))}" oninput="liveHeroPreview()" placeholder="バッジテキスト" />
       <button class="btn btn-danger btn-sm btn-icon" onclick="removeHeroBadge(${i})" title="削除">
         <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
       </button>
     </div>`
  ).join('');
}

function addHeroBadge() {
  const badges = Array.from(document.querySelectorAll('.hbadge-inp')).map(i => i.value);
  badges.push('');
  _renderHeroBadgeList(badges);
  const inps = document.querySelectorAll('.hbadge-inp');
  if (inps.length) inps[inps.length - 1].focus();
}

function removeHeroBadge(idx) {
  const badges = Array.from(document.querySelectorAll('.hbadge-inp')).map(i => i.value);
  badges.splice(idx, 1);
  _renderHeroBadgeList(badges);
  liveHeroPreview();
}

function _updateHeroBgThumb(url) {
  const thumb = document.getElementById('heroBgThumb');
  const img   = document.getElementById('heroBgImg');
  if (url) { img.src = url; thumb.style.display = 'block'; }
  else      { thumb.style.display = 'none'; }
}

function clearHeroBg() {
  document.getElementById('heroBgUrl').value = '';
  _updateHeroBgThumb('');
  _updateHeroPrev(_readHeroFromForm());
}

function openHeroMediaPick() {
  const images = MediaLib.get('images');
  const grid   = document.getElementById('heroMediaPickGrid');
  const empty  = document.getElementById('heroMediaPickEmpty');
  if (!images.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    grid.innerHTML = images.map(img =>
      `<img class="hmpick-img" src="${img.url}" alt="${(img.name||'').replace(/"/g,'&quot;')}" onclick="selectHeroBgMedia('${img.url.replace(/'/g,'%27')}')" />`
    ).join('');
  }
  document.getElementById('heroMediaPick').classList.add('open');
}

function closeHeroMediaPick() {
  document.getElementById('heroMediaPick').classList.remove('open');
}

function selectHeroBgMedia(url) {
  document.getElementById('heroBgUrl').value = url;
  _updateHeroBgThumb(url);
  liveHeroPreview();
  closeHeroMediaPick();
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
  _updateHeroBgThumb(document.getElementById('heroBgUrl').value.trim());
}

function _updateHeroPrev(h) {
  const get = id => document.getElementById(id);
  get('prevHdJa').textContent     = h.headline_ja   || '（日本語見出し）';
  get('prevHdEn').textContent     = h.headline_en   || '';
  get('prevSubP').textContent     = h.sub_primary   || '';
  get('prevSubS').textContent     = h.sub_secondary || '';
  get('prevBookSup').textContent  = h.cta_book_sup  || '';
  get('prevBookLbl').textContent  = h.cta_book_lbl  || '';
  get('prevQuoteSup').textContent = h.cta_quote_sup || '';
  get('prevQuoteLbl').textContent = h.cta_quote_lbl || '';
  get('prevLineText').textContent = h.cta_line      || 'LINE';
  const badges = (h.trust_badges || []).filter(b => b.trim());
  get('prevBadges').innerHTML = badges.map(b =>
    `<span style="background:rgba(29,158,117,.25);color:#6ee7b7;border:1px solid rgba(29,158,117,.4);border-radius:20px;padding:3px 8px;font-size:9px;font-weight:600">${b}</span>`
  ).join('');
  const card = get('heroPrevCard');
  if (h.bg_image) {
    card.style.backgroundImage    = `linear-gradient(rgba(10,31,68,.75),rgba(10,31,68,.75)),url('${h.bg_image}')`;
    card.style.backgroundSize     = 'cover';
    card.style.backgroundPosition = 'center';
  } else {
    card.style.backgroundImage = card.style.backgroundSize = card.style.backgroundPosition = '';
  }
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
