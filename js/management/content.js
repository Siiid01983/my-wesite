'use strict';
/* ══════════════════════════════════════════════════════
   WMC Content Management — pages, services, SEO, health cards (Phase 28)
   Entry points: _wmcBuildCards(), _wmcRenderOverviewGrid(),
                 _wmcRenderHealthCards(), _wmcUpdateBadges(),
                 _wmcCalcSeo(), _wmcRenderSeoPanel()
   Depends on: wmcCore.js (_padZ, _wmcFmtRelative), window.Adapter
   ══════════════════════════════════════════════════════ */

/* ── SEO score ── */
function _wmcCalcSeo() {
  if (typeof Adapter === 'undefined') return { score: 0, checks: [] };
  var hero    = Adapter.getHero     ? Adapter.getHero()     : {};
  var faq     = Adapter.getFaq      ? Adapter.getFaq()      : [];
  var svcs    = Adapter.getServices ? Adapter.getServices() : [];
  var reviews = Adapter.getReviews  ? Adapter.getReviews()  : [];
  var footer  = Adapter.getFooter   ? Adapter.getFooter()   : {};
  var company = null;
  try { company = JSON.parse(localStorage.getItem('hm_company_rows') || 'null'); } catch (_) {}
  var approved = reviews.filter(function (r) { return r.status === 'approved'; });

  var checks = [
    { label: 'ヒーロー見出しが設定されている',    pts: 15, pass: !!(hero.headline_ja && hero.headline_ja.trim()) },
    { label: 'ヒーローサブテキストが設定されている', pts: 10, pass: !!(hero.subtitle_ja && hero.subtitle_ja.trim()) },
    { label: 'サービスが3件以上登録されている',    pts: 15, pass: svcs.length >= 3, warn: svcs.length >= 1 && svcs.length < 3 },
    { label: '承認済みレビューが5件以上ある',      pts: 15, pass: approved.length >= 5, warn: approved.length >= 1 && approved.length < 5 },
    { label: 'FAQが3件以上設定されている',         pts: 10, pass: faq.length >= 3, warn: faq.length >= 1 && faq.length < 3 },
    { label: '会社情報が入力されている',           pts: 10, pass: !!(company && company.length >= 2) },
    { label: 'フッター情報が設定されている',        pts: 10, pass: !!(footer.brand_desc && footer.brand_desc.trim()) },
    { label: '料金が設定されている',              pts: 10, pass: (function () { try { var p = JSON.parse(localStorage.getItem('hm_prices') || 'null'); return !!(p && Object.keys(p).length > 0); } catch (_) { return false; } })() },
    { label: 'ヒーローバッジが設定されている',     pts:  5, pass: !!(hero.badges && hero.badges.length > 0) },
  ];
  var total  = checks.reduce(function (s, c) { return s + c.pts; }, 0);
  var scored = checks.reduce(function (s, c) { return s + (c.pass ? c.pts : 0); }, 0);
  return { score: Math.round((scored / total) * 100), checks: checks };
}

function _wmcRenderSeoRing(score) {
  var ring = document.getElementById('wmcSeoRing');
  if (!ring) return;
  var circ   = 2 * Math.PI * 46;
  var offset = circ * (1 - score / 100);
  var color  = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  ring.setAttribute('stroke-dasharray', circ.toFixed(1));
  ring.setAttribute('stroke-dashoffset', circ.toFixed(1));
  ring.setAttribute('stroke', color);
  setTimeout(function () {
    ring.style.transition = 'stroke-dashoffset .8s ease';
    ring.setAttribute('stroke-dashoffset', offset.toFixed(1));
  }, 80);
}

