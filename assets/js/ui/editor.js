/* ui/editor.js —— M3：行内编辑弹层
 * 编辑歌名/歌手/专辑（仅本机覆盖，不改文件）；提供"恢复为文件原始信息"。 */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function esc(s) { return QM.esc(s); }

  var currentId = null;
  var mask = null;

  function buildModal(song) {
    var title = QM.metadata.displayName(song);
    var artist = song.artist || (song.raw && song.raw.artist) || '';
    var album = song.album || (song.raw && song.raw.album) || '';
    return '<h3>编辑歌曲信息</h3>' +
      '<div class="field"><label>歌名</label><input data-field="title" value="' + esc(title) + '" placeholder="留空使用文件名"></div>' +
      '<div class="field"><label>歌手</label><input data-field="artist" value="' + esc(artist) + '" placeholder="留空"></div>' +
      '<div class="field"><label>专辑</label><input data-field="album" value="' + esc(album) + '" placeholder="留空"></div>' +
      '<p style="font-size:12px;color:var(--text-3)">仅影响本机显示，不会修改音乐文件。</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-act="restore">恢复为文件原始信息</button>' +
        '<button class="btn btn-ghost" data-act="cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="save">保存</button>' +
      '</div>';
  }

  function open(id) {
    var song = QM.state.get(id);
    if (!song) return;
    currentId = id;
    mask = QM.ui.openModal(buildModal(song));
    mask.addEventListener('click', onClick);
    var first = mask.querySelector('input[data-field="title"]');
    if (first) first.focus();
  }

  function close() {
    if (mask) QM.ui.closeModal(mask);
    mask = null;
    currentId = null;
  }

  function getField(name) {
    var input = mask.querySelector('input[data-field="' + name + '"]');
    return input ? input.value : '';
  }

  function save() {
    if (!currentId) return;
    var title = getField('title').trim();
    var artist = getField('artist').trim();
    var album = getField('album').trim();
    // 空值用 null，回退到标签原值或文件名
    QM.state.updateSong(currentId, {
      title: title || null,
      artist: artist || null,
      album: album || null
    }, true);
    close();
  }

  function restore() {
    if (!currentId) return;
    // 清掉手动覆盖，全部回退到 raw 标签原值
    QM.state.updateSong(currentId, {
      title: null,
      artist: null,
      album: null
    }, true);
    close();
  }

  function onClick(e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (e.target === mask || act === 'cancel') close();
    else if (act === 'save') save();
    else if (act === 'restore') restore();
  }

  function init() {
    // 编辑层由 open() 挂载事件，无需全局监听
  }

  QM.editor = {
    init: init,
    open: open,
    _close: close,
    _currentId: function () { return currentId; }
  };
})();
