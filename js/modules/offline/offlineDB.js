'use strict';

/* ════════════════════════════════════════════════════════
   OFFLINE DB — Phase 27D
   Thin IndexedDB wrapper for offline-capable data storage.

   Stores: bookings | calendar | quotes
   DB name: hm_offline_db  version: 1

   API:
     OfflineDB.put(store, item)       → Promise<void>
     OfflineDB.getAll(store)          → Promise<item[]>
     OfflineDB.get(store, id)         → Promise<item|null>
     OfflineDB.delete(store, id)      → Promise<void>
     OfflineDB.clear(store)           → Promise<void>
     OfflineDB.count(store)           → Promise<number>
   ════════════════════════════════════════════════════════ */

window.OfflineDB = (function () {

  var DB_NAME    = 'hm_offline_db';
  var DB_VERSION = 1;
  var STORES     = ['bookings', 'calendar', 'quotes', 'action_queue'];
  var _db        = null;

  /* ── Open / create DB ── */
  function _open() {
    if (_db) return Promise.resolve(_db);

    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB はこのブラウザでサポートされていません'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            var store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: false });
            if (name === 'action_queue') {
              store.createIndex('ts', 'ts', { unique: false });
            }
          }
        });
      };

      req.onsuccess = function (e) {
        _db = e.target.result;
        /* Handle unexpected version change */
        _db.onversionchange = function () { _db.close(); _db = null; };
        resolve(_db);
      };

      req.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  /* ── Generic transaction helper ── */
  function _tx(store, mode, fn) {
    return _open().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx  = db.transaction(store, mode);
          var st  = tx.objectStore(store);
          var req = fn(st);
          if (req && req.onsuccess !== undefined) {
            req.onsuccess = function () { resolve(req.result); };
            req.onerror   = function () { reject(req.error);  };
          } else {
            tx.oncomplete = function () { resolve(); };
            tx.onerror    = function () { reject(tx.error);   };
          }
        } catch (err) { reject(err); }
      });
    });
  }

  /* ── Public API ── */

  function put(store, item) {
    if (!item || item.id === undefined || item.id === null) return Promise.reject(new Error('item.id required'));
    return _tx(store, 'readwrite', function (st) { return st.put(item); });
  }

  function getAll(store) {
    return _open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(store, 'readonly');
        var st  = tx.objectStore(store);
        var req = st.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror   = function () { reject(req.error); };
      });
    });
  }

  function get(store, id) {
    return _tx(store, 'readonly', function (st) { return st.get(id); });
  }

  function del(store, id) {
    return _tx(store, 'readwrite', function (st) { return st.delete(id); });
  }

  function clear(store) {
    return _tx(store, 'readwrite', function (st) { return st.clear(); });
  }

  function count(store) {
    return _tx(store, 'readonly', function (st) { return st.count(); });
  }

  /* ── Bulk import from Adapter data ── */
  function syncFromAdapter() {
    if (!window.Adapter) return Promise.resolve();
    var promises = [];

    var bk = Adapter.getBookings ? Adapter.getBookings() : [];
    bk.forEach(function (b) { if (b.id) promises.push(put('bookings', b)); });

    var qt = Adapter.getQuotes ? Adapter.getQuotes() : [];
    qt.forEach(function (q) { if (q.id) promises.push(put('quotes', q)); });

    var avail = Adapter.getAvail ? Adapter.getAvail() : {};
    Object.keys(avail).forEach(function (date) {
      promises.push(put('calendar', { id: date, date: date, status: avail[date] }));
    });

    return Promise.all(promises).catch(function (e) {
      console.warn('[OfflineDB] syncFromAdapter error:', e);
    });
  }

  return {
    put:             put,
    getAll:          getAll,
    get:             get,
    'delete':        del,
    clear:           clear,
    count:           count,
    syncFromAdapter: syncFromAdapter,
  };

})();
