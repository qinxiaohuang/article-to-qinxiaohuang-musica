/* M5 测试用例 —— 持久化、续播与重启恢复 */
(function () {
  'use strict';
  var W, Q, D;

  function until(fn, timeout) {
    timeout = timeout || 8000;
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        var v;
        try { v = fn(); } catch (e) { v = undefined; }
        if (v) return resolve(v);
        if (Date.now() - t0 > timeout) return reject(new Error('等待超时'));
        setTimeout(tick, 50);
      })();
    });
  }

  function clearModals() {
    D.querySelectorAll('.modal-mask').forEach(function (m) { m.remove(); });
  }

  async function boot(root) {
    await Q.app.testHooks.reset();
    Q.state.settings = Object.assign({}, Q.DEFAULT_SETTINGS);
    Q.state.currentId = null;
    Q.state.playing = false;
    Q.player._resetShuffle();
    clearModals();
    await Q.app.testHooks.bootWith(root);
    await until(function () { return Q.app.testHooks.state() === 'READY'; });
    await Q.scanner.drain();
    await QT.wait(120);
    Q.state.setPlaying(false);
    clearModals();
  }

  function mockAudio() {
    var a = Q.player._audio();
    if (!a._mocked) {
      a._mocked = true;
      a._origPlay = a.play;
      a.play = function () { return Promise.resolve(); };
    }
    return a;
  }

  function restoreAudio() {
    var a = Q.player._audio();
    if (a._mocked) {
      a.play = a._origPlay;
      a._mocked = false;
    }
  }

  function mockCurrentTime(seconds) {
    var a = Q.player._audio();
    try {
      Object.defineProperty(a, 'currentTime', {
        get: function () { return seconds; },
        set: function () {},
        configurable: true
      });
    } catch (e) {}
  }

  async function setup() {
    var iframe = document.getElementById('app');
    await until(function () {
      W = iframe.contentWindow;
      return W && W.QM && W.QM.app && W.QM.app.testHooks && W.QM.player;
    });
    Q = W.QM; D = W.document;
    await Q.app.testHooks.reset();
    D.querySelectorAll('.modal-mask').forEach(function (m) { m.remove(); });
  }

  window.addEventListener('load', function () {
    setup().then(function () {

      // ===== 1. lastPlay 保存：播放后保存进度到 state 和 IDB =====
      QT.test('1. lastPlay 保存：_saveLastPlayNow 写入 state 和 IDB', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        mockCurrentTime(5.5);
        try {
          await Q.player.play('a.mp3');
          await QT.wait(20);
          Q.player._saveLastPlayNow();
          await QT.wait(30);
          QT.ok(Q.state.lastPlay, 'state.lastPlay 应存在');
          QT.eq(Q.state.lastPlay.songId, 'a.mp3', 'songId 应为 a.mp3');
          QT.eq(Q.state.lastPlay.position, 5.5, 'position 应为 5.5');
          // IDB 中也应有
          var lp = await Q.db.kvGet('lastPlay');
          QT.ok(lp, 'IDB 中 lastPlay 应存在');
          QT.eq(lp.songId, 'a.mp3', 'IDB songId 正确');
        } finally { restoreAudio(); }
      });

      // ===== 2. 续播恢复：重启后定位到上次歌曲但不播放 =====
      QT.test('2. 续播恢复：重启后 currentId 恢复但不自动播放', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        mockCurrentTime(3.0);
        try {
          // 播放 a 并保存进度
          await Q.player.play('a.mp3');
          await QT.wait(20);
          Q.player._saveLastPlayNow();
          await QT.wait(20);
          QT.ok(Q.state.lastPlay, '进度已保存');

          // 模拟重启：清空内存状态但保留 IDB
          Q.state.songs = new Map();
          Q.state.order = [];
          Q.state.handleMap = new Map();
          Q.state.currentId = null;
          Q.state.playing = false;
          Q.state.lastPlay = null;
          Q.player._resetShuffle();

          // 重新启动（从 IDB 恢复）
          await Q.app.testHooks.bootWith(root);
          await until(function () { return Q.app.testHooks.state() === 'READY'; });
          await Q.scanner.drain();
          await QT.wait(80);

          // currentId 应恢复为 a.mp3，但 playing 应为 false
          QT.eq(Q.state.currentId, 'a.mp3', 'currentId 应恢复为 a.mp3');
          QT.eq(Q.state.playing, false, '不应自动播放');
        } finally { restoreAudio(); }
      });

      // ===== 3. 位置恢复：首次播放时恢复上次进度 =====
      QT.test('3. 位置恢复：play 时恢复上次播放位置', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);

        // 预设 lastPlay
        Q.state.lastPlay = { songId: 'a.mp3', position: 4.2, updatedAt: Date.now() };

        mockAudio();
        var restoredTime = 0;
        var a = Q.player._audio();
        try {
          // 拦截 currentTime setter
          Object.defineProperty(a, 'currentTime', {
            get: function () { return restoredTime; },
            set: function (v) { restoredTime = v; },
            configurable: true
          });
          await Q.player.play('a.mp3');
          await QT.wait(30);
          QT.eq(restoredTime, 4.2, 'audio.currentTime 应恢复为 4.2');
          QT.ok(!Q.state.lastPlay, '恢复后 lastPlay 应清空');
        } finally {
          restoreAudio();
        }
      });

      // ===== 4. 缺失歌曲：lastPlay 指向已删除歌曲时清空 =====
      QT.test('4. 缺失歌曲：lastPlay 指向缺失歌曲时回退为无选中', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        // 预设指向不存在的歌曲
        Q.state.lastPlay = { songId: 'gone.mp3', position: 2.0, updatedAt: Date.now() };
        Q.player.restoreLastPlay();
        QT.eq(Q.state.currentId, null, 'currentId 应为 null（歌曲不存在）');
        QT.eq(Q.state.lastPlay, null, 'lastPlay 应被清空');
      });

      // ===== 5. 设置持久化：mode/volume/muted 重启后保持 =====
      QT.test('5. 设置持久化：mode/volume/muted 保存到 IDB', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        // 修改设置
        Q.player.setMode('shuffle');
        Q.player.setVolume(0.6);
        Q.player.toggleMute();
        await QT.wait(30);
        // 验证 IDB
        var s = await Q.db.kvGet('settings');
        QT.eq(s.mode, 'shuffle', 'mode 应为 shuffle');
        QT.eq(s.volume, 0.6, 'volume 应为 0.6');
        QT.eq(s.muted, true, 'muted 应为 true');
      });

      // ===== 6. 勾选持久化：勾选状态保存到 IDB =====
      QT.test('6. 勾选持久化：updateSong 落库', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        Q.state.updateSong('a.mp3', { checked: false }, true);
        await QT.wait(30);
        var songs = await Q.db.songsAll();
        var a = songs.filter(function (s) { return s.id === 'a.mp3'; })[0];
        QT.eq(a.checked, false, 'IDB 中 a.checked 应为 false');
      });

      // ===== 7. 权限禁用：NEED_PERMISSION 时播放栏置灰 =====
      QT.test('7. 权限禁用：NEED_PERMISSION 时播放栏置灰', async function () {
        var root = QTF.permDir('库', { query: 'prompt', request: 'granted' });
        root.add(QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)));
        // 不使用标准 boot（等待 READY），直接 bootWith 并等待 NEED_PERMISSION
        await Q.app.testHooks.reset();
        Q.state.settings = Object.assign({}, Q.DEFAULT_SETTINGS);
        clearModals();
        await Q.app.testHooks.bootWith(root);
        await until(function () { return Q.app.testHooks.state() === 'NEED_PERMISSION'; });
        await QT.wait(50);
        QT.eq(Q.state.permission, 'prompt', '权限应为 prompt');
        var bar = D.getElementById('player-bar');
        QT.ok(bar.classList.contains('disabled'), '播放栏应置灰');
      });

      QT.run();
    });
  });
})();
