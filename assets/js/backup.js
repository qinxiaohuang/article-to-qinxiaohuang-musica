/* backup.js —— M6：备份导出 / 导入 / 校验 / 合并
 * 导出 JSON（不含句柄、不含封面 blob、不含音频）；
 * 导入校验 app/v 字段，覆盖确认弹层，按 id 匹配合并。 */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function esc(s) { return QM.esc(s); }

  // ---------- 导出 ----------
  function buildBackup() {
    var songs = QM.state.list().map(function (s) {
      return {
        id: s.id,
        checked: s.checked,
        title: s.title,
        artist: s.artist,
        album: s.album,
        duration: s.duration
      };
    });
    return {
      app: 'qin-music-backup',
      v: 1,
      exportedAt: new Date().toISOString(),
      songs: songs,
      settings: QM.state.settings,
      lastPlay: QM.state.lastPlay
    };
  }

  function exportBackup() {
    var backup = buildBackup();
    var json = JSON.stringify(backup, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var date = new Date();
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'music-backup-' + y + m + d + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    QM.ui.toast('备份已导出');
  }

  // ---------- 导入 ----------
  function importFromInput() {
    var input = el('import-file');
    if (input) input.click();
  }

  function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (e) {
        QM.ui.alert({ title: '导入失败', bodyHtml: '<p>文件解析失败：' + esc(e.message) + '</p>' });
        return;
      }
      if (!data || data.app !== 'qin-music-backup' || data.v !== 1) {
        QM.ui.alert({ title: '导入失败', bodyHtml: '<p>这不是有效的备份文件。</p>' });
        return;
      }
      // 覆盖确认
      QM.ui.confirm({
        title: '确认导入备份',
        bodyHtml: '<p>将覆盖当前的勾选和编辑信息。</p><p>取消则不做任何修改。</p>',
        okText: '确认导入'
      }).then(function (ok) {
        if (!ok) return;
        mergeBackup(data);
      });
    };
    reader.onerror = function () {
      QM.ui.alert({ title: '导入失败', bodyHtml: '<p>文件读取失败。</p>' });
    };
    reader.readAsText(file);
  }

  // ---------- 合并 ----------
  function mergeBackup(data) {
    var matched = 0, unmatched = 0;
    if (data.songs) {
      data.songs.forEach(function (b) {
        var song = QM.state.get(b.id);
        if (song) {
          QM.state.updateSong(b.id, {
            checked: b.checked !== undefined ? b.checked : song.checked,
            title: b.title !== undefined ? b.title : song.title,
            artist: b.artist !== undefined ? b.artist : song.artist,
            album: b.album !== undefined ? b.album : song.album
          }, true);
          matched++;
        } else {
          unmatched++;
        }
      });
    }
    if (data.settings) {
      QM.state.setSettings(data.settings);
    }
    if (data.lastPlay) {
      QM.state.lastPlay = data.lastPlay;
      QM.db.kvSet('lastPlay', data.lastPlay).catch(function () {});
    }
    // 刷新 UI
    QM.bus.emit(QM.EV.SONGS_CHANGED, { reason: 'import' });
    if (QM.player && QM.player.restoreLastPlay) QM.player.restoreLastPlay();
    if (QM.playerBar && QM.playerBar.refreshMode) QM.playerBar.refreshMode();
    QM.ui.alert({
      title: '导入完成',
      bodyHtml: '<p>成功匹配 ' + matched + ' 首，未匹配 ' + unmatched + ' 首。</p>'
    });
  }

  // ---------- 初始化 ----------
  function init() {
    var input = el('import-file');
    if (!input) return;
    input.addEventListener('change', function () {
      if (this.files && this.files[0]) {
        handleFile(this.files[0]);
        this.value = '';
      }
    });
  }

  QM.backup = {
    init: init,
    export: exportBackup,
    importFromInput: importFromInput,
    _buildBackup: buildBackup,
    _handleFile: handleFile,
    _mergeBackup: mergeBackup
  };
})();
