'use strict';
/* ══════════════════════════════════════════════════════
   WMC Theme Customizer — Section 8 (Phase 28)
   Entry point: _wmcRenderTheme()
   Depends on: wmcCore.js (WMCPermissions)
   Writes: hm_theme_config, hm_custom_theme_css, hm_theme_applied_at
   index.html reads hm_custom_theme_css and injects it as a <style> tag
   ══════════════════════════════════════════════════════ */

var _TC_DEFAULTS = {
  colorNavy    : '#0a1f44',
  colorCta     : '#2563eb',
  colorAccent  : '#1D9E75',
  colorBg      : '#ffffff',
  colorText    : '#0b0f17',
  fontHeading  : "'Noto Sans JP', sans-serif",
  fontBody     : "'Inter', sans-serif",
  fontSize     : 14,
  btnRadius    : 8,
  btnStyle     : 'filled',
  cardRadius   : 12,
  sectionPad   : 80,
  componentGap : 24,
};

var _tcConfig = null;

function _tcLoad() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('hm_theme_config') || 'null'); } catch (_) {}
  _tcConfig = Object.assign({}, _TC_DEFAULTS, saved || {});
}

function _tcReset() {
  if (!confirm('テーマをデフォルト設定に戻しますか？')) return;
  _tcConfig = Object.assign({}, _TC_DEFAULTS);
  localStorage.removeItem('hm_theme_config');
  localStorage.removeItem('hm_custom_theme_css');
  _tcFillPanes();
  _tcUpdatePreview();
  var banner = document.getElementById('tcAppliedBanner');
  if (banner) banner.style.display = 'none';
  if (typeof toast !== 'undefined') toast('テーマをデフォルトにリセットしました');
}

function _tcApply() {
  _tcConfig = _tcReadControls();
  var css = _tcGenerateCss(_tcConfig);
  localStorage.setItem('hm_theme_config', JSON.stringify(_tcConfig));
  localStorage.setItem('hm_custom_theme_css', css);
  localStorage.setItem('hm_theme_applied_at', new Date().toISOString());
  /* Persist to Supabase so every visitor on every device gets the theme */
  if (typeof DataProvider !== 'undefined') {
    DataProvider.write('hm_data', { key: 'hm_custom_theme_css', value: css })
      .then(function (r) { if (!r.success) console.warn('[WMCTheme] Supabase write failed', r.error); });
  }
  var banner = document.getElementById('tcAppliedBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.innerHTML = '<div class="tc-applied-info">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>' +
      '<span>テーマをサイトに適用しました。公開サイト（<a href="/" target="_blank" style="color:var(--blue)">index.html</a>）をリロードすると変更が反映されます。</span>' +
    '</div>';
  }
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('update', 'theme', 'custom', 'テーマをサイトに適用');
  if (typeof toast !== 'undefined') toast('テーマをサイトに適用しました');
}

function _tcGenerateCss(c) {
  return [
    '.nav-container, nav, .navbar { background-color: ' + c.colorNavy + ' !important; }',
    '.hero, .hero-section, [class*="hero"] { background-color: ' + c.colorNavy + ' !important; }',
    'h1, h2, h3, h4 { font-family: ' + c.fontHeading + ' !important; }',
    'body { font-family: ' + c.fontBody + ' !important; font-size: ' + c.fontSize + 'px !important; background: ' + c.colorBg + ' !important; color: ' + c.colorText + ' !important; }',
    '.btn-primary, .btn-cta, button.primary { background: ' + c.colorCta + ' !important; border-radius: ' + c.btnRadius + 'px !important; }',
    (c.btnStyle === 'outline' ? '.btn-primary, .btn-cta { background: transparent !important; border: 2px solid ' + c.colorCta + ' !important; color: ' + c.colorCta + ' !important; }' : ''),
    (c.btnStyle === 'soft'    ? '.btn-primary, .btn-cta { background: ' + c.colorCta + '22 !important; color: ' + c.colorCta + ' !important; }' : ''),
    '.badge, .badge-green { background: ' + c.colorAccent + '22 !important; color: ' + c.colorAccent + ' !important; }',
    '.service-card, .card, .panel, .review-card { border-radius: ' + c.cardRadius + 'px !important; }',
    'section { padding-top: ' + c.sectionPad + 'px !important; padding-bottom: ' + c.sectionPad + 'px !important; }',
  ].filter(function (l) { return l.trim(); }).join('\n');
}

