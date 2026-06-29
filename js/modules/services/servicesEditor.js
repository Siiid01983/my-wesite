'use strict';

/* ════════════════════════════════════════════════════════
   SERVICE MANAGEMENT
   ════════════════════════════════════════════════════════ */
let _svcId = null;

function _renderServicesUI() {
  const svcs = Adapter.getServices();
  const meta = Adapter.getSvcMeta();
  document.getElementById('svcMetaEyebrow').value = meta.eyebrow || '';
  document.getElementById('svcMetaTitle').value   = meta.title   || '';
  document.getElementById('svcMetaLead').value    = meta.lead    || '';
  if (!svcs.length) {
    document.getElementById('servicesWrap').innerHTML = emptyHTML('サービスがありません');
  } else {
    const rows = svcs.map((s, i) => `<tr>
      <td style="text-align:center;font-weight:700;color:var(--gray-2);width:36px">${i + 1}</td>
      <td><strong>${esc(s.title||'—')}</strong></td>
      <td class="td-truncate td-sm">${esc(s.description||'—')}</td>
      <td>${s.badge ? `<span class="badge badge-new">${esc(s.badge)}</span>` : '<span class="td-sm">—</span>'}</td>
      <td>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="moveSvc('${esc(s.id)}',-1)" ${i===0?'disabled':''} title="上へ">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="moveSvc('${esc(s.id)}',1)" ${i===svcs.length-1?'disabled':''} title="下へ">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openSvcEdit('${esc(s.id)}')">編集</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="delSvc('${esc(s.id)}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
    document.getElementById('servicesWrap').innerHTML = `
      <table><thead><tr>
        <th style="width:36px">#</th><th>サービス名</th><th>説明</th><th>バッジ</th><th>操作</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }
  liveSvcPreview();
  renderSvcHistory();
}

function renderServices() { _renderServicesUI(); }

function _syncServicesFromApi() {
  if (!Adapter.apiReady) return;
  _dpSync('services', null, () => Adapter.syncServices(), 'view-services', _renderServicesUI);
}

function liveSvcPreview() {
  const eyebrow = document.getElementById('svcMetaEyebrow').value;
  const title   = document.getElementById('svcMetaTitle').value;
  const lead    = document.getElementById('svcMetaLead').value;
  const svcs    = Adapter.getServices();
  document.getElementById('svcPrevEyebrow').textContent = eyebrow;
  document.getElementById('svcPrevTitle').textContent   = title;
  document.getElementById('svcPrevLead').textContent    = lead;
  document.getElementById('svcPrevCards').innerHTML = svcs.map((s, i) =>
    `<div class="svc-prev-card${i === 0 ? ' svc-prev-card-feat' : ''}">
       ${s.badge ? `<div class="svc-prev-card-badge">${esc(s.badge)}</div>` : ''}
       <div class="svc-prev-card-title">${esc(s.title || '—')}</div>
       <div class="svc-prev-card-desc">${esc(s.description || '')}</div>
       ${s.cta_text ? `<div class="svc-prev-card-cta">${esc(s.cta_text)}</div>` : ''}
     </div>`
  ).join('');
}

function moveSvc(id, dir) {
  const svcs = Adapter.getServices();
  const idx  = svcs.findIndex(s => s.id === id);
  if (idx < 0) return;
  const next = idx + dir;
  if (next < 0 || next >= svcs.length) return;
  [svcs[idx], svcs[next]] = [svcs[next], svcs[idx]];
  Adapter.saveServices(svcs);
  renderServices();
}

function openSvcModal() {
  _svcId = null;
  document.getElementById('svcModalTitle').textContent = 'サービスを追加';
  document.getElementById('svcTitle').value   = '';
  document.getElementById('svcDesc').value    = '';
  document.getElementById('svcBadge').value   = '';
  document.getElementById('svcCtaText').value = '無料お見積り →';
  updateSvcModalPrev();
  document.getElementById('svcModal').classList.add('open');
}

function openSvcEdit(id) {
  const s = Adapter.getServices().find(s => s.id === id); if (!s) return;
  _svcId = id;
  document.getElementById('svcModalTitle').textContent = 'サービスを編集';
  document.getElementById('svcTitle').value   = s.title       || '';
  document.getElementById('svcDesc').value    = s.description || '';
  document.getElementById('svcBadge').value   = s.badge       || '';
  document.getElementById('svcCtaText').value = s.cta_text    || '';
  updateSvcModalPrev();
  document.getElementById('svcModal').classList.add('open');
}

function closeSvcModal() { document.getElementById('svcModal').classList.remove('open'); }

function updateSvcModalPrev() {
  const title = document.getElementById('svcTitle').value;
  const desc  = document.getElementById('svcDesc').value;
  const badge = document.getElementById('svcBadge').value;
  const cta   = document.getElementById('svcCtaText').value;
  const g = id => document.getElementById(id);
  g('svcPrevModalTitle').textContent = title || '（サービス名）';
  g('svcPrevModalDesc').textContent  = desc  || '';
  g('svcPrevModalCta').textContent   = cta   || '';
  const b = g('svcPrevModalBadge');
  if (badge) { b.textContent = badge; b.style.display = 'inline-block'; }
  else        { b.style.display = 'none'; }
}

function saveSvc() {
  const title       = document.getElementById('svcTitle').value.trim();
  const description = document.getElementById('svcDesc').value.trim();
  const badge       = document.getElementById('svcBadge').value.trim();
  const cta_text    = document.getElementById('svcCtaText').value.trim();
  if (!title) { alert('サービス名を入力してください'); return; }
  if (_svcId) {
    Adapter.updateService(_svcId, { title, description, badge, cta_text });
    toast('サービスを更新しました');
  } else {
    Adapter.addService({ id: 'SVC-' + Date.now(), title, description, badge, cta_text });
    toast('サービスを追加しました');
  }
  closeSvcModal();
  renderServices();
}

function delSvc(id) {
  if (!confirm('このサービスを削除しますか？')) return;
  Adapter.deleteService(id);
  toast('削除しました');
  renderServices();
}

function saveServicesAll() {
  const meta = {
    eyebrow: document.getElementById('svcMetaEyebrow').value.trim(),
    title:   document.getElementById('svcMetaTitle').value.trim(),
    lead:    document.getElementById('svcMetaLead').value.trim()
  };
  Adapter.pushSvcHistory({ meta: Adapter.getSvcMeta(), services: Adapter.getServices() });
  Adapter.saveSvcMeta(meta);
  renderSvcHistory();

  /* The Services view also hosts the image-manager panel (wmcServices.js), which
     historically had its OWN separate "すべて保存" button that users miss — so
     service-image edits were never persisted (hm_service_images stayed empty).
     Persist images in the SAME click here, but only when that panel is actually
     rendered with its cards (so we never overwrite hm_service_images with {} on a
     page/role where the image manager isn't shown, and this stays a no-op on
     admin.html where wmcServices.js isn't loaded). */
  if (typeof _wmcSvcSaveAll === 'function' && document.querySelector('.wmc-svc-img-card')) {
    try { _wmcSvcSaveAll(); } catch (e) { console.warn('[services] image-config save failed:', e); }
  }

  const ind = document.getElementById('svcSaveInd');
  ind.style.opacity = '1';
  clearTimeout(ind._t);
  ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
}

function renderSvcHistory() {
  const hist = Adapter.getSvcHistory();
  const el   = document.getElementById('svcHistoryList');
  if (!hist.length) {
    el.innerHTML = '<div class="empty" style="padding:16px 0"><p>まだバージョンがありません</p></div>';
    return;
  }
  el.innerHTML = hist.map((entry, i) => {
    const d  = new Date(entry.ts);
    const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const snap = (entry.meta && entry.meta.title) || '（タイトルなし）';
    return `<div class="hhist-item">
      <div class="hhist-meta">
        <div class="hhist-time">${ts}</div>
        <div class="hhist-snap">${esc(snap)} — ${(entry.services||[]).length}件</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreSvcVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreSvcVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getSvcHistory();
  if (!hist[idx]) return;
  Adapter.pushSvcHistory({ meta: Adapter.getSvcMeta(), services: Adapter.getServices() });
  Adapter.saveSvcMeta(hist[idx].meta);
  Adapter.saveServices(hist[idx].services);
  renderServices();
  toast('バージョンを復元しました');
}
