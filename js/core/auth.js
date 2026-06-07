'use strict';

/* ════════════════════════════════════════════════════════
   ADMIN UI MODULE
   Auth, navigation, dashboard, all editor UIs, init
   ════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════
   AUTH — hashed credentials, random session token, lockout
   Hardening (Phase 3):
     • Salted SHA-256 (random 16-byte salt per credential set)
     • Legacy unsalted hashes auto-migrated on first successful login
     • Constant-time hash comparison (_safeEqual) — no timing leaks
     • Session token rotated on every navigation (touch)
     • Exponential lockout backoff: 15 min → 30 → 60 → … ≤ 24 h
     • 30-day remember-me expiry stored as {user, exp}
   ════════════════════════════════════════════════════════ */
const Auth = {
  KEY:          'hm_admin_sess',
  CREDS_KEY:    'hm_admin_creds',
  LOCK_KEY:     'hm_admin_lock',
  LOG_KEY:      'hm_admin_log',
  TIMEOUT:      30 * 60 * 1000,
  MAX_ATTEMPTS: 5,
  LOCKOUT_MS:   15 * 60 * 1000,
  REMEMBER_MS:  30 * 24 * 60 * 60 * 1000,
  _timer: null,

  /* Hash with optional salt: SHA-256(salt + ':' + s) or SHA-256(s) for legacy */
  async _hash(s, salt) {
    const input = salt ? salt + ':' + s : s;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },

  /* Constant-time string comparison — always iterates full length to prevent timing attacks */
  _safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const len = Math.max(a.length, b.length);
    const pa  = a.padEnd(len, '\0');
    const pb  = b.padEnd(len, '\0');
    let diff = a.length ^ b.length;
    for (let i = 0; i < len; i++) diff |= pa.charCodeAt(i) ^ pb.charCodeAt(i);
    return diff === 0;
  },

  _mkToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
  },

  async initCreds() {
    if (!localStorage.getItem(this.CREDS_KEY)) {
      const salt = this._mkToken();
      const hash = await this._hash('hello2026', salt);
      localStorage.setItem(this.CREDS_KEY, JSON.stringify({user:'admin@hello-moving.com', hash, salt}));
    }
  },

  _getCreds() {
    try { return JSON.parse(localStorage.getItem(this.CREDS_KEY)); } catch(e) { return null; }
  },

  _getLock() {
    try { return JSON.parse(localStorage.getItem(this.LOCK_KEY)||'{}'); } catch(e) { return {}; }
  },

  isLockedOut() {
    const lk = this._getLock();
    if (!lk.until) return false;
    if (Date.now() < lk.until) return true;
    /* Lockout expired — reset count/until but preserve `times` for backoff escalation */
    const next = {times: lk.times || 0};
    localStorage.setItem(this.LOCK_KEY, JSON.stringify(next));
    return false;
  },

  lockoutMins() {
    const lk = this._getLock();
    return lk.until ? Math.max(1, Math.ceil((lk.until - Date.now()) / 60000)) : 0;
  },

  attemptsLeft() {
    const lk = this._getLock();
    return Math.max(0, this.MAX_ATTEMPTS - (lk.count||0));
  },

  _recordFail() {
    const lk   = this._getLock();
    lk.count   = (lk.count||0) + 1;
    lk.last    = Date.now();
    if (lk.count >= this.MAX_ATTEMPTS) {
      lk.times = (lk.times||0) + 1;
      /* Exponential backoff capped at 24 h */
      const ms = Math.min(this.LOCKOUT_MS * Math.pow(2, lk.times - 1), 24 * 60 * 60 * 1000);
      lk.until = Date.now() + ms;
    }
    localStorage.setItem(this.LOCK_KEY, JSON.stringify(lk));
    this._addLog('fail', lk.count >= this.MAX_ATTEMPTS ? 'locked' : 'wrong_creds');
  },

  _addLog(type, detail) {
    const log = this.getLog();
    log.unshift({type, detail, ts: new Date().toISOString()});
    if (log.length > 30) log.length = 30;
    localStorage.setItem(this.LOG_KEY, JSON.stringify(log));
  },

  getLog() {
    try { return JSON.parse(localStorage.getItem(this.LOG_KEY)||'[]'); } catch(e) { return []; }
  },

  async login(user, pass, remember) {
    if (this.isLockedOut()) return {ok:false, locked:true};
    const creds = this._getCreds();
    if (!creds) return {ok:false, locked:false, left:1};
    /* Always compute hash and compare both fields — prevents timing-based user enumeration */
    const hash      = await this._hash(pass, creds.salt || null);
    const userMatch = this._safeEqual(user, creds.user);
    const hashMatch = this._safeEqual(hash, creds.hash);
    if (userMatch && hashMatch) {
      /* Migrate legacy unsalted hash to salted on first successful login */
      if (!creds.salt) {
        const salt    = this._mkToken();
        const newHash = await this._hash(pass, salt);
        localStorage.setItem(this.CREDS_KEY, JSON.stringify({user:creds.user, hash:newHash, salt}));
      }
      /* Detect default password — works for fresh installs and legacy credentials */
      const fresh       = this._getCreds();
      const defaultHash = await this._hash('hello2026', fresh.salt || null);
      const isDefault   = this._safeEqual(defaultHash, fresh.hash);
      const mustChange  = isDefault || !!fresh.mustChange;
      /* Migrate: clean any legacy mustChange flag out of localStorage creds */
      if (fresh.mustChange) {
        localStorage.setItem(this.CREDS_KEY, JSON.stringify({user:fresh.user, hash:fresh.hash, salt:fresh.salt}));
      }
      localStorage.removeItem(this.LOCK_KEY);
      /* mustChange is stored in the session token (sessionStorage) — not in localStorage.
         This prevents the bypass of deleting the flag from localStorage via DevTools. */
      const sess = {token:this._mkToken(), ts:Date.now()};
      if (mustChange) sess.mustChange = true;
      sessionStorage.setItem(this.KEY, JSON.stringify(sess));
      if (remember) localStorage.setItem('hm_admin_remember', JSON.stringify({user, exp: Date.now() + this.REMEMBER_MS}));
      else          localStorage.removeItem('hm_admin_remember');
      this._addLog('login', 'success');
      return {ok:true, mustChange};
    }
    this._recordFail();
    return {ok:false, locked:this.isLockedOut(), left:this.attemptsLeft()};
  },

  logout() {
    this._addLog('logout', 'manual');
    sessionStorage.removeItem(this.KEY);
    if (typeof Adapter !== 'undefined') Adapter.destroyRealtime();
    showLogin();
  },

  isLoggedIn() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.KEY)||'null');
      if (!s || !s.token) return false;
      if (Date.now() - s.ts > this.TIMEOUT) { sessionStorage.removeItem(this.KEY); return false; }
      return true;
    } catch(e) { return false; }
  },

  /* Rotate session token on every page navigation — prevents token fixation.
     Preserves mustChange in the new token (though touch() is only reached
     when mustChangePassword() is false — go() returns early otherwise). */
  touch() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.KEY)||'null');
      if (s && s.token) {
        const next = {token:this._mkToken(), ts:Date.now()};
        if (s.mustChange) next.mustChange = true;
        sessionStorage.setItem(this.KEY, JSON.stringify(next));
      }
    } catch(e) {}
  },

  async changePassword(current, newPass) {
    const creds = this._getCreds();
    if (!creds) return false;
    const curHash = await this._hash(current, creds.salt || null);
    if (!this._safeEqual(curHash, creds.hash)) return false;
    const salt    = this._mkToken();
    const newHash = await this._hash(newPass, salt);
    localStorage.setItem(this.CREDS_KEY, JSON.stringify({user:creds.user, hash:newHash, salt}));
    /* Issue new session token immediately after password change */
    sessionStorage.setItem(this.KEY, JSON.stringify({token:this._mkToken(), ts:Date.now()}));
    this._addLog('passwd_change', 'success');
    return true;
  },

  mustChangePassword() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.KEY) || 'null');
      return !!s?.mustChange;
    } catch { return false; }
  },

  async forceChangePassword(newPass) {
    const creds = this._getCreds();
    if (!creds) return false;
    const salt    = this._mkToken();
    const newHash = await this._hash(newPass, salt);
    /* Omitting mustChange clears the gate */
    localStorage.setItem(this.CREDS_KEY, JSON.stringify({user:creds.user, hash:newHash, salt}));
    sessionStorage.setItem(this.KEY, JSON.stringify({token:this._mkToken(), ts:Date.now()}));
    this._addLog('passwd_change', 'forced');
    return true;
  },

  startTimer() {
    this._timer = setInterval(() => {
      if (!this.isLoggedIn()) return;
      try {
        const s = JSON.parse(sessionStorage.getItem(this.KEY));
        const remaining = Math.max(0, Math.ceil((this.TIMEOUT - (Date.now()-s.ts)) / 60000));
        const el = document.getElementById('sessionTimer');
        if (el) el.textContent = `セッション残り: ${remaining}分`;
        if (remaining === 0) { this._addLog('logout','timeout'); this.logout(); }
      } catch(e) {}
    }, 30000);
  }
};

/* Expose Auth so healthCheck.js can verify session validation */
window.Auth = Auth;