function _tcUpdatePreview() {
  var c   = _tcConfig;
  var el  = document.getElementById('tcPreview');
  if (!el) return;

  var btnBg, btnBorder, btnColor;
  if      (c.btnStyle === 'outline') { btnBg = 'transparent'; btnBorder = '2px solid ' + c.colorCta; btnColor = c.colorCta; }
  else if (c.btnStyle === 'soft')    { btnBg = c.colorCta + '22'; btnBorder = 'none'; btnColor = c.colorCta; }
  else                               { btnBg = c.colorCta; btnBorder = 'none'; btnColor = '#fff'; }

  var cardBg = c.colorBg === '#ffffff' ? '#f8f9fa' : c.colorBg;

  el.innerHTML =
    '<div class="tc-prev" style="background:' + c.colorBg + ';color:' + c.colorText + ';font-family:' + c.fontBody + ';font-size:' + c.fontSize + 'px">' +
    '<div class="tc-prev-hero" style="background:' + c.colorNavy + ';color:#fff">' +
      '<div class="tc-prev-nav">' +
        '<span class="tc-prev-logo" style="font-family:' + c.fontHeading + ';color:#fff">Hello Moving</span>' +
        '<span style="font-size:9px;opacity:.55;color:#fff">メニュー</span>' +
      '</div>' +
      '<div class="tc-prev-h1" style="font-family:' + c.fontHeading + ';color:#fff">丁寧・迅速・安心の引越し</div>' +
      '<div class="tc-prev-p" style="color:rgba(255,255,255,.75)">東京・関東エリアに特化した引越し専門サービス。</div>' +
      '<button class="tc-prev-btn" style="background:' + btnBg + ';border:' + btnBorder + ';color:' + btnColor + ';border-radius:' + c.btnRadius + 'px;padding:8px 18px">無料見積もり</button>' +
    '</div>' +
    '<div style="height:3px;background:' + c.colorAccent + '"></div>' +
    '<div class="tc-prev-cards" style="background:' + cardBg + '">' +
      '<div class="tc-prev-card" style="background:' + c.colorBg + ';border:1px solid rgba(0,0,0,.08);border-radius:' + c.cardRadius + 'px">' +
        '<div class="tc-prev-card-icon">🚚</div>' +
        '<div class="tc-prev-card-title" style="font-family:' + c.fontHeading + ';color:' + c.colorText + '">引越しサービス</div>' +
        '<div class="tc-prev-card-text" style="color:' + c.colorText + '">一般家庭向け</div>' +
      '</div>' +
      '<div class="tc-prev-card" style="background:' + c.colorBg + ';border:1px solid rgba(0,0,0,.08);border-radius:' + c.cardRadius + 'px">' +
        '<div class="tc-prev-card-icon">📦</div>' +
        '<div class="tc-prev-card-title" style="font-family:' + c.fontHeading + ';color:' + c.colorText + '">梱包サービス</div>' +
        '<div class="tc-prev-card-text" style="color:' + c.colorText + '">プロ品質</div>' +
      '</div>' +
    '</div>' +
    '<div style="padding:10px 16px;border-top:1px solid rgba(0,0,0,.06);display:flex;align-items:center;gap:10px;background:' + c.colorBg + '">' +
      '<span style="color:#f59e0b;font-size:12px;flex-shrink:0">★★★★★</span>' +
      '<span style="font-size:10px;color:' + c.colorText + ';opacity:.7">"スタッフが丁寧でとても助かりました。"</span>' +
    '</div>' +
    '<div style="padding:8px 16px;background:' + c.colorBg + '">' +
      '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;background:' + c.colorAccent + '22;color:' + c.colorAccent + '">✓ 実績500件+</span>' +
    '</div>' +
    '</div>';
}

function _tcReadControls() {
  var c = Object.assign({}, _tcConfig);
  ['colorNavy','colorCta','colorAccent','colorBg','colorText'].forEach(function (k) {
    var el = document.getElementById('tc-hex-' + k);
    if (el && el.value) c[k] = el.value;
  });
  var fh = document.getElementById('tc-fontHeading');
  var fb = document.getElementById('tc-fontBody');
  var fs = document.getElementById('tc-fontSize');
  if (fh) c.fontHeading = fh.value;
  if (fb) c.fontBody    = fb.value;
  if (fs) c.fontSize    = Number(fs.value);
  ['btnRadius','cardRadius','sectionPad','componentGap'].forEach(function (k) {
    var el = document.getElementById('tc-' + k);
    if (el) c[k] = Number(el.value);
  });
  return c;
}

