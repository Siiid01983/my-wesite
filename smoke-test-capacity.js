#!/usr/bin/env node
'use strict';
/*
  smoke-test-capacity.js — verify the capacity system is live on the server.

  Read-only: it makes a single GET to availability.php (the public endpoint that
  reports per-band capacity). It never creates a booking or writes anything.

  Usage:
    API_BASE=https://hello-moving.com/hm-api API_KEY=<key> node smoke-test-capacity.js [YYYY-MM-DD]

  Config (same source as the project):
    API_BASE  — public hm-api URL. Default: https://hello-moving.com/hm-api
    API_KEY   — must match hm-api/_config.php 'api_key' if the gate is enabled.
    argv[2]   — optional date to probe (default: tomorrow).

  Requires Node 18+ (global fetch). Exit code 0 on SUCCESS, 1 on failure.

  NOTE on the flag: availability.php exposes the `capacity` block (proving the
  engine is DEPLOYED and reporting) but not the raw `capacity_enabled` value —
  that flag only affects create-booking's reserve path. A well-formed `capacity`
  block => engine live; "configured beyond default(1)" hints the feature is in
  active use. Full flag verification needs an admin/booking test (out of scope).
*/

const API_BASE = (process.env.API_BASE || 'https://hello-moving.com/hm-api').replace(/\/+$/, '');
const API_KEY  = process.env.API_KEY || '';
const BANDS = ['am', 'pm', 'ev', 'nt'];
const VALID_STATUS = ['available', 'limited', 'full', 'closed'];

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DATE = process.argv[2] || tomorrow();

const errors = [];
const log = (...a) => console.log(...a);

// Exported for the self-test; validates a parsed availability.php response.
function checkResponse(status, body) {
  const errs = [];

  // (3) no 500-range error from the endpoint.
  if (status >= 500) errs.push(`Server error: HTTP ${status} (500-range) — check hm-api logs / _capacity.php`);

  // (1) successful response.
  if (status !== 200) errs.push(`Expected HTTP 200, got ${status}`);
  if (!body || typeof body !== 'object') { errs.push('Response body is not a JSON object'); return errs; }
  if (body.ok !== true) errs.push(`Expected {ok:true}, got ok=${JSON.stringify(body.ok)} error=${JSON.stringify(body.error)}`);

  // (2) capacity structure (proves the capacity engine is deployed + reporting).
  if (!body.capacity || typeof body.capacity !== 'object') {
    errs.push("Missing 'capacity' block — capacity engine not live (deploy hm-api/_capacity.php + availability.php)");
    return errs;
  }
  for (const b of BANDS) {
    const c = body.capacity[b];
    if (!c || typeof c !== 'object') { errs.push(`capacity.${b} missing`); continue; }
    for (const k of ['status', 'capacity', 'used', 'remaining', 'closed']) {
      if (!(k in c)) errs.push(`capacity.${b}.${k} missing`);
    }
    if (typeof c.capacity !== 'number' || c.capacity < 0) errs.push(`capacity.${b}.capacity invalid: ${JSON.stringify(c.capacity)}`);
    if (typeof c.used !== 'number' || c.used < 0) errs.push(`capacity.${b}.used invalid: ${JSON.stringify(c.used)}`);
    if (c.status !== undefined && !VALID_STATUS.includes(c.status)) errs.push(`capacity.${b}.status unexpected: ${JSON.stringify(c.status)}`);
  }
  return errs;
}

async function main() {
  const url = `${API_BASE}/availability.php?date=${encodeURIComponent(DATE)}`;
  log(`Capacity smoke test`);
  log(`  API_BASE : ${API_BASE}`);
  log(`  date     : ${DATE}`);
  if (!API_KEY) log('  ⚠ API_KEY is empty — if the server gate is enabled this will 401.');
  log(`→ GET ${url}\n`);

  let res, text, body;
  try {
    res = await fetch(url, { headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' } });
  } catch (e) {
    errors.push(`Network/fetch error: ${e && e.message ? e.message : e}`);
    return finish();
  }

  text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    if (res.status >= 500) errors.push(`Server error: HTTP ${res.status} (500-range)`);
    errors.push(`Response is not valid JSON (HTTP ${res.status}). First 200 chars: ${text.slice(0, 200)}`);
    return finish();
  }

  checkResponse(res.status, body).forEach((e) => errors.push(e));

  if (body && body.capacity) {
    const configured = BANDS.some((b) => body.capacity[b] && body.capacity[b].capacity !== 1);
    log(`  capacity block present ✓`);
    log(`  per-band configured beyond default(1): ${configured ? 'YES (capacity feature in active use)' : 'no (all default 1 — flag off or unconfigured)'}`);
    log(`  snapshot: ${JSON.stringify(body.capacity)}`);
    log(`  hourly flag: ${JSON.stringify(body.hourly)}`);
  }
  finish();
}

function finish() {
  if (errors.length === 0) {
    log('\nSUCCESS — capacity system is live and responding correctly.');
    process.exit(0);
  }
  log(`\nFAILED — ${errors.length} issue(s):`);
  errors.forEach((e, i) => log(`  ${i + 1}. ${e}`));
  process.exit(1);
}

// Run unless imported (allows the self-test to require this file).
if (require.main === module) main();
module.exports = { checkResponse };
