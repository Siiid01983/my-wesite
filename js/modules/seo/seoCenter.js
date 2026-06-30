'use strict';

/* ════════════════════════════════════════════════════════
   SEO CENTER
   Per-page title, meta, OG, Twitter Card, canonical, schema
   Audit score with per-field hints
   ════════════════════════════════════════════════════════ */

const SEO_PAGES = [
  { id: 'home',     label: 'ホームページ',    url: '/' },
  { id: 'services', label: 'サービスページ',  url: '/services' },
  { id: 'booking',  label: '予約ページ',      url: '/booking' },
  { id: 'reviews',  label: 'レビューページ',  url: '/reviews' },
  { id: 'about',    label: '会社概要',        url: '/about' },
];

const _SEO_DATA_KEY   = 'hm_seo_data';
const _SEO_CUSTOM_KEY = 'hm_seo_custom';

const SeoStore = {
  get() { try { return JSON.parse(localStorage.getItem(_SEO_DATA_KEY) || '{}'); } catch { return {}; } },
  save(data) { try { localStorage.setItem(_SEO_DATA_KEY, JSON.stringify(data)); return true; } catch { return false; } },
  getPage(id) { return this.get()[id] || {}; },
  savePage(id, data) { const all = this.get(); all[id] = data; return this.save(all); },
  deletePage(id) { const all = this.get(); delete all[id]; return this.save(all); },
  getCustomPages() { try { return JSON.parse(localStorage.getItem(_SEO_CUSTOM_KEY) || '[]'); } catch { return []; } },
  saveCustomPages(pages) { try { localStorage.setItem(_SEO_CUSTOM_KEY, JSON.stringify(pages)); } catch {} },
};

/* ── Constants reused from security (ring) ── */
const _SEO_RING_R = 32;
const _SEO_RING_C = +(2 * Math.PI * _SEO_RING_R).toFixed(1);

/* ── State ── */
let _seoPage = 'home';

/* ════ Main render ════ */
function renderSEO() {
  const el = document.getElementById('seoContent');
  if (!el) return;
  const allPages = [...SEO_PAGES, ...SeoStore.getCustomPages()];
  const allData  = SeoStore.get();
  const scores   = allPages.map(p => _seoScore(allData[p.id] || {}));
  const avg      = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
  if (!allPages.find(p => p.id === _seoPage)) _seoPage = 'home';
  el.innerHTML =
    _renderSEOAudit(avg, allPages, allData) +
    _renderSEOPageTabs(allPages) +
    _renderSEOEditor(_seoPage, allPages, allData);
}

/* ════ Audit panel ════ */
function _renderSEOAudit(avg, allPages, allData) {
  const color  = avg >= 80 ? 'var(--green)' : avg >= 50 ? 'var(--yellow)' : 'var(--red)';
  const offset = _SEO_RING_C * (1 - avg / 100);
  const ring   = `<div class="sec-ring-wrap">
    <svg viewBox="0 0 80 80" width="72" height="72">
      <circle cx="40" cy="40" r="${_SEO_RING_R}" fill="none" stroke="var(--line)" stroke-width="7"/>
      <circle cx="40" cy="40" r="${_SEO_RING_R}" fill="none" stroke="${color}" stroke-width="7"
        stroke-dasharray="${_SEO_RING_C}" stroke-dashoffset="${offset.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 40 40)" style="transition:stroke-dashoffset .5s ease"/>
    </svg>
    <div class="sec-ring-num" style="color:${color}">${avg}</div>
  </div>`;

  const bars = allPages.map(p => {
    const s  = _seoScore(allData[p.id] || {});
    const c  = s >= 80 ? 'var(--green)' : s >= 50 ? 'var(--yellow)' : 'var(--red)';
    const ac = _seoPage === p.id ? 'font-weight:600;color:var(--ink)' : 'color:var(--gray-1)';
    return `<div class="seo-page-score" onclick="selectSEOPage('${p.id}')">
      <div style="font-size:12px;${ac};min-width:90px">${esc(p.label)}</div>
      <div class="seo-bar-track"><div style="width:${s}%;background:${c};height:100%;border-radius:2px;transition:width .4s"></div></div>
      <div style="font-size:12px;font-weight:600;color:${c};min-width:26px;text-align:right">${s}</div>
    </div>`;
  }).join('');

  return `<div class="panel sec-score-panel" style="margin-bottom:16px">
    <div class="panel-head"><span class="panel-title">SEO 監査スコア</span></div>
    <div class="panel-body" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
      ${ring}
      <div style="flex:1;min-width:240px">
        <div style="font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:10px">全 ${allPages.length} ページ平均スコア</div>
        <div style="display:flex;flex-direction:column;gap:7px">${bars}</div>
      </div>
    </div>
  </div>`;
}

