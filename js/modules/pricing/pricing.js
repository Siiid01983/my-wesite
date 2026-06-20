'use strict';

/* ════════════════════════════════════════════════════════
   PRICING MANAGEMENT
   ════════════════════════════════════════════════════════ */
const PRICING_SERVICES = [
  { key: '単身引越し',             label: '単身引越し',    en: 'Single Moving' },
  { key: 'カップル・ご夫婦引越し', label: 'カップル引越し', en: 'Couple Moving' },
  { key: '学生・新生活引越し',     label: '学生引越し',    en: 'Student Moving' },
  { key: '不用品回収・処分サービス', label: '不用品処分',   en: 'Disposal Service' }
];
const PRICING_FIELDS = [
  { key: 'base',      label: '基本料金',         sub: '引越しの基本費用',       unit: '円',    step: 1000 },
  { key: 'distPerKm', label: '距離料金（/km）',   sub: '1kmあたりの追加料金',    unit: '円/km', step: 10 },
  { key: 'floorFee',  label: '階数料金（/階）',   sub: '2階以上・1階あたりの料金', unit: '円/階', step: 500 },
  { key: 'weekend',   label: '土日・祝日割増',    sub: '土日・祝日の追加料金',    unit: '円',   step: 500 },
  { key: 'sameday',   label: '当日申込割増',      sub: '当日のご依頼の追加料金',  unit: '円',   step: 1000 }
];

let _pricingActiveIdx = 0;

function _renderPricingUI() {
  const prices = Adapter.getPrices();

  let tabs = '<div class="media-tabs" id="pricingTabs" style="margin:-16px -16px 0;padding:0 16px">';
  PRICING_SERVICES.forEach((svc, i) => {
    tabs += `<button class="media-tab${i===_pricingActiveIdx?' active':''}" onclick="switchPricingTab(${i})">${esc(svc.label)}</button>`;
  });
  tabs += '</div>';

  let panels = '';
  PRICING_SERVICES.forEach((svc, i) => {
    const cfg = prices[svc.key] || {};
    panels += `<div id="ptab-${i}" style="margin-top:16px;${i===_pricingActiveIdx?'':'display:none'}">`;
    panels += `<div style="margin-bottom:14px;padding:10px 14px;background:rgba(37,99,235,.05);border:1px solid rgba(37,99,235,.15);border-radius:8px;display:flex;align-items:center;gap:10px">
      <svg viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0;color:var(--blue)"><path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
      <span style="font-size:12px;color:var(--blue);font-weight:600">${esc(svc.label)}</span>
      <span style="font-size:11px;color:var(--gray-2)">${esc(svc.en)}</span>
    </div>`;
    PRICING_FIELDS.forEach(f => {
      const val = cfg[f.key] != null ? cfg[f.key] : '';
      panels += `<div class="settings-row">
        <div>
          <div class="settings-label">${esc(f.label)}</div>
          <div class="settings-sub">${esc(f.sub)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:12px;color:var(--gray-2)">¥</span>
          <input type="number" class="price-input" data-svc-idx="${i}" data-key="${f.key}" value="${val}" min="0" step="${f.step}" style="width:120px" />
          <span style="font-size:11px;color:var(--gray-2);white-space:nowrap">${esc(f.unit)}</span>
        </div>
      </div>`;
    });
    panels += '</div>';
  });

  const actions = `<div style="margin-top:20px;display:flex;gap:8px;align-items:center;padding-top:16px;border-top:1px solid var(--line)">
    <button class="btn btn-primary" onclick="savePricing()">
      <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
      保存して反映
    </button>
    <button class="btn btn-ghost" onclick="_pricingActiveIdx=0;_renderPricingUI()">リセット</button>
    <span id="pricingSaveInd" style="font-size:11px;color:var(--green);opacity:0;transition:opacity .3s;font-weight:500">✓ 保存しました</span>
  </div>`;

  document.getElementById('pricingBody').innerHTML = tabs + panels + actions;
}

function renderPricing() { _renderPricingUI(); }

function _syncPricingFromApi() {
  if (!Adapter.apiReady) return;
  _dpSync('hm_data', {key:'hm_prices'}, () => Adapter.syncPrices(), 'view-pricing', _renderPricingUI);
}

