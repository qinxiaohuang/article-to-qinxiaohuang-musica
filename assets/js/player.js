/* player.js —— M4：播放引擎与调度
 * 单例 <audio> + blob: ObjectURL；三模式调度（顺序/单曲/随机）；
 * 播放范围（勾选规则）；自动跳过 + 熔断；时长回写；进度/音量/静音。 */
(function () {
  'use strict';

  var audio = null;
  var currentUrl = null;          // 当前 blob: URL（切歌时 revoke）
  var skipCount = 0;             // 自动跳过熔断计数器
  var saveTimer = null;          // lastPlay 节流计时器

  // 随机播放历史栈
  var shuffle = { history: [], pointer: -1 };

  // ===================== 纯函数：调度逻辑（不依赖 DOM） =====================

  // 播放范围：status=ok 且可播；checkedCount≥1 时与勾选交集
  function rangeIds(songs, order) {
    songs = songs || QM.state.songs;
    order = order || QM.state.order;
    var ids = [];
    for (var i = 0; i < order.length; i++) {
      var s = songs.get(order[i]);
      if (s && s.status === 'ok' && QM.compat.canPlayMime(QM.extToMime(s.ext))) {
        ids.push(order[i]);
      }
    }
    // 统计范围内已勾选数
    var checkedN = 0;
    ids.forEach(function (id) { if (songs.get(id).checked) checkedN++; });
    if (checkedN >= 1) {
      ids = ids.filter(function (id) { return songs.get(id).checked; });
    }
    return ids;
  }

  // 计算下一首 id（纯函数，便于逐格自测）
  // direction: 1=前进, -1=后退；reason: 'auto'|'manual'
  function computeNext(direction, reason, opts) {
    var range = opts.range;
    var mode = opts.mode;
    var cur = opts.currentId;
    var hist = opts.history;
    var ptr = opts.pointer;

    if (!range || range.length === 0) return null;

    // ---- 随机模式 ----
    if (mode === 'shuffle') {
      return shufflePick(direction, reason, range, cur, hist, ptr);
    }

    // ---- 顺序 / 单曲模式：线性导航 ----
    var idx = range.indexOf(cur);

    if (reason === 'auto') {
      // 歌曲自然播完
      if (mode === 'single') return cur;                 // 单曲循环：重播当前
      // 顺序：范围内下一首，最后一首后停止
      if (idx < 0) return range[0];
      var ni = idx + 1;
      if (ni >= range.length) return null;               // 末尾停止
      return range[ni];
    }

    // 手动 prev/next：在范围内线性移动（首尾环绕）
    if (idx < 0) return range[0];
    var ni2 = idx + direction;
    if (ni2 < 0) ni2 = range.length - 1;                 // 到头环绕到末尾
    if (ni2 >= range.length) ni2 = 0;                    // 到尾环绕到开头
    return range[ni2];
  }

  // 随机选曲：返回 { id, history, pointer }
  function shufflePick(direction, reason, range, cur, hist, ptr) {
    if (range.length <= 1) {
      return { id: range[0], history: [range[0]], pointer: 0 };
    }

    if (reason === 'auto') {
      // 自动选曲：排除当前 id
      var pick = randomExcept(range, cur);
      var newHist = hist.slice(0, ptr + 1);
      newHist.push(pick);
      return { id: pick, history: newHist, pointer: newHist.length - 1 };
    }

    // 手动 next：优先前进历史，再随机新曲
    if (direction > 0) {
      if (ptr + 1 < hist.length) {
        // 历史中有前进记录
        return { id: hist[ptr + 1], history: hist, pointer: ptr + 1 };
      }
      // 无前进历史，随机新曲
      var pick2 = randomExcept(range, cur);
      var newHist2 = hist.slice(0, ptr + 1);
      newHist2.push(pick2);
      return { id: pick2, history: newHist2, pointer: newHist2.length - 1 };
    }

    // 手动 prev：回退历史
    if (ptr > 0) {
      return { id: hist[ptr - 1], history: hist, pointer: ptr - 1 };
    }
    // 已在历史起点，无法回退
    return null;
  }

  function randomExcept(range, exclude) {
    var pick;
    var tries = 0;
    do {
      pick = range[Math.floor(Math.random() * range.length)];
      tries++;
    } while (pick === exclude && tries < 20);
    return pick;
  }

  // ===================== lastPlay 持久化 =====================

  function saveLastPlay() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      doSaveLastPlay();
    }, 1000);
  }

  function doSaveLastPlay() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var id = QM.state.currentId;
    if (!id) return;
    var lp = { songId: id, position: audio.currentTime || 0, updatedAt: Date.now() };
    QM.state.lastPlay = lp;
    QM.db.kvSet('lastPlay', lp).catch(function () {});
  }

  // M5：启动恢复——定位到上次歌曲但不发声、不取文件
  function restoreLastPlay() {
    var lp = QM.state.lastPlay;
    if (!lp || !lp.songId) return;
    var song = QM.state.get(lp.songId);
    if (!song || song.status !== 'ok') {
      QM.state.lastPlay = null;
      QM.db.kvSet('lastPlay', null).catch(function () {});
      return;
    }
    QM.state.setCurrent(lp.songId);
    QM.state.setPlaying(false);
    QM.bus.emit(QM.EV.PROGRESS, {
      currentTime: lp.position || 0,
      duration: song.duration || 0
    });
  }

  // ===================== 播放控制 =====================

  async function play(id) {
    var song = QM.state.get(id);
    if (!song || song.status !== 'ok') return false;

    var handle = QM.state.handleMap.get(id);
    if (!handle) {
      QM.ui.toast('文件句柄未就绪，请重新扫描');
      return false;
    }

    try {
      var file = await QM.fs.getFile(handle);
      if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
      currentUrl = URL.createObjectURL(file);
      audio.src = currentUrl;
      audio.load();

      QM.state.setCurrent(id);
      skipCount = 0;

      // 随机模式：手动点歌重置历史栈
      if (QM.state.settings.mode === 'shuffle') {
        shuffle.history = [id];
        shuffle.pointer = 0;
      }

      await audio.play();

      // M5：续播——恢复上次播放位置
      if (QM.state.lastPlay && QM.state.lastPlay.songId === id && QM.state.lastPlay.position) {
        try { audio.currentTime = QM.state.lastPlay.position; } catch (e) {}
        QM.state.lastPlay = null;
        QM.db.kvSet('lastPlay', null).catch(function () {});
      }

      QM.state.setPlaying(true);
      return true;
    } catch (e) {
      console.warn('播放失败', id, e);
      handleError();
      return false;
    }
  }

  function toggle() {
    if (!QM.state.currentId) {
      var range = rangeIds();
      if (range.length > 0) play(range[0]);
      return;
    }
    if (QM.state.playing) {
      audio.pause();
      QM.state.setPlaying(false);
    } else {
      audio.play().then(function () { QM.state.setPlaying(true); })
        .catch(function () {});
    }
  }

  function next() {
    var range = rangeIds();
    if (range.length === 0) { QM.ui.toast('没有可播放的歌曲'); return; }
    var result = computeNext(1, 'manual', {
      range: range,
      mode: QM.state.settings.mode,
      currentId: QM.state.currentId,
      history: shuffle.history,
      pointer: shuffle.pointer
    });
    if (!result) return;
    var id = (typeof result === 'string') ? result : result.id;
    if (result.history) { shuffle.history = result.history; shuffle.pointer = result.pointer; }
    play(id);
  }

  function prev() {
    var range = rangeIds();
    if (range.length === 0) { QM.ui.toast('没有可播放的歌曲'); return; }
    var result = computeNext(-1, 'manual', {
      range: range,
      mode: QM.state.settings.mode,
      currentId: QM.state.currentId,
      history: shuffle.history,
      pointer: shuffle.pointer
    });
    if (!result) {
      // 无法后退（已在随机历史起点），重启当前歌
      if (audio.currentTime > 3) audio.currentTime = 0;
      return;
    }
    var id = (typeof result === 'string') ? result : result.id;
    if (result.history) { shuffle.history = result.history; shuffle.pointer = result.pointer; }
    play(id);
  }

  function stop() {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    QM.state.setPlaying(false);
  }

  // ===================== 自动跳过 + 熔断 =====================

  function handleError() {
    skipCount++;
    var range = rangeIds();
    if (skipCount > range.length) {
      stop();
      QM.ui.toast('没有可播放的歌曲');
      return;
    }
    var result = computeNext(1, 'auto', {
      range: range,
      mode: QM.state.settings.mode,
      currentId: QM.state.currentId,
      history: shuffle.history,
      pointer: shuffle.pointer
    });
    if (result) {
      var id = (typeof result === 'string') ? result : result.id;
      if (result.history) { shuffle.history = result.history; shuffle.pointer = result.pointer; }
      if (id !== QM.state.currentId) { play(id); return; }
    }
    stop();
    QM.ui.toast('没有可播放的歌曲');
  }

  // ===================== audio 事件 =====================

  function onLoadedMetadata() {
    var id = QM.state.currentId;
    if (!id) return;
    var song = QM.state.get(id);
    if (song && song.duration === 0 && audio.duration && isFinite(audio.duration)) {
      QM.state.updateSong(id, { duration: Math.round(audio.duration) }, true);
    }
    emitProgress();
  }

  function onTimeUpdate() {
    emitProgress();
    saveLastPlay();               // M5：节流保存播放进度
  }

  function onEnded() {
    var mode = QM.state.settings.mode;
    if (mode === 'single') {
      audio.currentTime = 0;
      audio.play().catch(function () {});
      return;
    }
    // 顺序 / 随机：自动下一首
    var range = rangeIds();
    if (range.length === 0) { stop(); QM.ui.toast('没有可播放的歌曲'); return; }
    var result = computeNext(1, 'auto', {
      range: range,
      mode: mode,
      currentId: QM.state.currentId,
      history: shuffle.history,
      pointer: shuffle.pointer
    });
    if (result) {
      var id = (typeof result === 'string') ? result : result.id;
      if (result.history) { shuffle.history = result.history; shuffle.pointer = result.pointer; }
      play(id);
    } else {
      stop();
    }
  }

  function onError() {
    console.warn('Audio error:', audio.error);
    handleError();
  }

  function emitProgress() {
    QM.bus.emit(QM.EV.PROGRESS, {
      currentTime: audio.currentTime || 0,
      duration: (audio.duration && isFinite(audio.duration)) ? audio.duration : 0
    });
  }

  // ===================== 进度 / 音量 =====================

  function seek(seconds) {
    if (audio.duration && isFinite(audio.duration)) {
      try {
        audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
      } catch (e) { /* 异常 seek 忽略，timeupdate 会回弹 */ }
    }
  }

  function setVolume(v) {
    var vol = Math.max(0, Math.min(1, v));
    QM.state.setSettings({ volume: vol, muted: false });
    if (audio) { audio.volume = vol; audio.muted = false; }
  }

  function toggleMute() {
    var muted = !QM.state.settings.muted;
    QM.state.setSettings({ muted: muted });
    if (audio) audio.muted = muted;
  }

  function setMode(mode) {
    QM.state.setSettings({ mode: mode });
    if (mode === 'shuffle' && QM.state.currentId) {
      shuffle.history = [QM.state.currentId];
      shuffle.pointer = 0;
    }
  }

  // ===================== 初始化 =====================

  function init() {
    audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = QM.state.settings.muted ? 0 : QM.state.settings.volume;
    audio.muted = QM.state.settings.muted;

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('pause', function () {
      if (QM.state.currentId) doSaveLastPlay();
    });

    // M5：页面隐藏/关闭时保存进度
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && QM.state.currentId) doSaveLastPlay();
    });
    window.addEventListener('pagehide', function () {
      if (QM.state.currentId) doSaveLastPlay();
    });
  }

  // ===================== 导出 =====================

  QM.player = {
    init: init,
    play: play,
    toggle: toggle,
    next: next,
    prev: prev,
    stop: stop,
    seek: seek,
    setVolume: setVolume,
    toggleMute: toggleMute,
    setMode: setMode,
    rangeIds: rangeIds,
    computeNext: computeNext,
    restoreLastPlay: restoreLastPlay,
    _audio: function () { return audio; },
    _shuffle: function () { return shuffle; },
    _resetShuffle: function () { shuffle.history = []; shuffle.pointer = -1; },
    _skipCount: function () { return skipCount; },
    _saveLastPlayNow: doSaveLastPlay
  };
})();
