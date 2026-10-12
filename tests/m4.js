/* M4 测试用例 —— 播放引擎与调度：范围/模式/跳过/进度音量/快捷键 */
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
    // 重置设置与播放状态（reset 不清理这些）
    Q.state.settings = Object.assign({}, Q.DEFAULT_SETTINGS);
    Q.state.currentId = null;
    Q.state.playing = false;
    Q.player._resetShuffle();
    clearModals();
    await Q.app.testHooks.bootWith(root);
    await until(function () { return Q.app.testHooks.state() === 'READY'; });
    await Q.scanner.drain();
    await QT.wait(120);
    // 通过事件同步 UI（直接赋值不触发 PLAY_STATE 事件）
    Q.state.setPlaying(false);
    clearModals();
  }

  function mockAudio() {
    // 模拟 audio.play() 以绕过浏览器自动播放限制
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

  function dispatchEvt(node, type) {
    node.dispatchEvent(new node.ownerDocument.defaultView.Event(type, { bubbles: false }));
  }

  async function setup() {
    var iframe = document.getElementById('app');
    await until(function () {
      W = iframe.contentWindow;
      return W && W.QM && W.QM.app && W.QM.app.testHooks && W.QM.player && W.QM.playerBar;
    });
    Q = W.QM; D = W.document;
    await Q.app.testHooks.reset();
    D.querySelectorAll('.modal-mask').forEach(function (m) { m.remove(); });
  }

  window.addEventListener('load', function () {
    setup().then(function () {

      // ===== 1. rangeIds：无勾选=全部可播，有勾选=仅勾选 =====
      QT.test('1. rangeIds：无勾选时范围=全部 ok 歌曲', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3)),
          QTF.fileHandle('c.xyz', QTF.file('c.xyz', 'x'))
        ]);
        await boot(root);
        // 取消所有勾选
        Q.state.songs.forEach(function (s) { s.checked = false; });
        var range = Q.player.rangeIds();
        QT.eq(range.length, 2, '应只有 2 首可播（xyz 不支持）');
        QT.eq(range[0], 'a.mp3', '第一首 a');
        QT.eq(range[1], 'b.mp3', '第二首 b');
      });

      // ===== 2. rangeIds：有勾选时范围=勾选交集 =====
      QT.test('2. rangeIds：有勾选时范围=勾选且可播', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3)),
          QTF.fileHandle('c.mp3', QTF.wavFile('c.mp3', 0.3))
        ]);
        await boot(root);
        // 仅勾选 b
        Q.state.songs.forEach(function (s) { s.checked = false; });
        Q.state.get('b.mp3').checked = true;
        var range = Q.player.rangeIds();
        QT.eq(range.length, 1, '应只有 1 首（仅 b 勾选）');
        QT.eq(range[0], 'b.mp3', '范围应为 b');
      });

      // ===== 3. computeNext 顺序模式：自动前进 + 末尾停止 =====
      QT.test('3. 顺序模式：自动下一首前进，末首结束停止', function () {
        var range = ['a', 'b', 'c'];
        // a→b（自动）
        var r = Q.player.computeNext(1, 'auto', { range: range, mode: 'sequence', currentId: 'a', history: [], pointer: -1 });
        QT.eq(r, 'b', 'a 自动播完应到 b');
        // b→c（自动）
        r = Q.player.computeNext(1, 'auto', { range: range, mode: 'sequence', currentId: 'b', history: [], pointer: -1 });
        QT.eq(r, 'c', 'b 自动播完应到 c');
        // c→null（末首停止）
        r = Q.player.computeNext(1, 'auto', { range: range, mode: 'sequence', currentId: 'c', history: [], pointer: -1 });
        QT.eq(r, null, 'c 自动播完应停止');
      });

      // ===== 4. computeNext 顺序模式：手动 next/prev 环绕 =====
      QT.test('4. 顺序模式：手动 next/prev 环绕', function () {
        var range = ['a', 'b', 'c'];
        // a→b（手动 next）
        var r = Q.player.computeNext(1, 'manual', { range: range, mode: 'sequence', currentId: 'a', history: [], pointer: -1 });
        QT.eq(r, 'b', '手动 next a→b');
        // c→a（手动 next 到末尾环绕）
        r = Q.player.computeNext(1, 'manual', { range: range, mode: 'sequence', currentId: 'c', history: [], pointer: -1 });
        QT.eq(r, 'a', '手动 next c→a（环绕）');
        // a→c（手动 prev 环绕）
        r = Q.player.computeNext(-1, 'manual', { range: range, mode: 'sequence', currentId: 'a', history: [], pointer: -1 });
        QT.eq(r, 'c', '手动 prev a→c（环绕）');
      });

      // ===== 5. computeNext 单曲循环：自动重播，手动线性移动 =====
      QT.test('5. 单曲循环：自动重播当前，手动线性移动', function () {
        var range = ['a', 'b', 'c'];
        // a→a（自动重播）
        var r = Q.player.computeNext(1, 'auto', { range: range, mode: 'single', currentId: 'a', history: [], pointer: -1 });
        QT.eq(r, 'a', '单曲循环自动应重播 a');
        // 手动 next a→b
        r = Q.player.computeNext(1, 'manual', { range: range, mode: 'single', currentId: 'a', history: [], pointer: -1 });
        QT.eq(r, 'b', '手动 next a→b');
        // 手动 prev b→a
        r = Q.player.computeNext(-1, 'manual', { range: range, mode: 'single', currentId: 'b', history: [], pointer: -1 });
        QT.eq(r, 'a', '手动 prev b→a');
      });

      // ===== 6. computeNext 随机模式：自动排除当前 =====
      QT.test('6. 随机模式：自动选曲排除当前', function () {
        var range = ['a', 'b', 'c'];
        // 当前 a，自动应排除 a
        for (var i = 0; i < 10; i++) {
          var r = Q.player.computeNext(1, 'auto', { range: range, mode: 'shuffle', currentId: 'a', history: ['a'], pointer: 0 });
          var id = (typeof r === 'string') ? r : r.id;
          QT.ok(id !== 'a', '随机自动选曲不应重复 a（第' + i + '次）');
        }
      });

      // ===== 7. 随机模式：手动 next 前进历史，prev 回退 =====
      QT.test('7. 随机模式：手动 next 前进历史，prev 回退历史', function () {
        var range = ['a', 'b', 'c', 'd'];
        // 预设历史 [a, b, c]，指针在 c（pointer=2）
        // 手动 next：应前进到 b？不，指针在2=历史最后，应随机新曲
        // 先从 b（pointer=1）前进
        var r = Q.player.computeNext(1, 'manual', { range: range, mode: 'shuffle', currentId: 'b', history: ['a', 'b', 'c'], pointer: 1 });
        QT.eq(r.id, 'c', '手动 next 从 b 应前进到 c');
        QT.eq(r.pointer, 2, '指针应到 2');
        // 手动 prev 从 c 回退
        r = Q.player.computeNext(-1, 'manual', { range: range, mode: 'shuffle', currentId: 'c', history: ['a', 'b', 'c'], pointer: 2 });
        QT.eq(r.id, 'b', '手动 prev 从 c 应回退到 b');
        QT.eq(r.pointer, 1, '指针应回到 1');
      });

      // ===== 8. play：设置 currentId + 播放状态 =====
      QT.test('8. play：设置当前歌曲与播放状态', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        try {
          var ok = await Q.player.play('a.mp3');
          QT.eq(ok, true, 'play 应返回 true');
          QT.eq(Q.state.currentId, 'a.mp3', 'currentId 应为 a.mp3');
          QT.eq(Q.state.playing, true, '应处于播放中');
          var a = Q.player._audio();
          QT.ok(a.src.indexOf('blob:') === 0, 'audio.src 应为 blob: URL');
        } finally { restoreAudio(); }
      });

      // ===== 9. toggle：无歌曲时从范围开头播放；播放中暂停 =====
      QT.test('9. toggle：无播放时从范围首播放，播放中暂停', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        try {
          // 无 currentId → 从 a 开始
          Q.player.toggle();
          await QT.wait(20);
          QT.eq(Q.state.currentId, 'a.mp3', 'toggle 应从 a 开始');
          QT.eq(Q.state.playing, true, '应播放中');
          // 再次 toggle → 暂停
          Q.player.toggle();
          await QT.wait(20);
          QT.eq(Q.state.playing, false, '应暂停');
        } finally { restoreAudio(); }
      });

      // ===== 10. ended 自动切歌：顺序模式 =====
      QT.test('10. ended 事件：顺序模式自动切到下一首', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        try {
          await Q.player.play('a.mp3');
          await QT.wait(20);
          // 触发 ended
          dispatchEvt(Q.player._audio(), 'ended');
          await QT.wait(40);
          QT.eq(Q.state.currentId, 'b.mp3', 'ended 后应切到 b');
          QT.eq(Q.state.playing, true, '应继续播放');
        } finally { restoreAudio(); }
      });

      // ===== 11. 单曲循环 ended：重播当前 =====
      QT.test('11. ended 事件：单曲循环重播当前', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3))
        ]);
        await boot(root);
        Q.player.setMode('single');
        mockAudio();
        try {
          await Q.player.play('a.mp3');
          await QT.wait(20);
          dispatchEvt(Q.player._audio(), 'ended');
          await QT.wait(40);
          QT.eq(Q.state.currentId, 'a.mp3', '单曲循环 ended 后应仍为 a');
          QT.eq(Q.state.playing, true, '应继续播放');
        } finally { restoreAudio(); }
      });

      // ===== 12. 音量/静音：设置更新 state，静音保留音量 =====
      QT.test('12. 音量与静音：setVolume/toggleMute 更新设置', function () {
        Q.player.setVolume(0.5);
        QT.eq(Q.state.settings.volume, 0.5, 'volume 应为 0.5');
        QT.eq(Q.state.settings.muted, false, '不应静音');
        // 静音
        Q.player.toggleMute();
        QT.eq(Q.state.settings.muted, true, '应静音');
        // 音量值保留（不因静音清零）
        QT.eq(Q.state.settings.volume, 0.5, '静音时 volume 仍保留 0.5');
        // 取消静音
        Q.player.toggleMute();
        QT.eq(Q.state.settings.muted, false, '取消静音');
      });

      // ===== 13. 播放栏模式按钮循环切换 =====
      QT.test('13. playerbar：模式按钮顺序→单曲→随机→顺序', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        var modeBtn = D.getElementById('btn-mode');
        // 顺序→单曲
        modeBtn.click();
        QT.eq(Q.state.settings.mode, 'single', '点击后应为 single');
        // 单曲→随机
        modeBtn.click();
        QT.eq(Q.state.settings.mode, 'shuffle', '点击后应为 shuffle');
        // 随机→顺序
        modeBtn.click();
        QT.eq(Q.state.settings.mode, 'sequence', '点击后应为 sequence');
      });

      // ===== 14. 播放栏播放按钮文字与状态同步 =====
      QT.test('14. playerbar：播放按钮文字随播放状态切换', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        try {
          var btn = D.getElementById('btn-playpause');
          QT.eq(btn.textContent, '▶', '初始应为播放图标');
          Q.player.toggle();
          await QT.wait(30);
          QT.eq(btn.textContent, '⏸', '播放中应为暂停图标');
          Q.player.toggle();
          await QT.wait(30);
          QT.eq(btn.textContent, '▶', '暂停后应为播放图标');
        } finally { restoreAudio(); }
      });

      // ===== 15. 播放栏禁用：无可播歌曲时置灰 =====
      QT.test('15. playerbar：无可播歌曲时底部栏置灰', async function () {
        var origCan = Q.compat.canPlayMime;
        Q.compat.canPlayMime = function () { return false; };
        try {
          var root = QTF.dir('库', [
            QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
          ]);
          await boot(root);
          var bar = D.getElementById('player-bar');
          QT.ok(bar.classList.contains('disabled'), '无不支持歌曲时应置灰');
        } finally {
          Q.compat.canPlayMime = origCan;
        }
      });

      QT.run();
    });
  });
})();
