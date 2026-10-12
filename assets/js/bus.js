/* bus.js —— 极简发布订阅：UI 只订阅事件，不反向耦合业务模块 */
(function () {
  'use strict';
  var listeners = Object.create(null);

  QM.bus = {
    on: function (event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return function () { QM.bus.off(event, fn); };
    },
    off: function (event, fn) {
      var arr = listeners[event];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    emit: function (event, payload) {
      var arr = listeners[event];
      if (!arr) return;
      arr.slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error('[bus] ' + event, e); }
      });
    }
  };

  // 全局事件名常量，避免拼写错误
  QM.EV = {
    STATE_CHANGED: 'state-changed',        // 通用：状态机变化
    SONGS_CHANGED: 'songs-changed',        // 歌单数据变化
    SONG_UPDATED: 'song-updated',          // 单首更新（标签解析完/勾选/编辑）
    CURRENT_CHANGED: 'current-changed',    // 当前播放歌曲变化
    PLAY_STATE: 'play-state',              // 播放/暂停
    PROGRESS: 'progress',                  // 播放进度
    SETTINGS_CHANGED: 'settings-changed',
    PERMISSION_CHANGED: 'permission-changed',
    TOAST: 'toast'
  };
})();
