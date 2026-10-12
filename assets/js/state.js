/* state.js —— 内存状态中心
 * 所有写操作走这里：改内存 -> 发事件 -> 落库；UI 只订阅事件重渲染。 */
(function () {
  'use strict';

  var DEFAULT_SETTINGS = { mode: 'sequence', volume: 0.8, muted: false };

  var state = {
    // 文件夹
    rootHandle: null,
    folderName: '',
    permission: 'missing',        // missing | prompt | denied | granted
    scanning: false,

    // 歌单
    songs: new Map(),             // id -> song
    order: [],                    // 显示顺序（id 数组）
    handleMap: new Map(),         // id -> FileSystemFileHandle（不持久化）

    // 播放
    currentId: null,
    playing: false,

    // 设置 / 续播
    settings: Object.assign({}, DEFAULT_SETTINGS),
    lastPlay: null,               // {songId, position, updatedAt}

    // ---- 查询 ----
    list: function () {
      var self = this;
      return this.order.map(function (id) { return self.songs.get(id); });
    },
    get: function (id) { return this.songs.get(id); },

    checkedCount: function () {
      var n = 0;
      this.songs.forEach(function (s) { if (s.checked && s.status === 'ok') n++; });
      return n;
    },

    // ---- 写操作 ----
    setRoot: function (handle, name) {
      this.rootHandle = handle || null;
      this.folderName = name || '';
    },
    setPermission: function (p) {
      this.permission = p;
      QM.bus.emit(QM.EV.PERMISSION_CHANGED, p);
    },
    setScanning: function (v) {
      this.scanning = v;
      QM.bus.emit(QM.EV.STATE_CHANGED, { scanning: v });
    },

    // 整体替换歌单（扫描后）
    setSongs: function (records) {
      this.songs = new Map();
      this.order = [];
      var self = this;
      records.forEach(function (r) {
        self.songs.set(r.id, r);
        self.order.push(r.id);
      });
      QM.bus.emit(QM.EV.SONGS_CHANGED, { reason: 'replace' });
    },

    // 单首更新（合并字段），落库由调用方/统一监听处理
    updateSong: function (id, patch, persist) {
      var s = this.songs.get(id);
      if (!s) return null;
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      s.updatedAt = Date.now();
      QM.bus.emit(QM.EV.SONG_UPDATED, { id: id, song: s, patch: patch });
      if (persist) QM.db.songPut(s).catch(function (e) { console.error('save song', e); });
      return s;
    },

    setSettings: function (patch) {
      Object.assign(this.settings, patch);
      QM.bus.emit(QM.EV.SETTINGS_CHANGED, this.settings);
      QM.db.kvSet('settings', this.settings).catch(function (e) { console.error('save settings', e); });
    },

    setCurrent: function (id) {
      this.currentId = id;
      QM.bus.emit(QM.EV.CURRENT_CHANGED, id);
    },
    setPlaying: function (v) {
      this.playing = v;
      QM.bus.emit(QM.EV.PLAY_STATE, v);
    }
  };

  QM.state = state;
  QM.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})();
