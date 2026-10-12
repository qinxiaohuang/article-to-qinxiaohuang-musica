/* db.js —— IndexedDB Promise 封装
 * 三个 store：kv(单值键表) / songs(歌曲，key=id) / covers(封面小图，key=id) */
(function () {
  'use strict';

  var DB_NAME = 'qin-music';
  var DB_VERSION = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('covers')) {
          db.createObjectStore('covers', { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(storeName, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, mode);
        var store = t.objectStore(storeName);
        var result;
        Promise.resolve()
          .then(function () { return fn(store); })
          .then(function (v) { result = v; })
          .catch(reject);
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  QM.db = {
    init: open,

    // ---- kv ----
    kvGet: function (k) {
      return tx('kv', 'readonly', function (s) { return reqToPromise(s.get(k)); });
    },
    kvSet: function (k, v) {
      return tx('kv', 'readwrite', function (s) { return reqToPromise(s.put(v, k)); });
    },
    kvDel: function (k) {
      return tx('kv', 'readwrite', function (s) { return reqToPromise(s.delete(k)); });
    },

    // ---- songs ----
    songsAll: function () {
      return tx('songs', 'readonly', function (s) { return reqToPromise(s.getAll()); });
    },
    songGet: function (id) {
      return tx('songs', 'readonly', function (s) { return reqToPromise(s.get(id)); });
    },
    songPut: function (song) {
      return tx('songs', 'readwrite', function (s) { return reqToPromise(s.put(song)); });
    },
    songsBulkPut: function (arr) {
      return tx('songs', 'readwrite', function (s) {
        return arr.reduce(function (p, song) {
          return p.then(function () { return reqToPromise(s.put(song)); });
        }, Promise.resolve());
      });
    },
    songDelete: function (id) {
      return tx('songs', 'readwrite', function (s) { return reqToPromise(s.delete(id)); });
    },
    songsClear: function () {
      return tx('songs', 'readwrite', function (s) { return reqToPromise(s.clear()); });
    },

    // ---- covers ----
    coverGet: function (id) {
      return tx('covers', 'readonly', function (s) { return reqToPromise(s.get(id)); });
    },
    coverPut: function (id, blob) {
      return tx('covers', 'readwrite', function (s) {
        return reqToPromise(s.put({ id: id, blob: blob, updatedAt: Date.now() }));
      });
    },
    coverDelete: function (id) {
      return tx('covers', 'readwrite', function (s) { return reqToPromise(s.delete(id)); });
    },

    // 测试 / 恢复用：彻底重置
    hardReset: function () {
      return open().then(function (db) {
        db.close();
        dbp = null;
        return new Promise(function (resolve, reject) {
          var req = indexedDB.deleteDatabase(DB_NAME);
          req.onsuccess = resolve;
          req.onerror = function () { reject(req.error); };
          req.onblocked = resolve;
        });
      }).then(open);
    }
  };
})();
