/* compat.js —— 全局命名空间与浏览器能力检测 */
(function () {
  'use strict';
  window.QM = window.QM || {};

  QM.AUDIO_EXTS = ['mp3', 'flac', 'm4a', 'wav', 'ogg', 'oga', 'aac'];

  // 运行所需的浏览器能力
  // 支持 Chrome/Edge（File System Access API）和 Firefox（webkitdirectory input）
  QM.compat = {
    // 是否有 File System Access API（Chrome/Edge）
    hasFsAccess: function () {
      return !!(window.showDirectoryPicker &&
                window.FileSystemHandle &&
                'getFile' in FileSystemFileHandle.prototype);
    },
    // 是否支持 webkitdirectory 目录选择（Firefox 等）
    hasWebkitDir: function () {
      try {
        var inp = document.createElement('input');
        inp.type = 'file';
        return 'webkitdirectory' in inp;
      } catch (e) { return false; }
    },
    supported: function () {
      var hasFs = this.hasFsAccess();
      var hasDir = this.hasWebkitDir();
      return !!(window.indexedDB &&
                URL && URL.createObjectURL &&
                (hasFs || hasDir));
    },
    missing: function () {
      var list = [];
      if (!window.showDirectoryPicker && !this.hasWebkitDir()) {
        list.push('文件夹选择 API（Chrome/Edge 或 Firefox 均不支持）');
      }
      if (!window.indexedDB) list.push('IndexedDB');
      if (!window.URL || !URL.createObjectURL) list.push('ObjectURL');
      return list;
    },
    // audio 对某 MIME 的可播预判：'' / 'maybe' / 'probably'
    canPlayMime: function (mime) {
      try {
        var a = document.createElement('audio');
        var v = a.canPlayType(mime);
        return !!v;
      } catch (e) { return false; }
    }
  };

  // 扩展名 -> MIME
  QM.extToMime = function (ext) {
    ext = (ext || '').toLowerCase();
    return ({
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
      ogg: 'audio/ogg', oga: 'audio/ogg',
      wav: 'audio/wav',
      m4a: 'audio/mp4', aac: 'audio/aac'
    })[ext] || '';
  };
})();
