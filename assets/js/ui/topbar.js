/* ui/topbar.js —— 顶部栏：文件夹状态、重新扫描、菜单 */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }

  function refresh() {
    var st = QM.state;
    var label = el('folder-label');
    var rescan = el('btn-rescan');
    var menu = el('btn-menu');

    if (st.folderName) {
      label.textContent = st.folderName + (st.permission === 'granted' ? '' : '（待授权）');
      label.classList.add('ready');
    } else {
      label.textContent = '未选择文件夹';
      label.classList.remove('ready');
    }
    rescan.disabled = !(st.rootHandle && st.permission === 'granted' && !st.scanning);
    menu.disabled = !st.rootHandle;
  }

  function init() {
    el('btn-rescan').addEventListener('click', function () {
      QM.app.rescan();
    });

    var menuBtn = el('btn-menu');
    var pop = el('menu-pop');
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menuBtn.disabled) return;
      pop.classList.toggle('hidden');
    });
    document.addEventListener('click', function (e) {
      if (!pop.contains(e.target)) pop.classList.add('hidden');
    });
    pop.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      pop.classList.add('hidden');
      QM.app.handleMenuAction(act);
    });

    QM.bus.on(QM.EV.PERMISSION_CHANGED, refresh);
    QM.bus.on(QM.EV.STATE_CHANGED, refresh);
    QM.bus.on(QM.EV.SONGS_CHANGED, refresh);
    refresh();
  }

  QM.topbar = { init: init, refresh: refresh };
})();
