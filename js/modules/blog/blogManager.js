'use strict';

/* ════════════════════════════════════════════════════════
   BLOG MANAGER
   Create · Edit · Categories · Tags · Featured Image
   Draft / Publish / Scheduled · Search · Markdown preview
   ════════════════════════════════════════════════════════ */

const _BLOG_KEY = 'hm_blog_posts';

const BlogStore = {
  getAll() { try { return JSON.parse(localStorage.getItem(_BLOG_KEY) || '[]'); } catch { return []; } },
  saveAll(posts) { try { localStorage.setItem(_BLOG_KEY, JSON.stringify(posts)); return true; } catch { return false; } },
  find(id) { return this.getAll().find(p => p.id === id) || null; },
  /* Write-through: when the Adapter/API is available it owns persistence
     (localStorage + blog_posts table). Falls back to localStorage-only when the
     Adapter isn't loaded (e.g. offline). */
  save(post) {
    if (typeof Adapter !== 'undefined' && Adapter.apiReady) { Adapter.saveBlogPost(post); return true; }
    const all = this.getAll();
    const idx = all.findIndex(p => p.id === post.id);
    if (idx >= 0) all[idx] = post; else all.unshift(post);
    return this.saveAll(all);
  },
  delete(id) {
    if (typeof Adapter !== 'undefined' && Adapter.apiReady) { Adapter.deleteBlogPost(id); return true; }
    return this.saveAll(this.getAll().filter(p => p.id !== id));
  },
};

/* ── State ── */
let _blogView   = 'list';   // 'list' | 'edit'
let _blogEditId = null;     // null = new post
let _blogFilter = 'all';    // 'all' | 'published' | 'draft' | 'scheduled'
let _blogSearch = '';
let _blogTab    = 'write';  // 'write' | 'preview'

/* ── Scheduled post checker (runs every 60 s) ── */
setInterval(_checkScheduledPosts, 60000);

function _checkScheduledPosts() {
  const now   = new Date().toISOString();
  const posts = BlogStore.getAll();
  let changed = false;
  posts.forEach(p => {
    if (p.status === 'scheduled' && p.scheduledAt && p.scheduledAt <= now) {
      p.status      = 'published';
      p.publishedAt = p.scheduledAt;
      changed = true;
      /* Write each transition through the Adapter so the publish reaches the
         blog_posts table, not just localStorage. (Client-side fallback only —
         the server-side scheduled publisher arrives in a later phase.) */
      BlogStore.save(p);
    }
  });
  if (changed && document.getElementById('view-blog')?.classList.contains('active') && _blogView === 'list') {
    renderBlog();
  }
}

/* ════ Main render ════ */
let _blogSynced = false;
function renderBlog() {
  const el = document.getElementById('blogContent');
  if (!el) return;
  /* First open: pull authoritative posts from the blog_posts table (and migrate
     any legacy localStorage-only posts up once), then re-render with live data. */
  if (!_blogSynced && typeof Adapter !== 'undefined' && Adapter.apiReady) {
    _blogSynced = true;
    Promise.resolve(Adapter.migrateBlogToApi())
      .then(() => Adapter.syncBlog())
      .then(ok => { if (ok) renderBlog(); })
      .catch(e => console.warn('[Blog] initial sync failed:', e && e.message));
  }
  _checkScheduledPosts();
  el.innerHTML = _blogView === 'edit' ? _renderBlogEditor() : _renderBlogList();
}

