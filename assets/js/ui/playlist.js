/* ui/playlist.js —— M3：歌单列表与工具栏
 * 渲染歌曲行、勾选/全选/清空、已选数量、点歌即播、
 * 缺失/不支持行置灰、正在播放高亮、IntersectionObserver 可见行优先解析。 */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }

  var listEl, countEl, checkAllEl, playCheckedBtn;
  var rowNodes = Object.create(null);   // id -> 行元素
  var observer = null;
  var visibleIds = new Set();

  function esc(s) { return QM.esc(s); }

  // ---------- 单行 ----------
  function coverFrame() {
    return '<div class="row-cover">' +
      '<img class="note-ico" src="assets/img/note.svg" alt="">' +
      '<div class="row-eq"><i></i><i></i><i></i></div>' +
      '</div>';
  }
  function tagPill(song) {
    if (song.status === 'missing') return '<span class="tag-pill miss">文件缺失</span>';
    if (song.status === 'unsupported') return '<span class="tag-pill unsup">格式不支持</span>';
    return '';
  }
  function rowClass(song) {
    var cls = 'song-row';
    if (song.status === 'ok') cls += ' playable';
    else if (song.status === 'missing') cls += ' missing';
    else if (song.status === 'unsupported') cls += ' unsupported';
    if (QM.state.currentId === song.id && song.status === 'ok') cls += ' playing';
    return cls;
  }

  function buildRow(song) {
    var dispName = QM.metadata.displayName(song);
    var sub = QM.metadata.displaySub(song);
    var dur = song.duration > 0 ? QM.metadata.fmtTime(song.duration) : '';
    var checkable = song.status === 'ok';
    var checkedAttr = (song.checked && checkable) ? 'checked' : '';
    var disabledAttr = checkable ? '' : 'disabled';
    var row = document.createElement('div');
    row.className = rowClass(song);
    row.dataset.id = song.id;
    row.innerHTML =
      '<input type="checkbox" class="row-check" ' + checkedAttr + ' ' + disabledAttr + ' aria-label="勾选">' +
      coverFrame() +
      '<div class="row-info">' +
        '<div class="row-title-line">' +
          '<span class="row-title">' + esc(dispName) + '</span>' +
          tagPill(song) +
        '</div>' +
        '<div class="row-sub">' + esc(sub) + '</div>' +
      '</div>' +
      '<div class="row-tail">' +
        '<span class="row-duration">' + dur + '</span>' +
        '<button class="row-edit" title="编辑信息" aria-label="编辑">✎</button>' +
      '</div>';
    return row;
  }

  function loadCover(row, song) {
    QM.db.coverGet(song.id).then(function (rec) {
      if (!rec || !rec.blob) return;
      if (rowNodes[song.id] !== row) return; // 行已被替换
      var img = row.querySelector('.row-cover img');
      if (!img || img._objUrl) return;
      var url = URL.createObjectURL(rec.blob);
      img._objUrl = url;
      img.src = url;
      img.classList.remove('note-ico');
    }).catch(function () {});
  }

  function appendRow(song) {
    var row = buildRow(song);
    rowNodes[song.id] = row;
    listEl.appendChild(row);
    loadCover(row, song);
    if (observer) observer.observe(row);
    return row;
  }

  function clearRows() {
    Object.keys(rowNodes).forEach(function (id) {
      var row = rowNodes[id];
      var img = row.querySelector('.row-cover img');
      if (img && img._objUrl) { URL.revokeObjectURL(img._objUrl); img._objUrl = null; }
      if (observer) observer.unobserve(row);
    });
    rowNodes = Object.create(null);
    listEl.innerHTML = '';
  }

  // ---------- 整体 / 单行刷新 ----------
  function render() {
    clearRows();
    var songs = QM.state.list();
    songs.forEach(function (s) { appendRow(s); });
    refreshToolbar();
  }

  function refreshRow(id) {
    var song = QM.state.get(id);
    var oldRow = rowNodes[id];
    if (!song) {
      if (oldRow) {
        if (observer) observer.unobserve(oldRow);
        var img = oldRow.querySelector('.row-cover img');
        if (img && img._objUrl) URL.revokeObjectURL(img._objUrl);
        oldRow.remove();
        delete rowNodes[id];
      }
      return;
    }
    var fresh = buildRow(song);
    if (oldRow) {
      var oldImg = oldRow.querySelector('.row-cover img');
      if (oldImg && oldImg._objUrl) {
        var newImg = fresh.querySelector('.row-cover img');
        newImg._objUrl = oldImg._objUrl;
        newImg.src = oldImg._objUrl;
        newImg.classList.remove('note-ico');
      } else {
        loadCover(fresh, song);
      }
      oldRow.replaceWith(fresh);
    } else {
      listEl.appendChild(fresh);
      loadCover(fresh, song);
    }
    rowNodes[id] = fresh;
    if (observer) observer.observe(fresh);
  }

  // ---------- 工具栏 ----------
  function refreshToolbar() {
    var total = 0, checked = 0;
    QM.state.songs.forEach(function (s) {
      if (s.status === 'ok') { total++; if (s.checked) checked++; }
    });
    countEl.textContent = '已选 ' + checked + ' 首';
    var allChecked = total > 0 && checked === total;
    checkAllEl.checked = allChecked;
    checkAllEl.disabled = total === 0;
    playCheckedBtn.disabled = checked === 0;
  }

  function setCheckAll(checked) {
    QM.state.songs.forEach(function (s) {
      if (s.status === 'ok' && s.checked !== checked) {
        s.checked = checked;
        s.updatedAt = Date.now();
        QM.db.songPut(s).catch(function () {});
      }
    });
    Object.keys(rowNodes).forEach(function (id) {
      var row = rowNodes[id];
      var s = QM.state.get(id);
      if (s && s.status === 'ok') {
        var cb = row.querySelector('.row-check');
        if (cb) cb.checked = checked;
      }
    });
    refreshToolbar();
  }

  function toggleCheck(id, checked) {
    // 直接改内存 + 落库；UI 由 SONG_UPDATED 事件驱动 refreshRow
    QM.state.updateSong(id, { checked: checked }, true);
    refreshToolbar();
  }

  // ---------- 播放高亮 ----------
  function refreshHighlight(id) {
    Object.keys(rowNodes).forEach(function (rid) {
      var row = rowNodes[rid];
      var song = QM.state.get(rid);
      if (!song) return;
      row.classList.toggle('playing', rid === id && song.status === 'ok');
    });
  }

  // ---------- 事件 ----------
  function onListClick(e) {
    var row = e.target.closest('.song-row');
    if (!row) return;
    var id = row.dataset.id;
    var song = QM.state.get(id);
    if (!song) return;

    if (e.target.classList.contains('row-edit')) {
      e.stopPropagation();
      QM.editor.open(id);
      return;
    }
    if (e.target.classList.contains('row-check')) return; // 由 change 处理
    // 缺失 / 不支持行不可点播
    if (song.status !== 'ok') return;
    QM.app.playSong(id);
  }

  function onListChange(e) {
    if (e.target.classList.contains('row-check')) {
      var row = e.target.closest('.song-row');
      var id = row && row.dataset.id;
      if (id) toggleCheck(id, e.target.checked);
    }
  }

  function init() {
    listEl = el('song-list');
    countEl = el('checked-count');
    checkAllEl = el('check-all');
    playCheckedBtn = el('btn-play-checked');

    checkAllEl.addEventListener('change', function () { setCheckAll(this.checked); });
    playCheckedBtn.addEventListener('click', function () {
      if (this.disabled) return;
      QM.app.playChecked();
    });

    listEl.addEventListener('click', onListClick);
    listEl.addEventListener('change', onListChange);

    // IntersectionObserver：可见行优先解析（懒加载标签/封面）
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var id = en.target.dataset.id;
          if (!id) return;
          if (en.isIntersecting) {
            visibleIds.add(id);
            QM.scanner.requestParse(id, true);
          } else {
            visibleIds.delete(id);
          }
        });
      }, { root: listEl, threshold: 0.1 });
    }

    QM.bus.on(QM.EV.SONGS_CHANGED, render);
    QM.bus.on(QM.EV.SONG_UPDATED, function (p) {
      // 仅勾选变化时无需重建行（避免替换用户正在操作的 checkbox）
      var keys = Object.keys(p.patch || {});
      if (!(keys.length === 1 && keys[0] === 'checked')) refreshRow(p.id);
      refreshToolbar();
    });
    QM.bus.on(QM.EV.CURRENT_CHANGED, refreshHighlight);
  }

  QM.playlist = {
    init: init,
    render: render,
    refreshToolbar: refreshToolbar,
    refreshRow: refreshRow,
    refreshHighlight: refreshHighlight,
    _observer: function () { return observer; },
    _visibleIds: function () { return visibleIds; },
    _rowNodes: function () { return rowNodes; }
  };
})();
