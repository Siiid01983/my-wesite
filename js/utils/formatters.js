'use strict';

/* ════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ════════════════════════════════════════════════════════ */
const MN = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const DN = ['日','月','火','水','木','金','土'];
const ST_MAP = {
  '新規':'badge-new','確認中':'badge-review','確定':'badge-confirmed',
  '完了':'badge-done','キャンセル':'badge-cancel'
};

const pad = n => String(n).padStart(2,'0');
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const isPast = ds => ds < todayStr();

function fmtD(ds) {
  if (!ds) return '—';
  const d = new Date(ds + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${DN[d.getDay()]}）`;
}
function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function genId() {
  const d = new Date();
  return `HM-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
}
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function badge(st) { return `<span class="badge ${ST_MAP[st]||'badge-new'}">${esc(st||'新規')}</span>`; }

function toast(msg, dur=2400) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), dur);
}
