#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   migrate-from-supabase.mjs   (one-time export tool — no SDK, plain fetch)

   Exports every table from a still-running Supabase project into a MySQL import
   file:  hm-api/data-export.sql

   Run it BEFORE you decommission the Supabase project, then import the file into
   your cPanel MySQL database (phpMyAdmin → Import) AFTER schema.mysql.sql.

   Usage:
     node tools/migrate-from-supabase.mjs \
       --url https://xxxx.supabase.co --key <anon-or-service-key>

   This tool talks to the Supabase REST API directly with fetch() — the project
   has NO @supabase/supabase-js dependency.
   ════════════════════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => {
    if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
    return a;
  }, [])
);

const URL = args.url, KEY = args.key;
if (!URL || !KEY) {
  console.error('Usage: node tools/migrate-from-supabase.mjs --url https://<ref>.supabase.co --key <anon-or-service-key>');
  process.exit(1);
}
const BASE = URL.replace(/\/+$/, '');

const TABLES = {
  hm_data:               ['id','key','value','updated_at'],
  bookings:              ['id','customer_name','customer_email','customer_phone','booking_date','service_id','status','notes','items','created_at','updated_at'],
  calendar_availability: ['id','date','status','updated_at'],
  reviews:               ['id','reference_id','customer_name','rating','review_text','approved','published','headline','service','date_label','location','source','booking_reference','created_at'],
  services:              ['id','reference_id','title','description','display_order','active','badge','cta_text'],
  communications:        ['id','booking_id','customer_email','sender_email','subject','message','direction','created_at','created_by','email_status','email_error','sent_at'],
  inbox_messages:        ['id','sender','email','subject','body','booking_id','created_at'],
  audit_log:             ['id','created_at','actor','action','target_type','target_id','details'],
};
const JSON_COLS = { hm_data: ['value'], bookings: ['items'] };
const BOOL_COLS = { reviews: ['approved','published'], services: ['active'] };

function sqlVal(table, col, v) {
  if (v === null || v === undefined) return 'NULL';
  if ((JSON_COLS[table] || []).includes(col)) return q(JSON.stringify(v));
  if ((BOOL_COLS[table] || []).includes(col)) return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return q(String(v));
}
function q(s) { return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

async function fetchTable(table) {
  const res = await fetch(`${BASE}/rest/v1/${table}?select=*`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const out = ['-- Hello Moving — data export from Supabase', 'SET NAMES utf8mb4;', ''];

for (const [table, cols] of Object.entries(TABLES)) {
  let data;
  try { data = await fetchTable(table); }
  catch (e) { console.warn(`! ${table}: ${e.message} (skipped)`); continue; }
  if (!data || !data.length) { console.log(`· ${table}: 0 rows`); continue; }
  console.log(`✓ ${table}: ${data.length} rows`);
  for (const row of data) {
    const vals = cols.map((c) => sqlVal(table, c, row[c])).join(',');
    out.push(`INSERT INTO \`${table}\` (${cols.map((c) => '`' + c + '`').join(',')}) VALUES (${vals});`);
  }
  out.push('');
}

const dest = new URL('../hm-api/data-export.sql', import.meta.url);
writeFileSync(dest, out.join('\n'), 'utf8');
console.log('\nWrote', dest.pathname);