function _wmcRenderSeoPanel(seo) {
  var numEl   = document.getElementById('wmcSeoNum');
  var gradeEl = document.getElementById('wmcSeoGrade');
  var descEl  = document.getElementById('wmcSeoDesc');
  var listEl  = document.getElementById('wmcSeoChecks');
  if (numEl) numEl.textContent = seo.score;
  _wmcRenderSeoRing(seo.score);

  var grade, desc, color;
  if      (seo.score >= 90) { grade = 'A+  優秀';   desc = 'SEO対策は非常に良好です。';                    color = '#10b981'; }
  else if (seo.score >= 75) { grade = 'B  良好';     desc = 'SEO対策は概ね良好です。いくつかの改善で更に向上します。'; color = '#10b981'; }
  else if (seo.score >= 55) { grade = 'C  普通';     desc = '基本的な要素は揃っていますが、コンテンツ充実が効果的です。'; color = '#f59e0b'; }
  else if (seo.score >= 35) { grade = 'D  要改善';   desc = 'SEO対策に改善が必要です。';                  color = '#ef4444'; }
  else                      { grade = 'F  要対応';   desc = 'SEO対策が不十分です。基本コンテンツの設定から始めてください。'; color = '#ef4444'; }

  if (gradeEl) { gradeEl.textContent = grade; gradeEl.style.color = color; }
  if (descEl)  descEl.textContent = desc;
  if (listEl)  listEl.innerHTML = seo.checks.map(function (c) {
    var cls  = c.pass ? 'pass' : (c.warn ? 'warn' : 'fail');
    var icon = c.pass ? '✓'   : (c.warn ? '!'   : '✕');
    var pts  = c.pass ? '+' + c.pts : (c.warn ? '~' + Math.round(c.pts / 2) : '+0');
    return '<div class="wmc-check-item">' +
      '<div class="wmc-check-icon ' + cls + '">' + icon + '</div>' +
      '<span class="wmc-check-label">' + esc(c.label) + '</span>' +
      '<span class="wmc-check-pts">' + pts + 'pt</span>' +
    '</div>';
  }).join('');
}

/* ── Stat cards ── */
function _wmcLastContentUpdate() {
  var ts = localStorage.getItem('hm_last_content_update');
  return ts ? new Date(ts) : null;
}

function _wmcBuildCards() {
  var svcs     = (typeof Adapter !== 'undefined' && Adapter.getServices)  ? Adapter.getServices()  : [];
  var reviews  = (typeof Adapter !== 'undefined' && Adapter.getReviews)   ? Adapter.getReviews()   : [];
  var faq      = (typeof Adapter !== 'undefined' && Adapter.getFaq)       ? Adapter.getFaq()       : [];
  var bookings = (typeof Adapter !== 'undefined' && Adapter.getBookings)  ? Adapter.getBookings()  : [];
  var approved = reviews.filter(function (r) { return r.status === 'approved'; });
  var pending  = reviews.filter(function (r) { return r.status === 'pending'; });
  var posts    = []; try { posts = JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) {}

  var deployTs   = localStorage.getItem('hm_last_deploy');
  var deployText = deployTs ? (function () { var d = new Date(deployTs); return d.getFullYear() + '/' + _padZ(d.getMonth() + 1) + '/' + _padZ(d.getDate()); })() : '未記録';
  var contentTs  = _wmcLastContentUpdate();
  var seo        = _wmcCalcSeo();

  return [
    { icon: '🌐', iconBg: 'rgba(37,99,235,.1)',   accent: '#2563eb', label: 'ウェブサイト状態',   value: '確認中',               meta: 'リアルタイム確認', badge: null, id: 'wmcCardStatus' },
    { icon: '📄', iconBg: 'rgba(16,185,129,.1)',  accent: '#10b981', label: '総ページ数',         value: 5,                      meta: 'HTMLページ', badge: { cls: 'blue', text: '公開中: 5' } },
    { icon: '📝', iconBg: 'rgba(139,92,246,.1)',  accent: '#7c3aed', label: 'ブログ投稿',         value: posts.length,           meta: '投稿済み', badge: posts.length === 0 ? { cls: 'yellow', text: '投稿なし' } : { cls: 'green', text: '公開中' } },
    { icon: '⚙️', iconBg: 'rgba(245,158,11,.1)',  accent: '#f59e0b', label: 'サービス数',         value: svcs.length,            meta: '登録済みサービス', badge: { cls: svcs.length >= 3 ? 'green' : 'yellow', text: svcs.length >= 3 ? '充分' : '要追加' } },
    { icon: '⭐', iconBg: 'rgba(245,158,11,.1)',  accent: '#f59e0b', label: 'レビュー数',         value: reviews.length,         meta: '承認済み: ' + approved.length + ' · 保留: ' + pending.length, badge: pending.length > 0 ? { cls: 'yellow', text: '保留: ' + pending.length } : { cls: 'green', text: '確認済み' } },
    { icon: '🚀', iconBg: 'rgba(16,185,129,.1)',  accent: '#10b981', label: '最終デプロイ',       value: deployText,             meta: '最終デプロイ日', badge: deployTs ? { cls: 'green', text: '記録済み' } : { cls: 'yellow', text: '未記録' } },
    { icon: '✏️', iconBg: 'rgba(37,99,235,.1)',   accent: '#2563eb', label: '最終コンテンツ更新', value: contentTs ? _wmcFmtRelative(contentTs) : '未記録', meta: 'コンテンツ更新日時', badge: contentTs ? { cls: 'green', text: '記録あり' } : { cls: 'yellow', text: '未記録' } },
    { icon: '📊', iconBg: seo.score >= 75 ? 'rgba(16,185,129,.1)' : seo.score >= 50 ? 'rgba(245,158,11,.1)' : 'rgba(239,68,68,.08)', accent: seo.score >= 75 ? '#10b981' : seo.score >= 50 ? '#f59e0b' : '#ef4444', label: 'SEOスコア', value: seo.score + '/100', meta: 'コンテンツ最適化指数', badge: { cls: seo.score >= 75 ? 'green' : seo.score >= 50 ? 'yellow' : 'red', text: seo.score >= 75 ? '良好' : seo.score >= 50 ? '改善推奨' : '要対応' } },
  ];
}

