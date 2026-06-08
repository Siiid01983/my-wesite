'use strict';
/* ══════════════════════════════════════════════════════
   WMC Blog — Blog post management (Phase 28)
   Entry points: _wmcRenderBlog(), wmcNewBlogPost(), wmcEditBlogPost()
   Depends on: wmcCore.js (WMCPermissions)
   ══════════════════════════════════════════════════════ */

function _wmcRenderBlog() {
  var el = document.getElementById('wmcBlogContent');
  if (!el) return;

  var canEdit   = typeof WMCPermissions !== 'undefined' ? WMCPermissions.can('edit_content')   : true;
  var canCreate = typeof WMCPermissions !== 'undefined' ? WMCPermissions.can('create_content') : true;

  /* Show/hide new post button based on role */
  var newBtn = document.getElementById('wmcBlogNewBtn');
  if (newBtn) newBtn.style.display = canCreate ? '' : 'none';

  var posts = [];
  try { posts = JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) {}

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
      return '<div style="padding:14px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:var(--ink)">' + esc(p.title || '(タイトル未設定)') + '</div>' +
          '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + (p.date || '') + ' · ' + esc(p.author || 'Admin') + '</div>' +
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

  var posts = [];
  try { posts = JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) {}

  var post = {
    id       : 'BP-' + Date.now().toString(36).toUpperCase(),
    title    : title.trim(),
    content  : '',
    author   : (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser().name : 'Admin',
    date     : new Date().toLocaleDateString('ja-JP'),
    status   : 'draft',
    createdAt: new Date().toISOString(),
  };
  posts.unshift(post);
  localStorage.setItem('hm_blog_posts', JSON.stringify(posts));
  localStorage.setItem('hm_last_content_update', new Date().toISOString());

  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('add', 'blog_post', post.id, '新規ブログ投稿: ' + title.trim());

  /* Sync to Supabase hm_data */
  if (typeof Adapter !== 'undefined' && Adapter.supabaseReady && window.SupabaseClient) {
    window.SupabaseClient.from('hm_data')
      .upsert({ key: 'hm_blog_posts', value: JSON.stringify(posts), updated_at: new Date().toISOString() })
      .then(function (r) { if (r.error) console.warn('[WMC] blog sync:', r.error.message); });
  }

  if (typeof toast !== 'undefined') toast('ブログ投稿を作成しました');
  _wmcRenderBlog();
  _wmcUpdateBadges();
}

function wmcEditBlogPost(id) {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('edit_content')) {
    if (typeof toast !== 'undefined') toast('この操作にはスタッフ以上の権限が必要です');
    return;
  }
  var posts = [];
  try { posts = JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) {}
  var post = posts.find(function (p) { return p.id === id; });
  if (!post) { if (typeof toast !== 'undefined') toast('投稿が見つかりません'); return; }
  var newTitle = window.prompt('タイトルを編集してください:', post.title || '');
  if (newTitle === null) return;
  post.title = newTitle.trim() || post.title;
  post.updatedAt = new Date().toISOString();
  localStorage.setItem('hm_blog_posts', JSON.stringify(posts));
  localStorage.setItem('hm_last_content_update', new Date().toISOString());
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('update', 'blog_post', id, 'ブログ投稿を編集: ' + post.title);
  if (typeof toast !== 'undefined') toast('投稿を更新しました');
  _wmcRenderBlog();
}

function _wmcDeleteBlogPost(id) {
  if (typeof WMCPermissions !== 'undefined' && !WMCPermissions.can('edit_content')) {
    if (typeof toast !== 'undefined') toast('この操作にはスタッフ以上の権限が必要です');
    return;
  }
  var posts = [];
  try { posts = JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) {}
  var post = posts.find(function (p) { return p.id === id; });
  if (!post || !confirm('「' + (post.title || id) + '」を削除しますか？')) return;
  localStorage.setItem('hm_blog_posts', JSON.stringify(posts.filter(function (p) { return p.id !== id; })));
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('delete', 'blog_post', id, 'ブログ投稿を削除: ' + post.title);
  if (typeof toast !== 'undefined') toast('投稿を削除しました');
  _wmcRenderBlog();
  _wmcUpdateBadges();
}
