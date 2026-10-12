/* M1 测试用例 */
(function () {
  'use strict';
  var W, Q, D;

  function until(fn, timeout) {
    timeout = timeout || 4000;
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

  async function setup() {
    var iframe = document.getElementById('app');
    await until(function () {
      W = iframe.contentWindow;
      return W && W.QM && W.QM.app && W.QM.app.testHooks;
    });
    Q = W.QM; D = W.document;
    await Q.app.testHooks.reset();
  }

  function visible(node) { return node && !node.classList.contains('hidden'); }
  function mkSongTree() {
    var root = QTF.dir('测试音乐');
    var sub = QTF.dir('sub');
    var deep = QTF.dir('deep');
    sub.add(deep);
    deep.add(QTF.fileHandle('d.ogg', QTF.file('d.ogg', 'ogg-x')));
    sub.add(QTF.fileHandle('c.flac', QTF.file('c.flac', 'flac-x')));
    root.add(QTF.fileHandle('a.MP3', QTF.file('a.MP3', 'mp3-x')));
    root.add(QTF.fileHandle('note.txt', QTF.file('note.txt', 'text')));
    root.add(QTF.fileHandle('b.mp3', QTF.file('b.mp3', 'mp3-x')));
    root.add(QTF.fileHandle('e.wav', QTF.file('e.wav', 'wav-x')));
    root.add(QTF.fileHandle('z.M4A', QTF.file('z.M4A', 'm4a-x')));
    root.add(sub);
    return root;
  }

  window.addEventListener('load', function () {
    setup().then(function () {

      QT.test('1. 首次打开为 FIRST_USE：大按钮可见，歌单隐藏', async function () {
        await Q.app.testHooks.bootFresh();
        QT.eq(Q.app.testHooks.state(), 'FIRST_USE');
        var ov = D.getElementById('overlay');
        QT.ok(visible(ov), '遮罩应可见');
        QT.ok(ov.innerText.indexOf('选择音乐文件夹') >= 0, '应有选择按钮文案');
        QT.ok(!visible(D.getElementById('playlist-view')), '歌单区应隐藏');
        QT.ok(!visible(D.getElementById('perm-banner')), '授权条不应出现');
      });

      QT.test('2. 空文件夹进入 EMPTY_LIB 空状态', async function () {
        await Q.app.testHooks.bootWith(QTF.dir('空库', []));
        QT.eq(Q.app.testHooks.state(), 'EMPTY_LIB');
        QT.ok(D.getElementById('overlay').innerText.indexOf('还没有音乐') >= 0);
      });

      QT.test('3. 授权后扫描：递归/过滤扩展名/大小写/排序，状态 READY 并落库', async function () {
        var root = mkSongTree();
        await Q.app.testHooks.bootWith(root);
        QT.eq(Q.app.testHooks.state(), 'READY');
        QT.ok(!visible(D.getElementById('overlay')), '遮罩应隐藏');
        QT.ok(visible(D.getElementById('playlist-view')), '歌单区应显示');
        QT.ok(!visible(D.getElementById('perm-banner')), '授权条应隐藏');

        var expectIds = ['a.MP3', 'b.mp3', 'e.wav', 'sub/c.flac', 'sub/deep/d.ogg', 'z.M4A'];
        QT.eq(Q.state.order, expectIds, '顺序应为自然排序');
        QT.eq(Q.state.order.length, 6, 'txt 与目录应被过滤');
        QT.eq(Q.state.handleMap.size, 6, '句柄映射应重建');
        QT.ok(Q.state.get('a.MP3').checked === true, '新歌默认勾选');
        QT.ok(Q.state.get('a.MP3').tagStatus === 'pending', '标签待解析');

        QT.ok(D.getElementById('folder-label').textContent.indexOf('测试音乐') >= 0);
        QT.ok(D.getElementById('btn-rescan').disabled === false, '重新扫描应可用');

        var saved = await Q.db.songsAll();
        QT.eq(saved.length, 6, '歌曲应已写入 IndexedDB');
      });

      QT.test('4. 自然排序：数字按数值，基础名先于带后缀', function () {
        var got = Q.scanner.sortIds(['10.mp3', '2.mp3', '1.mp3', '1a.mp3']);
        QT.eq(got, ['1.mp3', '1a.mp3', '2.mp3', '10.mp3']);
      });

      QT.test('5. 重启后句柄仍授权：无需重选文件夹直接 READY（A5 逻辑）', async function () {
        await Q.app.testHooks.bootFresh();
        QT.eq(Q.app.testHooks.state(), 'READY');
        QT.eq(Q.state.order.length, 6);
        var h = await Q.db.kvGet('folderHandle');
        QT.ok(!!h, '文件夹句柄应持久化');
        QT.ok(D.getElementById('btn-rescan').disabled === false);
      });

      QT.test('6. 权限 prompt 时为 NEED_PERMISSION，点允许后恢复且只请求一次', async function () {
        await Q.app.testHooks.reset();
        var dir = QTF.permDir('待授权库', { query: 'prompt', request: 'granted' });
        dir.add(QTF.fileHandle('x.mp3', QTF.file('x.mp3', 'x')));
        dir.add(QTF.fileHandle('y.mp3', QTF.file('y.mp3', 'y')));
        Q.fs.setMemoryRoot(dir);
        await Q.db.kvSet('folderName', '待授权库');
        await Q.app.testHooks.bootFresh();

        QT.eq(Q.app.testHooks.state(), 'NEED_PERMISSION');
        QT.ok(visible(D.getElementById('perm-banner')), '黄色授权条应显示');
        QT.ok(visible(D.getElementById('playlist-view')), '列表区仍应显示');
        QT.ok(D.getElementById('btn-rescan').disabled === true, '未授权不能扫描');

        D.getElementById('perm-banner-btn').click();
        await until(function () { return Q.app.testHooks.state() === 'READY'; });
        QT.eq(dir.requestCalled, 1, 'requestPermission 只应被调用一次');
        QT.eq(Q.state.order.length, 2);
      });

      QT.test('7. 授权被拒绝：停留 NEED_PERMISSION 并提示', async function () {
        await Q.app.testHooks.reset();
        var dir = QTF.permDir('拒绝库', { query: 'prompt', request: 'denied' });
        dir.add(QTF.fileHandle('x.mp3', QTF.file('x.mp3', 'x')));
        Q.fs.setMemoryRoot(dir);
        await Q.db.kvSet('folderName', '拒绝库');
        await Q.app.testHooks.bootFresh();
        QT.eq(Q.app.testHooks.state(), 'NEED_PERMISSION');

        D.getElementById('perm-banner-btn').click();
        await QT.wait(400);
        QT.eq(Q.app.testHooks.state(), 'NEED_PERMISSION');
        QT.eq(dir.requestCalled, 1);
        QT.ok(!!D.querySelector('.toast'), '应有 toast 提示');
      });

      QT.test('8. IndexedDB 读写：kv / songs / covers，重置后清空', async function () {
        await Q.db.kvSet('k1', { a: 1, b: ['x'] });
        QT.eq(await Q.db.kvGet('k1'), { a: 1, b: ['x'] });
        await Q.db.songsBulkPut([
          { id: 'p/1.mp3', title: null }, { id: '2.mp3', title: null }
        ]);
        QT.eq((await Q.db.songsAll()).length, 2);
        var blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
        await Q.db.coverPut('2.mp3', blob);
        var got = await Q.db.coverGet('2.mp3');
        QT.eq(got.blob.size, 3);
        await Q.db.hardReset();
        QT.ok((await Q.db.kvGet('k1')) == null, 'hardReset 后该键应不存在');
        QT.eq((await Q.db.songsAll()).length, 0);
      });

      QT.run();
    });
  });
})();
