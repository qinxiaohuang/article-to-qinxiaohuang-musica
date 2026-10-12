/* ui/playerbar.js —— M4：底部播放栏交互
 * 三键 + 模式按钮 + 进度条拖拽 + 音量/静音 + 当前歌曲信息。 */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }

  var bar, coverEl, titleEl, artistEl;
  var modeBtn, prevBtn, playBtn, nextBtn;
  var seekEl, timeCurEl, timeTotalEl;
  var muteBtn, volumeEl;

  var dragging = false;        // 进度条正在拖拽
  var lastVolumeBeforeMute = 0.8;

  // 模式图标与文案
  var MODES = [
    { key: 'sequence', icon: '↻', title: '顺序播放' },
    { key: 'single',   icon: '🔂', title: '单曲循环' },
    { key: 'shuffle',  icon: '🔀', title: '随机播放' }
  ];

  function modeInfo(key) {
    return MODES.filter(function (m) { return m.key === key; })[0] || MODES[0];
  }

  function cycleMode() {
    var cur = QM.state.settings.mode;
    var idx = MODES.findIndex(function (m) { return m.key === cur; });
    var next = MODES[(idx + 1) % MODES.length];
    QM.player.setMode(next.key);
  }

  // ===================== 渲染 =====================

  function refreshMode() {
    var m = modeInfo(QM.state.settings.mode);
    modeBtn.textContent = m.icon;
    modeBtn.title = m.title;
    modeBtn.classList.toggle('active', true);
  }

  function refreshPlayButton() {
    playBtn.textContent = QM.state.playing ? '⏸' : '▶';
    playBtn.title = QM.state.playing ? '暂停' : '播放';
  }

  function refreshNowPlaying() {
    var id = QM.state.currentId;
    if (!id) {
      titleEl.textContent = '秦小皇音乐';
      artistEl.textContent = '选择文件夹后开始听歌';
      coverEl.innerHTML = '';
      return;
    }
    var song = QM.state.get(id);
    if (!song) return;
    titleEl.textContent = QM.metadata.displayName(song);
    var sub = QM.metadata.displaySub(song);
    artistEl.textContent = sub || '\u00a0';
    // 封面
    coverEl.innerHTML = '';
    QM.db.coverGet(id).then(function (rec) {
      if (!rec || !rec.blob || QM.state.currentId !== id) return;
      var img = document.createElement('img');
      img.src = URL.createObjectURL(rec.blob);
      coverEl.appendChild(img);
    }).catch(function () {});
  }

  function refreshDisabled() {
    var range = QM.player.rangeIds();
    var noPerm = QM.state.permission !== 'granted';
    bar.classList.toggle('disabled', range.length === 0 || noPerm);
  }

  function fmtTime(sec) {
    if (!sec || !isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function refreshProgress(p) {
    timeCurEl.textContent = fmtTime(p.currentTime);
    timeTotalEl.textContent = fmtTime(p.duration);
    if (!dragging && p.duration > 0) {
      seekEl.value = Math.round((p.currentTime / p.duration) * 1000);
    }
  }

  function refreshVolume() {
    var s = QM.state.settings;
    volumeEl.value = s.muted ? 0 : Math.round(s.volume * 100);
    muteBtn.textContent = s.muted ? '🔇' : '🔊';
    muteBtn.title = s.muted ? '取消静音' : '静音';
    if (!s.muted && s.volume > 0) lastVolumeBeforeMute = s.volume;
  }

  // ===================== 事件处理 =====================

  function onModeClick() { cycleMode(); }
  function onPrevClick() { QM.player.prev(); }
  function onNextClick() { QM.player.next(); }
  function onPlayClick() { QM.player.toggle(); }

  // 进度条拖拽
  function onSeekInput() {
    dragging = true;
    if (QM.state.playing) {
      // 拖动时不暂停音频，仅停止刷新进度
    }
    var val = parseFloat(seekEl.value);
    var dur = QM.player._audio() && QM.player._audio().duration;
    if (dur && isFinite(dur)) {
      timeCurEl.textContent = fmtTime((val / 1000) * dur);
    }
  }

  function onSeekChange() {
    var val = parseFloat(seekEl.value);
    var dur = QM.player._audio() && QM.player._audio().duration;
    if (dur && isFinite(dur)) {
      QM.player.seek((val / 1000) * dur);
    }
    dragging = false;
  }

  // 音量
  function onVolumeInput() {
    var v = parseFloat(volumeEl.value) / 100;
    QM.player.setVolume(v);
  }

  function onMuteClick() {
    QM.player.toggleMute();
  }

  // ===================== 初始化 =====================

  function init() {
    bar = el('player-bar');
    coverEl = el('pb-cover');
    titleEl = el('pb-title');
    artistEl = el('pb-artist');
    modeBtn = el('btn-mode');
    prevBtn = el('btn-prev');
    playBtn = el('btn-playpause');
    nextBtn = el('btn-next');
    seekEl = el('seek');
    timeCurEl = el('time-cur');
    timeTotalEl = el('time-total');
    muteBtn = el('btn-mute');
    volumeEl = el('volume');

    modeBtn.addEventListener('click', onModeClick);
    prevBtn.addEventListener('click', onPrevClick);
    playBtn.addEventListener('click', onPlayClick);
    nextBtn.addEventListener('click', onNextClick);

    seekEl.addEventListener('input', onSeekInput);
    seekEl.addEventListener('change', onSeekChange);

    volumeEl.addEventListener('input', onVolumeInput);
    muteBtn.addEventListener('click', onMuteClick);

    // 事件订阅
    QM.bus.on(QM.EV.CURRENT_CHANGED, function () {
      refreshNowPlaying();
      refreshPlayButton();
    });
    QM.bus.on(QM.EV.PLAY_STATE, refreshPlayButton);
    QM.bus.on(QM.EV.PROGRESS, refreshProgress);
    QM.bus.on(QM.EV.SETTINGS_CHANGED, function () {
      refreshMode();
      refreshVolume();
    });
    QM.bus.on(QM.EV.SONGS_CHANGED, function () { refreshDisabled(); });
    QM.bus.on(QM.EV.SONG_UPDATED, function (p) {
      if (p.id === QM.state.currentId) refreshNowPlaying();
      refreshDisabled();
    });
    QM.bus.on(QM.EV.PERMISSION_CHANGED, function () { refreshDisabled(); });

    // 初始渲染
    refreshMode();
    refreshPlayButton();
    refreshVolume();
    refreshDisabled();
  }

  QM.playerBar = {
    init: init,
    refreshMode: refreshMode,
    refreshPlayButton: refreshPlayButton,
    refreshNowPlaying: refreshNowPlaying,
    refreshDisabled: refreshDisabled,
    refreshVolume: refreshVolume
  };
})();
