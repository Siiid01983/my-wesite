'use strict';
/* ══════════════════════════════════════════════════════
   WMC SEO — SEO settings view (Phase 28)
   Entry point: _wmcRenderSeoSettings()
   Depends on: wmcOverview.js (_wmcCalcSeo)
   ══════════════════════════════════════════════════════ */

function _wmcRenderSeoSettings() {
  var el = document.getElementById('wmcSeoSettingsContent');
  if (!el) return;

  var canEdit = typeof WMCPermissions !== 'undefined' ? WMCPermissions.can('modify_settings') : true;
  var seo     = _wmcCalcSeo();

  var scoreColor = seo.score >= 75 ? '#10b981' : seo.score >= 50 ? '#f59e0b' : '#ef4444';

  el.innerHTML =
    '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px">' +
      '<div style="padding:14px 18px;border-bottom:1px solid var(--line)">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:4px">' +
          '現在のSEOスコア: <span style="color:' + scoreColor + '">' + seo.score + '/100</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--gray-1)">コンテンツ品質に基づいて計算されます。チェック項目を改善するとスコアが上がります。</div>' +
      '</div>' +
      '<div style="padding:16px">' +
      seo.checks.map(function (c) {
        var color = c.pass ? '#10b981' : (c.warn ? '#f59e0b' : '#ef4444');
        var icon  = c.pass ? '✓'      : (c.warn ? '!'      : '✕');
        var action = c.pass ? '確認' : '改善';
        return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-2)">' +
          '<div style="width:22px;height:22px;border-radius:50%;background:' + color + '22;color:' + color + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">' + icon + '</div>' +
          '<div style="flex:1;font-size:12px;color:var(--ink)">' + esc(c.label) + '</div>' +
          '<div style="font-size:11px;font-weight:600;color:var(--gray-2);flex-shrink:0">' + c.pts + 'pt</div>' +
          (canEdit
            ? '<a href="admin.html" style="font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;flex-shrink:0">' + action + ' →</a>'
            : '<span style="font-size:11px;color:var(--gray-2);flex-shrink:0">閲覧のみ</span>') +
        '</div>';
      }).join('') +
      '</div>' +
    '</div>' +
    (!canEdit
      ? '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:8px;margin-bottom:14px;font-size:12px;color:var(--ink)">' +
          '<span>🔒</span><span>SEO設定の変更は管理者のみ可能です。</span>' +
        '</div>'
      : '') +
    '<div style="font-size:12px;color:var(--gray-2);line-height:1.6;padding:12px 16px;background:var(--bg-soft-2);border-radius:10px;border:1px solid var(--line)">' +
      '💡 <strong>ヒント:</strong> SEOスコアはサイトのコンテンツ品質の目安です。' +
      'ヒーロー見出し・サービス情報・FAQ・レビューを充実させると検索順位が向上します。' +
    '</div>';
}
