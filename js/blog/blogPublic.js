/* ════════════════════════════════════════════════════════
   PUBLIC BLOG RENDERER  —  js/blog/blogPublic.js
   Drives blog.html (list) and article.html (detail).

   Reads the public `blog_posts` table via the same hm-api client the rest of
   the site uses (window.api, set up by js/core/bootstrap.js). SELECT on
   blog_posts is public (rest.php) — no admin token needed; the page-served
   API key is sent automatically by apiClient.

   Security: post `content` is Markdown — rendered with an ESCAPE-FIRST renderer
   (HTML is neutralised before any inline formatting), and link URLs are limited
   to http(s)/relative, so stored content can never inject markup or scripts.

   Page detection: #blogListEl → list view · #articleEl → detail view.
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── escaping / formatting ─────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(d) {
    if (!d) return '';
    var dt = new Date(String(d).replace(' ', 'T'));
    if (isNaN(dt.getTime())) return '';
    return dt.getFullYear() + '年' + (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  }

  /* ── safe Markdown (escape-first; never emits author HTML) ───────────────── */
  function mdInline(t) {
    return String(t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, url) {
        if (!/^(https?:\/\/|\/)/i.test(url)) return txt;          // drop unsafe scheme, keep text
        return '<a href="' + url.replace(/"/g, '%22') + '" target="_blank" rel="noopener nofollow">' + txt + '</a>';
      });
  }

  function mdToHtml(text) {
    if (!text) return '';
    var lines = String(text).split('\n'), html = '', inList = false;
    for (var i = 0; i < lines.length; i++) {
      var tr = lines[i].trim();
      if (!tr) { if (inList) { html += '</ul>'; inList = false; } continue; }
      if (/^### /.test(tr))       { if (inList) { html += '</ul>'; inList = false; } html += '<h3>' + mdInline(tr.slice(4)) + '</h3>'; }
      else if (/^## /.test(tr))   { if (inList) { html += '</ul>'; inList = false; } html += '<h2>' + mdInline(tr.slice(3)) + '</h2>'; }
      else if (/^# /.test(tr))    { if (inList) { html += '</ul>'; inList = false; } html += '<h2>' + mdInline(tr.slice(2)) + '</h2>'; }
      else if (/^[-*] /.test(tr)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + mdInline(tr.slice(2)) + '</li>'; }
      else                        { if (inList) { html += '</ul>'; inList = false; } html += '<p>' + mdInline(tr) + '</p>'; }
    }
    if (inList) html += '</ul>';
    return html;
  }

  /* Strip Markdown syntax → plain text (excerpt fallback). */
  function stripMd(text) {
    return String(text || '')
      .replace(/[#>*`_~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stateMsg(msg) {
    return '<div class="blog-state"><p>' + esc(msg) + '</p>' +
      '<a class="btn btn-ghost" href="/blog.html">記事一覧へ</a></div>';
  }

  function setMeta(name, content) {
    if (!content) return;
    var m = document.querySelector('meta[name="' + name + '"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', name); document.head.appendChild(m); }
    m.setAttribute('content', content);
  }

  /* ── wait for the API client that bootstrap.js sets up ─── */
  function whenApiReady(timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() {
        if (window.api) return resolve(window.api);
        var b = window.__BOOTSTRAP__;
        if (b && (b.ready || b.stage === 'FAILED')) return resolve(window.api || null);
        if (Date.now() - start > timeoutMs) return resolve(window.api || null);
        setTimeout(poll, 120);
      })();
    });
  }

  /* ── List view (blog.html) ─────────────────────────────── */
  function _card(p) {
    var key  = p.slug || p.reference_id || p.id || '';
    var url  = 'article.html?slug=' + encodeURIComponent(key);
    var date = fmtDate(p.published_at || p.created_at);
    var excerpt = p.excerpt || stripMd(p.content).slice(0, 120);
    var img  = p.featured_image
      ? '<a class="blog-card__imgwrap" href="' + url + '" tabindex="-1" aria-hidden="true">' +
          '<img class="blog-card__img" src="' + esc(p.featured_image) + '" alt="" loading="lazy" ' +
          'onerror="this.closest(\'.blog-card__imgwrap\').style.display=\'none\'"></a>'
      : '';
    return '<article class="blog-card">' + img +
      '<div class="blog-card__body">' +
        (p.featured ? '<span class="blog-card__badge">注目</span>' : '') +
        '<h2 class="blog-card__title"><a href="' + url + '">' + esc(p.title || '(無題)') + '</a></h2>' +
        (date ? '<div class="blog-card__date">' + esc(date) + '</div>' : '') +
        (excerpt ? '<p class="blog-card__excerpt">' + esc(excerpt) + '</p>' : '') +
        '<a class="blog-card__more" href="' + url + '">続きを読む <span aria-hidden="true">→</span></a>' +
      '</div>' +
    '</article>';
  }

  function renderList(posts, el) {
    if (!posts.length) {
      el.innerHTML = '<div class="blog-state"><p>まだ公開されている記事はありません。</p>' +
        '<a class="btn btn-primary" href="/">ホームへ戻る</a></div>';
      return;
    }
    /* Featured post (if any) floats to the top of the list. */
    posts.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); });
    el.innerHTML = posts.map(_card).join('');
  }

  async function initList() {
    var el = document.getElementById('blogListEl');
    var api = await whenApiReady(15000);
    if (!api) { el.innerHTML = stateMsg('記事を読み込めませんでした。時間をおいて再度お試しください。'); return; }
    try {
      var res = await api.from('blog_posts').select('*')
        .eq('status', 'published')
        .order('published_at', { ascending: false });
      if (res.error) throw new Error(res.error.message);
      renderList((res.data || []).filter(function (p) { return p.status === 'published'; }), el);
    } catch (e) {
      console.warn('[blog] list error:', e && e.message);
      el.innerHTML = stateMsg('記事の取得に失敗しました。');
    }
  }

  /* ── Detail view (article.html?slug=… | ?id=…) ─────────── */
  function renderArticle(p, el) {
    var date = fmtDate(p.published_at || p.created_at);
    document.title = (p.title || '記事') + ' — Hello Moving ブログ';
    setMeta('description', p.excerpt || stripMd(p.content).slice(0, 150));

    var cats = (p.categories || []).map(function (c) {
      return '<span class="article__cat">' + esc(c) + '</span>';
    }).join('');
    var img = p.featured_image
      ? '<img class="article__hero" src="' + esc(p.featured_image) + '" alt="' + esc(p.title || '') + '" onerror="this.style.display=\'none\'">'
      : '';
    var authorBlock = (p.author || p.author_bio)
      ? '<footer class="article__author">' +
          (p.author ? '<div class="article__author-name">' + esc(p.author) + '</div>' : '') +
          (p.author_bio ? '<div class="article__author-bio">' + esc(p.author_bio) + '</div>' : '') +
        '</footer>'
      : '';

    el.innerHTML =
      '<nav class="breadcrumb" aria-label="パンくずリスト">' +
        '<a href="/">ホーム</a><span aria-hidden="true">›</span>' +
        '<a href="/blog.html">ブログ</a><span aria-hidden="true">›</span>' +
        '<span class="breadcrumb__current">' + esc(p.title || '') + '</span>' +
      '</nav>' +
      '<article class="article">' +
        '<header class="article__head">' +
          (cats ? '<div class="article__cats">' + cats + '</div>' : '') +
          '<h1 class="article__title">' + esc(p.title || '(無題)') + '</h1>' +
          '<div class="article__meta">' +
            (date ? '<time>' + esc(date) + '</time>' : '') +
            (p.author ? '<span class="article__by">' + esc(p.author) + '</span>' : '') +
          '</div>' +
        '</header>' +
        img +
        '<div class="article__content">' + mdToHtml(p.content || '') + '</div>' +
        authorBlock +
        '<div class="article__back"><a class="btn btn-ghost" href="/blog.html">← 記事一覧へ</a></div>' +
      '</article>';
  }

  async function initArticle() {
    var el = document.getElementById('articleEl');
    var params = new URLSearchParams(location.search);
    var slug = params.get('slug');
    var id   = params.get('id');
    if (!slug && !id) { el.innerHTML = stateMsg('記事が指定されていません。'); return; }

    var api = await whenApiReady(15000);
    if (!api) { el.innerHTML = stateMsg('記事を読み込めませんでした。時間をおいて再度お試しください。'); return; }
    try {
      var q = api.from('blog_posts').select('*').eq('status', 'published');
      q = slug ? q.eq('slug', slug) : q.eq('reference_id', id);
      var res = await q.maybeSingle();
      if (res.error) throw new Error(res.error.message);
      if (!res.data) {
        document.title = '記事が見つかりません — Hello Moving';
        el.innerHTML = stateMsg('記事が見つかりませんでした。削除されたか、まだ公開されていない可能性があります。');
        return;
      }
      renderArticle(res.data, el);
    } catch (e) {
      console.warn('[blog] article error:', e && e.message);
      el.innerHTML = stateMsg('記事の取得に失敗しました。');
    }
  }

  /* ── boot ──────────────────────────────────────────────── */
  function start() {
    if (document.getElementById('blogListEl'))      initList();
    else if (document.getElementById('articleEl'))  initArticle();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
