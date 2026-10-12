/* shortcuts.js —— M4：空格播放/暂停、←/→ 切歌
 * 输入框聚焦或弹层打开时不触发；页面被点击激活后生效。 */
(function () {
  'use strict';

  var activated = false;       // 用户点击页面后激活
  var modalOpen = false;       // 弹层打开时禁用

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function hasOpenModal() {
    return !!document.querySelector('.modal-mask') || modalOpen;
  }

  function onKeyDown(e) {
    if (!activated) return;
    if (hasOpenModal()) return;
    if (isTyping(e.target)) return;

    var key = e.key;
    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      QM.player.toggle();
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      QM.player.prev();
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      QM.player.next();
    }
  }

  // 监听弹层打开/关闭（通过事件总线间接感知）
  // openModal/closeModal 会修改 #modal-root 的子节点，用 MutationObserver 感知
  function setupModalWatcher() {
    var root = document.getElementById('modal-root');
    if (!root) return;
    var obs = new MutationObserver(function () {
      modalOpen = root.children.length > 0;
    });
    obs.observe(root, { childList: true });
  }

  function init() {
    // 任意点击激活快捷键
    document.addEventListener('click', function () { activated = true; }, { once: false });
    document.addEventListener('keydown', onKeyDown);
    setupModalWatcher();
  }

  QM.shortcuts = {
    init: init,
    _isActivated: function () { return activated; },
    _setActivated: function (v) { activated = v; }
  };
})();
