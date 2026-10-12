/* fake-fs.js —— 测试用内存文件系统（模拟 File System Access API）
 * FakeDirHandle / FakeFileHandle 行为与浏览器真实句柄一致（只读）。 */
(function () {
  'use strict';

  function FakeFileHandle(name, file) {
    this.kind = 'file';
    this.name = name;
    this._file = file;
  }
  FakeFileHandle.prototype.getFile = async function () { return this._file; };

  function FakeDirHandle(name, children) {
    this.kind = 'directory';
    this.name = name || '';
    this._children = children || [];
  }
  FakeDirHandle.prototype.values = async function* () {
    for (var i = 0; i < this._children.length; i++) yield this._children[i];
  };
  FakeDirHandle.prototype.add = function (h) { this._children.push(h); return h; };
  FakeDirHandle.prototype.getDirectoryHandle = async function (n) {
    for (var i = 0; i < this._children.length; i++) {
      var c = this._children[i];
      if (c.kind === 'directory' && c.name === n) return c;
    }
    var e = new Error('NotAllowedError: dir not found ' + n);
    e.name = 'NotFoundError';
    throw e;
  };
  FakeDirHandle.prototype.getFileHandle = async function (n) {
    for (var i = 0; i < this._children.length; i++) {
      var c = this._children[i];
      if (c.kind === 'file' && c.name === n) return c;
    }
    var e = new Error('NotFoundError: file not found ' + n);
    e.name = 'NotFoundError';
    throw e;
  };

  // 可配置权限行为的目录句柄（方法挂原型，模拟原生句柄的克隆行为）
  function FakePermDir(name, opts) {
    FakeDirHandle.call(this, name, []);
    this._permOpts = opts || {};
    this.requestCalled = 0;
  }
  FakePermDir.prototype = Object.create(FakeDirHandle.prototype);
  FakePermDir.prototype.constructor = FakePermDir;
  FakePermDir.prototype.queryPermission = async function () {
    return this._permOpts.query || 'prompt';
  };
  FakePermDir.prototype.requestPermission = async function () {
    this.requestCalled++;
    return this._permOpts.request || 'granted';
  };

  // 构造一个 File（bytes 可为字符串/数组/Uint8Array）
  function file(name, bytes, type) {
    var u8;
    if (bytes == null) u8 = new Uint8Array(0);
    else if (bytes instanceof Uint8Array) u8 = bytes;
    else if (Array.isArray(bytes)) u8 = new Uint8Array(bytes);
    else u8 = new TextEncoder().encode(String(bytes));
    return new File([u8], name, { type: type || '' });
  }

  // 生成一个可真实解码的 PCM WAV（16bit 单声道 8000Hz，指定秒数静音/正弦）
  function wavFile(name, seconds, freq) {
    var rate = 8000;
    var n = Math.floor(rate * (seconds || 0.2));
    var data = new Uint8Array(n * 2);
    var dv = new DataView(data.buffer);
    var f = freq || 0;
    for (var i = 0; i < n; i++) {
      var v = f ? Math.round(16000 * Math.sin(2 * Math.PI * f * i / rate)) : 0;
      dv.setInt16(i * 2, v, true);
    }
    var buf = new Uint8Array(44 + data.length);
    var d = new DataView(buf.buffer);
    function ws(off, s) { for (var i = 0; i < s.length; i++) d.setUint8(off + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); d.setUint32(4, 36 + data.length, true); ws(8, 'WAVE');
    ws(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
    d.setUint16(22, 1, true); d.setUint32(24, rate, true);
    d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
    ws(36, 'data'); d.setUint32(40, data.length, true);
    buf.set(data, 44);
    return new File([buf], name, { type: 'audio/wav' });
  }

  window.QTF = {
    dir: function (name, children) { return new FakeDirHandle(name, children); },
    fileHandle: function (name, f) { return new FakeFileHandle(name, f); },
    permDir: function (name, opts) { return new FakePermDir(name, opts); },
    file: file,
    wavFile: wavFile
  };
})();
