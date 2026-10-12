/* app.js —— 启动引导与页面状态机
 * 状态：UNSUPPORTED / FIRST_USE / REQUESTING / SCANNING / EMPTY_LIB / READY / NEED_PERMISSION */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  var App = {
    state: 'BOOT',

    setState: function (key, info) {
      this.state = key;
      if (key === 'READY') {
        QM.overlays.setBanner('none');
        QM.overlays.render('HIDDEN');
      } else if (key === 'NEED_PERMISSION') {
        QM.overlays.setBanner('prompt');
        QM.overlays.render('HIDDEN');
      } else {
        QM.overlays.setBanner('none');
        QM.overlays.render(key, info);
      }
    },

    // ---------- 授权后的主流程 ----------
    async enterGranted(handle) {
      QM.state.setRoot(handle, handle.name || QM.state.folderName);
      QM.state.setPermission('granted');
      this.setState('SCANNING');
      this._persistStorage();
      try {
        var records = await QM.scanner.scan(handle);
        this.setState(records.length ? 'READY' : 'EMPTY_LIB');
      } catch (e) {
        if (e && e.message === 'SCANNING') { QM.ui.toast('正在扫描中…'); return; }
        console.error(e);
        QM.ui.toast('扫描失败：' + (e && e.message || e));
        this.setState(QM.state.songs.size ? 'READY' : 'FIRST_USE');
      }
    },

    async pickAndEnter() {
      this.setState('REQUESTING');
      var handle;
      try {
        handle = await QM.fs.pick();
      } catch (e) {
        console.error(e);
        QM.ui.toast('无法打开文件夹选择窗口');
        this.setState('FIRST_USE');
        return;
      }
      if (!handle) {
        // 用户取消
        if (QM.state.rootHandle) { this.setState('NEED_PERMISSION'); }
        else { this.setState('FIRST_USE'); }
        QM.ui.toast('未授权访问，无法播放，请重新点击允许');
        return;
      }
      // 更换文件夹：清空旧库的显示与记录
      if (QM.state.folderName && QM.state.folderName !== handle.name) {
        QM.state.setSongs([]);
        QM.state.handleMap = new Map();
        await QM.db.songsClear();
      }
      await this.persistHandle(handle);
      await this.enterGranted(handle);
    },

    // 会话内记忆 + IDB 持久化
    // Chrome/Edge：原生句柄可克隆，持久化到 IDB
    // Firefox：File 列表无法持久化，仅本次会话有效，重启后需重新选文件夹
    async persistHandle(handle) {
      QM.fs.setMemoryRoot(handle);
      try {
        // Firefox 后端：不持久化句柄（无法克隆），但保存文件夹名
        if (QM.fs.isFirefoxRoot(handle)) {
          await QM.db.kvSet('folderName', handle.name || '');
          await QM.db.kvSet('folderHandle', null);
          return;
        }
        await QM.db.kvSet('folderHandle', handle);
        await QM.db.kvSet('folderName', handle.name || '');
      } catch (e) {
        console.warn('句柄无法持久化到 IndexedDB，仅本次会话有效：', e && e.name);
      }
    },

    async requestAgain() {
      var handle = QM.state.rootHandle;
      var r;
      try { r = await QM.fs.request(handle); }
      catch (e) { console.error(e); r = 'denied'; }
      if (r === 'granted') { await this.enterGranted(handle); }
      else { QM.ui.toast('未授权访问，无法播放，请重新点击允许'); }
    },

    async rescan() {
      if (QM.state.scanning) { QM.ui.toast('正在扫描中…'); return; }
      if (QM.state.permission !== 'granted') { this.setState('NEED_PERMISSION'); return; }
      await this.enterGranted(QM.state.rootHandle);
    },

    // 点歌即播：单击歌曲行立即播放（不受勾选限制，但不改其勾选状态）
    playSong: function (id) {
      var song = QM.state.get(id);
      if (!song || song.status !== 'ok') return false;
      QM.state.setCurrent(id);
      if (QM.player && QM.player.play) QM.player.play(id);
      return true;
    },

    // 播放选中：从已勾选且文件正常的歌曲中的第一首开始
    playChecked: function () {
      var order = QM.state.order;
      for (var i = 0; i < order.length; i++) {
        var s = QM.state.get(order[i]);
        if (s && s.checked && s.status === 'ok') { this.playSong(order[i]); return true; }
      }
      QM.ui.toast('请先勾选歌曲');
      return false;
    },

    handleMenuAction: function (act) {
      if (act === 'change-folder') { this.pickAndEnter(); }
      else if (act === 'export-backup') { QM.backup.export(); }
      else if (act === 'import-backup') { QM.backup.importFromInput(); }
      else if (act === 'about') { this.showAbout(); }
    },

    showAbout: function () {
      var isFx = !QM.compat.hasFsAccess();
      var tip = isFx
        ? '<p>· Firefox 浏览器：每次重启后需重新选择音乐文件夹（浏览器限制，无法记住授权）。</p>'
        : '<p>· 每次完全重启浏览器后，需要点一次黄色提示条上的「点此允许」。</p>';
      QM.ui.alert({
        title: '数据说明',
        bodyHtml:
          '<p>· 音乐文件始终留在你选择的文件夹里，本应用只读取，不会修改或复制。</p>' +
          '<p>· 歌单、勾选、编辑、音量等数据保存在本机浏览器中；清理浏览器「网站数据」会清除它们。</p>' +
          '<p>· 建议偶尔用菜单中的「导出备份」保存一个 JSON 文件；清数据后重新选择文件夹并「导入备份」即可恢复。</p>' +
          '<p>· 移动或改名音乐文件夹会导致歌曲显示「文件缺失」，放回原位后重新扫描即可恢复。</p>' +
          tip
      });
    },

    _persistStorage: function () {
      try {
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(function () {});
        }
      } catch (e) {}
    },

    // ---------- 启动 ----------
    async boot(overrideHandle) {
      if (!QM.compat.supported()) {
        this.setState('UNSUPPORTED', { missing: QM.compat.missing() });
        return;
      }
      await QM.db.init();

      // 设置与续播（M4/M5 使用，先载入）
      var savedSettings = await QM.db.kvGet('settings');
      if (savedSettings) Object.assign(QM.state.settings, savedSettings);
      QM.state.lastPlay = await QM.db.kvGet('lastPlay') || null;

      // 已保存歌单先载入（权限待确认时也能看到列表）
      var savedSongs = await QM.db.songsAll();
      if (savedSongs && savedSongs.length) QM.state.setSongs(savedSongs);

      var handle = overrideHandle || QM.fs.getMemoryRoot() || await QM.db.kvGet('folderHandle');
      var folderName = await QM.db.kvGet('folderName') || '';
      if (overrideHandle) {
        await this.persistHandle(overrideHandle);
        folderName = overrideHandle.name || '';
        handle = overrideHandle;
      }
      if (handle) QM.fs.setMemoryRoot(handle);

      if (!handle) {
        QM.state.setRoot(null, '');
        QM.state.setPermission('missing');
        this.setState('FIRST_USE');
        return;
      }

      QM.state.setRoot(handle, folderName);
      var perm = await QM.fs.permState(handle);
      if (perm === 'granted') {
        await this.enterGranted(handle);
      } else {
        QM.state.setPermission(perm === 'denied' ? 'denied' : 'prompt');
        this.setState('NEED_PERMISSION');
      }

      // M5：续播恢复——定位到上次歌曲但不发声
      if (QM.player && QM.player.restoreLastPlay) {
        QM.player.restoreLastPlay();
      }
    },

    init: function () {
      var self = this;

      // 遮罩内按钮（事件委托，遮罩会反复重绘）
      el('overlay').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'pick-folder') self.pickAndEnter();
        else if (act === 'rescan') self.rescan();
      });

      el('perm-banner-btn').addEventListener('click', function () { self.requestAgain(); });

      QM.topbar.init();
      if (QM.playlist && QM.playlist.init) QM.playlist.init();
      if (QM.editor && QM.editor.init) QM.editor.init();
      if (QM.playerBar && QM.playerBar.init) QM.playerBar.init();
      if (QM.shortcuts && QM.shortcuts.init) QM.shortcuts.init();
      if (QM.backup && QM.backup.init) QM.backup.init();
      if (QM.player && QM.player.init) QM.player.init();

      this.boot().catch(function (e) {
        console.error(e);
        QM.ui.alert({ title: '启动失败', body: String(e && e.message || e) });
      });
    },

    // ---- 测试钩子（仅自动化测试使用）----
    testHooks: {
      reset: function () {
        QM.state.songs = new Map();
        QM.state.order = [];
        QM.state.handleMap = new Map();
        QM.state.setRoot(null, '');
        QM.fs.setMemoryRoot(null);
        return QM.db.hardReset();
      },
      bootFresh: function () { return App.boot(); },
      bootWith: function (handle) { return App.boot(handle); },
      state: function () { return App.state; }
    }
  };

  QM.app = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { App.init(); });
  } else {
    App.init();
  }
})();