function switchPricingTab(idx) {
  _pricingActiveIdx = idx;
  PRICING_SERVICES.forEach((_, i) => {
    const panel = document.getElementById('ptab-' + i);
    if (panel) panel.style.display = i === idx ? '' : 'none';
  });
  document.querySelectorAll('#pricingTabs .media-tab').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
}

function savePricing() {
  const prices = Adapter.getPrices();
  document.querySelectorAll('#pricingBody .price-input[data-svc-idx]').forEach(inp => {
    const i = parseInt(inp.dataset.svcIdx);
    const key = inp.dataset.key;
    const svc = PRICING_SERVICES[i];
    if (!svc) return;
    if (!prices[svc.key]) prices[svc.key] = {};
    prices[svc.key][key] = parseInt(inp.value) || 0;
  });
  Adapter.savePrices(prices);
  const ind = document.getElementById('pricingSaveInd');
  if (ind) { ind.style.opacity = '1'; setTimeout(() => { ind.style.opacity = '0'; }, 2500); }
  toast('料金を保存しました・サイトに即時反映');
}

function printPricing() {
  const prices = Adapter.getPrices();
  const e = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* header row: service names */
  const thCells = PRICING_SERVICES.map(svc =>
    `<th style="background:#f8f9fa;font-weight:600;text-align:right;padding:9px 14px;border:1px solid #e5e7eb;font-size:11px;color:#0b0f17;white-space:nowrap">${e(svc.label)}<br><span style="font-size:9px;font-weight:400;color:#9ca3af">${e(svc.en)}</span></th>`
  ).join('');

  /* one row per pricing field */
  const bodyRows = PRICING_FIELDS.map((f, fi) => {
    const bg = fi % 2 === 1 ? 'background:#fafafa' : '';
    const cells = PRICING_SERVICES.map(svc => {
      const cfg = prices[svc.key] || {};
      const val = cfg[f.key] != null ? cfg[f.key] : 0;
      return `<td style="padding:9px 14px;border:1px solid #f0f2f5;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;${bg}">¥${Number(val).toLocaleString()}<span style="font-size:10px;font-weight:400;color:#9ca3af;margin-left:3px">${e(f.unit)}</span></td>`;
    }).join('');
    return `<tr>
      <td style="padding:9px 14px;border:1px solid #f0f2f5;font-size:12px;font-weight:600;color:#374151;${bg};white-space:nowrap">${e(f.label)}</td>
      <td style="padding:9px 14px;border:1px solid #f0f2f5;font-size:11px;color:#9ca3af;${bg}">${e(f.sub)}</td>
      ${cells}
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>料金表 — Hello Moving</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:13px;color:#0b0f17;background:#fff;padding:32px 36px}
@media print{body{padding:0}@page{margin:14mm 12mm;size:A4 landscape}}
</style></head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #0a1f44;margin-bottom:24px">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:40px;height:40px;border-radius:10px;background:#1D9E75;color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>
    <div>
      <div style="font-size:17px;font-weight:700;color:#0a1f44;line-height:1.2">Hello Moving</div>
      <div style="font-size:10px;color:#6b7280;margin-top:1px">ハローム―ビング</div>
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;color:#0a1f44">料金表</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px">
  <thead>
    <tr>
      <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:9px 14px;border:1px solid #e5e7eb;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">料金項目</th>
      <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:9px 14px;border:1px solid #e5e7eb;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">説明</th>
      ${thCells}
    </tr>
  </thead>
  <tbody>${bodyRows}</tbody>
</table>

<div style="background:#f0fdf4;border:1px solid #10b98133;border-radius:8px;padding:12px 16px;font-size:11px;color:#374151;line-height:1.8;margin-bottom:24px">
  <strong style="color:#059669">ご注意：</strong> 表示金額は基本料金です。実際の料金は距離・階数・日程等により異なります。最終的な料金はお見積り時にご確認ください。
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7">
    <div>Hello Moving — 引越し専門サービス</div>
    <div>このドキュメントは管理システムから自動生成されました</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7">
    <div style="font-weight:600;color:#0b0f17">Hello Moving</div>
    <div>contact@hello-moving.com</div>
  </div>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=960,height=700');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}
