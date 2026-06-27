'use strict';

/* ════════════════════════════════════════════════════════
   ADMIN UI MODULE
   Auth, navigation, dashboard, all editor UIs, init
   ════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════
   AUTH — MySQL-backed (hm-api/admin-login.php), hybrid session + token

   Credentials live SERVER-SIDE in the admin_users table (password_hash /
   password_verify). This module no longer stores any credential in the browser
   (the legacy localStorage `hm_admin_creds` / `hm_staff` stores are gone).

   On login admin-login.php:
     • verifies the password against admin_users,
     • starts a hardened PHP session,
     • returns the EXISTING HMAC admin token (rest.php's hm_require_admin() gate
       is unchanged) — kept in sessionStorage + window.__HM_ADMIN_TOKEN.

   What still lives in the browser (NOT credentials):
     • a short session marker (sessionStorage) → drives the 30-min UI timeout,
       role/name display, and the mustChange gate,
     • the lockout counter + activity log (localStorage) → client-side UX only;
       the server independently rate-limits and password_verify()s.
   ════════════════════════════════════════════════════════ */
const Auth = {
  KEY:          'hm_admin_sess',
  TOKEN_KEY:    'hm_admin_token',
  EXP_KEY:      'hm_admin_token_exp',   // server token expiry (epoch s) — keeps the UI marker from outliving the token
  ENFORCED_KEY: 'hm_admin_enforced',
  LOGOUT_PING:  'hm_admin_logout_ping', // localStorage broadcast → log every same-origin tab out together
  CREDS_KEY:    'hm_admin_creds',   // retained for back-compat cleanup; no longer written
  LOCK_KEY:     'hm_admin_lock',
  LOG_KEY:      'hm_admin_log',
  STAFF_KEY:    'hm_staff',
  TIMEOUT:      30 * 60 * 1000,
  MAX_ATTEMPTS: 5,
  LOCKOUT_MS:   15 * 60 * 1000,
  REMEMBER_MS:  30 * 24 * 60 * 60 * 1000,
  _timer: null,
  _user: null,          // { id, name, email, role } of the logged-in admin
  _staffCache: null,    // cached admin_users list (other accounts) for sync getStaff()
  _staffLoading: false,

  /* Random hex token for the client session marker (rotated on navigation). */
  _mkToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
  },

  /* Map each action to its dedicated PHP endpoint (centralized server auth).
     login/force_change → admin-login.php · logout → admin-logout.php ·
     verify → admin-session.php · user mgmt + change_password → admin-users.php. */
  _ENDPOINT: {
    login:                 'admin-login.php',
    force_change_password: 'admin-login.php',
    logout:                'admin-logout.php',
    verify:                'admin-session.php',
    list_users:            'admin-users.php',
    create_user:           'admin-users.php',
    update_user:           'admin-users.php',
    reset_password:        'admin-users.php',
    delete_user:           'admin-users.php',
    change_password:       'admin-users.php',
  },

  /* ── Server call helper ───────────────────────────────────────────────────
     POSTs the action to its mapped endpoint with the API key + admin token (when
     present). credentials:'include' so the PHP session cookie flows on same-origin
     (and cross-origin when the API host sets Access-Control-Allow-Credentials). */
  async _api(action, body) {
    const base = (window.API_BASE || '').replace(/\/+$/, '');
    if (!base) return { ok:false, error:{ message:'No API', code:'no_api' } };
    const endpoint = this._ENDPOINT[action] || 'admin-login.php';
    const headers = { 'Content-Type':'application/json', 'X-API-KEY': window.API_KEY || '' };
    if (window.__HM_ADMIN_TOKEN) headers['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    try {
      const res = await fetch(base + '/' + endpoint, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify(Object.assign({ action }, body || {})),
      });
      const j = await res.json().catch(() => null);
      return j || { ok:false, error:{ message:'Bad response', code:'bad_response' } };
    } catch (e) {
      return { ok:false, error:{ message:'Network error', code:'network' } };
    }
  },

  _clearAdminToken() {
    try { sessionStorage.removeItem(this.TOKEN_KEY); } catch (_) {}
    try { sessionStorage.removeItem(this.EXP_KEY); } catch (_) {}
    try { sessionStorage.removeItem(this.ENFORCED_KEY); } catch (_) {}
    window.__HM_ADMIN_TOKEN = null;
    window.__HM_ADMIN_EXP = 0;
    window.__HM_ADMIN_ENFORCED = false;
  },

  /* No-op retained for callers (appBootstrap): credentials are now server-side,
     so there is nothing to seed in the browser. Also opportunistically purges any
     stale legacy credential blobs left from the localStorage era. */
  async initCreds() {
    try { localStorage.removeItem(this.CREDS_KEY); } catch (_) {}
    try { localStorage.removeItem(this.STAFF_KEY); } catch (_) {}
  },

  /* ── Session marker helpers (sessionStorage) ───────────────────────────── */
  _marker() {
    try { return JSON.parse(sessionStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; }
  },

  _setMarker(extra) {
    const u = this._user || {};
    const m = Object.assign({
      token: this._mkToken(), ts: Date.now(),
      role: u.role || 'admin', userId: u.id || 'admin',
      userName: u.name || 'Admin', userEmail: u.email || '',
    }, extra || {});
    sessionStorage.setItem(this.KEY, JSON.stringify(m));
  },

  /* ── Lockout (client-side UX; server also rate-limits) ─────────────────── */
  _getLock() {
    try { return JSON.parse(localStorage.getItem(this.LOCK_KEY)||'{}'); } catch(e) { return {}; }
  },

  isLockedOut() {
    const lk = this._getLock();
    if (!lk.until) return false;
    if (Date.now() < lk.until) return true;
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

  /* ── Login / logout ─────────────────────────────────────────────────────── */
  async login(user, pass, remember) {
    if (this.isLockedOut()) return {ok:false, locked:true};
    const email = String(user || '').trim();
    const r = await this._api('login', { email, password: pass });

    if (r && r.ok && r.data && r.data.token) {
      const d = r.data;
      try { sessionStorage.setItem(this.TOKEN_KEY, d.token); } catch (_) {}
      window.__HM_ADMIN_TOKEN = d.token;
      const exp = Number(d.exp) || 0;       // server token expiry (epoch s)
      try { sessionStorage.setItem(this.EXP_KEY, String(exp)); } catch (_) {}
      window.__HM_ADMIN_EXP = exp;
      const enf = !!d.enforced;
      try { sessionStorage.setItem(this.ENFORCED_KEY, enf ? '1' : '0'); } catch (_) {}
      window.__HM_ADMIN_ENFORCED = enf;

      const u = d.user || {};
      this._user = { id: u.id || 'admin', name: u.name || 'Admin', email: u.email || email, role: u.role || 'admin' };
      this._setMarker(d.mustChange ? { mustChange: true } : null);

      localStorage.removeItem(this.LOCK_KEY);
      if (remember) localStorage.setItem('hm_admin_remember', JSON.stringify({ user: this._user.email, exp: Date.now() + this.REMEMBER_MS }));
      else          localStorage.removeItem('hm_admin_remember');

      this._addLog('login', 'success');
      this._refreshStaff();          // populate the staff cache in the background
      return { ok:true, mustChange: !!d.mustChange };
    }

    /* Classify the failure. ONLY a genuine credential rejection (admin-login.php
       → error code 'invalid') counts toward the client lockout. Server
       misconfiguration (admin_secret_missing / admin_users_unprovisioned),
       wrong API key, network failures and rate-limiting must NOT penalise the
       operator (otherwise a server problem locks them out) and must surface a
       distinct, actionable reason instead of a misleading "wrong password". */
    const code = (r && r.error && r.error.code) || '';
    if (code === 'invalid') {
      this._recordFail();
      return { ok:false, locked:this.isLockedOut(), left:this.attemptsLeft(), code:'invalid' };
    }
    return { ok:false, locked:false, left:this.attemptsLeft(), system:true, code };
  },

  async logout() {
    this._addLog('logout', 'manual');
    // Best-effort: destroy the PHP session AND server-revoke every outstanding
    // token for this account (admin-logout.php sets tokens_valid_after) so no
    // other tab/device can keep writing with a copied token after logout.
    try { await this._api('logout', {}); } catch (_) {}
    sessionStorage.removeItem(this.KEY);
    this._clearAdminToken();
    this._user = null;
    this._staffCache = null;
    // Broadcast to every other same-origin tab so they drop their token + show
    // the login screen too (sessionStorage is per-tab; this localStorage write
    // fires a `storage` event in the OTHER tabs only).
    try { localStorage.setItem(this.LOGOUT_PING, String(Date.now())); } catch (_) {}
    if (typeof Adapter !== 'undefined') Adapter.destroyRealtime();
    showLogin();
  },

  isLoggedIn() {
    try {
      const s = this._marker();
      if (!s || !s.token) return false;
      if (Date.now() - s.ts > this.TIMEOUT) { sessionStorage.removeItem(this.KEY); return false; }
      // Hard token-expiry gate: the client marker is kept alive by activity
      // (touch()), but the server HMAC token has a FIXED lifetime. Once it lapses,
      // every admin write 401s — so treat the session as ended even if the marker
      // is still "fresh", instead of showing a logged-in UI with dead writes.
      const exp = window.__HM_ADMIN_EXP || 0;
      if (exp && (Date.now() / 1000) >= exp) {
        this._clearAdminToken();
        sessionStorage.removeItem(this.KEY);
        return false;
      }
      return true;
    } catch(e) { return false; }
  },

  /* Best-effort server-side validation of the restored token (admin-session.php).
     Call on page load: the client only knows its own marker/expiry, so this is the
     single point that catches a token revoked SERVER-side (account disabled/deleted
     or logged out elsewhere) while the local marker still looks valid.
     Returns { valid:true|false|null } — null means "couldn't tell" (offline /
     network / no token); callers must log out ONLY on an explicit false so a
     transient outage never ejects a working admin. */
  async verifySession() {
    if (!window.__HM_ADMIN_TOKEN) return { valid: false };
    const r = await this._api('verify', {});
    if (r && r.ok && r.data) {
      // Keep the enforcement flag in sync with the server's current answer.
      if (typeof r.data.enforced !== 'undefined') {
        window.__HM_ADMIN_ENFORCED = !!r.data.enforced;
        try { sessionStorage.setItem(this.ENFORCED_KEY, r.data.enforced ? '1' : '0'); } catch (_) {}
      }
      return { valid: r.data.valid === true };
    }
    return { valid: null };   // network / unknown — do not act
  },

  /* Rotate session token on navigation — prevents fixation. Preserves identity. */
  touch() {
    try {
      const s = this._marker();
      if (s && s.token) {
        const next = {token:this._mkToken(), ts:Date.now()};
        if (s.mustChange) next.mustChange = true;
        if (s.role)      next.role      = s.role;
        if (s.userId)    next.userId    = s.userId;
        if (s.userName)  next.userName  = s.userName;
        if (s.userEmail) next.userEmail = s.userEmail;
        sessionStorage.setItem(this.KEY, JSON.stringify(next));
      }
    } catch(e) {}
  },

  /* ── Password change ────────────────────────────────────────────────────── */
  async changePassword(current, newPass) {
    const r = await this._api('change_password', { current, new: newPass });
    if (r && r.ok) {
      this._setMarker();              // rotate marker, clear any mustChange
      this._addLog('passwd_change', 'success');
      return true;
    }
    return false;
  },

  mustChangePassword() {
    try { return !!this._marker()?.mustChange; } catch { return false; }
  },

  async forceChangePassword(newPass) {
    const r = await this._api('force_change_password', { new: newPass });
    if (r && r.ok) {
      this._setMarker();              // clears mustChange (omitted)
      this._addLog('passwd_change', 'forced');
      return true;
    }
    return false;
  },

  /* Change the logged-in admin's own email (Security → Account panel). */
  async changeOwnEmail(email) {
    if (!this._user) return false;
    const r = await this._api('update_user', { id: this._user.id, email: String(email||'').toLowerCase() });
    if (r && r.ok) {
      this._user.email = String(email||'').toLowerCase();
      this._setMarker();
      return true;
    }
    return false;
  },

  startTimer() {
    this._timer = setInterval(() => {
      if (!this.isLoggedIn()) return;
      try {
        const s = this._marker();
        const remaining = Math.max(0, Math.ceil((this.TIMEOUT - (Date.now()-s.ts)) / 60000));
        const el = document.getElementById('sessionTimer');
        if (el) el.textContent = `セッション残り: ${remaining}分`;
        if (remaining === 0) { this._addLog('logout','timeout'); this.logout(); }
      } catch(e) {}
    }, 30000);
  },

  /* ── Role & user helpers ───────────────────────────── */
  getRole() {
    try { return this._marker()?.role || 'admin'; } catch { return 'admin'; }
  },

  getUser() {
    try {
      const s = this._marker();
      return { id: s?.userId||'admin', name: s?.userName||'Admin', email: s?.userEmail||'', role: s?.role||'admin' };
    } catch { return { id:'admin', name:'Admin', email:'', role:'admin' }; }
  },

  canWrite() { return this.getRole() !== 'read-only'; },

  /* `_getCreds()` shim: callers (security.js / staff.js) used this to read the
     admin email. Now derived from the server-issued session marker. */
  _getCreds() {
    const email = this.getUser().email;
    return email ? { user: email } : null;
  },

  /* ── Admin accounts (admin_users) ──────────────────────────────────────────
     getStaff() is synchronous (the render code calls it inline), so it returns a
     cached snapshot and triggers a background refresh that re-renders on arrival.
     The list excludes the currently logged-in admin (shown separately in the UI).
     Roles map: UI 'admin' ⇆ server 'admin'; any other UI role ⇆ server 'manager'. */
  _roleToServer(role) { return role === 'admin' ? 'admin' : 'manager'; },

  getStaff() {
    if (this._staffCache == null && this.isLoggedIn() && !this._staffLoading) this._refreshStaff();
    const list = this._staffCache || [];
    const selfId = this._user && this._user.id;
    return list.filter(s => s.id !== selfId);
  },

  async _refreshStaff() {
    if (!this.isLoggedIn()) return;
    this._staffLoading = true;
    const r = await this._api('list_users', {});
    this._staffLoading = false;
    if (r && r.ok && r.data && Array.isArray(r.data.users)) {
      this._staffCache = r.data.users;
      this._reRenderStaffViews();
    } else if (this._staffCache == null) {
      this._staffCache = [];
    }
  },

  _reRenderStaffViews() {
    try {
      if (document.getElementById('securityContent') && typeof renderSecurity === 'function') renderSecurity();
      if (document.getElementById('staffContent')   && typeof renderStaff   === 'function') renderStaff();
    } catch (_) {}
  },

  _toast(msg) { try { if (typeof toast === 'function') toast(msg); } catch (_) {} },
  _errMsg(code) {
    const m = {
      duplicate:  'このメールアドレスは既に登録されています',
      weak:       'パスワードは8文字以上で設定してください',
      bad_email:  '有効なメールアドレスを入力してください',
      last_admin: '最後の管理者は変更・削除できません',
      self_delete:'自分自身のアカウントは削除できません',
      forbidden:  'この操作の権限がありません',
    };
    return m[code] || '操作に失敗しました';
  },

  async addStaffMember({ name, email, role, password }) {
    const r = await this._api('create_user', {
      name, email: String(email||'').toLowerCase(), password, role: this._roleToServer(role),
    });
    if (r && r.ok && r.data && r.data.user) {
      const u = r.data.user;
      if (this._staffCache) this._staffCache.push(u); else this._staffCache = [u];
      return u;
    }
    this._toast(this._errMsg(r && r.error && r.error.code));
    return null;
  },

  async updateStaffMember(id, patch) {
    /* Optimistic cache update so the inline renderSecurity() reflects it at once. */
    if (this._staffCache) {
      const m = this._staffCache.find(s => s.id === id);
      if (m) Object.assign(m, patch);
    }
    const body = { id };
    if ('name'   in patch) body.name   = patch.name;
    if ('email'  in patch) body.email  = patch.email;
    if ('role'   in patch) body.role   = this._roleToServer(patch.role);
    if ('active' in patch) body.active = patch.active;
    const r = await this._api('update_user', body);
    if (!(r && r.ok)) { this._toast(this._errMsg(r && r.error && r.error.code)); this._refreshStaff(); return false; }
    return true;
  },

  async resetStaffPassword(id, newPass) {
    const r = await this._api('reset_password', { id, new: newPass });
    if (r && r.ok) return true;
    this._toast(this._errMsg(r && r.error && r.error.code));
    return false;
  },

  async deleteStaffMember(id) {
    const prev = this._staffCache ? this._staffCache.slice() : null;
    if (this._staffCache) this._staffCache = this._staffCache.filter(s => s.id !== id);
    const r = await this._api('delete_user', { id });
    if (r && r.ok) return true;
    this._staffCache = prev; this._reRenderStaffViews();
    this._toast(this._errMsg(r && r.error && r.error.code));
    return false;
  },
};

/* Expose Auth so healthCheck.js can verify session validation */
window.Auth = Auth;

/* Restore session marker + admin token on page load so admin-only writes keep
   working across reloads within the same browser session (no forced re-login).
   Cleared on logout / when sessionStorage is cleared. */
try {
  const _hmTok = sessionStorage.getItem(Auth.TOKEN_KEY);
  if (_hmTok) window.__HM_ADMIN_TOKEN = _hmTok;
  window.__HM_ADMIN_EXP = parseInt(sessionStorage.getItem(Auth.EXP_KEY) || '0', 10) || 0;
  window.__HM_ADMIN_ENFORCED = sessionStorage.getItem(Auth.ENFORCED_KEY) === '1';
  const _m = Auth._marker();
  if (_m && _m.userId) Auth._user = { id:_m.userId, name:_m.userName, email:_m.userEmail, role:_m.role };
} catch (e) { /* sessionStorage blocked — token simply absent */ }

/* Cross-tab logout: when ANY same-origin admin tab logs out it writes
   Auth.LOGOUT_PING to localStorage, which fires this `storage` event in every
   OTHER tab. Drop the local token/marker and return to the login screen so a
   logout (e.g. on a shared computer) takes effect everywhere at once. */
try {
  window.addEventListener('storage', function (e) {
    if (e.key !== Auth.LOGOUT_PING || !e.newValue) return;
    try {
      sessionStorage.removeItem(Auth.KEY);
      Auth._clearAdminToken();
      Auth._user = null;
      Auth._staffCache = null;
      if (typeof Adapter !== 'undefined' && Adapter.destroyRealtime) Adapter.destroyRealtime();
      if (typeof showLogin === 'function') showLogin();
    } catch (_) {}
  });
} catch (e) { /* no window/localStorage — non-fatal */ }
