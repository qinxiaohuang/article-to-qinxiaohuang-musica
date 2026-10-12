/* M2 测试用例 —— 标签解析（五格式）+ 扫描合并 + 懒解析队列 + 封面下采样 */
(function () {
  'use strict';
  var W, Q, D;

  function until(fn, timeout) {
    timeout = timeout || 8000;
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        var v;
        try { v = fn(); } catch (e) { v = undefined; }
        if (v) return resolve(v);
        if (Date.now() - t0 > timeout) return reject(new Error('等待超时'));
        setTimeout(tick, 50);
      })();
    });
  }

  // ---- 字节构造辅助 ----
  function u8cat(parts) {
    var arr = [], total = 0;
    parts.forEach(function (p) {
      if (typeof p === 'string') { var e = new TextEncoder().encode(p); arr.push(e); total += e.length; }
      else if (p instanceof Uint8Array) { arr.push(p); total += p.length; }
      else if (Array.isArray(p)) { var u = new Uint8Array(p); arr.push(u); total += u.length; }
      else if (typeof p === 'number') { arr.push(new Uint8Array([p])); total += 1; }
    });
    var out = new Uint8Array(total), off = 0;
    arr.forEach(function (a) { out.set(a, off); off += a.length; });
    return out;
  }
  function u32be(n) { var u = new Uint8Array(4); new DataView(u.buffer).setUint32(0, n); return u; }
  function u32le(n) { var u = new Uint8Array(4); new DataView(u.buffer).setUint32(0, n, true); return u; }
  function u24be(n) { return new Uint8Array([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]); }
  function syncsafe(n) { return new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]); }
  function strB(s) { return new TextEncoder().encode(s); }
  function latinB(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  // ---- 合成标签文件 ----

  // ID3v2.3：'ID3'+[3,0,0]+syncsafe(len) + frames(TIT2/TPE1/TALB)
  function buildMp3v23(tags) {
    function textFrame(id, text) {
      var body = u8cat([new Uint8Array([0]), latinB(text)]); // enc=0 latin1
      return u8cat([latinB(id), u32be(body.length), new Uint8Array([0, 0]), body]);
    }
    var frames = [];
    if (tags.title) frames.push(textFrame('TIT2', tags.title));
    if (tags.artist) frames.push(textFrame('TPE1', tags.artist));
    if (tags.album) frames.push(textFrame('TALB', tags.album));
    var body = u8cat(frames);
    var header = u8cat([latinB('ID3'), new Uint8Array([3, 0, 0]), syncsafe(body.length)]);
    return u8cat([header, body, new Uint8Array(50)]); // 50 bytes fake audio
  }

  // ID3v1：128 字节尾
  function buildMp3v1(tags) {
    function pad(s, n) {
      var u = latinB(s);
      var out = new Uint8Array(n);
      out.set(u.subarray(0, Math.min(u.length, n)));
      return out;
    }
    var tag = u8cat([
      latinB('TAG'), pad(tags.title || '', 30), pad(tags.artist || '', 30),
      pad(tags.album || '', 30), new Uint8Array(4), new Uint8Array(30), new Uint8Array([0])
    ]);
    return u8cat([new Uint8Array(100), tag]); // 100 bytes audio + 128 tag = 228
  }

  // MP4/M4A：moov>udta>meta(version4)>ilst>©nam/©ART/©alb>data
  function mp4Box(type, body) { return u8cat([u32be(8 + body.length), latinB(type), body]); }
  function mp4DataBox(dataType, payload) {
    // body: version/flags(4) + dataType(4) + locale(4) + padding(4) + payload
    var body = u8cat([new Uint8Array([0, 0, 0, 0]), u32be(dataType), new Uint8Array([0, 0, 0, 0]), new Uint8Array([0, 0, 0, 0]), payload]);
    return mp4Box('data', body);
  }
  function buildM4a(tags) {
    var ch = [];
    if (tags.title) ch.push(mp4Box('\xA9nam', mp4DataBox(1, strB(tags.title))));
    if (tags.artist) ch.push(mp4Box('\xA9ART', mp4DataBox(1, strB(tags.artist))));
    if (tags.album) ch.push(mp4Box('\xA9alb', mp4DataBox(1, strB(tags.album))));
    var ilst = mp4Box('ilst', u8cat(ch));
    var meta = mp4Box('meta', u8cat([new Uint8Array([0, 0, 0, 0]), ilst]));
    return mp4Box('moov', mp4Box('udta', meta));
  }

  // FLAC：'fLaC' + VORBIS_COMMENT block(type 4, last)
  function buildFlac(tags) {
    var vendor = strB('test');
    var comments = [];
    if (tags.title) comments.push(strB('TITLE=' + tags.title));
    if (tags.artist) comments.push(strB('ARTIST=' + tags.artist));
    if (tags.album) comments.push(strB('ALBUM=' + tags.album));
    var commentBody = u8cat([
      u32le(vendor.length), vendor, u32le(comments.length),
      u8cat(comments.map(function (c) { return u8cat([u32le(c.length), c]); }))
    ]);
    // block header: 0x84 = last(0x80) + type 4
    return u8cat([latinB('fLaC'), new Uint8Array([0x84]), u24be(commentBody.length), commentBody]);
  }

  // WAV：RIFF/WAVE + LIST/INFO(INAM/IART/IPRD) + data
  function buildWav(tags) {
    function infoChunk(id, text) {
      var data = u8cat([latinB(text), new Uint8Array([0])]);
      if (data.length % 2) data = u8cat([data, new Uint8Array([0])]);
      return u8cat([latinB(id), u32le(data.length), data]);
    }
    var infoChunks = [];
    if (tags.title) infoChunks.push(infoChunk('INAM', tags.title));
    if (tags.artist) infoChunks.push(infoChunk('IART', tags.artist));
    if (tags.album) infoChunks.push(infoChunk('IPRD', tags.album));
    var listBody = u8cat([latinB('INFO')].concat(infoChunks));
    var listChunk = u8cat([latinB('LIST'), u32le(listBody.length), listBody]);
    var dataChunk = u8cat([latinB('data'), u32le(0)]);
    var waveBody = u8cat([listChunk, dataChunk]);
    return u8cat([latinB('RIFF'), u32le(4 + waveBody.length), latinB('WAVE'), waveBody]);
  }

  // OGG Vorbis：page1(id packet) + page2(comment packet)
  function oggPage(headerType, serial, pageSeq, packet) {
    return u8cat([
      latinB('OggS'), new Uint8Array([0, headerType]),
      new Uint8Array(8), // granule
      serial, u32le(pageSeq), new Uint8Array(4), // checksum
      new Uint8Array([1]), new Uint8Array([packet.length]), packet
    ]);
  }
  function buildOgg(tags) {
    var serial = new Uint8Array([1, 0, 0, 0]);
    // id packet: 0x01 + 'vorbis' + version(4) + channels(1) + sampleRate(4) + bitrate(12) + blocksize(1) + framing(1) = 30
    var idPacket = u8cat([
      new Uint8Array([0x01]), latinB('vorbis'),
      u32le(0), new Uint8Array([1]), u32le(44100),
      u32le(0), u32le(0), u32le(0), new Uint8Array([0, 0])
    ]);
    var page1 = oggPage(0x02, serial, 0, idPacket);
    // comment packet: 0x03 + 'vorbis' + vendorLen(4LE) + vendor + count(4LE) + comments
    var vendor = strB('test');
    var comments = [];
    if (tags.title) comments.push(strB('TITLE=' + tags.title));
    if (tags.artist) comments.push(strB('ARTIST=' + tags.artist));
    if (tags.album) comments.push(strB('ALBUM=' + tags.album));
    var commentPacket = u8cat([
      new Uint8Array([0x03]), latinB('vorbis'),
      u32le(vendor.length), vendor, u32le(comments.length),
      u8cat(comments.map(function (c) { return u8cat([u32le(c.length), c]); }))
    ]);
    var page2 = oggPage(0x00, serial, 1, commentPacket);
    return u8cat([page1, page2]);
  }

  // ---- setup ----
  async function setup() {
    var iframe = document.getElementById('app');
    await until(function () {
      W = iframe.contentWindow;
      return W && W.QM && W.QM.app && W.QM.app.testHooks && W.QM.metaTest;
    });
    Q = W.QM; D = W.document;
    await Q.app.testHooks.reset();
  }

  window.addEventListener('load', function () {
    setup().then(function () {

      // ===== 1. MP3 ID3v2.3 标签解析 =====
      QT.test('1. MP3 ID3v2.3：解析 TIT2/TPE1/TALB', function () {
        var u8 = buildMp3v23({ title: 'My Song', artist: 'My Artist', album: 'My Album' });
        var r = Q.metaTest.parseID3v2(u8, 0);
        QT.ok(r !== null, '应返回非 null');
        QT.eq(r.title, 'My Song', '歌名应为 My Song');
        QT.eq(r.artist, 'My Artist', '歌手应为 My Artist');
        QT.eq(r.album, 'My Album', '专辑应为 My Album');
      });

      // ===== 2. MP3 ID3v1 尾部标签解析 =====
      QT.test('2. MP3 ID3v1：解析尾部 128 字节', function () {
        var u8 = buildMp3v1({ title: 'V1Title', artist: 'V1Artist', album: 'V1Album' });
        var r = Q.metaTest.parseID3v1(u8);
        QT.ok(r !== null, '应返回非 null');
        QT.eq(r.title, 'V1Title', '歌名');
        QT.eq(r.artist, 'V1Artist', '歌手');
        QT.eq(r.album, 'V1Album', '专辑');
      });

      // ===== 3. MP3 parseFile 端到端（ID3v2.3 优先于 v1） =====
      QT.test('3. MP3 parseFile：v2.3 优先，无标签时回退空', async function () {
        var u8 = buildMp3v23({ title: 'E2E', artist: 'E2A', album: 'E2B' });
        var file = QTF.file('test.mp3', u8);
        var r = await Q.metadata.parseFile(file, 'mp3');
        QT.eq(r.title, 'E2E', 'parseFile 歌名');
        QT.eq(r.artist, 'E2A', 'parseFile 歌手');

        // 无标签文件
        var empty = QTF.file('notag.mp3', new Uint8Array(200));
        var r2 = await Q.metadata.parseFile(empty, 'mp3');
        QT.eq(r2.title, '', '无标签应返回空歌名');
        QT.eq(r2.artist, '', '无标签应返回空歌手');
      });

      // ===== 4. M4A/M4A ilst 解析 =====
      QT.test('4. M4A ilst：解析 ©nam/©ART/©alb', function () {
        var u8 = buildM4a({ title: 'M4Title', artist: 'M4Artist', album: 'M4Album' });
        var r = Q.metaTest.parseMp4(u8);
        QT.eq(r.title, 'M4Title', '歌名');
        QT.eq(r.artist, 'M4Artist', '歌手');
        QT.eq(r.album, 'M4Album', '专辑');
      });

      // ===== 5. FLAC VORBIS_COMMENT 解析 =====
      QT.test('5. FLAC Vorbis Comment：解析 TITLE/ARTIST/ALBUM', function () {
        var u8 = buildFlac({ title: 'FlTitle', artist: 'FlArtist', album: 'FlAlbum' });
        var r = Q.metaTest.parseFlac(u8);
        QT.eq(r.title, 'FlTitle', '歌名');
        QT.eq(r.artist, 'FlArtist', '歌手');
        QT.eq(r.album, 'FlAlbum', '专辑');
      });

      // ===== 6. WAV LIST/INFO 解析 =====
      QT.test('6. WAV LIST/INFO：解析 INAM/IART/IPRD', function () {
        var u8 = buildWav({ title: 'WavTitle', artist: 'WavArtist', album: 'WavAlbum' });
        var r = Q.metaTest.parseWav(u8);
        QT.eq(r.title, 'WavTitle', '歌名');
        QT.eq(r.artist, 'WavArtist', '歌手');
        QT.eq(r.album, 'WavAlbum', '专辑');
      });

      // ===== 7. OGG Vorbis 注释解析 =====
      QT.test('7. OGG Vorbis：解析 TITLE/ARTIST/ALBUM', function () {
        var u8 = buildOgg({ title: 'OgTitle', artist: 'OgArtist', album: 'OgAlbum' });
        var r = Q.metaTest.parseOgg(u8);
        QT.eq(r.title, 'OgTitle', '歌名');
        QT.eq(r.artist, 'OgArtist', '歌手');
        QT.eq(r.album, 'OgAlbum', '专辑');
      });

      // ===== 8. displayName / displaySub / fmtTime =====
      QT.test('8. 显示辅助：displayName/displaySub/fmtTime', function () {
        var song = { fileName: 'track01.mp3', title: null, raw: { title: 'RawTitle', artist: 'RawArt', album: 'RawAlb' } };
        QT.eq(Q.metadata.displayName(song), 'RawTitle', '无覆盖应用 raw 标签');
        song.title = 'Manual';
        QT.eq(Q.metadata.displayName(song), 'Manual', '有覆盖应用手动值');
        song.title = null; song.raw = { title: '', artist: '', album: '' };
        QT.eq(Q.metadata.displayName(song), 'track01', '无标签回退文件名（去扩展名）');
        QT.eq(Q.metadata.displaySub({ artist: 'A', album: 'B' }), 'A · B', '歌手·专辑');
        QT.eq(Q.metadata.fmtTime(0), '0:00', 'fmtTime 0:00');
        QT.eq(Q.metadata.fmtTime(65), '1:05', 'fmtTime 1:05');
        QT.eq(Q.metadata.fmtTime(-1), '0:00', 'fmtTime 负数容错');
      });

      // ===== 9. 封面下采样 =====
      QT.test('9. shrinkCover：生成 ≤128px JPEG blob', async function () {
        var canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 100;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff7a45';
        ctx.fillRect(0, 0, 200, 100);
        var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/png'); });
        var pic = { mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) };
        var shrunk = await Q.metadata.shrinkCover(pic);
        QT.ok(shrunk && shrunk.size > 0, '应返回有效 blob');
        QT.eq(shrunk.type, 'image/jpeg', '应为 JPEG');
        var bmp = await createImageBitmap(shrunk);
        QT.ok(Math.max(bmp.width, bmp.height) <= 128, '长边应 ≤128px，实际 ' + bmp.width + 'x' + bmp.height);
        if (bmp.close) bmp.close();
      });

      // ===== 10. 扫描合并规则（A4）=====
      QT.test('10. 重新扫描合并：新增追加/消失标记缺失/保留勾选与编辑（A4）', async function () {
        // 首次扫描：A, B, C
        var root1 = QTF.dir('合并库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'aaa')),
          QTF.fileHandle('b.mp3', QTF.file('b.mp3', 'bbb')),
          QTF.fileHandle('c.mp3', QTF.file('c.mp3', 'ccc'))
        ]);
        await Q.app.testHooks.bootWith(root1);
        await until(function () { return Q.app.testHooks.state() === 'READY'; });
        await Q.scanner.drain();

        // 编辑 B 的歌名，取消 C 的勾选
        Q.state.updateSong('b.mp3', { title: 'EditedB' }, true);
        Q.state.updateSong('c.mp3', { checked: false }, true);
        await QT.wait(100); // 等待持久化

        // 第二次扫描：A, C, D（B 消失，D 新增）
        var root2 = QTF.dir('合并库', [
          QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'aaa')),
          QTF.fileHandle('c.mp3', QTF.file('c.mp3', 'ccc')),
          QTF.fileHandle('d.mp3', QTF.file('d.mp3', 'ddd'))
        ]);
        await Q.app.testHooks.bootWith(root2);
        await until(function () { return Q.app.testHooks.state() === 'READY'; });
        await Q.scanner.drain();

        var a = Q.state.get('a.mp3'), b = Q.state.get('b.mp3'), c = Q.state.get('c.mp3'), d = Q.state.get('d.mp3');
        QT.ok(!!a, 'A 应存在');
        QT.ok(!!b, 'B 应存在（缺失）');
        QT.eq(b.status, 'missing', 'B 应标记 missing');
        QT.eq(b.title, 'EditedB', 'B 的手动编辑应保留');
        QT.eq(a.checked, true, 'A 应保持勾选');
        QT.eq(c.checked, false, 'C 应保持未勾选');
        QT.ok(!!d, 'D 应存在');
        QT.eq(d.checked, true, 'D 应默认勾选');
        QT.eq(d.status, 'ok', 'D 应为 ok');
      });

      // ===== 11. 不支持格式标记 =====
      QT.test('11. 不支持格式：.xyz 标记 unsupported', async function () {
        // 用假 audio.canPlayType 返回空
        var origCanPlay = Q.compat.canPlayMime;
        Q.compat.canPlayMime = function (mime) { return mime === 'audio/mpeg'; }; // 只支持 mp3
        try {
          var root = QTF.dir('混合库', [
            QTF.fileHandle('a.mp3', QTF.file('a.mp3', 'x')),
            QTF.fileHandle('b.flac', QTF.file('b.flac', 'x'))
          ]);
          await Q.app.testHooks.bootWith(root);
          await until(function () { return Q.app.testHooks.state() === 'READY'; });
          await Q.scanner.drain();
          QT.eq(Q.state.get('a.mp3').status, 'ok', 'mp3 应为 ok');
          QT.eq(Q.state.get('b.flac').status, 'unsupported', 'flac 应为 unsupported');
        } finally {
          Q.compat.canPlayMime = origCanPlay;
        }
      });

      // ===== 12. 懒解析队列 drain =====
      QT.test('12. 懒解析队列：drain 后所有歌曲 tagStatus != pending', async function () {
        await Q.app.testHooks.reset();
        var root = QTF.dir('队列库', [
          QTF.fileHandle('1.mp3', QTF.file('1.mp3', 'x')),
          QTF.fileHandle('2.mp3', QTF.file('2.mp3', 'x')),
          QTF.fileHandle('3.mp3', QTF.file('3.mp3', 'x')),
          QTF.fileHandle('4.mp3', QTF.file('4.mp3', 'x'))
        ]);
        await Q.app.testHooks.bootWith(root);
        await until(function () { return Q.app.testHooks.state() === 'READY'; });
        await Q.scanner.drain();
        var all = Q.state.list();
        all.forEach(function (s) {
          QT.ok(s.tagStatus !== 'pending', s.id + ' tagStatus 应非 pending，实际 ' + s.tagStatus);
        });
        QT.eq(Q.scanner._queue.active, 0, '队列应已排空');
        QT.eq(Q.scanner._queue.pending.length, 0, 'pending 应为 0');
      });

      QT.run();
    });
  });
})();
