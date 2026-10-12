/* scanner.js —— 两阶段扫描
 * 阶段一：枚举（秒出列表）-> 与持久化库合并（新增/缺失/保留）-> 落库
 * 阶段二：标签封面懒解析队列（并发 2，可见行优先，由 UI 调 requestParse） */
(function () {
  'use strict';

  // 中文本地化自然排序：数字按数值（2 在 10 前），同目录自然聚集
  var collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  function naturalCompare(a, b) { return collator.compare(a, b); }
  function sortIds(ids) { return ids.slice().sort(naturalCompare); }

  function blankSong(entry) {
    var info = QM.fs.nameExt(entry.name);
    var mime = QM.extToMime(info.ext);
    var playable = QM.compat.canPlayMime(mime);
    return {
      id: entry.id,
      fileName: entry.name,
      ext: info.ext,
      raw: { title: '', artist: '', album: '' },
      title: null,
      artist: null,
      album: null,
      duration: 0,
      checked: true,
      status: playable ? 'ok' : 'unsupported', // ok | missing | unsupported
      tagStatus: 'pending',                    // pending | parsed | failed
      addedAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  // ---------------- 标签解析队列 ----------------
  var queue = {
    pending: [],
    inFlight: new Set(),
    active: 0,
    maxObserved: 0,
    drainers: [],
    priority: new Set()   // UI 可见行优先
  };
  var MAX_CONCURRENCY = 2;

  function enqueue(id, urgent) {
    var song = QM.state.songs.get(id);
    if (!song || song.status !== 'ok') return;
    if (!QM.state.handleMap.has(id)) return;
    if (queue.inFlight.has(id) || queue.pending.indexOf(id) >= 0) {
      if (urgent) {
        queue.pending.splice(queue.pending.indexOf(id), 1);
        queue.pending.unshift(id);
        queue.priority.add(id);
      }
      return;
    }
    if ((song.tagStatus === 'parsed' || song.tagStatus === 'failed') && !song.tagStale) return;
    if (urgent) { queue.pending.unshift(id); queue.priority.add(id); }
    else queue.pending.push(id);
    pump();
  }

  function pump() {
    while (queue.active < MAX_CONCURRENCY && queue.pending.length) {
      var id = queue.pending.shift();
      if (queue.inFlight.has(id)) continue;
      queue.inFlight.add(id);
      queue.active++;
      queue.maxObserved = Math.max(queue.maxObserved, queue.active);
      parseOne(id).then(finishOne, finishOne);
    }
    if (queue.active === 0 && queue.pending.length === 0) {
      var ds = queue.drainers;
      queue.drainers = [];
      ds.forEach(function (fn) { fn(); });
    }
  }
  function finishOne() {
    queue.active--;
    pump();
  }
  function drain() {
    if (queue.active === 0 && queue.pending.length === 0) return Promise.resolve();
    return new Promise(function (resolve) { queue.drainers.push(resolve); });
  }

  async function parseOne(id) {
    try {
      var song = QM.state.songs.get(id);
      var handle = QM.state.handleMap.get(id);
      if (!song || !handle) return;
      var file = await QM.fs.getFile(handle);
      var meta = await QM.metadata.parseFile(file, song.ext);

      var patch = {
        raw: {
          title: meta.title || '',
          artist: meta.artist || '',
          album: meta.album || ''
        },
        tagStatus: (meta.title || meta.artist || meta.album || meta.picture) ? 'parsed' : 'failed',
        tagStale: false
      };

      // 封面：有则压缩入库；文件已无封面则清掉旧图
      if (meta.picture && meta.picture.bytes && meta.picture.bytes.length > 10) {
        try {
          var jpg = await QM.metadata.shrinkCover(meta.picture);
          if (jpg && jpg.size > 0) await QM.db.coverPut(id, jpg);
        } catch (e) { /* 封面失败不影响标签 */ }
      } else {
        await QM.db.coverDelete(id).catch(function () {});
      }

      var updated = QM.state.updateSong(id, patch, true);
      return updated;
    } catch (e) {
      console.warn('标签解析失败', id, e);
      QM.state.updateSong(id, { tagStatus: 'failed', tagStale: false }, true);
    } finally {
      queue.inFlight.delete(id);
      queue.priority.delete(id);
    }
  }

  QM.scanner = {
    naturalCompare: naturalCompare,
    sortIds: sortIds,

    // 阶段一：枚举 + 与库完整合并（不读文件内容）
    phase1: async function (rootHandle) {
      var found = await QM.fs.enumerate(rootHandle);
      var handleMap = new Map();
      var foundMap = new Map();
      found.forEach(function (f) { handleMap.set(f.id, f.handle); foundMap.set(f.id, f); });

      // 以持久化库为合并基准（重启后也正确）
      var oldAll = await QM.db.songsAll();
      var oldMap = new Map();
      oldAll.forEach(function (s) { oldMap.set(s.id, s); });

      var records = [];

      found.forEach(function (f) {
        var old = oldMap.get(f.id);
        var song;
        if (old) {
          song = old;
          song.status = 'ok';
          song.fileName = f.name; // 仅大小写改名时同步
          song.tagStale = true;   // 重新读标签（手动覆盖值 title/artist/album 保留）
        } else {
          song = blankSong(f);
        }
        // 重新确认可播性（浏览器能力可能变化）
        if (song.status === 'ok' && !QM.compat.canPlayMime(QM.extToMime(song.ext))) {
          song.status = 'unsupported';
        }
        if (song.status === 'unsupported' && QM.compat.canPlayMime(QM.extToMime(song.ext))) {
          song.status = 'ok';
        }
        song.updatedAt = Date.now();
        records.push(song);
      });

      // 消失的歌：标记缺失，勾选/编辑/标签全部保留
      oldAll.forEach(function (old) {
        if (!foundMap.has(old.id)) {
          old.status = 'missing';
          old.tagStale = false;
          old.updatedAt = Date.now();
          records.push(old);
        }
      });

      var ids = sortIds(records.map(function (r) { return r.id; }));
      var byId = new Map();
      records.forEach(function (r) { byId.set(r.id, r); });
      records = ids.map(function (id) { return byId.get(id); });

      return { records: records, handleMap: handleMap };
    },

    // 完整扫描：合并 -> 更新内存 -> 落库 -> 排队解析
    scan: async function (rootHandle) {
      if (QM.state.scanning) throw new Error('SCANNING');
      QM.state.setScanning(true);
      try {
        var res = await this.phase1(rootHandle);
        QM.state.handleMap = res.handleMap;
        QM.state.setSongs(res.records);
        await QM.db.songsBulkPut(res.records);
        await QM.db.kvSet('lastScanAt', Date.now());

        // 阶段二：需要解析的歌排队（未解析过或文件已变化）
        res.records.forEach(function (s) {
          if (s.status === 'ok' && (s.tagStatus === 'pending' || s.tagStale)) {
            enqueue(s.id, false);
          }
        });
        return res.records;
      } finally {
        QM.state.setScanning(false);
      }
    },

    // UI：请求立即解析某首（可见行优先）
    requestParse: function (id, urgent) { enqueue(id, urgent !== false); },
    drain: drain,
    _queue: queue
  };
})();
