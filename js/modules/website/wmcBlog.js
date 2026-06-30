'use strict';
/* ══════════════════════════════════════════════════════
   WMC Blog — Blog post management (Phase 28 · Blog System Phase 1)
   Entry points: _wmcRenderBlog(), wmcNewBlogPost(), wmcEditBlogPost()
   Depends on: wmcCore.js (WMCPermissions), apiAdapter.js (Adapter)

   SINGLE SOURCE OF TRUTH: this shell (wmcDashboard.html) and the rich editor
   (blogManager.js in websiteManagement.html) BOTH persist to the dedicated
   `blog_posts` table via Adapter — never to hm_data['hm_blog_posts'] (the old
   stringified write that conflicted with the table schema has been removed).
   Posts carry the full schema (slug/excerpt/categories/…) so the rich editor can
   open anything created here.
   ══════════════════════════════════════════════════════ */

var _wmcBlogSynced = false;

function _wmcLocalPosts() {
  try { return JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) { return []; }
}

/* Canonical post list: Adapter (localStorage mirror of blog_posts) when present,
   else the raw localStorage fallback. */
function _wmcBlogPosts() {
  return (typeof Adapter !== 'undefined' && Adapter.getBlogPosts) ? Adapter.getBlogPosts() : _wmcLocalPosts();
}

/* Write-through: Adapter owns persistence (localStorage + blog_posts table) when
   ready; localStorage-only fallback otherwise. */
function _wmcBlogSave(post) {
  if (typeof Adapter !== 'undefined' && Adapter.apiReady) { Adapter.saveBlogPost(post); return; }
  var posts = _wmcLocalPosts();
  var i = posts.findIndex(function (p) { return p.id === post.id; });
  if (i >= 0) posts[i] = post; else posts.unshift(post);
  try { localStorage.setItem('hm_blog_posts', JSON.stringify(posts)); } catch (_) {}
}

function _wmcBlogDelete(id) {
  if (typeof Adapter !== 'undefined' && Adapter.apiReady) { Adapter.deleteBlogPost(id); return; }
  try { localStorage.setItem('hm_blog_posts', JSON.stringify(_wmcLocalPosts().filter(function (p) { return p.id !== id; }))); } catch (_) {}
}

/* Japanese-safe slug (keep Unicode letters/numbers) + uniqueness across posts
   (blog_posts has a UNIQUE slug index). Mirrors blogManager.js. */