function _wmcRenderOverviewGrid(cards) {
  var grid = document.getElementById('wmcOverviewGrid');
  if (!grid) return;
  grid.innerHTML = cards.map(function (c) {
    var badge = c.badge ? '<div class="wmc-stat-badge ' + c.badge.cls + '">' + esc(c.badge.text) + '</div>' : '';
    return '<div class="wmc-stat-card" style="--card-accent:' + c.accent + ';--icon-bg:' + c.iconBg + '"' + (c.id ? ' id="' + c.id + '"' : '') + '>' +
      '<div class="wmc-stat-icon">' + c.icon + '</div>' +
      '<div class="wmc-stat-label">' + esc(c.label) + '</div>' +
      '<div class="wmc-stat-value">' + esc(String(c.value)) + '</div>' +
      '<div class="wmc-stat-meta">' + esc(c.meta) + '</div>' +
      badge +
    '</div>';
  }).join('');
}

function _wmcRenderHealthCards() {
  var grid = document.getElementById('wmcHealthGrid');
  if (!grid) return;
  var hero   = (typeof Adapter !== 'undefined' && Adapter.getHero)     ? Adapter.getHero()     : {};
  var faq    = (typeof Adapter !== 'undefined' && Adapter.getFaq)      ? Adapter.getFaq()      : [];
  var svcs   = (typeof Adapter !== 'undefined' && Adapter.getServices) ? Adapter.getServices() : [];
  var footer = (typeof Adapter !== 'undefined' && Adapter.getFooter)   ? Adapter.getFooter()   : {};
  var items = [
    { icon: '🏠', bg: 'rgba(37,99,235,.1)',   title: 'ヒーローセクション', meta: hero.headline_ja ? '見出し設定済み' : '⚠ 見出し未設定',             action: 'ヒーローを編集', ok: !!(hero.headline_ja) },
    { icon: '⚙️', bg: 'rgba(245,158,11,.1)',  title: 'サービス情報',       meta: svcs.length + '件のサービスが登録されています',                       action: 'サービスを管理', ok: svcs.length >= 3 },
    { icon: '❓', bg: 'rgba(139,92,246,.1)',  title: 'FAQ',               meta: faq.length + '件の質問が登録されています',                             action: 'FAQを編集',     ok: faq.length >= 3 },
    { icon: '🔗', bg: 'rgba(16,185,129,.1)',  title: 'フッター情報',       meta: footer.brand_desc ? '説明文設定済み' : '⚠ 説明文未設定',               action: 'フッターを編集', ok: !!(footer.brand_desc) },
  ];
  grid.innerHTML = items.map(function (item) {
    var dot = item.ok ? '#10b981' : '#f59e0b';
    return '<div class="wmc-health-card">' +
      '<div class="wmc-health-icon-wrap" style="background:' + item.bg + '">' + item.icon + '</div>' +
      '<div class="wmc-health-body">' +
        '<div class="wmc-health-title" style="display:flex;align-items:center;gap:6px">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:' + dot + ';flex-shrink:0;display:inline-block"></span>' +
          esc(item.title) +
        '</div>' +
        '<div class="wmc-health-meta">' + esc(item.meta) + '</div>' +
        '<a href="admin.html" class="wmc-health-action">' + esc(item.action) + ' →</a>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ── Sidebar badges ── */
function _wmcUpdateBadges() {
  var posts = []; try { posts = JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) {}
  var svcs    = (typeof Adapter !== 'undefined' && Adapter.getServices) ? Adapter.getServices() : [];
  var reviews = (typeof Adapter !== 'undefined' && Adapter.getReviews)  ? Adapter.getReviews()  : [];
  var pending = reviews.filter(function (r) { return r.status === 'pending'; });

  function _set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val || ''; }
  _set('wmcPagesBadge', 5);
  _set('wmcBlogBadge',  posts.length || '');
  _set('wmcSvcBadge',   svcs.length  || '');
  _set('wmcRevBadge',   pending.length || '');
}