function _tcFillPanes() {
  var c = _tcConfig;

  var colorDefs = [
    { key: 'colorNavy',   label: 'ヒーロー背景色',  sub: 'ナビ・ヒーローセクション' },
    { key: 'colorCta',    label: 'CTAボタン色',      sub: '予約・見積もりボタン' },
    { key: 'colorAccent', label: 'アクセント色',      sub: 'バッジ・ハイライト' },
    { key: 'colorBg',     label: 'ページ背景色',      sub: 'メインコンテンツ背景' },
    { key: 'colorText',   label: 'テキスト色',        sub: '本文・ラベル' },
  ];
  var cpEl = document.getElementById('tcPane-colors');
  if (cpEl) cpEl.innerHTML = colorDefs.map(function (d) {
    return '<div class="tc-row">' +
      '<div><div class="tc-row-label">' + esc(d.label) + '</div><div class="tc-row-sub">' + esc(d.sub) + '</div></div>' +
      '<div class="tc-color-wrap">' +
        '<button class="tc-color-btn" style="background:' + c[d.key] + '" title="カラーピッカー">' +
          '<input type="color" id="tc-picker-' + d.key + '" value="' + c[d.key] + '">' +
        '</button>' +
        '<input class="tc-color-hex" id="tc-hex-' + d.key + '" type="text" value="' + c[d.key] + '" maxlength="7" placeholder="#000000">' +
      '</div>' +
    '</div>';
  }).join('');

  var fontOpts = [
    { v: "'Noto Sans JP', sans-serif", l: 'Noto Sans JP' },
    { v: "'Inter', sans-serif",        l: 'Inter' },
    { v: "'Georgia', serif",           l: 'Georgia (Serif)' },
    { v: "'Courier New', monospace",   l: 'Courier New' },
    { v: "system-ui, sans-serif",      l: 'System UI' },
  ];
  function selOpts(opts, cur) {
    return opts.map(function (o) { return '<option value="' + o.v + '"' + (cur === o.v ? ' selected' : '') + '>' + o.l + '</option>'; }).join('');
  }
  var fpEl = document.getElementById('tcPane-fonts');
  if (fpEl) fpEl.innerHTML =
    '<div class="tc-row"><div><div class="tc-row-label">見出しフォント</div><div class="tc-row-sub">h1・h2・h3</div></div><select class="tc-select" id="tc-fontHeading">' + selOpts(fontOpts, c.fontHeading) + '</select></div>' +
    '<div class="tc-row"><div><div class="tc-row-label">本文フォント</div><div class="tc-row-sub">段落・ラベル</div></div><select class="tc-select" id="tc-fontBody">' + selOpts(fontOpts, c.fontBody) + '</select></div>' +
    '<div class="tc-row"><div><div class="tc-row-label">基本フォントサイズ</div></div><div class="tc-range-wrap"><input class="tc-range" id="tc-fontSize" type="range" min="12" max="18" step="1" value="' + c.fontSize + '"><span class="tc-range-val" id="tc-fontSize-val">' + c.fontSize + 'px</span></div></div>';

  var bpEl = document.getElementById('tcPane-buttons');
  if (bpEl) bpEl.innerHTML =
    '<div class="tc-row"><div><div class="tc-row-label">ボタンスタイル</div><div class="tc-row-sub">CTA・予約ボタン</div></div>' +
    '<div class="tc-btn-group">' +
      '<button class="tc-btn-opt' + (c.btnStyle==='filled' ?' active':'') + '" data-style="filled"  onclick="_tcSetBtnStyle(\'filled\')">塗りつぶし</button>' +
      '<button class="tc-btn-opt' + (c.btnStyle==='outline'?' active':'') + '" data-style="outline" onclick="_tcSetBtnStyle(\'outline\')">枠線</button>' +
      '<button class="tc-btn-opt' + (c.btnStyle==='soft'   ?' active':'') + '" data-style="soft"    onclick="_tcSetBtnStyle(\'soft\')">ソフト</button>' +
    '</div></div>' +
    '<div class="tc-row"><div><div class="tc-row-label">ボタン角丸</div></div><div class="tc-range-wrap"><input class="tc-range" id="tc-btnRadius" type="range" min="0" max="24" step="1" value="' + c.btnRadius + '"><span class="tc-range-val" id="tc-btnRadius-val">' + c.btnRadius + 'px</span></div></div>';

  var rpEl = document.getElementById('tcPane-radius');
  if (rpEl) rpEl.innerHTML =
    '<div class="tc-row"><div><div class="tc-row-label">カード角丸</div><div class="tc-row-sub">サービスカード・パネル</div></div><div class="tc-range-wrap"><input class="tc-range" id="tc-cardRadius" type="range" min="0" max="24" step="1" value="' + c.cardRadius + '"><span class="tc-range-val" id="tc-cardRadius-val">' + c.cardRadius + 'px</span></div></div>';

  var spEl = document.getElementById('tcPane-spacing');
  if (spEl) spEl.innerHTML =
    '<div class="tc-row"><div><div class="tc-row-label">セクション余白</div><div class="tc-row-sub">各セクションの上下パディング</div></div><div class="tc-range-wrap"><input class="tc-range" id="tc-sectionPad" type="range" min="40" max="120" step="4" value="' + c.sectionPad + '"><span class="tc-range-val" id="tc-sectionPad-val">' + c.sectionPad + 'px</span></div></div>' +
    '<div class="tc-row"><div><div class="tc-row-label">コンポーネント間隔</div><div class="tc-row-sub">カード・要素間のギャップ</div></div><div class="tc-range-wrap"><input class="tc-range" id="tc-componentGap" type="range" min="8" max="48" step="2" value="' + c.componentGap + '"><span class="tc-range-val" id="tc-componentGap-val">' + c.componentGap + 'px</span></div></div>';
}

