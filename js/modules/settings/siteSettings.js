'use strict';

/* ════════════════════════════════════════════════════════
   WEBSITE SETTINGS
   Company info · Contact · Social links · Branding
   Stored in localStorage hm_site_settings + API hm_data
   ════════════════════════════════════════════════════════ */

const _SETTINGS_KEY = 'hm_site_settings';

const _SETTINGS_DEFAULT = {
  company: {
    name: 'ハロームービング', nameEn: 'Hello Moving',
    description: '', industry: '引越し・運送サービス',
  },
  contact: {
    phone: '', email: '', address: '',
    address2: '', city: '', prefecture: '', postal: '',
  },
  social: {
    twitter: '', facebook: '', instagram: '', line: '', youtube: '',
  },
  brand: {
    logo: '', favicon: '', color: '#0a1f44',
  },
};

const SettingsStore = {
  get() {
    try {
      const raw = JSON.parse(localStorage.getItem(_SETTINGS_KEY) || 'null');
      return _deepMerge(_SETTINGS_DEFAULT, raw || {});
    } catch { return Object.assign({}, _SETTINGS_DEFAULT); }
  },
  save(data) {
    try { localStorage.setItem(_SETTINGS_KEY, JSON.stringify(data)); return true; } catch { return false; }
  },
};

