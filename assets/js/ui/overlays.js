/* ui/overlays.js —— 页面状态遮罩、黄色授权条、toast 与通用弹层 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  QM.esc = esc;

  // ---------------- 遮罩状态 ----------------
  var TEMPLATES = {
    UNSUPPORTED: function (info) {
      return '<h2 class="err">当前浏览器不受支持</h2>' +
        '<p>请使用最新版 <b>Microsoft Edge</b>、<b>Chrome</b> 或 <b>Firefox</b> 浏览器打开本应用。</p>' +
        '<p style="font-size:12px">缺少能力：' + esc((info && info.missing || []).join('、')) + '</p>';
    },
    FIRST_USE: function () {
      return '<h2>欢迎使用秦小皇音乐</h2>' +
        '<p>这是一个只在你电脑上运行的本地播放器。选择存放音乐的文件夹后，应用只会<b>读取</b>里面的音乐，' +
        '不会复制、移动或修改任何文件。</p>' +
        '<button class="btn btn-primary big-btn" data-act="pick-folder">选择音乐文件夹</button>' +
        '<p style="font-size:12px">音乐文件需要你自己提前放进文件夹；支持 mp3 / flac / m4a / wav / ogg。</p>';
    },
    REQUESTING: function () {
      return '<div class="spinner"></div>' +
        '<h2>等待授权</h2>' +
        '<p>请在弹出的窗口中选择音乐文件夹，并点击「允许」访问。</p>';
    },
    SCANNING: function (info) {
      return '<div class="spinner"></div>' +
        '<h2>正在扫描歌曲…</h2>' +
        '<p>已发现 <b id="scan-count">' + ((info && info.count) || 0) + '</b> 首，标签信息稍后会自动补全。</p>';
    },
    EMPTY_LIB: function () {
      return '<h2>这个文件夹里还没有音乐文件</h2>' +
        '<p>把音乐（mp3 / flac / m4a / wav / ogg）放进该文件夹后，点击顶部「重新扫描」。</p>' +
        '<button class="btn btn-primary big-btn" data-act="rescan">重新扫描</button>';
    }
  };

  function renderOverlay(key, info) {
    var box = el('overlay');
    var list = el('playlist-view');
    if (!key || key === 'HIDDEN') {
      box.classList.add('hidden');
      box.innerHTML = '';
      if (list) list.classList.remove('hidden');
      return;
    }
    if (list) list.classList.toggle('hidden', key !== 'READY' && key !== 'NEED_PERMISSION');
    box.classList.remove('hidden');
    box.innerHTML = TEMPLATES[key] ? TEMPLATES[key](info) : '';
  }

  // mode: none | prompt
  function setBanner(mode) {
    var banner = el('perm-banner');
    if (mode === 'prompt') {
      banner.classList.remove('hidden');
      el('perm-banner-text').textContent = '浏览器要求重新确认文件夹权限，点一下即可继续使用。';
      el('perm-banner-btn').textContent = '点此允许';
    } else {
      banner.classList.add('hidden');
    }
  }

  // ---------------- toast ----------------
  var toastTimer = null;
  function toast(msg, ms) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, ms || 2200);
  }

  // ---------------- 通用弹层 ----------------
  function openModal(innerHtml) {
    var root = el('modal-root');
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal">' + innerHtml + '</div>';
    root.appendChild(mask);
    return mask;
  }
  function closeModal(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  // 返回 Promise<bool>
  function confirmModal(opts) {
    return new Promise(function (resolve) {
      var mask = openModal(
        '<h3>' + esc(opts.title || '请确认') + '</h3>' +
        '<div>' + (opts.bodyHtml || esc(opts.body || '')) + '</div>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-act="cancel">' + esc(opts.cancelText || '取消') + '</button>' +
        '<button class="btn btn-primary" data-act="ok">' + esc(opts.okText || '确定') + '</button>' +
        '</div>');
      mask.addEventListener('click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (e.target === mask || act === 'cancel') { closeModal(mask); resolve(false); }
        if (act === 'ok') { closeModal(mask); resolve(true); }
      });
    });
  }

  function alertModal(opts) {
    return new Promise(function (resolve) {
      var mask = openModal(
        '<h3>' + esc(opts.title || '提示') + '</h3>' +
        '<div class="modal-body">' + (opts.bodyHtml || esc(opts.body || '')) + '</div>' +
        '<div class="modal-actions"><button class="btn btn-primary" data-act="ok">' +
        esc(opts.okText || '我知道了') + '</button></div>');
      mask.addEventListener('click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (e.target === mask || act === 'ok') { closeModal(mask); resolve(); }
      });
    });
  }

  QM.overlays = { render: renderOverlay, setBanner: setBanner };
  QM.ui = {
    toast: toast,
    confirm: confirmModal,
    alert: alertModal,
    openModal: openModal,
    closeModal: closeModal
  };
})();