function _tcBindEvents() {
  var view = document.getElementById('wmc-view-theme');
  if (!view) return;

  view.querySelectorAll('.tc-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      view.querySelectorAll('.tc-tab').forEach(function (t)  { t.classList.remove('active'); });
      view.querySelectorAll('.tc-pane').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var pane = document.getElementById('tcPane-' + tab.dataset.tab);
      if (pane) pane.classList.add('active');
    });
  });

  ['colorNavy','colorCta','colorAccent','colorBg','colorText'].forEach(function (k) {
    var picker = document.getElementById('tc-picker-' + k);
    var hexIn  = document.getElementById('tc-hex-' + k);
    var swatch = picker && picker.parentElement;
    if (picker) picker.addEventListener('input', function () {
      _tcConfig[k] = this.value;
      if (hexIn)  hexIn.value  = this.value;
      if (swatch) swatch.style.background = this.value;
      _tcUpdatePreview();
    });
    if (hexIn) hexIn.addEventListener('change', function () {
      var v = this.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
      _tcConfig[k] = v;
      if (picker) picker.value = v;
      if (swatch) swatch.style.background = v;
      _tcUpdatePreview();
    });
  });

  var fh = document.getElementById('tc-fontHeading');
  var fb = document.getElementById('tc-fontBody');
  if (fh) fh.addEventListener('change', function () { _tcConfig.fontHeading = this.value; _tcUpdatePreview(); });
  if (fb) fb.addEventListener('change', function () { _tcConfig.fontBody    = this.value; _tcUpdatePreview(); });

  [
    { id: 'tc-fontSize',     key: 'fontSize',     valId: 'tc-fontSize-val'     },
    { id: 'tc-btnRadius',    key: 'btnRadius',    valId: 'tc-btnRadius-val'    },
    { id: 'tc-cardRadius',   key: 'cardRadius',   valId: 'tc-cardRadius-val'   },
    { id: 'tc-sectionPad',   key: 'sectionPad',   valId: 'tc-sectionPad-val'   },
    { id: 'tc-componentGap', key: 'componentGap', valId: 'tc-componentGap-val' },
  ].forEach(function (r) {
    var el = document.getElementById(r.id);
    if (!el) return;
    el.addEventListener('input', function () {
      _tcConfig[r.key] = Number(this.value);
      var v = document.getElementById(r.valId);
      if (v) v.textContent = this.value + 'px';
      _tcUpdatePreview();
    });
  });
}

function _tcSetBtnStyle(style) {
  _tcConfig.btnStyle = style;
  document.querySelectorAll('#wmc-view-theme .tc-btn-opt').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.style === style);
  });
  _tcUpdatePreview();
}

function _wmcRenderTheme() {
  _tcLoad();
  _tcFillPanes();
  _tcBindEvents();
  _tcUpdatePreview();

  var appliedAt = localStorage.getItem('hm_theme_applied_at');
  var banner    = document.getElementById('tcAppliedBanner');
  if (banner && appliedAt) {
    banner.style.display = 'block';
    var d = new Date(appliedAt);
    banner.innerHTML = '<div class="tc-applied-info">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>' +
      '<span>最終適用: ' + d.toLocaleDateString('ja-JP') + ' ' + _padZ(d.getHours()) + ':' + _padZ(d.getMinutes()) +
      ' — <a href="/" target="_blank" style="color:var(--blue)">公開サイトを確認する →</a></span>' +
    '</div>';
  }
}
