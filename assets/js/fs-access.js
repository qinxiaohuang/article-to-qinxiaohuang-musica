/* fs-access.js —— 文件夹选择、授权校验/请求、递归枚举、按相对路径取文件
 * 对源文件夹严格只读：本文件只允许出现 values()/getDirectoryHandle/getFileHandle/getFile。
 *
 * 双后端支持：
 *   - Chrome/Edge：File System Access API（showDirectoryPicker，可持久化句柄）
 *   - Firefox 等：<input type="file" webkitdirectory>（返回 File 列表，无法持久化句柄）
 *
 * 统一句柄抽象：
 *   root 可以是 FileSystemDirectoryHandle 或 { files: File[], name: string }（Firefox）
 *   文件句柄可以是 FileSystemFileHandle 或 File（Firefox）
 *   QM.fs.getFile(handle) 统一返回 File 对象
 */
(function () {
  'use strict';

  var MODE = { mode: 'read' };

  function nameExt(name) {
    var i = name.lastIndexOf('.');
    if (i <= 0) return { base: name, ext: '' };
    return { base: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() };
  }

  function isAudioName(name) {
    var ext = nameExt(name).ext;
    return QM.AUDIO_EXTS.indexOf(ext) >= 0;
  }

  // 判断是否为 File 对象（Firefox 后端的文件句柄）
  function isFileObj(h) {
    return h instanceof File || (h && typeof h === 'object' && h instanceof Blob && 'name' in h);
  }

  // 判断 root 是否为 Firefox 风格的文件列表对象
  function isFirefoxRoot(root) {
    return root && Array.isArray(root.files);
  }

  // 本次会话内的根目录记忆
  var memoryRoot = null;

  QM.fs = {
    setMemoryRoot: function (h) { memoryRoot = h || null; },
    getMemoryRoot: function () { return memoryRoot; },

    // 弹出系统选择窗口；用户取消时返回 null
    pick: async function () {
      if (QM.compat.hasFsAccess()) {
        // Chrome/Edge：File System Access API
        try {
          var handle = await window.showDirectoryPicker(MODE);
          return handle;
        } catch (e) {
          if (e && (e.name === 'AbortError' || e.code === 20)) return null;
          throw e;
        }
      }
      // Firefox 等：webkitdirectory input
      return new Promise(function (resolve) {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.webkitdirectory = true;
        inp.directory = true;
        inp.multiple = true;
        inp.style.display = 'none';
        document.body.appendChild(inp);
        inp.addEventListener('change', function () {
          var files = inp.files;
          document.body.removeChild(inp);
          if (!files || files.length === 0) { resolve(null); return; }
          // 取第一个文件的相对路径的首段作为文件夹名
          var folderName = '';
          var first = files[0];
          if (first.webkitRelativePath) {
            folderName = first.webkitRelativePath.split('/')[0];
          }
          resolve({ files: Array.from(files), name: folderName || '音乐文件夹' });
        });
        inp.addEventListener('cancel', function () {
          document.body.removeChild(inp);
          resolve(null);
        });
        inp.click();
      });
    },

    // 'granted' | 'prompt' | 'denied' | 'missing'
    permState: async function (handle) {
      if (!handle) return 'missing';
      // Firefox 后端：File 列表直接可读，无需授权
      if (isFirefoxRoot(handle)) return 'granted';
      // 注入的假句柄（无 queryPermission 方法，测试用）一律视为 granted
      if (typeof handle.queryPermission !== 'function') return 'granted';
      return await handle.queryPermission(MODE);
    },

    // 必须在用户点击事件链中调用
    request: async function (handle) {
      if (!handle) return 'denied';
      if (isFirefoxRoot(handle)) return 'granted';
      if (typeof handle.requestPermission !== 'function') return 'granted';
      return await handle.requestPermission(MODE);
    },

    // 递归枚举音频文件
    // 返回 [{id:'相对/路径.mp3', name, handle}]，id 用 / 分隔
    enumerate: async function (root) {
      if (isFirefoxRoot(root)) {
        // Firefox：遍历 File 列表，用 webkitRelativePath 构建相对路径
        var out = [];
        for (var i = 0; i < root.files.length; i++) {
          var file = root.files[i];
          if (!isAudioName(file.name)) continue;
          // webkitRelativePath 格式：文件夹名/子目录/文件名.mp3
          // 去掉首段文件夹名，得到相对路径
          var rel = file.webkitRelativePath || file.name;
          var slashIdx = rel.indexOf('/');
          var id = (slashIdx >= 0) ? rel.slice(slashIdx + 1) : file.name;
          out.push({ id: id, name: file.name, handle: file });
        }
        return out;
      }
      // Chrome/Edge：递归遍历目录句柄
      var out2 = [];
      async function walk(dir, prefix) {
        for await (var entry of dir.values()) {
          if (entry.kind === 'directory') {
            await walk(entry, prefix + entry.name + '/');
          } else if (entry.kind === 'file' && isAudioName(entry.name)) {
            out2.push({ id: prefix + entry.name, name: entry.name, handle: entry });
          }
        }
      }
      await walk(root, '');
      return out2;
    },

    // 统一获取 File 对象
    // handle 可以是 FileSystemFileHandle 或 File
    getFile: async function (handle) {
      if (isFileObj(handle)) return handle;
      if (handle && typeof handle.getFile === 'function') return await handle.getFile();
      throw new Error('无效的文件句柄');
    },

    // 按相对路径（/ 分隔）逐级定位文件（仅 Chrome/Edge 后端支持）
    getFileByRel: async function (root, relPath) {
      if (isFirefoxRoot(root)) {
        // Firefox：在 files 中查找匹配的文件
        for (var i = 0; i < root.files.length; i++) {
          var f = root.files[i];
          var rel = f.webkitRelativePath || f.name;
          var slashIdx = rel.indexOf('/');
          var id = (slashIdx >= 0) ? rel.slice(slashIdx + 1) : f.name;
          if (id === relPath) return f;
        }
        throw new Error('文件未找到: ' + relPath);
      }
      var parts = relPath.split('/');
      var dir = root;
      for (var i2 = 0; i2 < parts.length - 1; i2++) {
        dir = await dir.getDirectoryHandle(parts[i2], {});
      }
      var fh = await dir.getFileHandle(parts[parts.length - 1], {});
      return await fh.getFile();
    },

    nameExt: nameExt,
    isAudioName: isAudioName,
    isFirefoxRoot: isFirefoxRoot,
    isFileObj: isFileObj
  };
})();
