/* qtest.js —— 极简浏览器测试框架（无外部依赖）
 * 页面末尾调用 QT.run()；结果写入 #qt-result 与 document.title。 */
(function () {
  'use strict';
  var cases = [];
  var QT = {
    test: function (name, fn) { cases.push({ name: name, fn: fn }); },
    ok: function (cond, msg) {
      if (!cond) throw new Error(msg || '期望为真，实际：' + QFMT(cond));
    },
    eq: function (actual, expected, msg) {
      if (!QEQ(actual, expected)) {
        throw new Error((msg || '断言失败') + '\n期望：' + QFMT(expected) + '\n实际：' + QFMT(actual));
      }
    },
    wait: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    run: run
  };

  function QFMT(v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function QEQ(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a && b && typeof a === 'object') {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every(function (k) { return QEQ(a[k], b[k]); });
    }
    return false;
  }

  async function run() {
    var pass = 0, fail = 0;
    var box = document.getElementById('qt-list') || document.body;
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      var line = document.createElement('div');
      try {
        await c.fn();
        pass++;
        line.className = 'pass';
        line.textContent = 'PASS  ' + c.name;
      } catch (e) {
        fail++;
        line.className = 'fail';
        line.textContent = 'FAIL  ' + c.name;
        var pre = document.createElement('pre');
        pre.textContent = String(e && e.stack || e);
        line.appendChild(pre);
      }
      box.appendChild(line);
    }
    var summary = 'RESULT PASS=' + pass + ' FAIL=' + fail;
    var r = document.getElementById('qt-result');
    if (r) r.textContent = summary;
    document.title = summary;
    window.QT_RESULT = { pass: pass, fail: fail };
  }

  window.QT = QT;
})();