function _wmcBlogSlugify(title) {
  return (title || '').toString().trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function _wmcBlogUniqueSlug(slug, selfId, posts) {
  if (!slug) slug = 'post-' + String(selfId).toLowerCase();
  var taken = {};
  posts.forEach(function (p) { if (p.id !== selfId && p.slug) taken[p.slug] = 1; });
  if (!taken[slug]) return slug;
  var n = 2, c;
  do { c = slug + '-' + n; n++; } while (taken[c]);
  return c;
}

function _wmcRenderBlog() {
  var el = document.getElementById('wmcBlogContent');
  if (!el) return;

  /* First open: pull authoritative posts from blog_posts (migrate legacy
     localStorage-only posts up once), then re-render with live data. */
  if (!_wmcBlogSynced && typeof Adapter !== 'undefined' && Adapter.apiReady) {
    _wmcBlogSynced = true;
    Promise.resolve(Adapter.migrateBlogToApi())
      .then(function () { return Adapter.syncBlog(); })
      .then(function (ok) { if (ok) _wmcRenderBlog(); })
      .catch(function (e) { console.warn('[WMC] blog sync failed:', e && e.message); });
  }

  var canEdit   = typeof WMCPermissions !== 'undefined' ? WMCPermissions.can('edit_content')   : true;
  var canCreate = typeof WMCPermissions !== 'undefined' ? WMCPermissions.can('create_content') : true;

  /* Show/hide new post button based on role */
  var newBtn = document.getElementById('wmcBlogNewBtn');
  if (newBtn) newBtn.style.display = canCreate ? '' : 'none';

  var posts = _wmcBlogPosts();

  if (posts.length === 0) {
    el.innerHTML =
      '<div class="wmc-placeholder">' +
        '<div class="wmc-placeholder-icon">📝</div>' +
        '<div class="wmc-placeholder-title">ブログ投稿がありません</div>' +
        '<div class="wmc-placeholder-text">「新規投稿」ボタンから最初の記事を作成してください。</div>' +
        (canCreate ? '<button class="btn btn-primary" style="margin-top:16px" onclick="wmcNewBlogPost()">+ 新規投稿</button>' : '') +
      '</div>';
    return;
  }

  el.innerHTML =
    '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden">' +
    posts.map(function (p) {
      var statusBg    = p.status === 'published' ? 'rgba(16,185,129,.1)'  : 'rgba(245,158,11,.1)';
      var statusColor = p.status === 'published' ? '#059669'              : '#b45309';
      var statusBdr   = p.status === 'published' ? 'rgba(16,185,129,.2)' : 'rgba(245,158,11,.2)';
      var when        = p.publishedAt || p.createdAt || p.date || '';
      var dateLabel   = when ? new Date(when).toLocaleDateString('ja-JP') : '';
      return '<div style="padding:14px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:var(--ink)">' + esc(p.title || '(タイトル未設定)') + '</div>' +
          '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + dateLabel + ' · ' + esc(p.author || 'Admin') + '</div>' +
        '</div>' +
        '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:' + statusBg + ';color:' + statusColor + ';border:1px solid ' + statusBdr + ';flex-shrink:0">' +
          (p.status === 'published' ? '公開中' : '下書き') +
        '</span>' +
        (canEdit ? '<button class="btn btn-ghost btn-sm" onclick="wmcEditBlogPost(\'' + esc(p.id) + '\')">編集</button>' : '') +
        (canEdit ? '<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="_wmcDeleteBlogPost(\'' + esc(p.id) + '\')">削除</button>' : '') +
      '</div>';
    }).join('') +
    '</div>';
}

function wmcNewBlogPost() {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('create_content')) {
    if (typeof toast !== 'undefined') toast('この操作にはスタッフ以上の権限が必要です');
    return;
  }
  var title = window.prompt('新規ブログ投稿のタイトルを入力してください:');
  if (!title || !title.trim()) return;
  title = title.trim();

  var posts = _wmcBlogPosts();
  var id    = 'BP-' + Date.now().toString(36).toUpperCase();
  var slug  = _wmcBlogUniqueSlug(_wmcBlogSlugify(title), id, posts);
  var now   = new Date().toISOString();

  var post = {
    id:            id,
    title:         title,
    slug:          slug,
    content:       '',
    excerpt:       '',
    featuredImage: '',
    categories:    [],
    tags:          [],
    status:        'draft',
    featured:      false,
    scheduledAt:   null,
    publishedAt:   null,
    author:        (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser().name : 'Admin',
    authorBio:     '',
    createdAt:     now,
    updatedAt:     now,
  };
  _wmcBlogSave(post);

  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('add', 'blog_post', post.id, '新規ブログ投稿: ' + title);

  if (typeof toast !== 'undefined') toast('ブログ投稿を作成しました');
  _wmcRenderBlog();
  if (typeof _wmcUpdateBadges === 'function') _wmcUpdateBadges();
}

function wmcEditBlogPost(id) {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('edit_content')) {
    if (typeof toast !== 'undefined') toast('この操作にはスタッフ以上の権限が必要です');
    return;
  }
  var posts = _wmcBlogPosts();
  var post  = posts.find(function (p) { return p.id === id; });
  if (!post) { if (typeof toast !== 'undefined') toast('投稿が見つかりません'); return; }
  var newTitle = window.prompt('タイトルを編集してください:', post.title || '');
  if (newTitle === null) return;
  post.title = newTitle.trim() || post.title;
  if (!post.slug) post.slug = _wmcBlogUniqueSlug(_wmcBlogSlugify(post.title), id, posts);
  post.updatedAt = new Date().toISOString();
  _wmcBlogSave(post);
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('update', 'blog_post', id, 'ブログ投稿を編集: ' + post.title);
  if (typeof toast !== 'undefined') toast('投稿を更新しました');
  _wmcRenderBlog();
}

function _wmcDeleteBlogPost(id) {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('edit_content')) {
    if (typeof toast !== 'undefined') toast('この操作にはスタッフ以上の権限が必要です');
    return;
  }
  var post = _wmcBlogPosts().find(function (p) { return p.id === id; });
  if (!post || !confirm('「' + (post.title || id) + '」を削除しますか？')) return;
  _wmcBlogDelete(id);
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('delete', 'blog_post', id, 'ブログ投稿を削除: ' + post.title);
  if (typeof toast !== 'undefined') toast('投稿を削除しました');
  _wmcRenderBlog();
  if (typeof _wmcUpdateBadges === 'function') _wmcUpdateBadges();
}
