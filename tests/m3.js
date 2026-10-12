/* M3 测试用例 —— 歌单列表渲染 / 勾选 / 行内编辑 / 缺失不支持行 / 高亮 / 可见行优先 */
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
    // 清理残留弹层（避免初始 boot 失败产生的 alert modal 干扰后续编辑层测试）
    D.querySelectorAll('.modal-mask').forEach(function (m) { m.remove(); });
  }

  async function boot(root) {
    await Q.app.testHooks.reset();
    clearModals();
    await Q.app.testHooks.bootWith(root);
    await until(function () { return Q.app.testHooks.state() === 'READY'; });
    await Q.scanner.drain();
    // 等待 IntersectionObserver 回调与 UI 刷新
    await QT.wait(120);
    clearModals();
  }

  function rows() { return D.querySelectorAll('.song-row'); }
  function rowOf(id) { return D.querySelector('.song-row[data-id="' + CSS.escape(id) + '"]'); }
  function dispatch(node, type) {
    var E = node.ownerDocument.defaultView.Event;
    node.dispatchEvent(new E(type, { bubbles: true, cancelable: true }));
  }
  function click(node) {
    var ME = node.ownerDocument.defaultView.MouseEvent;
    node.dispatchEvent(new ME('click', { bubbles: true, cancelable: true }));
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

  async function setup() {
    var iframe = document.getElementById('app');
    await until(function () {
      W = iframe.contentWindow;
      return W && W.QM && W.QM.app && W.QM.app.testHooks && W.QM.playlist;
    });
    Q = W.QM; D = W.document;
    await Q.app.testHooks.reset();
    // 清理 iframe 初始 boot 可能产生的 alert 弹层
    D.querySelectorAll('.modal-mask').forEach(function (m) { m.remove(); });
  }

  window.addEventListener('load', function () {
    setup().then(function () {

      // ===== 1. 列表渲染：行数与排序 =====
      QT.test('1. 列表渲染：行数与自然排序', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('10.mp3', QTF.file('10.mp3', 'x')),
          QTF.fileHandle('2.mp3', QTF.file('2.mp3', 'x')),
          QTF.fileHandle('1.mp3', QTF.file('1.mp3', 'x'))
        ]);
        await boot(root);
        var r = rows();
        QT.eq(r.length, 3, '应有 3 行');
        // 自然排序：1 < 2 < 10
        QT.eq(r[0].dataset.id, '1.mp3', '第一行应为 1.mp3');
        QT.eq(r[1].dataset.id, '2.mp3', '第二行应为 2.mp3');
        QT.eq(r[2].dataset.id, '10.mp3', '第三行应为 10.mp3');
      });

      // ===== 2. 行内容：歌名回退文件名、歌手·专辑、时长 =====
      QT.test('2. 行内容：无标签回退文件名，子行与时长正确', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x'))
        ]);
        await boot(root);
        var row = rowOf('a.mp3');
        QT.ok(row, '应存在 a.mp3 行');
        QT.eq(row.querySelector('.row-title').textContent, 'a', '歌名应为文件名 a');
        QT.eq(row.querySelector('.row-sub').textContent, '', '无标签歌手·专辑应为空');
        // duration 在 M4 播放时补全，当前为 0 → 时长单元为空
        QT.eq(row.querySelector('.row-duration').textContent, '', '时长未解析应为空');
      });

      // ===== 3. 默认勾选与已选数量 =====
      QT.test('3. 默认勾选：所有 ok 行默认勾选，已选数量正确', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x')),
          QTF.fileHandle('b.mp3', QTF.file('b.mp3', 'x'))
        ]);
        await boot(root);
        QT.eq(Q.state.checkedCount(), 2, '已选应为 2');
        QT.eq(D.getElementById('checked-count').textContent, '已选 2 首', '工具栏显示');
        QT.eq(D.getElementById('check-all').checked, true, '全选框应为选中');
        QT.eq(rowOf('a.mp3').querySelector('.row-check').checked, true, 'a 行应勾选');
      });

      // ===== 4. 单行勾选/取消 =====
      QT.test('4. 单行勾选/取消：状态与已选数量同步', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x')),
          QTF.fileHandle('b.mp3', QTF.file('b.mp3', 'x'))
        ]);
        await boot(root);
        var cb = rowOf('a.mp3').querySelector('.row-check');
        cb.checked = false;
        dispatch(cb, 'change');
        await QT.wait(30);
        QT.eq(Q.state.get('a.mp3').checked, false, 'a 应取消勾选');
        QT.eq(Q.state.get('b.mp3').checked, true, 'b 应保持勾选');
        QT.eq(Q.state.checkedCount(), 1, '已选应为 1');
        QT.eq(D.getElementById('checked-count').textContent, '已选 1 首', '工具栏应更新');
        QT.eq(D.getElementById('check-all').checked, false, '全选框应取消');
        // 重新勾选
        cb.checked = true;
        dispatch(cb, 'change');
        await QT.wait(30);
        QT.eq(Q.state.get('a.mp3').checked, true, 'a 应恢复勾选');
        QT.eq(Q.state.checkedCount(), 2, '已选恢复 2');
      });

      // ===== 5. 全选/清空 =====
      QT.test('5. 全选/清空：勾选框切换批量改变全部行', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x')),
          QTF.fileHandle('b.mp3', QTF.file('b.mp3', 'x'))
        ]);
        await boot(root);
        // 先取消 a，使并非全部选中
        var ca = rowOf('a.mp3').querySelector('.row-check');
        ca.checked = false; dispatch(ca, 'change');
        await QT.wait(20);
        // 点全选框 → 全选
        var all = D.getElementById('check-all');
        all.checked = true; dispatch(all, 'change');
        await QT.wait(30);
        QT.eq(Q.state.get('a.mp3').checked, true, '全选后 a 应勾选');
        QT.eq(Q.state.get('b.mp3').checked, true, '全选后 b 应勾选');
        QT.eq(Q.state.checkedCount(), 2, '已选 2');
        // 再点 → 清空
        all.checked = false; dispatch(all, 'change');
        await QT.wait(30);
        QT.eq(Q.state.get('a.mp3').checked, false, '清空后 a 应取消');
        QT.eq(Q.state.get('b.mp3').checked, false, '清空后 b 应取消');
        QT.eq(Q.state.checkedCount(), 0, '已选 0');
      });

      // ===== 6. 行内编辑保存 =====
      QT.test('6. 行内编辑：保存后歌名/歌手/专辑更新', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x'))
        ]);
        await boot(root);
        // 打开编辑层
        Q.editor.open('a.mp3');
        await QT.wait(20);
        var modal = D.querySelector('.modal');
        QT.ok(modal, '编辑层应出现');
        modal.querySelector('input[data-field="title"]').value = '我的歌';
        modal.querySelector('input[data-field="artist"]').value = '歌手X';
        modal.querySelector('input[data-field="album"]').value = '专辑Y';
        click(modal.querySelector('button[data-act="save"]'));
        await QT.wait(40);
        var s = Q.state.get('a.mp3');
        QT.eq(s.title, '我的歌', 'song.title 应为手动值');
        QT.eq(s.artist, '歌手X', 'song.artist 应为手动值');
        QT.eq(s.album, '专辑Y', 'song.album 应为手动值');
        // 行显示同步
        QT.eq(rowOf('a.mp3').querySelector('.row-title').textContent, '我的歌', '行歌名应更新');
        QT.eq(rowOf('a.mp3').querySelector('.row-sub').textContent, '歌手X · 专辑Y', '行子行应更新');
        QT.ok(!D.querySelector('.modal'), '保存后编辑层应关闭');
      });

      // ===== 7. 行内编辑恢复原始 =====
      QT.test('7. 行内编辑：恢复为文件原始信息', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x'))
        ]);
        await boot(root);
        // 先设手动值
        Q.state.updateSong('a.mp3', { title: '临时', artist: 'A', album: 'B' }, true);
        await QT.wait(30);
        // 打开编辑层，点恢复
        Q.editor.open('a.mp3');
        await QT.wait(20);
        var modal = D.querySelector('.modal');
        QT.ok(modal.querySelector('button[data-act="restore"]'), '应有恢复按钮（raw 非空）');
        click(modal.querySelector('button[data-act="restore"]'));
        await QT.wait(40);
        var s = Q.state.get('a.mp3');
        QT.eq(s.title, null, '恢复后 title 应为 null');
        QT.eq(s.artist, null, '恢复后 artist 应为 null');
        QT.eq(s.album, null, '恢复后 album 应为 null');
        // 行回退到文件名
        QT.eq(rowOf('a.mp3').querySelector('.row-title').textContent, 'a', '行歌名应回退文件名');
      });

      // ===== 8. 缺失行置灰且不可点播 =====
      QT.test('8. 缺失行：置灰、文件缺失标签、checkbox 禁用、点击不播放', async function () {
        // 第一次扫描：a, b
        var root1 = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x')),
          QTF.fileHandle('b.mp3', QTF.file('b.mp3', 'x'))
        ]);
        await boot(root1);
        // 第二次扫描：仅 a（b 消失 → 缺失）
        var root2 = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x'))
        ]);
        await Q.app.testHooks.bootWith(root2);
        await until(function () { return Q.app.testHooks.state() === 'READY'; });
        await Q.scanner.drain();
        await QT.wait(120);

        var b = Q.state.get('b.mp3');
        QT.eq(b.status, 'missing', 'b 应标记 missing');
        var row = rowOf('b.mp3');
        QT.ok(row.classList.contains('missing'), '行应有 missing 类');
        QT.ok(row.querySelector('.tag-pill.miss'), '应有文件缺失标签');
        QT.eq(row.querySelector('.row-check').disabled, true, '勾选框应禁用');
        // 点击缺失行不应触发播放
        Q.state.setCurrent(null);
        click(row);
        await QT.wait(20);
        QT.eq(Q.state.currentId, null, '点击缺失行不应设置当前播放');
        // b 缺失：虽 checked=true 但不计入已选；仅 a（ok）计入
        QT.eq(b.checked, true, 'b 的勾选状态应保留');
        QT.eq(Q.state.checkedCount(), 1, '缺失行不应计入已选，仅 a 计入');
      });

      // ===== 9. 不支持格式行 =====
      QT.test('9. 不支持格式行：格式不支持标签且不可点播', async function () {
        var origCan = Q.compat.canPlayMime;
        Q.compat.canPlayMime = function (mime) { return mime === 'audio/mpeg'; }; // 只支持 mp3
        try {
          var root = QTF.dir('库', [
            QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x')),
            QTF.fileHandle('b.flac', QTF.file('b.flac', 'x'))
          ]);
          await boot(root);
          var row = rowOf('b.flac');
          QT.ok(row.classList.contains('unsupported'), '行应有 unsupported 类');
          QT.ok(row.querySelector('.tag-pill.unsup'), '应有格式不支持标签');
          QT.eq(row.querySelector('.row-check').disabled, true, '勾选框应禁用');
          // 不支持行不计入已选
          QT.eq(Q.state.checkedCount(), 1, '仅 a.mp3 计入已选');
        } finally {
          Q.compat.canPlayMime = origCan;
        }
      });

      // ===== 10. 正在播放高亮 =====
      QT.test('10. 正在播放：点歌即播后行高亮', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        try {
          var ok = Q.app.playSong('a.mp3');
          QT.eq(ok, true, 'playSong 应返回 true');
          await QT.wait(20);
          QT.eq(Q.state.currentId, 'a.mp3', '当前应为 a.mp3');
          var ra = rowOf('a.mp3'), rb = rowOf('b.mp3');
          QT.ok(ra.classList.contains('playing'), 'a 行应有 playing 高亮');
          QT.ok(!rb.classList.contains('playing'), 'b 行不应高亮');
          // 切到 b
          Q.app.playSong('b.mp3');
          await QT.wait(20);
          QT.ok(rowOf('b.mp3').classList.contains('playing'), '切到 b 后 b 行高亮');
          QT.ok(!rowOf('a.mp3').classList.contains('playing'), 'a 行应取消高亮');
        } finally { restoreAudio(); }
      });

      // ===== 11. 播放选中按钮 =====
      QT.test('11. 播放选中：无勾选时按钮禁用；有勾选时播放第一首', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('a.mp3', QTF.wavFile('a.mp3', 0.3)),
          QTF.fileHandle('b.mp3', QTF.wavFile('b.mp3', 0.3))
        ]);
        await boot(root);
        mockAudio();
        try {
          var btn = D.getElementById('btn-play-checked');
          // 默认全勾选 → 可点
          QT.eq(btn.disabled, false, '默认有勾选，按钮应可点');
          // 取消全部
          Q.state.songs.forEach(function (s) { if (s.status === 'ok') s.checked = false; });
          Q.playlist.refreshToolbar();
          QT.eq(btn.disabled, true, '无勾选时按钮应禁用');

          // 仅勾选 b，点播放选中 → 应从 b 开始
          Q.state.updateSong('b.mp3', { checked: true }, false);
          Q.playlist.refreshToolbar();
          click(btn);
          await QT.wait(30);
          QT.eq(Q.state.currentId, 'b.mp3', '应播放勾选的第一首 b.mp3');
        } finally { restoreAudio(); }
      });

      // ===== 12. IntersectionObserver：可见行优先解析 =====
      QT.test('12. IntersectionObserver：可见行被标记优先解析', async function () {
        var root = QTF.dir('库', [
          QTF.fileHandle('1.mp3', QTF.file('1.mp3', 'x')),
          QTF.fileHandle('2.mp3', QTF.file('2.mp3', 'x'))
        ]);
        await boot(root);
        QT.ok(Q.playlist._observer(), '应创建 IntersectionObserver');
        // iframe 高度足够，两行均可见
        var vis = Q.playlist._visibleIds();
        QT.ok(vis.size > 0, '应有可见行被记录');
        // drain 完成后歌曲已 parsed/failed，requestParse 正确跳过；
        // 将歌曲标记为 stale 后再请求，应加入 priority 队列
        var s = Q.state.get('1.mp3');
        s.tagStale = true;
        Q.scanner.requestParse('1.mp3', true);
        QT.ok(Q.scanner._queue.priority.has('1.mp3') || Q.scanner._queue.inFlight.has('1.mp3'),
          'stale 歌曲的 requestParse urgent 应加入 priority 或 inFlight');
      });

      QT.run();
    });
  });
})();