/* ════ Page tabs ════ */
function _renderSEOPageTabs(allPages) {
  const tabs = allPages.map(p =>
    `<button class="media-tab${_seoPage === p.id ? ' active' : ''}" onclick="selectSEOPage('${p.id}')" style="font-size:12px;padding:8px 14px">${esc(p.label)}</button>`
  ).join('');
  return `<div style="display:flex;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:16px">
    <div class="media-tabs" style="border-bottom:none;margin-bottom:0;flex:1;flex-wrap:wrap">${tabs}</div>
    <button class="btn btn-ghost btn-sm" style="margin-bottom:4px" onclick="addCustomSEOPage()">
      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      カスタムページ
    </button>
  </div>`;
}

/* ════ Page editor ════ */
function _renderSEOEditor(pageId, allPages, allData) {
  const page  = allPages.find(p => p.id === pageId) || allPages[0];
  const data  = allData[pageId] || {};
  const score = _seoScore(data);
  const col   = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  const off   = (_SEO_RING_C * (1 - score / 100)).toFixed(1);
  const isCustom = !SEO_PAGES.find(p => p.id === pageId);

  const tl = (data.title || '').length;
  const dl = (data.description || '').length;

  const _fieldHint = (len, min, max) => {
    if (!len) return '';
    if (len < min) return `<span class="seo-hint seo-hint-warn">短すぎます（推奨 ${min}〜${max} 文字）</span>`;
    if (len > max) return `<span class="seo-hint seo-hint-warn">長すぎます（推奨 ${min}〜${max} 文字）</span>`;
    return `<span class="seo-hint seo-hint-ok">最適な長さです</span>`;
  };

  return `<div class="panel">
    <div class="panel-head">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="panel-title">${esc(page.label)}</span>
        <div class="sec-ring-wrap" style="width:38px;height:38px">
          <svg viewBox="0 0 80 80" width="36" height="36">
            <circle cx="40" cy="40" r="${_SEO_RING_R}" fill="none" stroke="var(--line)" stroke-width="8"/>
            <circle cx="40" cy="40" r="${_SEO_RING_R}" fill="none" stroke="${col}" stroke-width="8"
              stroke-dasharray="${_SEO_RING_C}" stroke-dashoffset="${off}"
              stroke-linecap="round" transform="rotate(-90 40 40)"/>
          </svg>
          <div class="sec-ring-num" style="color:${col};font-size:11px;font-weight:800">${score}</div>
        </div>
        ${page.url ? `<span style="font-size:11px;color:var(--gray-2)">${esc(page.url)}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px">
        ${isCustom ? `<button class="btn btn-ghost btn-sm" onclick="deleteCustomSEOPage('${pageId}')">削除</button>` : ''}
        <button class="btn btn-primary btn-sm" onclick="saveSEO()">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
          保存
        </button>
      </div>
    </div>
    <div class="panel-body">
      <div class="settings-grid">
        <!-- Left: Basic + Technical -->
        <div>
          <div class="seo-section-head">基本設定</div>
          <div class="m-field">
            <label class="m-label">ページタイトル（title タグ）<span class="seo-char-count" id="seoTitleCount">${tl}/70</span></label>
            <input class="m-input" id="seoTitle" type="text" maxlength="100"
              value="${esc(data.title||'')}"
              oninput="updateSEOCount('seoTitle','seoTitleCount',70)"
              placeholder="例：ハローム―ビング — 安心・丁寧な引越しサービス" />
            ${_fieldHint(tl, 30, 70)}
          </div>
          <div class="m-field">
            <label class="m-label">メタディスクリプション<span class="seo-char-count" id="seoDescCount">${dl}/175</span></label>
            <textarea class="m-input seo-textarea" id="seoDesc" maxlength="300"
              oninput="updateSEOCount('seoDesc','seoDescCount',175)"
              placeholder="ページの説明（50〜175文字推奨）">${esc(data.description||'')}</textarea>
            ${_fieldHint(dl, 50, 175)}
          </div>
          <div class="seo-section-head" style="margin-top:16px">技術設定</div>
          <div class="m-field">
            <label class="m-label">Canonical URL</label>
            <input class="m-input" id="seoCanonical" type="url"
              value="${esc(data.canonical||'')}"
              placeholder="https://hello-moving.com${esc(page.url||'/')}" />
          </div>
          <div class="m-field">
            <label class="m-label">Twitter カード</label>
            <select class="m-input" id="seoTwitterCard">
              <option value="summary"${data.twitterCard==='summary'?' selected':''}>summary</option>
              <option value="summary_large_image"${(!data.twitterCard||data.twitterCard==='summary_large_image')?' selected':''}>summary_large_image（推奨）</option>
            </select>
          </div>
        </div>
        <!-- Right: Open Graph -->
        <div>
          <div class="seo-section-head">Open Graph / SNS シェア</div>
          <div class="m-field">
            <label class="m-label">OG タイトル <span style="color:var(--gray-2);font-weight:400">（空欄でページタイトルを使用）</span></label>
            <input class="m-input" id="seoOgTitle" type="text"
              value="${esc(data.ogTitle||'')}"
              placeholder="SNSシェア時のタイトル" />
          </div>
          <div class="m-field">
            <label class="m-label">OG ディスクリプション <span style="color:var(--gray-2);font-weight:400">（空欄でmeta descriptionを使用）</span></label>
            <textarea class="m-input seo-textarea" id="seoOgDesc"
              placeholder="SNSシェア時の説明文">${esc(data.ogDescription||'')}</textarea>
          </div>
          <div class="m-field">
            <label class="m-label">OG 画像 URL <span style="color:var(--gray-2);font-weight:400">（推奨: 1200×630px）</span></label>
            <input class="m-input" id="seoOgImage" type="url"
              value="${esc(data.ogImage||'')}"
              placeholder="https://hello-moving.com/images/og.jpg"
              oninput="_seoOgImagePreview(this.value)" />
            <div id="seoOgImagePreview" style="margin-top:6px">
              ${data.ogImage ? `<img src="${esc(data.ogImage)}" class="seo-og-preview" onerror="this.style.display='none'" />` : ''}
            </div>
          </div>
        </div>
      </div>
      <!-- Schema Markup -->
      <div style="margin-top:8px">
        <div class="seo-section-head" style="display:flex;align-items:center;gap:8px">
          Schema マークアップ（JSON-LD）
          <a href="https://schema.org/LocalBusiness" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue);font-weight:400">schema.org →</a>
          <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px;margin-left:auto" onclick="_seoInjectSchema('${pageId}')">テンプレート挿入</button>
        </div>
        <textarea class="m-input seo-schema-textarea" id="seoSchema"
          placeholder='{"@context":"https://schema.org","@type":"LocalBusiness","name":"Hello Moving",...}'>${esc(data.schema||'')}</textarea>
        <div id="seoSchemaMsg" class="seo-hint" style="margin-top:4px"></div>
      </div>
    </div>
  </div>`;
}

/* ════ Score calculation ════ */
function _seoScore(data) {
  let score = 0;
  const tl = (data.title || '').length;
  const dl = (data.description || '').length;

  // Title: 25 pts
  if (tl >= 30 && tl <= 70) score += 25;
  else if (tl > 0) score += 12;

  // Description: 25 pts
  if (dl >= 50 && dl <= 175) score += 25;
  else if (dl > 0) score += 12;

  // OG coverage: 25 pts (title 8 + desc 8 + image 9)
  if (data.ogTitle)       score += 8;
  if (data.ogDescription) score += 8;
  if (data.ogImage)       score += 9;

  // Technical: 25 pts (canonical 12 + schema 13)
  if (data.canonical)              score += 12;
  if ((data.schema || '').trim())  score += 13;

  return score;
}

/* ════ Actions ════ */
function selectSEOPage(id) {
  _seoPage = id;
  renderSEO();
}

function saveSEO() {
  const schema = (document.getElementById('seoSchema')?.value || '').trim();
  const msgEl  = document.getElementById('seoSchemaMsg');

  if (schema) {
    try {
      JSON.parse(schema);
      if (msgEl) { msgEl.className = 'seo-hint seo-hint-ok'; msgEl.textContent = 'JSON-LD: 有効'; }
    } catch(e) {
      if (msgEl) { msgEl.className = 'seo-hint seo-hint-warn'; msgEl.textContent = 'JSON-LD: 無効なJSON形式です'; }
      return;
    }
  } else if (msgEl) { msgEl.textContent = ''; }

  const data = {
    title:         document.getElementById('seoTitle')?.value.trim()      || '',
    description:   document.getElementById('seoDesc')?.value.trim()       || '',
    canonical:     document.getElementById('seoCanonical')?.value.trim()  || '',
    twitterCard:   document.getElementById('seoTwitterCard')?.value       || 'summary_large_image',
    ogTitle:       document.getElementById('seoOgTitle')?.value.trim()    || '',
    ogDescription: document.getElementById('seoOgDesc')?.value.trim()     || '',
    ogImage:       document.getElementById('seoOgImage')?.value.trim()    || '',
    schema,
  };

  SeoStore.savePage(_seoPage, data);

  /* Persist to API hm_data under key 'hm_seo' so every visitor gets the saved
     SEO on the public site (ContentLoader._applySeo). Previously saveSEO only
     wrote localStorage, so SEO never reached the server and was never rendered.
     The stored value is the FULL page-map (same shape SeoStore.get() returns),
     matching _syncSEOFromApi → Adapter.syncData('hm_seo', _SEO_DATA_KEY). */
  if (typeof Adapter !== 'undefined' && Adapter.apiReady) {
    try { Adapter.saveData('hm_seo', SeoStore.get()); } catch (_) {}
  }

  toast('SEO設定を保存しました');
  renderSEO();
}

function updateSEOCount(inputId, countId, max) {
  const input = document.getElementById(inputId);
  const count = document.getElementById(countId);
  if (!input || !count) return;
  const len = input.value.length;
  count.textContent = `${len}/${max}`;
  count.style.color = len > max ? 'var(--red)' : len > max * 0.9 ? 'var(--yellow)' : 'var(--gray-2)';
}

function _seoOgImagePreview(url) {
  const el = document.getElementById('seoOgImagePreview');
  if (!el) return;
  el.innerHTML = url ? `<img src="${esc(url)}" class="seo-og-preview" onerror="this.style.display='none'" />` : '';
}

function addCustomSEOPage() {
  const label = prompt('カスタムページ名（例：採用情報）');
  if (!label?.trim()) return;
  const url = prompt('ページURL（例：/careers）', '/') || '/';
  const id  = 'custom_' + Date.now().toString(36);
  const pages = SeoStore.getCustomPages();
  pages.push({ id, label: label.trim(), url });
  SeoStore.saveCustomPages(pages);
  _seoPage = id;
  renderSEO();
  toast(`「${label.trim()}」ページを追加しました`);
}

function deleteCustomSEOPage(id) {
  const pages = SeoStore.getCustomPages();
  const p = pages.find(x => x.id === id);
  if (!p || !confirm(`「${p.label}」を削除しますか？`)) return;
  SeoStore.saveCustomPages(pages.filter(x => x.id !== id));
  SeoStore.deletePage(id);
  _seoPage = 'home';
  renderSEO();
  toast('ページを削除しました');
}

function _seoInjectSchema(pageId) {
  const el = document.getElementById('seoSchema');
  if (!el || el.value.trim()) return;
  const page = [...SEO_PAGES, ...SeoStore.getCustomPages()].find(p => p.id === pageId);
  el.value = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Hello Moving",
    "url": "https://hello-moving.com" + (page?.url || '/'),
    "telephone": "",
    "address": {
      "@type": "PostalAddress",
      "addressCountry": "JP"
    },
    "priceRange": "¥¥"
  }, null, 2);
}

function _syncSEOFromApi() {
  if (typeof _dpSync === 'undefined' || !Adapter.apiReady) return;
  _dpSync('hm_data', { key: 'hm_seo' }, () => Adapter.syncData('hm_seo', _SEO_DATA_KEY), 'view-seo', renderSEO);
}