function _deepMerge(base, override) {
  const out = Object.assign({}, base);
  for (const key of Object.keys(override || {})) {
    if (typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
      out[key] = _deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

/* ── State ── */
let _settingsTab = 'company';

/* ════ Main render ════ */
function renderSiteSettings() {
  const el = document.getElementById('siteSettingsContent');
  if (!el) return;
  const s = SettingsStore.get();
  el.innerHTML = _renderSettingsHeader(s) + _renderSettingsTabs() + _renderSettingsTab(s);
}

function _renderSettingsHeader(s) {
  const logo = s.brand.logo
    ? `<img src="${esc(s.brand.logo)}" style="width:40px;height:40px;border-radius:8px;object-fit:contain;border:1px solid var(--line)" onerror="this.style.display='none'" />`
    : `<div style="width:40px;height:40px;border-radius:8px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700">H</div>`;
  return `<div class="cl-header" style="margin-bottom:16px">
    <div class="cl-header-info" style="display:flex;align-items:center;gap:12px">
      ${logo}
      <div>
        <div class="cl-header-title">${esc(s.company.name || 'ウェブサイト設定')}</div>
        <div class="cl-stats"><span>${esc(s.company.nameEn)}</span><span class="cl-dot">·</span><span>${esc(s.company.industry)}</span></div>
      </div>
    </div>
    <div class="cl-header-controls">
      <button class="btn btn-primary btn-sm" onclick="saveSettings()">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
        すべて保存
      </button>
    </div>
  </div>`;
}

function _renderSettingsTabs() {
  const tabs = [
    { id:'company', label:'基本情報', icon:'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z' },
    { id:'contact', label:'連絡先',   icon:'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z' },
    { id:'social',  label:'SNS',      icon:'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z' },
    { id:'brand',   label:'ブランド', icon:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z' },
  ];
  return `<div class="media-tabs" style="margin-bottom:16px">
    ${tabs.map(t => `<button class="media-tab${_settingsTab===t.id?' active':''}" onclick="switchSettingsTab('${t.id}')" style="display:inline-flex;align-items:center;gap:6px">
      <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="${t.icon}"/></svg>${t.label}
    </button>`).join('')}
  </div>`;
}

function _renderSettingsTab(s) {
  const f = (id, label, type, val, opts={}) => {
    const placeholder = opts.placeholder || '';
    const note = opts.note ? `<div class="settings-sub">${opts.note}</div>` : '';
    const inputEl = type === 'textarea'
      ? `<textarea class="m-input" id="${id}" style="height:80px;font-size:13px">${esc(val || '')}</textarea>`
      : `<input class="m-input" id="${id}" type="${type}" value="${esc(val || '')}" placeholder="${esc(placeholder)}" />`;
    return `<div class="m-field">${note ? `<label class="m-label">${label}</label>${note}` : `<label class="m-label">${label}</label>`}${inputEl}</div>`;
  };

  const socialLink = (id, label, icon, val) =>
    `<div class="m-field"><label class="m-label" style="display:flex;align-items:center;gap:6px">
      <svg viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0">${icon}</svg>${label}
    </label><input class="m-input" id="${id}" type="url" value="${esc(val||'')}" placeholder="https://..." /></div>`;

  switch (_settingsTab) {
    case 'company':
      return `<div class="panel"><div class="panel-body">
        <div class="settings-grid">
          <div>
            <div class="seo-section-head">会社名</div>
            ${f('sCompanyName',    '会社名（日本語）', 'text', s.company.name,    { placeholder:'ハロームービング' })}
            ${f('sCompanyNameEn',  '会社名（英語）',   'text', s.company.nameEn,  { placeholder:'Hello Moving' })}
            ${f('sIndustry',       '業種',             'text', s.company.industry, { placeholder:'引越し・運送サービス' })}
          </div>
          <div>
            <div class="seo-section-head">会社説明</div>
            ${f('sDescription', '会社概要・キャッチコピー', 'textarea', s.company.description, { placeholder:'安心・丁寧な引越しサービスを提供しています' })}
          </div>
        </div>
      </div></div>`;

    case 'contact':
      return `<div class="panel"><div class="panel-body">
        <div class="settings-grid">
          <div>
            <div class="seo-section-head">連絡先</div>
            ${f('sPhone', '電話番号', 'tel', s.contact.phone, { placeholder:'03-xxxx-xxxx' })}
            ${f('sEmail', 'メールアドレス', 'email', s.contact.email, { placeholder:'contact@hello-moving.com' })}
          </div>
          <div>
            <div class="seo-section-head">住所</div>
            ${f('sPostal',     '郵便番号',     'text', s.contact.postal,     { placeholder:'000-0000' })}
            ${f('sPrefecture', '都道府県',     'text', s.contact.prefecture, { placeholder:'東京都' })}
            ${f('sCity',       '市区町村',     'text', s.contact.city,       { placeholder:'渋谷区' })}
            ${f('sAddress',    '番地・建物名', 'text', s.contact.address,    { placeholder:'〇〇町1-2-3' })}
          </div>
        </div>
      </div></div>`;

    case 'social': {
      const icons = {
        twitter:   '<path fill="currentColor" d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 01-1.93.07 4.28 4.28 0 004 2.98 8.521 8.521 0 01-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>',
        facebook:  '<path fill="currentColor" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>',
        instagram: '<path fill="currentColor" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>',
        line:      '<path fill="currentColor" d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>',
        youtube:   '<path fill="currentColor" d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/>',
      };
      return `<div class="panel"><div class="panel-body">
        <div class="settings-grid">
          ${socialLink('sSocTwitter',   'Twitter / X',  `<path d="${icons.twitter.match(/d="([^"]+)"/)?.[1]}"/>`, s.social.twitter)}
          ${socialLink('sSocFacebook',  'Facebook',     `<path d="${icons.facebook.match(/d="([^"]+)"/)?.[1]}"/>`, s.social.facebook)}
          ${socialLink('sSocInstagram', 'Instagram',    `<path d="${icons.instagram.match(/d="([^"]+)"/)?.[1]}"/>`, s.social.instagram)}
          ${socialLink('sSocLine',      'LINE',         `<path d="${icons.line.match(/d="([^"]+)"/)?.[1]}"/>`, s.social.line)}
          ${socialLink('sSocYoutube',   'YouTube',      `<path d="${icons.youtube.match(/d="([^"]+)"/)?.[1]}"/>`, s.social.youtube)}
        </div>
      </div></div>`;
    }

    case 'brand':
      return `<div class="panel"><div class="panel-body">
        <div class="settings-grid">
          <div>
            <div class="seo-section-head">ロゴ・ファビコン</div>
            <div class="m-field">
              <label class="m-label">ロゴ URL <span style="color:var(--gray-2);font-weight:400">（推奨: SVG または PNG）</span></label>
              <input class="m-input" id="sBrandLogo" type="url" value="${esc(s.brand.logo)}" placeholder="https://..." oninput="_settingsBrandPreview()" />
              <div id="sBrandLogoPreview" style="margin-top:8px">
                ${s.brand.logo ? `<img src="${esc(s.brand.logo)}" style="max-height:60px;max-width:200px;border:1px solid var(--line);border-radius:6px;padding:6px;background:#fff" onerror="this.style.display='none'" />` : ''}
              </div>
            </div>
            <div class="m-field">
              <label class="m-label">ファビコン URL <span style="color:var(--gray-2);font-weight:400">（推奨: 32×32px ICO/PNG）</span></label>
              <input class="m-input" id="sBrandFavicon" type="url" value="${esc(s.brand.favicon)}" placeholder="https://..." />
            </div>
          </div>
          <div>
            <div class="seo-section-head">ブランドカラー</div>
            <div class="m-field">
              <label class="m-label">メインカラー</label>
              <div style="display:flex;gap:10px;align-items:center">
                <input type="color" id="sBrandColor" value="${esc(s.brand.color||'#0a1f44')}" style="width:48px;height:36px;border:1px solid var(--line);border-radius:6px;cursor:pointer;padding:2px" />
                <input class="m-input" id="sBrandColorHex" type="text" value="${esc(s.brand.color||'#0a1f44')}" placeholder="#0a1f44" style="flex:1" oninput="document.getElementById('sBrandColor').value=this.value" />
              </div>
              <div style="margin-top:10px;padding:12px;border-radius:8px;background:${esc(s.brand.color||'#0a1f44')};color:#fff;font-size:12px;text-align:center;font-weight:600" id="sBrandColorPreview">
                Hello Moving — カラープレビュー
              </div>
            </div>
          </div>
        </div>
      </div></div>`;

    default:
      return '';
  }
}

function _settingsBrandPreview() {
  const url = document.getElementById('sBrandLogo')?.value;
  const el  = document.getElementById('sBrandLogoPreview');
  if (!el) return;
  el.innerHTML = url ? `<img src="${esc(url)}" style="max-height:60px;max-width:200px;border:1px solid var(--line);border-radius:6px;padding:6px;background:#fff" onerror="this.style.display='none'" />` : '';
}

function switchSettingsTab(tab) {
  _settingsTab = tab;
  renderSiteSettings();
}

function saveSettings() {
  const color = document.getElementById('sBrandColorHex')?.value || document.getElementById('sBrandColor')?.value || '#0a1f44';
  // Update brand color preview
  const prev = document.getElementById('sBrandColorPreview');
  if (prev) prev.style.background = color;

  const existing = SettingsStore.get();

  const data = {
    company: {
      name:        document.getElementById('sCompanyName')?.value.trim()   || existing.company.name,
      nameEn:      document.getElementById('sCompanyNameEn')?.value.trim() || existing.company.nameEn,
      description: document.getElementById('sDescription')?.value.trim()   || existing.company.description,
      industry:    document.getElementById('sIndustry')?.value.trim()       || existing.company.industry,
    },
    contact: {
      phone:      document.getElementById('sPhone')?.value.trim()      || existing.contact.phone,
      email:      document.getElementById('sEmail')?.value.trim()      || existing.contact.email,
      address:    document.getElementById('sAddress')?.value.trim()    || existing.contact.address,
      address2:   existing.contact.address2,
      city:       document.getElementById('sCity')?.value.trim()       || existing.contact.city,
      prefecture: document.getElementById('sPrefecture')?.value.trim() || existing.contact.prefecture,
      postal:     document.getElementById('sPostal')?.value.trim()     || existing.contact.postal,
    },
    social: {
      twitter:   document.getElementById('sSocTwitter')?.value.trim()   || existing.social.twitter,
      facebook:  document.getElementById('sSocFacebook')?.value.trim()  || existing.social.facebook,
      instagram: document.getElementById('sSocInstagram')?.value.trim() || existing.social.instagram,
      line:      document.getElementById('sSocLine')?.value.trim()      || existing.social.line,
      youtube:   document.getElementById('sSocYoutube')?.value.trim()   || existing.social.youtube,
    },
    brand: {
      logo:    document.getElementById('sBrandLogo')?.value.trim()    || existing.brand.logo,
      favicon: document.getElementById('sBrandFavicon')?.value.trim() || existing.brand.favicon,
      color,
    },
  };

  SettingsStore.save(data);
  toast('設定を保存しました');

  // Sync to API
  if (typeof Adapter !== 'undefined' && Adapter.apiReady) {
    try { Adapter.saveData('hm_settings', data).catch(() => {}); } catch {}
  }

  renderSiteSettings();
}

function _syncSiteSettingsFromApi() {
  if (typeof _dpSync === 'undefined' || !Adapter.apiReady) return;
  _dpSync('hm_data', { key: 'hm_settings' }, () => Adapter.syncData('hm_settings', _SETTINGS_KEY), 'view-site-settings', renderSiteSettings);
}
