/* 水火箭發射 — 寫實風繪圖（各高度層背景、地球、月球、星空、水火箭、打氣筒）。
 * 背景層一律先畫進快取畫布（makeCanvas），飛行時只貼圖；動態的小東西（客機、流星…）由 rocket.js 即時畫。
 * 只用 iOS 12 Safari 支援的 Canvas 功能（不用 ctx.filter；柔邊靠放射漸層與 shadowBlur）。
 */
(function (root) {
  'use strict';
  var ART_W = 960;           // 每一層背景圖的寬度（主畫面再窄也從中間裁）
  var ZONE_PX = 540;         // 每一層的高度
  var PAD_TOP = 100, PAD_BOT = 200;   // 背景圖上下多畫一點，讓相鄰兩層的東西可以重疊
  var ZONE_H = ZONE_PX + PAD_TOP + PAD_BOT;
  var BASE_Y = PAD_TOP + ZONE_PX;     // 圖中「這一層底部」的 y

  function clamp(x, lo, hi) { if (lo === undefined) { lo = 0; hi = 1; } return Math.max(lo, Math.min(hi, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t) | 0, lerp(a[1], b[1], t) | 0, lerp(a[2], b[2], t) | 0]; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')'; }
  function rng32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // 2D value noise + fBm（只用在小塊區域：地球紋理、岩石稜線）
  function makeNoise(seed) {
    var r = rng32(seed), p = [], i;
    for (i = 0; i < 256; i++) p.push(r());
    function h(x, y) { return p[((x * 73856093) ^ (y * 19349663)) & 255]; }
    function sm(t) { return t * t * (3 - 2 * t); }
    function n2(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      return lerp(lerp(h(xi, yi), h(xi + 1, yi), xf), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), xf), yf);
    }
    return function fbm(x, y, oct) {
      var s = 0, a = 0.5, f = 1, n = 0;
      for (var o = 0; o < (oct || 4); o++) { s += a * n2(x * f, y * f); n += a; a *= 0.5; f *= 2; }
      return s / n;
    };
  }
  function glow(ctx, x, y, r, c, a) {   // 柔和光暈
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function shadedBlob(ctx, x, y, r, light, dark, alpha) {   // 左上受光的球體（雲團、樹冠）
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, rgba(light, alpha)); g.addColorStop(0.7, rgba(mix(light, dark, 0.55), alpha)); g.addColorStop(1, rgba(dark, alpha));
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  }
  function softBlob(ctx, x, y, r, light, dark, alpha) {   // 柔邊受光團（雲）：邊緣漸漸透明
    var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r);
    g.addColorStop(0, rgba(light, alpha)); g.addColorStop(0.5, rgba(mix(light, dark, 0.35), alpha * 0.95));
    g.addColorStop(0.8, rgba(dark, alpha * 0.6)); g.addColorStop(1, rgba(dark, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function ridge(rand, x0, x1, base, peaks, rough, n) {   // 山脊折線：主峰 + 細碎起伏
    var pts = []; n = n || 120;
    for (var i = 0; i <= n; i++) {
      var x = lerp(x0, x1, i / n), y = base;
      for (var k = 0; k < peaks.length; k++) {
        var pk = peaks[k], d = Math.abs(x - pk[0]) / pk[2];
        y = Math.min(y, base - pk[1] * Math.max(0, 1 - Math.pow(d, 1.25)));
      }
      pts.push([x, y + (rand() - 0.5) * rough]);
    }
    return pts;
  }
  function fillRidge(ctx, pts, bottom, fill) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], bottom);
    for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[pts.length - 1][0], bottom); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function cumulus(ctx, rand, cx, cy, w, h, light, shadow, alpha) {   // 立體積雲：底部平、頂部隆起，柔邊團塊層層疊
    var sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);   // 雲底的灰色陰影
    sh.addColorStop(0, rgba(shadow, alpha * 0.55)); sh.addColorStop(1, rgba(shadow, 0));
    ctx.save(); ctx.translate(cx, cy + h * 0.05); ctx.scale(w * 0.55, h * 0.35); ctx.fillStyle = sh; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
    var n = Math.round(w / 7);
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < n; i++) {
        var t = rand(), x = cx + (t - 0.5) * w * (1 - pass * 0.15), top = Math.sin(t * Math.PI);
        var r = (0.24 + rand() * 0.26) * h * (0.6 + top * 0.6) * (1 - pass * 0.15);
        var y = cy - top * h * (0.25 + pass * 0.2) - rand() * h * 0.2;
        var lt = pass === 2 ? light : mix(light, shadow, 0.45 - pass * 0.2);
        softBlob(ctx, x, y, r, lt, mix(lt, shadow, 0.35), alpha);
      }
    }
  }

  // ---------- 天空：依高度連續變化（大氣散射：地平線亮、頂部深） ----------
  var SKY_TOP = [[0, [70, 140, 220]], [2, [62, 128, 214]], [4, [44, 100, 196]], [5, [28, 68, 160]], [6, [14, 34, 100]],
                 [7, [6, 12, 46]], [8, [2, 4, 18]], [11, [1, 2, 8]]];
  var SKY_HOR = [[0, [200, 225, 245]], [2, [190, 218, 242]], [4, [150, 190, 235]], [5, [110, 160, 225]], [6, [70, 120, 200]],
                 [7, [30, 60, 130]], [8, [8, 16, 50]], [11, [2, 3, 12]]];
  function stopAt(tab, z) {
    for (var i = 1; i < tab.length; i++) if (z <= tab[i][0]) return mix(tab[i - 1][1], tab[i][1], clamp((z - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0])));
    return tab[tab.length - 1][1];
  }
  function drawSky(ctx, w, h, cam) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(stopAt(SKY_TOP, cam + 0.6)));
    g.addColorStop(0.55, rgba(mix(stopAt(SKY_TOP, cam), stopAt(SKY_HOR, cam), 0.5)));
    g.addColorStop(1, rgba(stopAt(SKY_HOR, cam - 0.4)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var sunA = clamp(1 - cam / 7);   // 太陽光暈（越高越弱，太空中太陽在畫面外）
    if (sunA > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, w * 0.12, h * 0.12, 260, [255, 240, 210], 0.35 * sunA);
      glow(ctx, w * 0.12, h * 0.12, 60, [255, 250, 235], 0.6 * sunA);
      ctx.restore();
    }
  }

  // ---------- 星空與銀河（太空背景，畫一次） ----------
  function paintSpace(make) {
    var c = make(ART_W, 540), x = c.getContext('2d'), r = rng32(42), i;
    x.save(); x.translate(ART_W * 0.5, 270); x.rotate(-0.45);   // 銀河帶
    for (i = 0; i < 9; i++) glow(x, (r() - 0.5) * 900, (r() - 0.5) * 60, 90 + r() * 80, [190, 180, 230], 0.06);
    for (i = 0; i < 1400; i++) {
      var gx = (r() - 0.5) * 1100, gy = (r() + r() + r() - 1.5) * 60;
      x.fillStyle = 'rgba(230,225,255,' + (0.15 + r() * 0.35).toFixed(2) + ')'; x.fillRect(gx, gy, 1, 1);
    }
    x.restore();
    for (i = 0; i < 420; i++) {   // 星星：大小、顏色不同
      var s = Math.pow(r(), 3) * 2.2 + 0.4, col = r() < 0.15 ? [255, 210, 180] : r() < 0.3 ? [190, 210, 255] : [255, 255, 255];
      var sx = r() * ART_W, sy = r() * 540;
      x.fillStyle = rgba(col, 0.5 + r() * 0.5); x.beginPath(); x.arc(sx, sy, s * 0.6, 0, Math.PI * 2); x.fill();
      if (s > 1.8) glow(x, sx, sy, s * 4, col, 0.25);
    }
    return c;
  }

  // ---------- 地球（紋理畫一次；依高度縮放：低空是地平線弧，高空是整顆球） ----------
  function paintEarthTexture(make) {
    var S = 512, c = make(S, S), x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data;
    var land = makeNoise(11), cloud = makeNoise(29), R = S / 2;
    for (var py = 0; py < S; py++) {
      for (var px = 0; px < S; px++) {
        var dx = (px - R) / R, dy = (py - R) / R, rr = dx * dx + dy * dy, o = (py * S + px) * 4;
        if (rr > 1) { d[o + 3] = 0; continue; }
        var zz = Math.sqrt(1 - rr), u = dx / (zz + 0.6) * 3 + 5, v = dy / (zz + 0.6) * 3 + 5;   // 簡單的球面扭曲
        var hgt = land(u, v, 5), cl = cloud(u * 1.6 + 3, v * 2.2, 4);
        var col;
        if (hgt > 0.56) {   // 陸地：低地綠、高地褐、極地白
          col = hgt > 0.68 ? [150, 125, 90] : [70 + hgt * 60 | 0, 120 + hgt * 40 | 0, 60];
        } else col = mix([10, 40, 110], [30, 90, 170], hgt / 0.56);   // 海洋
        var cw = clamp((cl - 0.52) * 3.5);
        col = mix(col, [250, 252, 255], cw * 0.9);
        var shade = 0.35 + 0.65 * clamp(zz * 0.8 + (-dx * 0.35 - dy * 0.35));   // 光從左上來，右下是夜晚
        d[o] = col[0] * shade; d[o + 1] = col[1] * shade; d[o + 2] = col[2] * shade; d[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    var band = make(ART_W, 300), bx = band.getContext('2d'), r = rng32(5);   // 低軌道看到的地平線雲帶（也先畫好）
    for (var i = 0; i < 60; i++) {
      var gx = r() * ART_W, gy = 8 + r() * 240, gr = 30 + r() * 60;
      var cg = bx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      cg.addColorStop(0, 'rgba(255,255,255,0.5)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
      bx.fillStyle = cg; bx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    c.band = band;
    return c;
  }
  function drawEarth(ctx, w, h, cam, tex) {
    var p = clamp((cam - 5.3) / 4.9);
    if (p <= 0) return;
    var R = 9000 * Math.pow(0.026, p), cap = lerp(30, 300, p), cx = w / 2, cy = h - cap + R;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';   // 大氣光環
    var halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.06 + 20);
    halo.addColorStop(0, 'rgba(120,180,255,0.55)'); halo.addColorStop(0.4, 'rgba(80,140,255,0.25)'); halo.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.06 + 20, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    var texA = tex ? clamp((1700 - R) / 600) : 0;
    if (texA < 1) {   // 很低的時候只看得到地平線：用漸層加上一條雲帶
      var g = ctx.createLinearGradient(0, cy - R, 0, cy - R + cap);
      g.addColorStop(0, 'rgb(150,190,235)'); g.addColorStop(0.15, 'rgb(60,110,190)'); g.addColorStop(1, 'rgb(20,55,120)');
      ctx.fillStyle = g; ctx.fillRect(0, cy - R, w, cap + 2);
      if (tex && tex.band) ctx.drawImage(tex.band, (w - ART_W) / 2, cy - R, ART_W, cap);
    }
    if (texA > 0) { ctx.globalAlpha = texA; ctx.drawImage(tex, cx - R, cy - R, R * 2, R * 2); ctx.globalAlpha = 1; }
    var rim = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R);   // 邊緣變亮的大氣
    rim.addColorStop(0, 'rgba(140,190,255,0)'); rim.addColorStop(1, 'rgba(160,210,255,0.45)');
    ctx.fillStyle = rim; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  }
  function paintMoon(make) {
    var S = 160, c = make(S, S), x = c.getContext('2d'), R = S / 2 - 4, r = rng32(77);
    var g = x.createRadialGradient(S / 2 - R * 0.35, S / 2 - R * 0.35, R * 0.1, S / 2, S / 2, R);
    g.addColorStop(0, 'rgb(245,243,235)'); g.addColorStop(0.75, 'rgb(190,186,175)'); g.addColorStop(1, 'rgb(120,116,110)');
    x.beginPath(); x.arc(S / 2, S / 2, R, 0, Math.PI * 2); x.fillStyle = g; x.fill();
    x.save(); x.clip();
    for (var i = 0; i < 5; i++) {   // 月海
      var mx = S / 2 + (r() - 0.5) * R, my = S / 2 + (r() - 0.5) * R;
      var mg = x.createRadialGradient(mx, my, 0, mx, my, R * (0.2 + r() * 0.25));
      mg.addColorStop(0, 'rgba(110,108,105,0.45)'); mg.addColorStop(1, 'rgba(110,108,105,0)');
      x.fillStyle = mg; x.fillRect(0, 0, S, S);
    }
    for (i = 0; i < 26; i++) {   // 坑洞：亮邊＋暗底
      var cx = S / 2 + (r() - 0.5) * R * 1.8, cy = S / 2 + (r() - 0.5) * R * 1.8, cr = 2 + Math.pow(r(), 2) * 9;
      x.beginPath(); x.arc(cx + 0.8, cy + 0.8, cr, 0, Math.PI * 2); x.fillStyle = 'rgba(90,88,84,0.45)'; x.fill();
      x.beginPath(); x.arc(cx - 0.6, cy - 0.6, cr * 0.8, 0, Math.PI * 2); x.fillStyle = 'rgba(235,232,225,0.25)'; x.fill();
    }
    var sh = x.createLinearGradient(S * 0.2, 0, S, S * 0.8);   // 背光面
    sh.addColorStop(0.55, 'rgba(0,0,10,0)'); sh.addColorStop(1, 'rgba(0,0,10,0.7)');
    x.fillStyle = sh; x.fillRect(0, 0, S, S);
    x.restore();
    return c;
  }

  // ---------- 各高度層背景（畫進 ART_W × ZONE_H 的畫布；BASE_Y 是這一層底部） ----------
  function paintZone(make, k) {
    var c = make(ART_W, ZONE_H), x = c.getContext('2d'), r = rng32(1000 + k * 17), by = BASE_Y, W = ART_W, i, j;
    if (k === 0) {   // 地面：遠山、樹林、草地
      var far = ridge(r, -20, W + 20, by - 40, [[120, 70, 260], [420, 95, 320], [760, 80, 300]], 6);
      fillRidge(x, far, by, 'rgba(120,150,175,0.75)');
      var mid = ridge(r, -20, W + 20, by - 10, [[230, 50, 220], [650, 60, 260]], 8);
      fillRidge(x, mid, by, 'rgba(85,120,110,0.85)');
      for (i = 0; i < 700; i++) {   // 遠方樹林：很多小葉團
        var tx = r() * W, ty = by - 4 - Math.pow(r(), 1.5) * 26;
        shadedBlob(x, tx, ty, 3 + r() * 5, mix([110, 150, 95], [70, 120, 70], r()), [35, 70, 50], 0.9);
      }
      var gg = x.createLinearGradient(0, by - 4, 0, ZONE_H);   // 草地
      gg.addColorStop(0, 'rgb(118,170,82)'); gg.addColorStop(0.4, 'rgb(92,150,64)'); gg.addColorStop(1, 'rgb(60,110,45)');
      x.fillStyle = gg; x.fillRect(0, by - 4, W, ZONE_H - by + 4);
      for (i = 0; i < 1600; i++) {   // 草葉
        var gx = r() * W, gy = by + Math.pow(r(), 1.5) * (ZONE_H - by), l = 2 + (gy - by) / 30 * (1 + r());
        x.strokeStyle = r() < 0.5 ? 'rgba(150,200,100,0.5)' : 'rgba(50,100,40,0.5)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + (r() - 0.5) * 3, gy - l); x.stroke();
      }
      var trees = [[60, 150], [150, 120], [610, 135], [700, 175], [820, 145], [905, 125]];
      for (i = 0; i < trees.length; i++) {   // 近處的大樹
        var bx = trees[i][0], th = trees[i][1];
        var tg = x.createLinearGradient(bx - 5, 0, bx + 5, 0);
        tg.addColorStop(0, 'rgb(105,80,58)'); tg.addColorStop(1, 'rgb(55,40,30)');
        x.fillStyle = tg; x.fillRect(bx - 4, by - th * 0.5, 8, th * 0.5 + 4);
        x.strokeStyle = 'rgb(70,52,38)'; x.lineWidth = 3;
        x.beginPath(); x.moveTo(bx, by - th * 0.4); x.lineTo(bx - th * 0.18, by - th * 0.62); x.moveTo(bx, by - th * 0.45); x.lineTo(bx + th * 0.16, by - th * 0.66); x.stroke();
        for (j = 0; j < 260; j++) {   // 樹冠：由內而外，外圍受光較亮
          var a = r() * Math.PI * 2, d = Math.sqrt(r()), lx = Math.cos(a) * d, ly = Math.sin(a) * d;
          var lit = clamp(0.5 - lx * 0.35 - ly * 0.45 + d * 0.2 + (r() - 0.5) * 0.3);
          shadedBlob(x, bx + lx * th * 0.36, by - th * 0.66 + ly * th * 0.3, th * (0.03 + r() * 0.035),
            mix([40, 85, 45], [150, 195, 100], lit), mix([20, 50, 30], [60, 110, 55], lit), 1);
        }
      }
      var pad = x.createLinearGradient(0, by - 6, 0, by + 30);   // 水泥發射區
      pad.addColorStop(0, 'rgb(175,172,165)'); pad.addColorStop(1, 'rgb(120,118,112)');
      x.fillStyle = pad; x.beginPath(); x.ellipse(440, by + 8, 150, 22, 0, 0, Math.PI * 2); x.fill();
      return c;
    }
    if (k === 1) {   // 低空：零星積雲
      cumulus(x, r, 220, by - 330, 280, 80, [255, 255, 255], [175, 192, 215], 0.85);
      cumulus(x, r, 780, by - 420, 220, 64, [255, 255, 255], [175, 192, 215], 0.8);
      return c;
    }
    if (k === 2) {   // 城市天際線與台北 101
      var hills = ridge(r, -20, W + 20, by + 40, [[150, 140, 300], [520, 110, 260], [850, 160, 320]], 5);
      fillRidge(x, hills, by + 200, 'rgba(110,140,165,0.6)');
      for (var layer = 0; layer < 3; layer++) {   // 三層建築：越遠越淡
        var tone = mix([150, 170, 190], [70, 85, 105], layer / 2), ybase = by + 60 + layer * 50;
        for (i = 0; i < 40; i++) {
          var bw = 14 + r() * 26, bh = 30 + r() * (90 - layer * 20), bx2 = r() * W;
          var bg = x.createLinearGradient(bx2, 0, bx2 + bw, 0);
          bg.addColorStop(0, rgba(mix(tone, [255, 255, 255], 0.15))); bg.addColorStop(1, rgba(tone));
          x.fillStyle = bg; x.fillRect(bx2, ybase - bh, bw, bh + 200);
          if (layer === 2) for (j = 0; j < 8; j++) { x.fillStyle = 'rgba(255,240,200,0.25)'; x.fillRect(bx2 + 3 + r() * (bw - 6), ybase - bh + r() * bh, 2, 2); }
        }
      }
      var cx101 = 700, base = by + 60, segH = 30, glass = function (xx, yy, ww, hh) {
        var gl = x.createLinearGradient(xx - ww / 2, 0, xx + ww / 2, 0);
        gl.addColorStop(0, 'rgb(150,190,180)'); gl.addColorStop(0.35, 'rgb(95,140,135)'); gl.addColorStop(1, 'rgb(45,80,82)');
        return gl;
      };
      x.fillStyle = glass(cx101, 0, 70, 0); x.fillRect(cx101 - 34, base - 110, 68, 120);   // 基座
      for (i = 0; i < 8; i++) {   // 8 節「花開」造型
        var yb = base - 110 - i * segH;
        x.beginPath(); x.moveTo(cx101 - 26, yb); x.lineTo(cx101 + 26, yb); x.lineTo(cx101 + 33, yb - segH); x.lineTo(cx101 - 33, yb - segH); x.closePath();
        x.fillStyle = glass(cx101, yb, 66, segH); x.fill();
        x.strokeStyle = 'rgba(30,60,60,0.8)'; x.lineWidth = 1.2; x.stroke();
        for (j = 1; j < 4; j++) { x.strokeStyle = 'rgba(200,230,225,0.25)'; x.beginPath(); x.moveTo(cx101 - 26 - j * 2, yb - j * 7); x.lineTo(cx101 + 26 + j * 2, yb - j * 7); x.stroke(); }
      }
      var topY = base - 110 - 8 * segH;
      x.fillStyle = glass(cx101, 0, 30, 0); x.fillRect(cx101 - 14, topY - 34, 28, 34);
      x.fillStyle = 'rgb(70,100,100)'; x.fillRect(cx101 - 4, topY - 60, 8, 26); x.fillRect(cx101 - 1.5, topY - 110, 3, 50);
      var haze = x.createLinearGradient(0, by - 60, 0, by + 200);   // 城市霧霾
      haze.addColorStop(0, 'rgba(200,215,230,0)'); haze.addColorStop(1, 'rgba(200,215,230,0.5)');
      x.fillStyle = haze; x.fillRect(0, by - 60, W, 260);
      x.globalCompositeOperation = 'destination-in';   // 城市下半部隱入霧霾：從低空往上看只露出天際線
      var fade = x.createLinearGradient(0, by - 40, 0, by + 110);
      fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = fade; x.fillRect(0, 0, W, ZONE_H);
      x.globalCompositeOperation = 'source-over';
      return c;
    }
    if (k === 3) {   // 積雲層
      var spots = [[150, 90], [520, 60], [840, 130], [300, 300], [700, 360], [90, 470], [560, 520], [880, 560]];
      for (i = 0; i < spots.length; i++) cumulus(x, r, spots[i][0] + (r() - 0.5) * 60, by - spots[i][1] + 40, 200 + r() * 160, 70 + r() * 50, [255, 255, 255], [150, 170, 205], 0.95);
      return c;
    }
    if (k === 4) {   // 玉山與雲海
      var far4 = ridge(r, -20, W + 20, by + 40, [[100, 230, 260], [330, 200, 220], [860, 250, 300]], 6);
      fillRidge(x, far4, by + 120, 'rgba(150,172,205,0.8)');
      var main = ridge(r, -20, W + 20, by + 60, [[520, 400, 330], [250, 300, 250], [760, 330, 260]], 2.5, 490);
      for (i = 1; i < main.length - 1; i += 4) main[i][1] += (r() - 0.5) * 5;
      var mgr = x.createLinearGradient(0, by - 340, 0, by + 60);
      mgr.addColorStop(0, 'rgb(96,98,110)'); mgr.addColorStop(1, 'rgb(62,76,98)');
      fillRidge(x, main, by + 120, mgr);
      x.save();
      x.beginPath(); x.moveTo(main[0][0], by + 200); for (i = 0; i < main.length; i++) x.lineTo(main[i][0], main[i][1]); x.lineTo(W + 20, by + 120); x.closePath(); x.clip();
      var nz = makeNoise(4);
      for (i = 0; i < main.length - 1; i++) {   // 每一小段山坡依坡向受光：面向左上較亮
        var p0 = main[i], p1 = main[i + 1], a0 = main[Math.max(0, i - 6)], a1 = main[Math.min(main.length - 1, i + 6)];
        var slope = (a1[1] - a0[1]) / (a1[0] - a0[0]);
        var lit = clamp(0.5 - slope * 0.9 + (nz(i * 0.05, 1) - 0.5) * 0.5);
        var depth = 120 + nz(i * 0.04, 5) * 200, sg = x.createLinearGradient(0, p0[1], 0, p0[1] + depth);
        var col = lit > 0.5 ? [200, 185, 165] : [25, 30, 50];
        sg.addColorStop(0, rgba(col, Math.abs(lit - 0.5) * 0.9)); sg.addColorStop(1, rgba(col, 0));
        x.fillStyle = sg; x.fillRect(p0[0], Math.min(p0[1], p1[1]), p1[0] - p0[0] + 0.5, depth + 20);
        var snow = clamp((by - 150 - p0[1]) / 160);   // 高處殘雪：沿著稜線往下長短不一
        if (snow > 0) {
          var sl = (15 + nz(i * 0.12, 9) * 70) * snow, wg = x.createLinearGradient(0, p0[1], 0, p0[1] + sl);
          var sc = lit > 0.45 ? [250, 250, 255] : [190, 200, 225];
          wg.addColorStop(0, rgba(sc, 0.95)); wg.addColorStop(0.7, rgba(sc, 0.6)); wg.addColorStop(1, rgba(sc, 0));
          x.fillStyle = wg; x.fillRect(p0[0], Math.min(p0[1], p1[1]) - 1, p1[0] - p0[0] + 0.5, sl + 2);
        }
      }
      for (i = 0; i < 70; i++) {   // 從稜線往下的岩溝
        var q = main[2 + Math.floor(r() * (main.length - 4))], len4 = 40 + r() * 140;
        var gg4 = x.createLinearGradient(0, q[1], 0, q[1] + len4);
        gg4.addColorStop(0, 'rgba(30,32,48,0.45)'); gg4.addColorStop(1, 'rgba(30,32,48,0)');
        x.strokeStyle = gg4; x.lineWidth = 1 + r() * 2;
        x.beginPath(); x.moveTo(q[0], q[1] + 4); x.quadraticCurveTo(q[0] + (r() - 0.5) * 30, q[1] + len4 * 0.5, q[0] + (r() - 0.5) * 50, q[1] + len4); x.stroke();
      }
      var aer = x.createLinearGradient(0, by - 220, 0, by + 110);   // 山腳空氣感，最後融進雲海
      aer.addColorStop(0, 'rgba(170,190,220,0)'); aer.addColorStop(0.6, 'rgba(185,200,228,0.5)'); aer.addColorStop(1, 'rgba(225,233,248,1)');
      x.fillStyle = aer; x.fillRect(0, by - 220, W, 340);
      x.restore();
      for (i = 0; i < 10; i++) cumulus(x, r, (i + r() * 0.5) * W / 9, by + 90 + r() * 20, 240, 60, [255, 255, 255], [170, 185, 212], 0.97);   // 雲海
      var sea = x.createLinearGradient(0, by + 70, 0, by + 200);
      sea.addColorStop(0, 'rgba(232,238,250,0)'); sea.addColorStop(0.2, 'rgba(228,235,249,0.95)'); sea.addColorStop(0.55, 'rgba(225,233,248,0.85)'); sea.addColorStop(1, 'rgba(225,233,248,0)');
      x.fillStyle = sea; x.fillRect(0, by + 70, W, 130);
      return c;
    }
    if (k === 5) {   // 卷雲：細長的冰晶雲
      for (i = 0; i < 26; i++) {
        var cx5 = r() * W, cy5 = by - 40 - r() * 460, len = 120 + r() * 220;
        x.save(); x.translate(cx5, cy5); x.rotate(-0.15 + r() * 0.3);
        for (j = 0; j < 18; j++) {
          var t = j / 17, gx5 = (t - 0.5) * len, gy5 = Math.sin(t * Math.PI * 2) * 6;
          var cg = x.createRadialGradient(gx5, gy5, 0, gx5, gy5, 16 + r() * 14);
          cg.addColorStop(0, 'rgba(255,255,255,0.16)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = cg; x.fillRect(gx5 - 34, gy5 - 34, 68, 68);
        }
        x.restore();
      }
      return c;
    }
    if (k === 6) {   // 臭氧層：淡淡的紫色光帶
      var oz = x.createLinearGradient(0, by - 330, 0, by - 170);
      oz.addColorStop(0, 'rgba(150,120,255,0)'); oz.addColorStop(0.5, 'rgba(160,130,255,0.3)'); oz.addColorStop(1, 'rgba(150,120,255,0)');
      x.fillStyle = oz; x.fillRect(0, by - 330, W, 160);
      return c;
    }
    if (k === 7) {   // 夜光雲（中氣層的銀藍色雲）
      x.save(); x.globalCompositeOperation = 'lighter';
      for (i = 0; i < 40; i++) {
        var nx = r() * W, ny = by + 20 + r() * 120;
        x.save(); x.translate(nx, ny); x.scale(3.5, 0.6);
        var ng = x.createRadialGradient(0, 0, 0, 0, 0, 30 + r() * 30);
        ng.addColorStop(0, 'rgba(120,190,255,0.12)'); ng.addColorStop(1, 'rgba(120,190,255,0)');
        x.fillStyle = ng; x.fillRect(-70, -70, 140, 140); x.restore();
      }
      x.restore();
      return c;
    }
    if (k === 9) {   // 極光：綠色光幕＋垂直光束（之後以透明度微微閃動）
      x.save(); x.globalCompositeOperation = 'lighter';
      for (var band = 0; band < 3; band++) {
        var yb9 = by - 40 - band * 40, amp = 50 + band * 20, ph = r() * 6;
        for (i = 0; i < 260; i++) {
          var ax = i / 260 * W, ay = yb9 - 60 - amp * Math.sin(ax / 140 + ph) - 20 * Math.sin(ax / 37 + ph * 2);
          var hgt9 = 80 + r() * 120, ag = x.createLinearGradient(0, ay - hgt9, 0, ay);
          var colA = band === 2 ? [190, 90, 255] : [80, 255, 160];
          ag.addColorStop(0, rgba(colA, 0)); ag.addColorStop(0.75, rgba(colA, 0.05 + r() * 0.06)); ag.addColorStop(1, rgba([200, 255, 220], 0.12));
          x.fillStyle = ag; x.fillRect(ax, ay - hgt9, W / 260 + 1.5, hgt9);
        }
      }
      x.restore();
      return c;
    }
    return c;   // 第 8、10 層沒有固定背景（卡門線、月亮由 rocket.js 畫）
  }

  // ---------- 水火箭（寶特瓶） ----------
  function drawRocket(ctx, swell, water, chute, t) {
    var w = 14 + swell, h = 74, i;
    if (chute) {   // 降落傘：紅白相間的傘面
      ctx.strokeStyle = 'rgba(240,240,240,0.85)'; ctx.lineWidth = 0.8;
      for (i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(0, -h - 20); ctx.lineTo(i * 14, -h - 70); ctx.stroke(); }
      for (i = 0; i < 6; i++) {
        var a0 = Math.PI + i * Math.PI / 6, a1 = a0 + Math.PI / 6;
        ctx.beginPath(); ctx.moveTo(0, -h - 70); ctx.arc(0, -h - 70, 46, a0, a1); ctx.closePath();
        var cg = ctx.createLinearGradient(0, -h - 116, 0, -h - 70);
        cg.addColorStop(0, i % 2 ? 'rgb(255,255,255)' : 'rgb(235,60,50)'); cg.addColorStop(1, i % 2 ? 'rgb(200,200,210)' : 'rgb(160,30,30)');
        ctx.fillStyle = cg; ctx.fill();
      }
    }
    // 尾翼（後面那片較暗）
    var fin = function (side, dark) {
      ctx.beginPath(); ctx.moveTo(side * w * 0.6, -26); ctx.lineTo(side * (w + 14), 2); ctx.lineTo(side * (w + 12), 6); ctx.lineTo(side * w * 0.7, -4); ctx.closePath();
      var fg = ctx.createLinearGradient(0, -26, 0, 6);
      fg.addColorStop(0, dark ? 'rgb(150,30,30)' : 'rgb(240,80,70)'); fg.addColorStop(1, dark ? 'rgb(110,20,20)' : 'rgb(180,40,40)');
      ctx.fillStyle = fg; ctx.fill();
    };
    fin(-1, false); fin(1, true);
    // 瓶身：透明塑膠，左右較暗、中間反光
    ctx.beginPath();
    ctx.moveTo(-w, -6); ctx.lineTo(-w, -h + 18); ctx.quadraticCurveTo(-w, -h + 4, -w * 0.45, -h);
    ctx.lineTo(w * 0.45, -h); ctx.quadraticCurveTo(w, -h + 4, w, -h + 18); ctx.lineTo(w, -6);
    ctx.quadraticCurveTo(w, 0, w * 0.6, 0); ctx.lineTo(-w * 0.6, 0); ctx.quadraticCurveTo(-w, 0, -w, -6); ctx.closePath();
    var bg = ctx.createLinearGradient(-w, 0, w, 0);
    bg.addColorStop(0, 'rgba(150,190,215,0.75)'); bg.addColorStop(0.25, 'rgba(235,248,255,0.55)'); bg.addColorStop(0.5, 'rgba(200,225,240,0.35)'); bg.addColorStop(1, 'rgba(110,150,180,0.8)');
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(90,130,160,0.7)'; ctx.lineWidth = 1; ctx.stroke();
    if (water > 0) {   // 瓶內的水
      var wh = (h - 10) * 0.4 * water;
      ctx.save(); ctx.clip();
      var wg = ctx.createLinearGradient(-w, 0, w, 0);
      wg.addColorStop(0, 'rgba(20,90,170,0.85)'); wg.addColorStop(0.35, 'rgba(70,150,230,0.7)'); wg.addColorStop(1, 'rgba(15,70,140,0.85)');
      ctx.fillStyle = wg; ctx.fillRect(-w, -wh, w * 2, wh + 2);
      ctx.fillStyle = 'rgba(200,235,255,0.6)'; ctx.fillRect(-w, -wh - 1, w * 2, 2);   // 水面
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-w * 0.55, -h + 16, 3, h - 30);   // 長條反光
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(-w, -h * 0.55, w * 2, 9);           // 標籤
    ctx.fillStyle = 'rgb(40,110,200)'; ctx.fillRect(-w, -h * 0.55 + 3, w * 2, 3);
    // 鼻錐
    ctx.beginPath(); ctx.moveTo(-w * 0.55, -h + 1); ctx.quadraticCurveTo(-w * 0.5, -h - 22, 0, -h - 30); ctx.quadraticCurveTo(w * 0.5, -h - 22, w * 0.55, -h + 1); ctx.closePath();
    var ng = ctx.createLinearGradient(-w * 0.55, 0, w * 0.55, 0);
    ng.addColorStop(0, 'rgb(250,110,90)'); ng.addColorStop(0.35, 'rgb(255,170,150)'); ng.addColorStop(1, 'rgb(160,30,30)');
    ctx.fillStyle = ng; ctx.fill();
    ctx.fillStyle = 'rgb(40,40,45)'; ctx.fillRect(-4, -2, 8, 7);   // 噴嘴
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-3, -1, 2, 5);
    void t;
  }
  function drawPump(ctx, x, groundY, stroke, needle) {   // 金屬打氣筒＋水管；stroke 握把下壓 0～1，needle 壓力錶 0～1
    ctx.strokeStyle = 'rgb(25,25,30)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + 12, groundY - 4); ctx.bezierCurveTo(x + 60, groundY + 14, x + 120, groundY + 14, x + 152, groundY - 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5; ctx.stroke();
    var bg = ctx.createLinearGradient(x - 26, 0, x + 26, 0);   // 底座
    bg.addColorStop(0, 'rgb(30,30,35)'); bg.addColorStop(0.5, 'rgb(70,70,78)'); bg.addColorStop(1, 'rgb(25,25,30)');
    ctx.fillStyle = bg; ctx.fillRect(x - 28, groundY - 8, 56, 8);
    var cg = ctx.createLinearGradient(x - 12, 0, x + 12, 0);   // 筒身
    cg.addColorStop(0, 'rgb(150,155,165)'); cg.addColorStop(0.3, 'rgb(240,242,245)'); cg.addColorStop(0.55, 'rgb(170,175,185)'); cg.addColorStop(1, 'rgb(90,95,105)');
    ctx.fillStyle = cg; ctx.fillRect(x - 12, groundY - 96, 24, 88);
    ctx.beginPath(); ctx.arc(x, groundY - 52, 9, 0, Math.PI * 2); ctx.fillStyle = 'rgb(245,245,240)'; ctx.fill();   // 小壓力錶
    ctx.strokeStyle = 'rgb(60,60,60)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, groundY - 52); ctx.lineTo(x + Math.cos(-2.4 + needle * 3.2) * 7, groundY - 52 + Math.sin(-2.4 + needle * 3.2) * 7);
    ctx.strokeStyle = 'rgb(200,40,40)'; ctx.lineWidth = 1.5; ctx.stroke();
    var hy = groundY - 96 - 42 + stroke * 36;
    var rg = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
    rg.addColorStop(0, 'rgb(150,150,155)'); rg.addColorStop(0.5, 'rgb(250,250,250)'); rg.addColorStop(1, 'rgb(120,120,125)');
    ctx.fillStyle = rg; ctx.fillRect(x - 3, hy, 6, groundY - 96 - hy + 4);
    var hg = ctx.createLinearGradient(0, hy - 9, 0, hy + 3);   // 握把
    hg.addColorStop(0, 'rgb(60,60,65)'); hg.addColorStop(1, 'rgb(15,15,18)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(x, hy - 3, 30, 6, 0, 0, Math.PI * 2); ctx.fill();
  }

  var api = {
    ART_W: ART_W, ZONE_H: ZONE_H, BASE_Y: BASE_Y,
    drawSky: drawSky, paintSpace: paintSpace, paintEarthTexture: paintEarthTexture, drawEarth: drawEarth,
    paintMoon: paintMoon, paintZone: paintZone, drawRocket: drawRocket, drawPump: drawPump, glow: glow, mix: mix, rgba: rgba
  };
  root.RocketArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