/* ════ List view ════ */
function _renderBlogList() {
  const all = BlogStore.getAll();
  const pubCount  = all.filter(p => p.status === 'published').length;
  const draftCount= all.filter(p => p.status === 'draft').length;
  const schedCount= all.filter(p => p.status === 'scheduled').length;

  let items = all;
  if (_blogFilter !== 'all') items = items.filter(p => p.status === _blogFilter);
  if (_blogSearch) {
    const q = _blogSearch.toLowerCase();
    items = items.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.excerpt || '').toLowerCase().includes(q) ||
      (p.categories || []).some(c => c.toLowerCase().includes(q)) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  const iconSearch = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;

  const filterBtn = (val, label, count) =>
    `<button class="cl-type-btn${_blogFilter===val?' active':''}" onclick="setBlogFilter('${val}')">${label}<span class="cl-pill">${count}</span></button>`;

  const header = `<div class="cl-header" style="margin-bottom:16px">
    <div class="cl-header-info">
      <div class="cl-header-title">ブログ管理</div>
      <div class="cl-stats">
        <span>${all.length} 記事</span>
        <span class="cl-dot">·</span>
        <span style="color:var(--green)">${pubCount} 公開中</span>
        <span class="cl-dot">·</span>
        <span style="color:var(--gray-1)">${draftCount} 下書き</span>
        ${schedCount > 0 ? `<span class="cl-dot">·</span><span style="color:var(--yellow)">${schedCount} 予約済み</span>` : ''}
      </div>
    </div>
    <div class="cl-header-controls">
      <div class="media-search-wrap" style="min-width:180px">
        ${iconSearch}
        <input class="media-search" id="blogSearch" type="text" placeholder="記事を検索..." value="${esc(_blogSearch)}" oninput="filterBlog(this.value)" />
      </div>
      <div class="cl-type-filters">
        ${filterBtn('all',       'すべて',   all.length)}
        ${filterBtn('published', '公開中',   pubCount)}
        ${filterBtn('draft',     '下書き',   draftCount)}
        ${filterBtn('scheduled', '予約済み', schedCount)}
      </div>
      <button class="btn btn-primary btn-sm" onclick="openBlogEditor(null)">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        新規記事
      </button>
    </div>
  </div>`;

  if (!items.length) {
    return header + `<div class="panel"><div class="panel-body"><div class="empty">
      <svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
      <p>${_blogSearch || _blogFilter !== 'all' ? '一致する記事がありません' : '記事がまだありません'}</p>
      ${!_blogSearch && _blogFilter === 'all' ? `<button class="btn btn-primary btn-sm" onclick="openBlogEditor(null)" style="margin-top:8px">最初の記事を作成する</button>` : ''}
    </div></div></div>`;
  }

  const cards = items.map(post => {
    const statusBadge = _blogStatusBadge(post.status);
    const cats  = (post.categories || []).slice(0, 3).map(c => `<span class="blog-tag blog-cat">${esc(c)}</span>`).join('');
    const tags  = (post.tags || []).slice(0, 3).map(t => `<span class="blog-tag">${esc(t)}</span>`).join('');
    const date  = post.status === 'scheduled' && post.scheduledAt
      ? `予約: ${new Date(post.scheduledAt).toLocaleString('ja-JP')}`
      : post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('ja-JP')
      : new Date(post.createdAt).toLocaleDateString('ja-JP');
    const thumb = post.featuredImage
      ? `<img src="${esc(post.featuredImage)}" class="blog-card-thumb" onerror="this.style.display='none'" />`
      : `<div class="blog-card-thumb blog-card-thumb-empty"><svg viewBox="0 0 24 24" width="24" height="24" style="color:var(--gray-2)"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg></div>`;

    return `<div class="blog-card">
      ${thumb}
      <div class="blog-card-body">
        <div class="blog-card-title">${esc(post.title || '（無題）')}</div>
        ${post.excerpt ? `<div class="blog-card-excerpt">${esc(post.excerpt)}</div>` : ''}
        <div class="blog-card-meta">
          ${statusBadge}
          ${cats}${tags}
          <span class="blog-card-date">${date}</span>
        </div>
        <div class="blog-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="openBlogEditor('${post.id}')">
            <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            編集
          </button>
          ${post.status === 'draft' || post.status === 'scheduled'
            ? `<button class="btn btn-ghost btn-sm" onclick="publishBlogPost('${post.id}')">公開する</button>` : ''}
          ${post.status === 'published'
            ? `<button class="btn btn-ghost btn-sm" onclick="unpublishBlogPost('${post.id}')">下書きに戻す</button>` : ''}
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteBlogPost('${post.id}')">
            <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  return header + `<div class="blog-grid">${cards}</div>`;
}

/* ════ Editor view ════ */
function _renderBlogEditor() {
  const post = _blogEditId ? BlogStore.find(_blogEditId) : null;
  const d = post || { title:'', slug:'', content:'', excerpt:'', featuredImage:'', categories:[], tags:[], status:'draft', scheduledAt:'' };

  const catVal  = (d.categories || []).join(', ');
  const tagVal  = (d.tags || []).join(', ');
  const preview = _mdToHtml(d.content || '');
  const isScheduled = d.status === 'scheduled';

  const catPills = (d.categories || []).map(c => `<span class="blog-tag blog-cat">${esc(c)}</span>`).join('');
  const tagPills = (d.tags || []).map(t => `<span class="blog-tag">${esc(t)}</span>`).join('');

  return `<div class="blog-editor-wrap">
    <!-- Editor header -->
    <div class="blog-editor-header">
      <button class="btn btn-ghost btn-sm" onclick="closeBlogEditor()">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        一覧へ戻る
      </button>
      <div style="flex:1"></div>
      <div class="cl-type-filters">
        <button class="cl-type-btn${_blogTab==='write'?' active':''}" onclick="setBlogTab('write')">編集</button>
        <button class="cl-type-btn${_blogTab==='preview'?' active':''}" onclick="setBlogTab('preview')">プレビュー</button>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="saveBlogPost('draft')">下書き保存</button>
      <button class="btn btn-primary btn-sm" onclick="saveBlogPost('published')">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
        公開する
      </button>
    </div>

    <!-- Editor body -->
    <div class="blog-editor-body">
      <!-- Main content area -->
      <div class="blog-editor-main">
        <input class="blog-title-input" id="blogTitleInput" type="text"
          placeholder="記事タイトルを入力..."
          value="${esc(d.title)}"
          oninput="_blogAutoSlug(this.value)" />
        <div class="blog-slug-row">
          <span style="color:var(--gray-2);font-size:12px">スラッグ: </span>
          <input class="blog-slug-input" id="blogSlugInput" type="text"
            value="${esc(d.slug)}" placeholder="article-slug" />
        </div>

        ${_blogTab === 'write' ? `
          <textarea class="blog-content-input" id="blogContentInput"
            placeholder="Markdown で記事を書いてください...

# 見出し1
## 見出し2
**太字** *斜体* \`コード\`
- リスト項目
[リンク](https://example.com)"
            oninput="updateBlogPreview()">${esc(d.content)}</textarea>
          <div class="blog-md-hint">Markdown 対応: # 見出し · **太字** · *斜体* · \`コード\` · - リスト · [リンク](url)</div>
        ` : `
          <div class="blog-preview-pane" id="blogPreviewPane">${preview}</div>
        `}
      </div>

      <!-- Sidebar -->
      <div class="blog-editor-sidebar">
        <!-- Status -->
        <div class="blog-sidebar-section">
          <div class="blog-sidebar-title">公開設定</div>
          <div class="m-field">
            <select class="m-input" id="blogStatus" onchange="_toggleScheduled(this.value)">
              <option value="draft"${d.status==='draft'?' selected':''}>下書き</option>
              <option value="published"${d.status==='published'?' selected':''}>公開</option>
              <option value="scheduled"${isScheduled?' selected':''}>予約公開</option>
            </select>
          </div>
          <div id="blogScheduledWrap" style="display:${isScheduled?'':'none'}">
            <div class="m-field">
              <label class="m-label">公開日時</label>
              <input class="m-input" id="blogScheduledAt" type="datetime-local"
                value="${d.scheduledAt ? d.scheduledAt.slice(0,16) : ''}" />
            </div>
          </div>
        </div>

        <!-- Excerpt -->
        <div class="blog-sidebar-section">
          <div class="blog-sidebar-title">抜粋</div>
          <textarea class="m-input" id="blogExcerpt" style="height:80px;font-size:12.5px"
            placeholder="記事の短い説明（一覧ページで表示）">${esc(d.excerpt)}</textarea>
        </div>

        <!-- Featured image -->
        <div class="blog-sidebar-section">
          <div class="blog-sidebar-title">アイキャッチ画像</div>
          <input class="m-input" id="blogFeaturedImage" type="url"
            value="${esc(d.featuredImage)}"
            placeholder="https://..."
            oninput="_blogImagePreview(this.value)" style="font-size:12px" />
          <div id="blogImagePreview" style="margin-top:8px">
            ${d.featuredImage ? `<img src="${esc(d.featuredImage)}" class="blog-feat-preview" onerror="this.style.display='none'" />` : ''}
          </div>
        </div>

        <!-- Categories -->
        <div class="blog-sidebar-section">
          <div class="blog-sidebar-title">カテゴリ</div>
          <input class="m-input" id="blogCategories" type="text"
            value="${esc(catVal)}"
            placeholder="例：お知らせ, 引越しのコツ"
            style="font-size:12px" />
          <div id="blogCatPills" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${catPills}</div>
          <div style="font-size:11px;color:var(--gray-2);margin-top:4px">カンマ区切りで複数入力</div>
        </div>

        <!-- Tags -->
        <div class="blog-sidebar-section">
          <div class="blog-sidebar-title">タグ</div>
          <input class="m-input" id="blogTags" type="text"
            value="${esc(tagVal)}"
            placeholder="例：引越し, 東京, 節約"
            style="font-size:12px" />
          <div id="blogTagPills" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${tagPills}</div>
          <div style="font-size:11px;color:var(--gray-2);margin-top:4px">カンマ区切りで複数入力</div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ════ Helpers ════ */
function _blogStatusBadge(status) {
  const map = {
    published: ['badge-confirmed', '公開中'],
    draft:     ['badge-done',      '下書き'],
    scheduled: ['badge-review',    '予約済み'],
  };
  const [cls, label] = map[status] || ['badge-done', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function _mdToHtml(text) {
  if (!text) return '<p style="color:var(--gray-2);font-style:italic">プレビューする内容がありません</p>';
  const lines = text.split('\n');
  let html = '', inList = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<br>';
      continue;
    }
    if      (t.startsWith('### ')) { if (inList){html+='</ul>';inList=false;} html += `<h3 style="font-size:15px;font-weight:700;margin:12px 0 6px">${_mdInline(t.slice(4))}</h3>`; }
    else if (t.startsWith('## '))  { if (inList){html+='</ul>';inList=false;} html += `<h2 style="font-size:18px;font-weight:700;margin:16px 0 8px">${_mdInline(t.slice(3))}</h2>`; }
    else if (t.startsWith('# '))   { if (inList){html+='</ul>';inList=false;} html += `<h1 style="font-size:22px;font-weight:800;margin:20px 0 10px">${_mdInline(t.slice(2))}</h1>`; }
    else if (t.startsWith('- ') || t.startsWith('* ')) {
      if (!inList) { html += '<ul style="padding-left:20px;margin:8px 0">'; inList = true; }
      html += `<li style="margin:4px 0">${_mdInline(t.slice(2))}</li>`;
    }
    else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p style="margin:8px 0;line-height:1.65">${_mdInline(t)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html || '<p style="color:var(--gray-2);font-style:italic">コンテンツなし</p>';
}

function _mdInline(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:var(--bg-soft-2);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:0.9em">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:underline">$1</a>');
}

/* Japanese-safe slug: keep Unicode letters/numbers (so Japanese titles produce a
   non-empty slug) instead of stripping them as the old [^\w] rule did. Returns ''
   only for a title with no letters/numbers at all — the caller then falls back to
   an id-based slug. */
function _blogSlugify(title) {
  return (title || '').toString().trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/* Enforce slug uniqueness across posts (DB has a UNIQUE slug index). Appends
   -2, -3, … on collision with a DIFFERENT post. `slug` must be non-empty. */
function _ensureUniqueBlogSlug(slug, selfId) {
  const taken = new Set(BlogStore.getAll().filter(p => p.id !== selfId).map(p => p.slug));
  if (!taken.has(slug)) return slug;
  let n = 2, candidate;
  do { candidate = slug + '-' + n; n++; } while (taken.has(candidate));
  return candidate;
}

function _blogAutoSlug(title) {
  const slugEl = document.getElementById('blogSlugInput');
  if (slugEl && !slugEl.dataset.manual) {
    slugEl.value = _blogSlugify(title);
  }
}

/* ════ Actions ════ */
function openBlogEditor(id) {
  _blogEditId = id;
  _blogView   = 'edit';
  _blogTab    = 'write';
  renderBlog();
}

function closeBlogEditor() {
  _blogView   = 'list';
  _blogEditId = null;
  renderBlog();
}

function setBlogFilter(val) {
  _blogFilter = val;
  renderBlog();
}

function filterBlog(val) {
  _blogSearch = val;
  renderBlog();
}

function setBlogTab(tab) {
  _blogTab = tab;
  renderBlog();
}

function _toggleScheduled(val) {
  const wrap = document.getElementById('blogScheduledWrap');
  if (wrap) wrap.style.display = val === 'scheduled' ? '' : 'none';
}

function updateBlogPreview() {
  // Preview is only shown in preview tab; no-op in write tab
}

function _blogImagePreview(url) {
  const el = document.getElementById('blogImagePreview');
  if (!el) return;
  el.innerHTML = url ? `<img src="${esc(url)}" class="blog-feat-preview" onerror="this.style.display='none'" />` : '';
}

function _collectBlogFormData(status) {
  const title     = document.getElementById('blogTitleInput')?.value.trim() || '';
  const content   = document.getElementById('blogContentInput')?.value || '';
  const excerpt   = document.getElementById('blogExcerpt')?.value.trim() || '';
  const featImg   = document.getElementById('blogFeaturedImage')?.value.trim() || '';
  const catRaw    = document.getElementById('blogCategories')?.value || '';
  const tagRaw    = document.getElementById('blogTags')?.value || '';
  const selStatus = document.getElementById('blogStatus')?.value || 'draft';
  const schedAt   = document.getElementById('blogScheduledAt')?.value || '';

  const finalStatus = status || selStatus;
  const categories  = catRaw.split(',').map(c => c.trim()).filter(Boolean);
  const tags        = tagRaw.split(',').map(t => t.trim()).filter(Boolean);

  const now = new Date().toISOString();
  const existing = _blogEditId ? BlogStore.find(_blogEditId) : null;
  const id = existing?.id || genId();

  /* Slug resolution: explicit slug → slugified title → id-based fallback, then
     made unique against all other posts (DB enforces a UNIQUE slug index). */
  let slug = document.getElementById('blogSlugInput')?.value.trim() || _blogSlugify(title);
  if (!slug) slug = 'post-' + String(id).toLowerCase();
  slug = _ensureUniqueBlogSlug(slug, id);

  return {
    id,
    title,
    slug,
    content,
    excerpt,
    featuredImage: featImg,
    categories,
    tags,
    status:       finalStatus,
    scheduledAt:  finalStatus === 'scheduled' && schedAt ? new Date(schedAt).toISOString() : null,
    publishedAt:  finalStatus === 'published' ? (existing?.publishedAt || now) : null,
    author:       Auth?.getUser?.()?.name || 'Admin',
    createdAt:    existing?.createdAt || now,
    updatedAt:    now,
  };
}

function saveBlogPost(statusOverride) {
  const title = document.getElementById('blogTitleInput')?.value.trim();
  if (!title) { toast('タイトルを入力してください'); return; }

  const post = _collectBlogFormData(statusOverride);
  BlogStore.save(post);
  _blogEditId = post.id;

  const msg = post.status === 'published' ? '公開しました' : post.status === 'scheduled' ? `${new Date(post.scheduledAt).toLocaleString('ja-JP')} に公開予定で保存しました` : '下書きを保存しました';
  toast(msg);
  renderBlog(); // Re-render editor to reflect saved state
}

function publishBlogPost(id) {
  const post = BlogStore.find(id);
  if (!post) return;
  post.status      = 'published';
  post.publishedAt = new Date().toISOString();
  post.updatedAt   = post.publishedAt;
  BlogStore.save(post);
  renderBlog();
  toast('記事を公開しました');
}

function unpublishBlogPost(id) {
  const post = BlogStore.find(id);
  if (!post) return;
  post.status    = 'draft';
  post.updatedAt = new Date().toISOString();
  BlogStore.save(post);
  renderBlog();
  toast('下書きに戻しました');
}

function deleteBlogPost(id) {
  const post = BlogStore.find(id);
  if (!post || !confirm(`「${post.title || '（無題）'}」を削除しますか？`)) return;
  BlogStore.delete(id);
  renderBlog();
  toast('記事を削除しました');
}
