/* metadata.js —— 自写音频标签/封面解析（零第三方依赖）
 * 支持：mp3(ID3v2.2/2.3/2.4 + ID3v1)、m4a/mp4(ilst atom)、
 *      flac(VORBIS_COMMENT + PICTURE)、ogg(Vorbis 注释 + base64 封面)、
 *      wav(LIST/INFO + id3 chunk)。
 * 任何解析失败都回退为空标签，绝不抛出阻断播放。 */
(function () {
  'use strict';

  var decUtf8 = new TextDecoder('utf-8');
  var decLatin = new TextDecoder('iso-8859-1');
  var decGbk = null;
  try { decGbk = new TextDecoder('gbk'); } catch (e) { decGbk = decLatin; }

  function u32be(u8, p) {
    return ((u8[p] << 24) >>> 0) + (u8[p + 1] << 16) + (u8[p + 2] << 8) + u8[p + 3];
  }
  function u32le(u8, p) {
    return u8[p] + (u8[p + 1] << 8) + (u8[p + 2] << 16) + ((u8[p + 3] << 24) >>> 0);
  }
  function u24be(u8, p) { return (u8[p] << 16) + (u8[p + 1] << 8) + u8[p + 2]; }
  function syncsafe(u8, p) {
    return (u8[p] << 21) + (u8[p + 1] << 14) + (u8[p + 2] << 7) + u8[p + 3];
  }
  function ascii(u8, p, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]);
    return s;
  }
  function cutNull(u8) {
    var end = u8.length;
    for (var i = 0; i < u8.length; i++) if (u8[i] === 0) { end = i; break; }
    return u8.subarray(0, end);
  }

  // ID3 文本帧解码。enc: 0 latin1 / 1 utf16(BOM) / 2 utf16be / 3 utf8
  function decodeID3Text(enc, bytes) {
    if (!bytes || !bytes.length) return '';
    try {
      if (enc === 3) return decUtf8.decode(bytes).replace(/\0+$/, '').trim();
      if (enc === 1 || enc === 2) {
        var le = enc !== 2;
        if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) { le = true; bytes = bytes.subarray(2); }
        else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) { le = false; bytes = bytes.subarray(2); }
        var out = '';
        var end = bytes.length - (bytes.length % 2);
        for (var i = 0; i + 1 < end; i += 2) {
          var code = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]);
          if (code === 0) break;
          out += String.fromCharCode(code);
        }
        return out.replace(/\0+$/, '').trim();
      }
      return decLatin.decode(bytes).replace(/\0+$/, '').trim();
    } catch (e) { return ''; }
  }

  // ---------- ID3v2 ----------
  function parseID3v2(u8, start) {
    var out = { title: '', artist: '', album: '', picture: null };
    if (start + 10 > u8.length || ascii(u8, start, 3) !== 'ID3') return null;
    var major = u8[start + 3];
    var flags = u8[start + 5];
    var size = syncsafe(u8, start + 6);
    var p = start + 10;
    var end = Math.min(start + 10 + size, u8.length);

    // 扩展头跳过
    if (flags & 0x40) {
      if (major === 4) { p += syncsafe(u8, p); }
      else { var es = u32be(u8, p); p += (es >= 6 ? es : 6); }
    }

    if (major === 2) {
      // 2.2：三字符帧 ID，3 字节大小
      while (p + 6 <= end) {
        var id3 = ascii(u8, p, 3);
        if (!/^[A-Z0-9]{3}$/.test(id3)) break;
        var fsize = (u8[p + 3] << 16) + (u8[p + 4] << 8) + u8[p + 5];
        var body = u8.subarray(p + 6, p + 6 + fsize);
        if (id3 === 'TT2') out.title = decodeID3Text(body[0], body.subarray(1));
        else if (id3 === 'TP1') out.artist = decodeID3Text(body[0], body.subarray(1));
        else if (id3 === 'TAL') out.album = decodeID3Text(body[0], body.subarray(1));
        else if (id3 === 'PIC') { var pic = parsePIC22(body); if (pic) out.picture = pic; }
        p += 6 + fsize;
      }
      return out;
    }

    while (p + 10 <= end) {
      var id = ascii(u8, p, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      var fSize = major === 4 ? syncsafe(u8, p + 4) : u32be(u8, p + 4);
      if (fSize <= 0 || p + 10 + fSize > end + 16) break;
      var fb = u8.subarray(p + 10, p + 10 + fSize);
      if (id === 'TIT2' && !out.title) out.title = decodeID3Text(fb[0], fb.subarray(1));
      else if (id === 'TPE1' && !out.artist) out.artist = decodeID3Text(fb[0], fb.subarray(1));
      else if (id === 'TALB' && !out.album) out.album = decodeID3Text(fb[0], fb.subarray(1));
      else if (id === 'APIC' && !out.picture) { var ap = parseAPIC(fb); if (ap) out.picture = ap; }
      p += 10 + fSize;
    }
    return out;
  }

  function readLatin0(u8, p) {
    var s = '';
    while (p < u8.length && u8[p] !== 0) { s += String.fromCharCode(u8[p]); p++; }
    return { text: s, next: p + 1 };
  }
  function parseAPIC(body) {
    var enc = body[0];
    var m = readLatin0(body, 1);
    var mime = m.text || 'image/jpeg';
    var p = m.next;
    p += 1; // picture type
    // 描述：按编码找终止
    if (enc === 1 || enc === 2) {
      while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
      p += 2;
    } else {
      while (p < body.length && body[p] !== 0) p++;
      p += 1;
    }
    if (p >= body.length) return null;
    return { mime: mime, bytes: body.subarray(p) };
  }
  function parsePIC22(body) {
    var enc = body[0];
    var fmt = ascii(body, 1, 3).toLowerCase(); // PNG/JPG
    var mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    var p = 4 + 1; // format + picture type
    if (enc === 1 || enc === 2) {
      while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
      p += 2;
    } else {
      while (p < body.length && body[p] !== 0) p++;
      p += 1;
    }
    if (p >= body.length) return null;
    return { mime: mime, bytes: body.subarray(p) };
  }

  // ID3v1（尾部 128 字节，中文常见 GBK）
  function parseID3v1(u8) {
    if (u8.length < 128 || ascii(u8, u8.length - 128, 3) !== 'TAG') return null;
    var b = u8.length - 128;
    function field(off, len) {
      var bytes = cutNull(u8.subarray(b + off, b + off + len));
      var t1 = decUtf8.decode(bytes).replace(/\s+$/, '');
      if (/[\u0080-\u00ff]/.test(t1)) { var t2 = decGbk.decode(bytes).replace(/\s+$/, ''); if (t2) return t2; }
      return t1.trim();
    }
    return { title: field(3, 30), artist: field(33, 30), album: field(63, 30), picture: null };
  }

  function parseMp3(u8) {
    var v2 = (u8.length >= 10 && ascii(u8, 0, 3) === 'ID3') ? parseID3v2(u8, 0) : null;
    if (v2 && (v2.title || v2.artist || v2.album || v2.picture)) return v2;
    var v1 = parseID3v1(u8);
    if (v1 && (v1.title || v1.artist || v1.album)) return v1;
    return v2 || { title: '', artist: '', album: '', picture: null };
  }

  // ---------- MP4 / M4A ----------
  function forEachBox(u8, start, end, cb) {
    var p = start;
    while (p + 8 <= end) {
      var size = u32be(u8, p);
      var type = ascii(u8, p + 4, 4);
      var header = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        var hi = u32be(u8, p + 8), lo = u32be(u8, p + 12);
        size = hi * 4294967296 + lo;
        header = 16;
      } else if (size === 0) {
        size = end - p;
      }
      if (size < header || p + size > end) break;
      cb(type, p + header, p + size, u8);
      p += size;
    }
  }

  function parseDataAtom(u8, s, e) {
    // data box: size/type(8) + flags-version(4) + dataType(4) + locale(4) + payload
    var result = null;
    forEachBox(u8, s, e, function (type, bs, be) {
      if (result || type !== 'data' || be - bs < 16) return;
      var dataType = u32be(u8, bs + 4); // bs+4 跳过 4 字节 version/flags
      var payload = u8.subarray(bs + 16, be);
      result = { type: dataType, bytes: payload };
    });
    return result;
  }

  function parseMp4(u8) {
    var out = { title: '', artist: '', album: '', picture: null };
    var ilstStart = -1, ilstEnd = -1;
    forEachBox(u8, 0, u8.length, function (t1, s1, e1) {
      if (t1 !== 'moov') return;
      forEachBox(u8, s1, e1, function (t2, s2, e2) {
        if (t2 !== 'udta') return;
        forEachBox(u8, s2, e2, function (t3, s3, e3) {
          if (t3 !== 'meta') return;
          // meta 容器前 4 字节 version/flags
          forEachBox(u8, s3 + 4, e3, function (t4, s4, e4) {
            if (t4 === 'ilst') { ilstStart = s4; ilstEnd = e4; }
          });
        });
      });
    });
    if (ilstStart < 0) return out;

    forEachBox(u8, ilstStart, ilstEnd, function (type, s, e) {
      var d = parseDataAtom(u8, s, e);
      if (!d) return;
      if (type === '©nam' && !out.title) out.title = decUtf8.decode(d.bytes).replace(/\0+$/, '').trim();
      else if (type === '©ART' && !out.artist) out.artist = decUtf8.decode(d.bytes).replace(/\0+$/, '').trim();
      else if (type === '©alb' && !out.album) out.album = decUtf8.decode(d.bytes).replace(/\0+$/, '').trim();
      else if (type === 'covr' && !out.picture) {
        var mime = (d.type === 14 || d.type === 216) ? 'image/png' : 'image/jpeg';
        out.picture = { mime: mime, bytes: d.bytes };
      }
    });
    return out;
  }

  // ---------- FLAC / Vorbis Comment ----------
  function parseFlacPictureBody(u8, p) {
    // 起始即 media type 长度
    if (p + 4 > u8.length) return null;
    var mimeLen = u32be(u8, p); p += 4;
    var mime = ascii(u8, p, mimeLen); p += mimeLen;
    var descLen = u32be(u8, p); p += 4 + descLen;
    p += 16; // width/height/depth/colors
    var dataLen = u32be(u8, p); p += 4;
    if (p + dataLen > u8.length) return null;
    return { mime: mime || 'image/jpeg', bytes: u8.subarray(p, p + dataLen) };
  }

  function parseVorbisCommentPacket(u8, start, end) {
    var out = { title: '', artist: '', album: '', picture: null };
    var p = start;
    var vendorLen = u32le(u8, p); p += 4 + vendorLen;
    var count = u32le(u8, p); p += 4;
    for (var i = 0; i < count && p + 4 <= end; i++) {
      var len = u32le(u8, p); p += 4;
      var raw = decUtf8.decode(u8.subarray(p, p + len));
      p += len;
      var eq = raw.indexOf('=');
      if (eq < 0) continue;
      var key = raw.slice(0, eq).toUpperCase();
      var val = raw.slice(eq + 1);
      if (key === 'TITLE' && !out.title) out.title = val;
      else if ((key === 'ARTIST' || key === 'ALBUMARTIST') && !out.artist) out.artist = val;
      else if (key === 'ALBUM' && !out.album) out.album = val;
      else if (key === 'METADATA_BLOCK_PICTURE' && !out.picture) {
        try {
          var bin = base64ToBytes(val);
          var pic = parseFlacPictureBody(bin, 0);
          if (pic) out.picture = pic;
        } catch (e) {}
      }
    }
    return out;
  }

  function parseFlac(u8) {
    var out = { title: '', artist: '', album: '', picture: null };
    if (ascii(u8, 0, 4) !== 'fLaC') return out;
    var p = 4;
    while (p + 4 <= u8.length) {
      var hdr = u8[p];
      var last = hdr & 0x80, type = hdr & 0x7f;
      var len = u24be(u8, p + 1);
      var bs = p + 4, be = bs + len;
      if (type === 4 && bs + 4 <= u8.length) {
        var c = parseVorbisCommentPacket(u8, bs, be);
        out.title = out.title || c.title; out.artist = out.artist || c.artist;
        out.album = out.album || c.album;
        if (c.picture) out.picture = c.picture;
      } else if (type === 6 && !out.picture) {
        var pic = parseFlacPictureBody(u8, bs);
        if (pic) out.picture = pic;
      }
      p = be;
      if (last) break;
    }
    return out;
  }

  // ---------- OGG ----------
  function collectOggPackets(u8) {
    // 返回前两个 Vorbis 逻辑包（id + comment）的 Uint8Array
    var packets = [];
    var cur = new Uint8Array(0);
    var p = 0;
    while (p + 27 <= u8.length && packets.length < 2) {
      if (ascii(u8, p, 4) !== 'OggS') break;
      var nSeg = u8[p + 26];
      var tableStart = p + 27;
      var bodyStart = tableStart + nSeg;
      var seg = bodyStart;
      for (var i = 0; i < nSeg; i++) {
        var l = u8[tableStart + i];
        var piece = u8.subarray(seg, seg + l);
        cur = concatU8(cur, piece);
        seg += l;
        if (l < 255) {
          packets.push(cur);
          cur = new Uint8Array(0);
          if (packets.length >= 2) break;
        }
      }
      p = seg;
    }
    return packets;
  }
  function concatU8(a, b) {
    var n = new Uint8Array(a.length + b.length);
    n.set(a, 0); n.set(b, a.length);
    return n;
  }

  function parseOgg(u8) {
    var empty = { title: '', artist: '', album: '', picture: null };
    try {
      var packets = collectOggPackets(u8);
      if (packets.length < 2) return empty;
      // 兼容 Opus 注释包（'OpusTags'）
      var c2 = packets[1];
      var isVorbis = c2.length > 7 && c2[0] === 3 && ascii(c2, 1, 6) === 'vorbis';
      var start = isVorbis ? 7 : (c2.length > 8 && ascii(c2, 0, 8) === 'OpusTags' ? 8 : 0);
      if (!start) return empty;
      return parseVorbisCommentPacket(c2, start, c2.length);
    } catch (e) { return empty; }
  }

  // ---------- WAV ----------
  function parseWav(u8) {
    var out = { title: '', artist: '', album: '', picture: null };
    if (ascii(u8, 0, 4) !== 'RIFF' || ascii(u8, 8, 4) !== 'WAVE') return out;
    var p = 12;
    while (p + 8 <= u8.length) {
      var id = ascii(u8, p, 4);
      var size = u32le(u8, p + 4);
      var bs = p + 8, be = Math.min(bs + size, u8.length);
      if (id === 'id3 ' || id === 'ID3 ') {
        var t = parseID3v2(u8, bs);
        if (t) { out.title = out.title || t.title; out.artist = out.artist || t.artist; out.album = out.album || t.album; if (t.picture) out.picture = t.picture; }
      } else if (id === 'LIST') {
        if (ascii(u8, bs, 4) === 'INFO') {
          var q = bs + 4;
          while (q + 8 <= be) {
            var sid = ascii(u8, q, 4), ss = u32le(u8, q + 4);
            var val = decUtf8.decode(u8.subarray(q + 8, q + 8 + ss)).replace(/\0+$/, '').trim();
            if (sid === 'INAM' && !out.title) out.title = val;
            else if (sid === 'IART' && !out.artist) out.artist = val;
            else if (sid === 'IPRD' && !out.album) out.album = val;
            q += 8 + ss + (ss % 2);
          }
        }
      } else if (id === 'data') {
        break;
      }
      p = be + (size % 2);
    }
    return out;
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // ---------- 对外入口 ----------
  var PARSERS = {
    mp3: parseMp3,
    m4a: parseMp4, aac: parseMp4,
    flac: parseFlac,
    ogg: parseOgg, oga: parseOgg,
    wav: parseWav
  };

  async function parseFile(file, ext) {
    var empty = { title: '', artist: '', album: '', picture: null };
    var fn = PARSERS[ext] || PARSERS[(QM.fs.nameExt(file.name).ext)];
    if (!fn) return empty;
    var buf;
    try { buf = new Uint8Array(await file.arrayBuffer()); } catch (e) { return empty; }
    // 大文件截断到前 512KB（封面/标签都在头部；ID3v1 尾部单独补读由调用方处理）
    var head = buf.length > 512 * 1024 ? buf.subarray(0, 512 * 1024) : buf;
    try {
      var r = fn(head);
      // ID3v1 需要文件尾部
      if (ext === 'mp3' && !(r.title || r.artist || r.album) && buf.length > 128) {
        var v1 = parseID3v1(buf);
        if (v1) r = { title: v1.title, artist: v1.artist, album: v1.album, picture: r.picture };
      }
      return r || empty;
    } catch (e) {
      return empty;
    }
  }

  // 封面下采样为最长边 128 的 JPEG
  async function shrinkCover(pic) {
    var blob = new Blob([pic.bytes], { type: pic.mime || 'image/jpeg' });
    var bmp;
    try { bmp = await createImageBitmap(blob); }
    catch (e) {
      // 个别老格式回退 <img>
      bmp = await new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
      });
    }
    var max = 128;
    var w = bmp.width, h = bmp.height;
    var s = Math.min(1, max / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, cw, ch);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return await new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.82);
    });
  }

  // 显示名：手动覆盖 -> 标签 -> 去扩展名文件名（全 App 唯一口径）
  function displayName(song) {
    if (song.title) return song.title;
    if (song.raw && song.raw.title) return song.raw.title;
    return QM.fs.nameExt(song.fileName).base;
  }
  function displaySub(song) {
    var artist = song.artist || (song.raw && song.raw.artist) || '';
    var album = song.album || (song.raw && song.raw.album) || '';
    return [artist, album].filter(Boolean).join(' · ');
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // 仅供单元测试
  QM.metaTest = {
    parseID3v2: parseID3v2, parseID3v1: parseID3v1, parseMp4: parseMp4,
    parseFlac: parseFlac, parseOgg: parseOgg, parseWav: parseWav,
    parseVorbisCommentPacket: parseVorbisCommentPacket
  };

  QM.metadata = {
    parseFile: parseFile,
    shrinkCover: shrinkCover,
    displayName: displayName,
    displaySub: displaySub,
    fmtTime: fmtTime
  };
})();
