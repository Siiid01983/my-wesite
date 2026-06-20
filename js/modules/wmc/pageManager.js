'use strict';

/* ════════════════════════════════════════════════════════
   WMC PAGE MANAGER
   Stores pages in localStorage (hm_wmc_pages) + API
   hm_data KV table.  Each page holds a blocks[] array
   consumed by WMCBlockEditor.

   Public API:
     WMCPageManager.render()          — draw list into #wmcPagesContent
     WMCPageManager.openCreate()      — open "new page" modal
     WMCPageManager.getPage(id)       — page object
     WMCPageManager.updatePage(id, patch)
   ════════════════════════════════════════════════════════ */

window.WMCPageManager = (function () {

  var STORAGE_KEY = 'hm_wmc_pages';
  var _searchQuery = '';
  var _searchTimer = null;
  var _DEFAULT_IDS = ['PAGE-home','PAGE-about','PAGE-services','PAGE-pricing','PAGE-reviews','PAGE-contact','PAGE-faq'];

  /* ── Default pages (seeded on first load) ── */
  var DEFAULT_PAGES = [
    { id:'PAGE-home',     title:'ホーム',         titleEn:'Home',     slug:'/',          template:'home',     icon:'🏠' },
    { id:'PAGE-about',    title:'会社概要',       titleEn:'About',    slug:'/about',     template:'about',    icon:'🏢' },
    { id:'PAGE-services', title:'サービス',       titleEn:'Services', slug:'/services',  template:'default',  icon:'⚙️' },
    { id:'PAGE-pricing',  title:'料金プラン',     titleEn:'Pricing',  slug:'/pricing',   template:'default',  icon:'💴' },
    { id:'PAGE-reviews',  title:'口コミ・評判',   titleEn:'Reviews',  slug:'/reviews',   template:'default',  icon:'⭐' },
    { id:'PAGE-contact',  title:'お問い合わせ',   titleEn:'Contact',  slug:'/contact',   template:'contact',  icon:'📞' },
    { id:'PAGE-faq',      title:'よくある質問',   titleEn:'FAQ',      slug:'/faq',       template:'faq',      icon:'❓' },
  ].map(function (p) {
    var now = new Date().toISOString();
    return Object.assign({ blocks:[], status:'published', seo:{title:p.title, description:''},
      createdAt:now, updatedAt:now, publishedAt:now }, p);
  });

  /* ── Storage ── */
  function _load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return DEFAULT_PAGES.map(function(p){ return JSON.parse(JSON.stringify(p)); });
  }

  function _save(pages) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pages)); } catch (_) {}
    _syncSb(pages);
  }

  function _syncSb(pages) {
    var sb = window.api;
    if (!sb) return;
    sb.from('hm_data')
      .upsert({ key: STORAGE_KEY, value: JSON.stringify(pages), updated_at: new Date().toISOString() })
      .then(function(r){ if (r.error) console.warn('[WMCPageManager] sync:', r.error.message); });
  }

  /* ── CRUD ── */
  function getPages()  { return _load(); }
  function getPage(id) { return _load().find(function(p){ return p.id === id; }) || null; }

  function createPage(data) {
    var pages = _load();
    var slug  = data.slug || _makeSlug(data.title || 'page');
    var now   = new Date().toISOString();
    var page  = {
      id: 'PAGE-' + Date.now().toString(36),
      title: data.title || '新規ページ',
      slug: slug,
      status: 'draft',
      blocks: [],
      seo: { title: data.title || '', description: '' },
      template: 'default',
      icon: '📄',
      createdAt: now, updatedAt: now, publishedAt: null,
    };
    pages.push(page);
    _save(pages);
    _audit('add', page.id, 'ページを作成: ' + page.title);
    return page;
  }

  function updatePage(id, patch) {
    var pages = _load();
    var idx   = pages.findIndex(function(p){ return p.id === id; });
    if (idx === -1) return false;
    Object.assign(pages[idx], patch, { updatedAt: new Date().toISOString() });
    _save(pages);
    return true;
  }

  function deletePage(id) {
    if (_DEFAULT_IDS.includes(id)) { _toast('デフォルトページは削除できません'); return false; }
    var pages  = _load();
    var page   = pages.find(function(p){ return p.id === id; });
    if (!page) return false;
    _save(pages.filter(function(p){ return p.id !== id; }));
    _audit('delete', id, 'ページを削除: ' + page.title);
    return true;
  }

  function duplicatePage(id) {
    var pages = _load();
    var orig  = pages.find(function(p){ return p.id === id; });
    if (!orig) return null;
    var now  = new Date().toISOString();
    var copy = JSON.parse(JSON.stringify(orig));
    copy.id         = 'PAGE-' + Date.now().toString(36);
    copy.title      = orig.title + ' (コピー)';
    copy.slug       = orig.slug.replace(/\/+$/, '') + '-copy-' + Date.now().toString(36).slice(-4);
    copy.status     = 'draft';
    copy.publishedAt= null;
    copy.createdAt  = now;
    copy.updatedAt  = now;
    pages.push(copy);
    _save(pages);
    _audit('add', copy.id, 'ページを複製: ' + copy.title);
    return copy;
  }

  function setStatus(id, status) {
    var patch = { status: status };
    if (status === 'published') patch.publishedAt = new Date().toISOString();
    return updatePage(id, patch);
  }

  /* ── Slug helper ── */
  function _makeSlug(title) {
    var s = title.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w぀-鿿-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'page';
    return '/' + s;
  }

  /* ── Utilities ── */
  function _toast(msg) { if (typeof toast === 'function') toast(msg); }
  function _audit(action, id, detail) {
    if (typeof AuditLog !== 'undefined') AuditLog.record(action, 'page', id, detail);
  }

  /* ════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════ */
  function render() {
    var el = document.getElementById('wmcPagesContent');
    if (!el) return;

    var all    = _load();
    var q      = _searchQuery.trim().toLowerCase();
    var pages  = q
      ? all.filter(function(p){ return p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q); })
      : all;

    var published = all.filter(function(p){ return p.status === 'published'; }).length;
    var drafts    = all.length - published;

    var statsHtml =
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;font-size:12px;color:var(--gray-1)">' +
        '<span>総ページ数: <strong style="color:var(--ink)">' + all.length + '</strong></span>' +
        '<span style="color:#059669">公開中: <strong>' + published + '</strong></span>' +
        '<span>下書き: <strong>' + drafts + '</strong></span>' +
      '</div>';

    var toolbarHtml =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
        '<input id="wmcPageSearch" placeholder="ページを検索…" value="' + _esc(_searchQuery) + '"' +
          ' style="flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--bg)" />' +
        '<button class="btn btn-primary btn-sm" onclick="WMCPageManager.openCreate()">+ 新規ページ</button>' +
      '</div>';

    var emptyHtml = pages.length === 0
      ? '<div class="wmc-placeholder" style="padding:40px">' +
          '<div class="wmc-placeholder-icon">📄</div>' +
          '<div class="wmc-placeholder-title">' + (q ? '一致するページが見つかりません' : 'ページがありません') + '</div>' +
          (q ? '' : '<button class="btn btn-primary" style="margin-top:12px" onclick="WMCPageManager.openCreate()">+ 新規ページを作成</button>') +
        '</div>'
      : null;

    var rowsHtml = pages.map(function(p) {
      var isDefault = _DEFAULT_IDS.includes(p.id);
      var statusBadge = p.status === 'published'
        ? '<span class="wmc-pg-badge published">● 公開中</span>'
        : '<span class="wmc-pg-badge draft">下書き</span>';
      var upd = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('ja-JP', { year:'numeric', month:'short', day:'numeric' }) : '—';
      var blkCnt = Array.isArray(p.blocks) ? p.blocks.length : 0;
      return (
        '<tr class="wmc-pg-row">' +
          '<td style="padding:11px 16px;width:36px;font-size:18px">' + (p.icon || '📄') + '</td>' +
          '<td style="padding:11px 16px">' +
            '<div style="font-size:13px;font-weight:600;color:var(--ink)">' + _esc(p.title) +
              (isDefault ? '<span style="font-size:10px;color:var(--gray-2);font-weight:400;margin-left:5px">（デフォルト）</span>' : '') +
            '</div>' +
            '<div style="font-size:11px;color:var(--gray-2);font-family:monospace;margin-top:1px">' + _esc(p.slug) + '</div>' +
          '</td>' +
          '<td style="padding:11px 16px">' + statusBadge + '</td>' +
          '<td style="padding:11px 16px;font-size:12px;color:var(--gray-2)">' + blkCnt + 'ブロック</td>' +
          '<td style="padding:11px 16px;font-size:12px;color:var(--gray-2);white-space:nowrap">' + upd + '</td>' +
          '<td style="padding:11px 16px">' +
            '<div style="display:flex;align-items:center;gap:4px;flex-wrap:nowrap">' +
              '<button class="btn btn-primary btn-sm" onclick="WMCBlockEditor.open(\'' + p.id + '\')">編集</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="WMCPageManager.openEditSlug(\'' + p.id + '\')" title="スラッグ">🔗</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="WMCPageManager.duplicate(\'' + p.id + '\')" title="複製">⊕</button>' +
              (p.status === 'draft'
                ? '<button class="btn btn-ghost btn-sm wmc-pg-pub-btn" onclick="WMCPageManager.publish(\'' + p.id + '\')">公開</button>'
                : '<button class="btn btn-ghost btn-sm" onclick="WMCPageManager.unpublish(\'' + p.id + '\')">下書き</button>'
              ) +
              (isDefault ? ''
                : '<button class="btn btn-ghost btn-sm wmc-pg-del-btn" onclick="WMCPageManager.confirmDelete(\'' + p.id + '\')" title="削除">✕</button>'
              ) +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    var tableHtml = emptyHtml ||
      '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden">' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
          '<thead><tr style="background:var(--bg-soft-2)">' +
            _th('') + _th('タイトル / スラッグ') + _th('状態') + _th('ブロック') + _th('更新日') + _th('操作') +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table></div>' +
      '</div>';

    el.innerHTML = statsHtml + toolbarHtml + tableHtml;

    /* Bind search */
    var sinput = document.getElementById('wmcPageSearch');
    if (sinput) {
      sinput.addEventListener('input', function() {
        _searchQuery = this.value;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(render, 180);
      });
    }
  }

  function _th(txt) {
    return '<th style="padding:9px 16px;font-size:10px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap">' + txt + '</th>';
  }

  /* ════════════════════════════════════════════════════════
     MODALS
     ════════════════════════════════════════════════════════ */
  function openCreate() {
    _modal('wmcCreatePageModal',
      '<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:16px">新規ページを作成</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="display:block;font-size:12px;font-weight:600;color:var(--gray-1);margin-bottom:5px">ページタイトル *</label>' +
        '<input id="wcpTitle" style="' + _inputStyle() + '" placeholder="例: サービス紹介" />' +
      '</div>' +
      '<div style="margin-bottom:16px">' +
        '<label style="display:block;font-size:12px;font-weight:600;color:var(--gray-1);margin-bottom:5px">スラッグ（URL）</label>' +
        '<input id="wcpSlug" style="' + _inputStyle() + 'font-family:monospace" placeholder="/my-page" />' +
        '<div style="font-size:11px;color:var(--gray-2);margin-top:4px">タイトル入力で自動生成されます</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-ghost" onclick="_wmcCloseModal(\'wmcCreatePageModal\')">キャンセル</button>' +
        '<button class="btn btn-primary" onclick="WMCPageManager._doCreate()">作成して編集 →</button>' +
      '</div>'
    );
    var titleEl = document.getElementById('wcpTitle');
    var slugEl  = document.getElementById('wcpSlug');
    if (titleEl) {
      titleEl.focus();
      titleEl.addEventListener('input', function() { if (slugEl) slugEl.value = _makeSlug(this.value); });
      titleEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') WMCPageManager._doCreate(); });
    }
  }

  function _doCreate() {
    var titleEl = document.getElementById('wcpTitle');
    var slugEl  = document.getElementById('wcpSlug');
    if (!titleEl) return;
    var title = titleEl.value.trim();
    if (!title) { titleEl.focus(); return; }
    var slug  = (slugEl && slugEl.value.trim()) || _makeSlug(title);
    _wmcCloseModal('wmcCreatePageModal');
    var page = createPage({ title:title, slug:slug });
    _toast('ページを作成しました');
    render();
    if (window.WMCBlockEditor) WMCBlockEditor.open(page.id);
  }

  function openEditSlug(id) {
    var page = getPage(id);
    if (!page) return;
    _modal('wmcSlugModal',
      '<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:4px">スラッグを編集</div>' +
      '<div style="font-size:12px;color:var(--gray-2);margin-bottom:16px">' + _esc(page.title) + '</div>' +
      '<div style="margin-bottom:16px">' +
        '<label style="display:block;font-size:12px;font-weight:600;color:var(--gray-1);margin-bottom:5px">ページスラッグ（URL）</label>' +
        '<input id="wcpSlugEdit" style="' + _inputStyle() + 'font-family:monospace" value="' + _esc(page.slug) + '" />' +
        '<div style="font-size:11px;color:var(--gray-2);margin-top:4px">例: /about-us  (/始まり)</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-ghost" onclick="_wmcCloseModal(\'wmcSlugModal\')">キャンセル</button>' +
        '<button class="btn btn-primary" onclick="WMCPageManager._doSaveSlug(\'' + id + '\')">保存</button>' +
      '</div>'
    );
    var inp = document.getElementById('wcpSlugEdit');
    if (inp) {
      inp.focus(); inp.select();
      inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') WMCPageManager._doSaveSlug(id); });
    }
  }

  function _doSaveSlug(id) {
    var inp = document.getElementById('wcpSlugEdit');
    if (!inp) return;
    var slug = inp.value.trim();
    if (slug && !slug.startsWith('/')) slug = '/' + slug;
    updatePage(id, { slug: slug || '/' + id });
    _wmcCloseModal('wmcSlugModal');
    _toast('スラッグを更新しました');
    render();
  }

  /* ── Public action shortcuts ── */
  function duplicate(id)      { var c = duplicatePage(id); if (c) { _toast('ページを複製しました'); render(); } }
  function publish(id)        { setStatus(id, 'published'); _toast('ページを公開しました'); render(); }
  function unpublish(id)      { setStatus(id, 'draft');     _toast('下書きに戻しました');    render(); }
  function confirmDelete(id)  {
    var p = getPage(id);
    if (!p || !confirm('「' + p.title + '」を削除しますか？元に戻せません。')) return;
    if (deletePage(id)) { _toast('ページを削除しました'); render(); }
  }

  /* ── Modal helpers ── */
  function _modal(id, bodyHtml) {
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = id;
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;padding:24px;max-width:440px;width:100%;border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.25)">' + bodyHtml + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e) { if (e.target === ov) _wmcCloseModal(id); });
  }

  function _inputStyle() {
    return 'width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--bg);box-sizing:border-box;';
  }
  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ── Init: seed defaults ── */
  (function _init() {
    if (!localStorage.getItem(STORAGE_KEY)) {
      _save(DEFAULT_PAGES.map(function(p){ return JSON.parse(JSON.stringify(p)); }));
    }
  })();

  return {
    getPages, getPage, createPage, updatePage, deletePage, duplicatePage, setStatus,
    render,
    openCreate, _doCreate,
    openEditSlug, _doSaveSlug,
    duplicate, publish, unpublish, confirmDelete,
    makeSlug: _makeSlug,
  };

})();

/* Global modal closer */
function _wmcCloseModal(id) {
  var el = document.getElementById(id);
  if (el) el.remove();
}
