/* ════════════════════════════════════════════════════════════════════════════
   ops-repeat-customer.test.js — Ops returning-customer (リピート) detection.

   Unit tests for ops/js/repeatCustomer.js (Ops.Repeat.annotate). Pure logic,
   no DB / network / browser. Loaded via its CommonJS export.

   Covers the required scenarios:
     • first booking            → no repeat indicator / no previous date
     • second booking           → repeat + the FIRST booking's work date
     • third booking            → repeat + the IMMEDIATELY previous work date
     • same name, different id   → NOT a repeat (name alone is never an identity)
     • a booking is never its own previous date
   Plus: email vs phone identity, phone-formatting insensitivity, and cancelled
   bookings not counting as "actual work".

   Run: node --test tests/ops-repeat-customer.test.js   (npm run test:ops-repeat)
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Repeat = require('../ops/js/repeatCustomer.js');

// Minimal normalized-booking factory (Ops.normalizeBooking shape, only the
// fields the detector reads).
function bk(o) {
  return Object.assign({ dbId: '', name: '', email: '', phone: '', date: '', createdAt: '', statusRaw: 'pending' }, o);
}
// Annotate a fresh copy and return it keyed by dbId for convenient assertions.
function run(list) {
  Repeat.annotate(list);
  const by = {};
  list.forEach((b) => { by[b.dbId] = b; });
  return by;
}

test('first booking → no repeat, no previous date', () => {
  const by = run([ bk({ dbId: 'B1', email: 'a@x.com', date: '2023-12-14' }) ]);
  assert.equal(by.B1.isRepeat, false);
  assert.equal(by.B1.prevWorkDate, '');
});

test('second booking → repeat + the first booking work date', () => {
  const by = run([
    bk({ dbId: 'B1', email: 'a@x.com', date: '2023-12-14' }),
    bk({ dbId: 'B2', email: 'a@x.com', date: '2024-06-01' }),
  ]);
  assert.equal(by.B1.isRepeat, false);
  assert.equal(by.B2.isRepeat, true);
  assert.equal(by.B2.prevWorkDate, '2023-12-14');
});

test('third booking → repeat + the IMMEDIATELY previous date (not the first-ever)', () => {
  const by = run([
    bk({ dbId: 'B1', email: 'a@x.com', date: '2023-12-14' }),
    bk({ dbId: 'B2', email: 'a@x.com', date: '2024-06-01' }),
    bk({ dbId: 'B3', email: 'a@x.com', date: '2026-03-10' }),
  ]);
  assert.equal(by.B3.isRepeat, true);
  assert.equal(by.B3.prevWorkDate, '2024-06-01');   // the 2nd booking, NOT 2023-12-14
});

test('input order does not matter (annotation is by customer timeline)', () => {
  // Newest-first, as the Ops list actually arrives from rest.php.
  const by = run([
    bk({ dbId: 'B3', email: 'a@x.com', date: '2026-03-10', createdAt: '2026-03-01 10:00:00' }),
    bk({ dbId: 'B1', email: 'a@x.com', date: '2023-12-14', createdAt: '2023-12-01 10:00:00' }),
    bk({ dbId: 'B2', email: 'a@x.com', date: '2024-06-01', createdAt: '2024-05-20 10:00:00' }),
  ]);
  assert.equal(by.B1.isRepeat, false);
  assert.equal(by.B2.prevWorkDate, '2023-12-14');
  assert.equal(by.B3.prevWorkDate, '2024-06-01');
});

test('different customers who share a NAME are not repeats', () => {
  const by = run([
    bk({ dbId: 'B1', name: '田中太郎', email: 'tanaka1@x.com', date: '2023-01-01' }),
    bk({ dbId: 'B2', name: '田中太郎', email: 'tanaka2@x.com', date: '2024-01-01' }),
  ]);
  assert.equal(by.B1.isRepeat, false);
  assert.equal(by.B2.isRepeat, false);
});

test('name alone is never a customer identity', () => {
  // No email, no phone — only a shared name. Must NOT be judged a repeat.
  const by = run([
    bk({ dbId: 'B1', name: '佐藤', date: '2023-01-01' }),
    bk({ dbId: 'B2', name: '佐藤', date: '2024-01-01' }),
  ]);
  assert.equal(by.B2.isRepeat, false);
  assert.equal(by.B2.prevWorkDate, '');
});

test('a booking is never its own previous date', () => {
  const list = [
    bk({ dbId: 'B1', email: 'a@x.com', date: '2023-12-14' }),
    bk({ dbId: 'B2', email: 'a@x.com', date: '2024-06-01' }),
    bk({ dbId: 'B3', email: 'a@x.com', date: '2026-03-10' }),
  ];
  Repeat.annotate(list);
  list.forEach((b) => { assert.notEqual(b.prevWorkDate, b.date, b.dbId + ' must not reference its own date'); });
});

test('identity falls back to phone when no email, and ignores phone formatting', () => {
  const by = run([
    bk({ dbId: 'B1', phone: '090-1234-5678', date: '2023-05-05' }),
    bk({ dbId: 'B2', phone: '09012345678',  date: '2024-05-05' }),   // same number, different formatting
  ]);
  assert.equal(by.B1.isRepeat, false);
  assert.equal(by.B2.isRepeat, true);
  assert.equal(by.B2.prevWorkDate, '2023-05-05');
});

test('email takes precedence over phone for identity', () => {
  // Same email → one customer, even though phones differ.
  const by = run([
    bk({ dbId: 'B1', email: 'a@x.com', phone: '09011112222', date: '2023-05-05' }),
    bk({ dbId: 'B2', email: 'a@x.com', phone: '09033334444', date: '2024-05-05' }),
  ]);
  assert.equal(by.B2.isRepeat, true);
  assert.equal(by.B2.prevWorkDate, '2023-05-05');
});

test('a cancelled previous booking is not an "actual work" record', () => {
  const by = run([
    bk({ dbId: 'B1', email: 'a@x.com', date: '2023-12-14', statusRaw: 'cancelled' }),
    bk({ dbId: 'B2', email: 'a@x.com', date: '2024-06-01', statusRaw: 'pending' }),
    bk({ dbId: 'B3', email: 'a@x.com', date: '2026-03-10', statusRaw: 'pending' }),
  ]);
  // B2's only predecessor was cancelled → no actual previous work.
  assert.equal(by.B2.isRepeat, false);
  assert.equal(by.B2.prevWorkDate, '');
  // B3 follows a real (B2) booking → repeat with B2's date; the cancelled B1 is skipped.
  assert.equal(by.B3.isRepeat, true);
  assert.equal(by.B3.prevWorkDate, '2024-06-01');
});

test('fmtWorkDate renders YYYY年M月D日', () => {
  assert.equal(Repeat.fmtWorkDate('2023-12-14'), '2023年12月14日');
  assert.equal(Repeat.fmtWorkDate('2026-03-10'), '2026年3月10日');
  assert.equal(Repeat.fmtWorkDate(''), '');
});
