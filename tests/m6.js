/* M6 测试用例 —— 备份导出/导入恢复 */
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

  function clickModalButton(act) {
    var btn = D.querySelector('.modal-mask button[data-act="' + act + '"]');
    if (btn) btn.click();
  }

  async function setup() {
    var iframe = document.getElementById('app');
    await until(function () {
      W = iframe.contentWindow;
      return W && W.QM && W.QM.app && W.QM.app.testHooks && W.QM.backup;
    });
    Q = W.QM; D = W.document;
    await Q.app.testHooks.reset();
    D.querySelectorAll('.modal-mask').forEach(function (m) { m.remove(); });
  }

  window.addEventListener('load', function () {
    setup().then(function () {

      // ===== 1. 导出：备份对象结构正确，不含句柄/封面/音频 =====
      QT.test('1. 导出：备份对象结构正确', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        // 修改一些数据
        Q.state.updateSong('a.mp3', { title: '我的歌', artist: '歌手X' }, false);
        var backup = Q.backup._buildBackup();
        QT.eq(backup.app, 'qin-music-backup', 'app 字段正确');
        QT.eq(backup.v, 1, 'v 字段正确');
        QT.ok(backup.exportedAt, 'exportedAt 应存在');
        QT.eq(backup.songs.length, 1, '应含 1 首歌曲');
        QT.eq(backup.songs[0].id, 'a.mp3', 'songId 正确');
        QT.eq(backup.songs[0].title, '我的歌', 'title 正确');
        QT.eq(backup.songs[0].artist, '歌手X', 'artist 正确');
        // 不含句柄、封面 blob、音频
        QT.ok(!backup.songs[0].handle, '不应含 handle');
        QT.ok(!backup.songs[0].coverBlob, '不应含 coverBlob');
        QT.ok(!backup.songs[0].fileContent, '不应含 fileContent');
        QT.ok(backup.settings, '应含 settings');
      });

      // ===== 2. 导入校验：非法文件被拒绝 =====
      QT.test('2. 导入校验：非法文件被拒绝', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        var origChecked = Q.state.get('a.mp3').checked;
        // 非法 JSON 文件
        var badFile = new W.File(['not json'], 'bad.json', { type: 'application/json' });
        Q.backup._handleFile(badFile);
        await QT.wait(80);
        // 应出现 alert 弹层
        var alertText = D.querySelector('.modal-mask h3');
        QT.ok(alertText && alertText.textContent.indexOf('导入失败') >= 0, '应提示导入失败');
        // 数据不应改变
        QT.eq(Q.state.get('a.mp3').checked, origChecked, '数据不应改变');
        clearModals();
      });

      // ===== 3. 导入校验：缺少 app 字段被拒绝 =====
      QT.test('3. 导入校验：缺少 app 字段被拒绝', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        var fakeData = JSON.stringify({ v: 1, songs: [] });
        var fakeFile = new W.File([fakeData], 'fake.json', { type: 'application/json' });
        Q.backup._handleFile(fakeFile);
        await QT.wait(80);
        var alertText = D.querySelector('.modal-mask h3');
        QT.ok(alertText && alertText.textContent.indexOf('导入失败') >= 0, '应提示导入失败');
        clearModals();
      });

      // ===== 4. 导入合并：恢复勾选与编辑信息 =====
      QT.test('4. 导入合并：恢复勾选与编辑信息', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3))
        ]);
        await boot(root);
        // 当前 a 勾选、b 不勾选
        Q.state.updateSong('a.mp3', { checked: true }, false);
        Q.state.updateSong('b.mp3', { checked: false }, false);
        // 导入备份：a 不勾选、title=新歌名；b 勾选
        var backup = {
          app: 'qin-music-backup', v: 1,
          songs: [
            { id: 'a.mp3', checked: false, title: '新歌名', artist: '新歌手', album: null },
            { id: 'b.mp3', checked: true, title: null, artist: null, album: null }
          ],
          settings: { mode: 'shuffle', volume: 0.5, muted: true },
          lastPlay: null
        };
        Q.backup._mergeBackup(backup);
        await QT.wait(40);
        var a = Q.state.get('a.mp3');
        QT.eq(a.checked, false, 'a.checked 应恢复为 false');
        QT.eq(a.title, '新歌名', 'a.title 应恢复为新歌名');
        QT.eq(a.artist, '新歌手', 'a.artist 应恢复为新歌手');
        QT.eq(Q.state.get('b.mp3').checked, true, 'b.checked 应恢复为 true');
        QT.eq(Q.state.settings.mode, 'shuffle', 'mode 应恢复为 shuffle');
        QT.eq(Q.state.settings.volume, 0.5, 'volume 应恢复为 0.5');
        QT.eq(Q.state.settings.muted, true, 'muted 应恢复为 true');
        clearModals();
      });

      // ===== 5. 导入结果提示：匹配数与未匹配数 =====
      QT.test('5. 导入结果提示：匹配数与未匹配数', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        var backup = {
          app: 'qin-music-backup', v: 1,
          songs: [
            { id: 'a.mp3', checked: false, title: null, artist: null, album: null },
            { id: 'gone.mp3', checked: true, title: null, artist: null, album: null }
          ],
          settings: {}, lastPlay: null
        };
        Q.backup._mergeBackup(backup);
        await QT.wait(40);
        var body = D.querySelector('.modal-mask .modal-body, .modal-mask div');
        QT.ok(body && body.textContent.indexOf('成功匹配 1') >= 0, '应提示成功匹配 1 首');
        QT.ok(body && body.textContent.indexOf('未匹配 1') >= 0, '应提示未匹配 1 首');
        clearModals();
      });

      // ===== 6. 导入确认弹层：取消不做任何修改 =====
      QT.test('6. 导入确认：取消不做任何修改', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3))
        ]);
        await boot(root);
        var origChecked = Q.state.get('a.mp3').checked;
        var json = JSON.stringify({
          app: 'qin-music-backup', v: 1,
          songs: [{ id: 'a.mp3', checked: !origChecked, title: 'changed', artist: null, album: null }],
          settings: {}, lastPlay: null
        });
        var file = new W.File([json], 'backup.json', { type: 'application/json' });
        Q.backup._handleFile(file);
        await QT.wait(60);
        // 应出现确认弹层
        var confirmTitle = D.querySelector('.modal-mask h3');
        QT.ok(confirmTitle && confirmTitle.textContent.indexOf('确认导入') >= 0, '应出现确认弹层');
        // 点击取消
        clickModalButton('cancel');
        await QT.wait(40);
        // 数据不应改变
        QT.eq(Q.state.get('a.mp3').checked, origChecked, '取消后 checked 不应改变');
        QT.eq(Q.state.get('a.mp3').title, null, '取消后 title 不应改变');
        clearModals();
      });

      QT.run();
    });
  });
})();
