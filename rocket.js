/* 水火箭發射（網頁版）— 遊戲本體。
 * 握緊握力球打氣（至少 1 秒），放開那一瞬間的握力決定火箭飛多高。
 * 不直接碰 DOM：由 app.js 提供 env（握力球、存檔、音效、建立畫布），所以也能在 Node 裡測試。
 * iPad iOS 12（Bluefy）相容：不用 ?. ?? 、class 欄位、Array.at、roundRect 等新語法。
 * 邏輯座標固定 960x540（左 720 是主畫面，右 240 是紀錄欄）。
 */
(function (root) {
  'use strict';

  var VERSION = '2026.10.19-1';   // 每次發佈都改，畫面右下角會顯示
  var W = 960, H = 540, SCENE_W = 720, ROCKET_X = 330, ZONE_PX = 540, CAM0 = 0.4;
  var START_FORCE = 3.0, RELEASE_FORCE = 1.5, PUMP_MIN = 1.0, PEAK_WINDOW = 0.6;
  var FONT = '"PingFang TC", "Heiti TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
  var TEXT = [240, 238, 245], DIM = [150, 146, 165], GOLD = [255, 205, 70], GREEN = [96, 220, 150], RED = [255, 90, 90];

  // 等級：握力區間、名稱、真實高度區間（公尺）、圖鑑說明
  var LEVELS = [
    { name: '發射失敗', lo: 0, hi: 10, alt: [0, 5], color: [120, 120, 130], desc: '氣壓不夠，水火箭只跳了一下。' },
    { name: '越過樹梢', lo: 10, hi: 15, alt: [20, 100], color: [96, 200, 110], desc: '公園裡的大樹大約 20 公尺高。' },
    { name: '超越台北 101', lo: 15, hi: 20, alt: [510, 1000], color: [120, 190, 220], desc: '台北 101 高 508 公尺。' },
    { name: '穿過雲層', lo: 20, hi: 25, alt: [1000, 3900], color: [235, 240, 250], desc: '常見的雲大多在 1～3 公里高。' },
    { name: '飛越玉山', lo: 25, hi: 30, alt: [3952, 8000], color: [210, 225, 240], desc: '玉山主峰 3,952 公尺，是台灣最高峰。' },
    { name: '對流層頂', lo: 30, hi: 35, alt: [8000, 17000], color: [90, 140, 230], desc: '天氣都發生在對流層，客機在約 10 公里高飛行。' },
    { name: '平流層・臭氧層', lo: 35, hi: 40, alt: [17000, 50000], color: [140, 110, 230], desc: '臭氧層約在 20～30 公里高，擋住大部分紫外線。' },
    { name: '中氣層・流星', lo: 40, hi: 45, alt: [50000, 100000], color: [200, 120, 220], desc: '流星大多在 80～100 公里高燃燒發光。' },
    { name: '卡門線・太空邊界', lo: 45, hi: 50, alt: [100000, 200000], color: [255, 160, 90], desc: '100 公里高的卡門線，常被當作太空的起點。' },
    { name: '增溫層・太空站', lo: 50, hi: 55, alt: [200000, 500000], color: [96, 230, 170], desc: '國際太空站在約 400 公里高繞地球飛行，極光也在這一層。' },
    { name: '外太空', lo: 55, hi: 75, alt: [500000, 384400000], color: [255, 215, 90], desc: '離開大氣層！握力越大飛越遠，月球約 38 萬公里。' }
  ];
  var NUM_LEVELS = 10;

  // ---------- 小工具 ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(x, lo, hi) { if (lo === undefined) { lo = 0; hi = 1; } return Math.max(lo, Math.min(hi, x)); }
  function lerpColor(a, b, t) { return [lerp(a[0], b[0], t) | 0, lerp(a[1], b[1], t) | 0, lerp(a[2], b[2], t) | 0]; }
  function shade(c, amt) { return lerpColor(c, amt < 0 ? [0, 0, 0] : [255, 255, 255], Math.abs(amt)); }
  function rgb(c, a) { return a === undefined ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function ellipse(ctx, cx, cy, rx, ry, fill) {
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function polygon(ctx, pts, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  // ---------- 握力 → 等級與高度 ----------
  function levelOf(force) { return force < 10 ? 0 : Math.min(NUM_LEVELS, Math.floor((force - 10) / 5) + 1); }
  function fracInLevel(force) {   // 在這個等級裡的位置 0～1
    var L = LEVELS[levelOf(force)];
    return clamp((force - L.lo) / (L.hi - L.lo));
  }
  function altitudeOf(force) {    // 公尺；等級內用對數內插，力道越大越高
    var L = LEVELS[levelOf(force)], f = fracInLevel(force);
    if (levelOf(force) === 0) return lerp(L.alt[0], L.alt[1], f);
    return L.alt[0] * Math.pow(L.alt[1] / L.alt[0], f);
  }
  function fmtAlt(m) {
    if (m < 1000) return Math.round(m) + ' 公尺';
    if (m < 100000) return (Math.round(m / 100) / 10).toFixed(1) + ' 公里';
    return Math.round(m / 1000).toLocaleString('en-US') + ' 公里';
  }
  function altNote(m) {   // 外太空的距離比喻
    if (m >= 384400000) return '飛到月球了！';
    if (m >= 35786000) return '超過同步衛星軌道';
    return '';
  }

  // ---------- 音效與音樂（WebAudio 合成） ----------
  function Sfx(ac) {
    this.ac = ac || null; this.buf = {};
    if (!this.ac) return;
    var rate = this.ac.sampleRate, self = this;
    function noise(dur, decay, vol, lp) {
      var o = [], last = 0;
      for (var i = 0; i < rate * dur; i++) { var v = Math.random() * 2 - 1; last = lp ? last + (v - last) * lp : v; o.push(last * vol * Math.exp(-decay * i / rate)); }
      return o;
    }
    function tone(dur, f, decay, vol) { var o = []; for (var i = 0; i < rate * dur; i++) o.push(Math.sin(2 * Math.PI * f * i / rate) * vol * Math.exp(-decay * i / rate)); return o; }
    function sweep(dur, f0, f1, vol) { var o = [], ph = 0, n = rate * dur; for (var i = 0; i < n; i++) { ph += 2 * Math.PI * lerp(f0, f1, i / n) / rate; o.push(Math.sin(ph) * vol * (1 - i / n)); } return o; }
    function melody(notes, dur, vol) { var o = []; notes.forEach(function (f) { o = o.concat(tone(dur, f, 6, vol)); }); return o; }
    function make(s) { var b = self.ac.createBuffer(1, s.length, rate), d = b.getChannelData(0); for (var i = 0; i < s.length; i++) d[i] = clamp(s[i], -1, 1); return b; }
    this.buf.pump = make(noise(0.12, 25, 0.35, 0.25));
    var whoosh = noise(1.4, 2.2, 0.7, 0.12), thump = tone(1.4, 60, 6, 0.5);
    this.buf.launch = make(whoosh.map(function (v, i) { return v + thump[i]; }));
    this.buf.fail = make(sweep(0.35, 300, 120, 0.35).concat(tone(0.15, 90, 20, 0.4)));
    this.buf.chute = make(noise(0.18, 18, 0.4, 0.5));
    this.buf.zone = make(sweep(0.12, 900, 1400, 0.18));
    this.buf.win = make(melody([523, 659, 784, 1047], 0.12, 0.3));
    this.buf.unlock = make(melody([784, 988, 1175, 1568, 1175, 1568], 0.1, 0.3));
    this.buf.short = make(melody([330, 262], 0.12, 0.25));
  }
  Sfx.prototype.play = function (name) {
    if (!this.ac || !this.buf[name]) return;
    try { var s = this.ac.createBufferSource(); s.buffer = this.buf[name]; s.connect(this.ac.destination); s.start(0); } catch (e) { }
  };

  // 背景音樂：A 小調的冒險風 8 小節循環（Am → F → C → G），null = 延長前一個音
  var MELODY = [
    69, null, 72, 76, null, 74, 72, null,   65, null, 69, 72, null, 71, 69, null,
    72, null, 76, 79, null, 77, 76, 74,     71, null, 74, 79, null, 77, 74, null,
    76, 77, 79, null, 81, null, 79, 76,     77, 76, 74, null, 72, null, 69, null,
    72, 74, 76, null, 79, null, 76, 72,     74, null, 71, null, 67, null, null, null
  ];
  var BASS = [45, 41, 48, 43, 45, 41, 48, 43];
  var BPM = 116;
  function Music(ac) {
    this.ac = ac; this.enabled = false; this.step = 0; this.next = 0;
    this.master = ac.createGain(); this.master.gain.value = 0; this.master.connect(ac.destination);
    var n = Math.floor(ac.sampleRate * 0.05), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n / 6));
    this.noise = b;
  }
  Music.VOLUME = 0.12;
  Music.prototype.setEnabled = function (on) {
    this.enabled = on;
    var t = this.ac.currentTime, self = this;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? Music.VOLUME : 0, t, 0.2);
    clearInterval(this.timer); this.timer = null;
    if (on) {   // 獨立計時器排程：畫面卡一下，音樂也不會斷
      this.next = t + 0.1;
      this.timer = setInterval(function () { self.tick(); }, 50);
    }
  };
  Music.prototype.duck = function (sec) {
    if (!this.enabled) return;
    var t = this.ac.currentTime, g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(Music.VOLUME * 0.25, t, 0.05);
    g.setTargetAtTime(Music.VOLUME, t + sec, 0.5);
  };
  Music.prototype.note = function (type, midi, t, dur, vol) {
    var o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  };
  Music.prototype.kick = function (t) {
    var o = this.ac.createOscillator(), g = this.ac.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2);
  };
  Music.prototype.hat = function (t, vol) {
    var s = this.ac.createBufferSource(), g = this.ac.createGain(), f = this.ac.createBiquadFilter();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 6500; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  };
  Music.prototype.tick = function () {
    if (!this.enabled) return;
    var now = this.ac.currentTime, eighth = 60 / BPM / 2;
    if (this.next < now - 0.3) this.next = now + 0.05;
    while (this.next < now + 0.5) {
      var t = this.next, st = this.step, bar = Math.floor(st / 8) % 8, inBar = st % 8, m = MELODY[st];
      if (m !== null) {
        var len = 1;
        while (len < 4 && MELODY[(st + len) % MELODY.length] === null) len++;
        this.note('square', m, t, eighth * len * 0.9, 0.14);
        if (inBar % 4 === 0) this.note('triangle', m + 12, t, eighth * 0.6, 0.05);   // 高八度點綴
      }
      if (inBar % 2 === 0) this.note('triangle', inBar % 4 === 0 ? BASS[bar] : BASS[bar] + 7, t, eighth * 1.8, 0.5);
      if (inBar === 0 || inBar === 4) this.kick(t);
      if (inBar % 2 === 1) this.hat(t, 0.2);
      this.step = (st + 1) % MELODY.length;
      this.next += eighth;
    }
  };

  // ---------- 遊戲 ----------
  function Game(env) {
    this.env = env;   // { grip:{force,connected,status}, storage, connectGrip(), bluetoothSupported, makeCanvas }
    this.sfx = new Sfx(null);
    this.save = this.loadSave();
    this.time = 0; this.sim = 0; this.held = false; this.keyHeld = false;
    this.state = 'ready'; this.stateT = 0; this.lastState = 'ready';
    this.particles = []; this.banner = null; this.toast = null;
    this.waitRelease = false; this.armed = true;
    this.showCollection = false; this.confirmSwap = 0;
    this.buttons = [];
    this.zR = 0; this.rocketAngle = 0;
    var rng = mulberry32(7);
    this.stars = [];
    for (var i = 0; i < 160; i++) this.stars.push([rng() * SCENE_W, rng() * H, 0.4 + rng() * 1.4, rng() * 6.28]);
  }
  var G = Game.prototype;

  G.setAudio = function (ac) {
    this.sfx = new Sfx(ac);
    try { this.music = new Music(ac); this.music.setEnabled(this.save.music); } catch (e) { this.music = null; }
  };

  // ---- 存檔：圖鑑留在這台裝置；最佳紀錄與最近 10 次是「這位玩家」的，按換人挑戰清空 ----
  G.loadSave = function () {
    var s = { music: true, collection: {}, records: [], best: null };
    try {
      var d = JSON.parse(this.env.storage.get() || 'null');
      if (d) {
        s.music = d.music !== false;
        s.collection = d.collection || {};
        s.records = (d.records || []).slice(0, 10);
        s.best = d.best || null;
      }
    } catch (e) { }
    return s;
  };
  G.saveData = function () { try { this.env.storage.set(JSON.stringify(this.save)); } catch (e) { } };
  G.collected = function () { var n = 0; for (var k in this.save.collection) if (this.save.collection[k]) n++; return n; };

  // ---- 輸入（沒有握力球時：按住畫面，力道隨時間上升，按越久飛越高） ----
  G.readInput = function (dt) {
    var holding = this.held || this.keyHeld;
    if (holding) this.sim = Math.min(75, this.sim + (this.sim < 10 ? 20 : 12) * dt);
    else this.sim = Math.max(0, this.sim - 400 * dt);
    var g = this.env.grip;
    return g.force >= this.sim ? g.force : this.sim;
  };

  // ---- 流程 ----
  G.update = function (dt) {
    var force = this.readInput(dt);
    this.force = force;
    this.time += dt;
    if (this.state !== this.lastState) { this.lastState = this.state; this.stateT = 0; }
    this.stateT += dt;
    if (this.confirmSwap > 0) this.confirmSwap -= dt;
    if (force < START_FORCE) this.armed = true;
    if (this.waitRelease && force <= RELEASE_FORCE) this.waitRelease = false;
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; }
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    this.updateParticles(dt);

    var s = this.state;
    if (s === 'ready') {
      if (!this.showCollection && !this.waitRelease && force >= START_FORCE) this.startPump();
    } else if (s === 'pump') this.updatePump(dt, force);
    else if (s === 'flight') this.updateFlight(dt);
    else if (s === 'result') {
      // 再握一下就直接開始下一次打氣（要先放開過，避免發射那一下的餘力觸發）
      if (!this.showCollection && this.armed && this.stateT > 0.8 && force >= START_FORCE) { this.toReady(); this.startPump(); }
    }
  };
  G.toReady = function () {   // 回到發射台：火箭歸位、收起降落傘
    this.state = 'ready'; this.zR = 0; this.rocketAngle = 0; this.chute = false; this.banner = null;
  };
  G.startPump = function () {
    this.state = 'pump'; this.pumpT = 0; this.hist = []; this.pumpPhase = 0; this.armed = false;
  };
  G.recentPeak = function () {
    var p = 0, cut = this.time - PEAK_WINDOW;
    for (var i = 0; i < this.hist.length; i++) if (this.hist[i][0] >= cut) p = Math.max(p, this.hist[i][1]);
    return p;
  };
  G.updatePump = function (dt, force) {
    this.pumpT += dt;
    this.hist.push([this.time, force]);
    while (this.hist.length && this.hist[0][0] < this.time - PEAK_WINDOW - 0.1) this.hist.shift();
    var ph = this.pumpPhase;
    this.pumpPhase += dt * (1.6 + Math.min(force, 60) / 25);   // 握越大力打得越快
    if (Math.floor(this.pumpPhase) > Math.floor(ph)) {
      this.sfx.play('pump');
      this.bubbles(3);
    }
    var peak = this.recentPeak();
    // 放開判定：握力掉到最近高峰的一半以下（或幾乎放開）
    if (force <= Math.max(2, peak * 0.5)) {
      if (this.pumpT < PUMP_MIN) {
        this.state = 'ready'; this.waitRelease = true;
        this.toast = { s: '打氣不夠，至少要握住 1 秒', t: 2.2, color: GOLD };
        this.sfx.play('short');
      } else this.launch(peak);
    }
  };
  G.launch = function (force) {
    var lv = levelOf(force), alt = altitudeOf(force);
    this.state = 'flight'; this.flightT = 0;
    this.launchForce = force; this.level = lv; this.altitude = alt;
    this.targetZ = lv === 0 ? 0.08 : lv + 0.05 + fracInLevel(force) * 0.85;
    this.flightDur = lv === 0 ? 2.2 : 2.6 + lv * 0.55;
    this.zR = 0; this.rocketAngle = 0; this.zoneShown = 0; this.chute = false;
    this.waitRelease = true;
    // 紀錄
    var rec = { force: Math.round(force * 10) / 10, alt: alt, level: lv };
    this.save.records.unshift(rec);
    this.save.records = this.save.records.slice(0, 10);
    var best = this.save.best;
    this.newBest = !best || alt > best.alt;
    if (this.newBest) this.save.best = rec;
    this.newUnlock = lv > 0 && !this.save.collection[lv];
    if (lv > 0) this.save.collection[lv] = true;
    this.saveData();
    if (lv === 0) { this.sfx.play('fail'); this.splash(18, 0.6); }
    else { this.sfx.play('launch'); if (this.music) this.music.duck(this.flightDur); }
  };
  G.updateFlight = function (dt) {
    this.flightT += dt;
    var t = this.flightT, lv = this.level;
    if (lv === 0) {   // 失敗：跳一下就倒
      var k = clamp(t / 0.5);
      this.zR = Math.sin(k * Math.PI) * 0.08;
      this.rocketAngle = clamp((t - 0.35) / 0.4) * 1.3;
      if (t > this.flightDur) this.state = 'result';
      return;
    }
    if (t < this.flightDur) {
      this.zR = this.targetZ * easeOutCubic(t / this.flightDur);
      if (t < 0.7) this.jet();   // 噴水推進
      var zone = Math.floor(this.zR);
      if (zone > this.zoneShown && zone >= 1) {
        this.zoneShown = zone;
        var L = LEVELS[zone];
        this.banner = { s: '等級 ' + zone + '　' + L.name, sub: '約 ' + fmtAlt(L.alt[0]) + (zone < 10 ? ' ～ ' + fmtAlt(L.alt[1]) : ' 以上'), t: 1.3, color: L.color };
        this.sfx.play('zone');
      }
    } else {
      if (!this.chute) { this.chute = true; this.sfx.play('chute'); }
      this.zR = this.targetZ - clamp((t - this.flightDur) / 2) * 0.05;   // 開傘慢慢飄
      if (t > this.flightDur + 1.4) { this.state = 'result'; this.sfx.play(this.newUnlock ? 'unlock' : 'win'); }
    }
  };

  // ---- 粒子 ----
  G.updateParticles = function (dt) {
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.life -= dt;
    }
    this.particles = this.particles.filter(function (p) { return p.life > 0; });
  };
  G.addParticle = function (p) { if (this.particles.length < 250) this.particles.push(p); };
  G.rocketScreen = function () {   // 火箭在畫面上的位置（底部中心）；z=0 時剛好站在發射台上
    var cam = Math.max(CAM0, this.zR);
    return { x: ROCKET_X, y: H / 2 + (cam - this.zR) * ZONE_PX - 12 };
  };
  G.jet = function () {
    var r = this.rocketScreen();
    for (var i = 0; i < 3; i++) {
      this.addParticle({ x: r.x + (Math.random() - 0.5) * 8, y: r.y + 4, vx: (Math.random() - 0.5) * 80, vy: 260 + Math.random() * 220,
        g: 300, life: 0.5 + Math.random() * 0.4, max: 0.9, r: 3 + Math.random() * 4, c: Math.random() < 0.5 ? 'rgba(170,215,255,0.9)' : 'rgba(255,255,255,0.85)' });
    }
  };
  G.splash = function (n, power) {
    var r = this.rocketScreen();
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      this.addParticle({ x: r.x, y: r.y, vx: Math.cos(a) * 180 * power, vy: Math.sin(a) * 260 * power, g: 700,
        life: 0.6 + Math.random() * 0.4, max: 1, r: 3 + Math.random() * 3, c: 'rgba(170,215,255,0.9)' });
    }
  };
  G.bubbles = function (n) {
    var r = this.rocketScreen();
    for (var i = 0; i < n; i++) {
      this.addParticle({ x: r.x + (Math.random() - 0.5) * 16, y: r.y - 14 - Math.random() * 18, vx: (Math.random() - 0.5) * 10, vy: -40 - Math.random() * 40,
        g: 0, life: 0.5, max: 0.5, r: 1.5 + Math.random() * 2, c: 'rgba(255,255,255,0.8)' });
    }
  };

  // ---- 觸控 / 按鍵 ----
  G.button = function (id, x, y, w, h, label, opts) {
    opts = opts || {};
    this.buttons.push({ id: id, x: x, y: y, w: w, h: h });
    return { x: x, y: y, w: w, h: h, label: label, fill: opts.fill, ink: opts.ink, size: opts.size };
  };
  G.hit = function (x, y) {
    for (var i = this.buttons.length - 1; i >= 0; i--) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  };
  G.tap = function (x, y) {
    var id = this.hit(x, y);
    if (!id) {
      if (this.state === 'result' && x < SCENE_W) { this.toReady(); return true; }
      return false;
    }
    if (id === 'grip') this.env.connectGrip();
    else if (id === 'music') this.toggleMusic();
    else if (id === 'book') this.showCollection = true;
    else if (id === 'closeBook') this.showCollection = false;
    else if (id === 'swap') {
      if (this.confirmSwap > 0) {   // 換人挑戰：只清空這位玩家的紀錄，圖鑑保留
        this.save.records = []; this.save.best = null; this.saveData();
        this.confirmSwap = 0; this.toReady();
        this.toast = { s: '換人挑戰！紀錄已清空，圖鑑保留', t: 2.2, color: GREEN };
      } else this.confirmSwap = 3;
    }
    return true;
  };
  // 按住畫面＝打氣（按鈕、圖鑑開著、紀錄欄除外）
  G.toggleMusic = function () { this.save.music = !this.save.music; this.saveData(); if (this.music) this.music.setEnabled(this.save.music); };
  G.pointerInPlayArea = function (x, y) {
    return x < SCENE_W && !this.hit(x, y) && !this.showCollection && (this.state === 'ready' || this.state === 'pump');   // 結果畫面點一下＝繼續
  };
  G.key = function (code, down) {
    if (code === 'Space') { this.keyHeld = down; return; }
    if (!down) return;
    if (code === 'KeyM') this.toggleMusic();
    else if (code === 'KeyB') this.showCollection = !this.showCollection;
    else if (code === 'Escape') this.showCollection = false;
  };

  // ---------- 繪圖 ----------
  G.text = function (ctx, s, size, color, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.font = (o.weight || 'bold') + ' ' + size + 'px ' + FONT;
    ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    ctx.translate(x, y);
    if (o.scale) ctx.scale(o.scale, o.scale);
    if (o.shadow !== false) { ctx.fillStyle = 'rgba(10,10,20,0.85)'; ctx.fillText(s, 2, 2); }
    ctx.fillStyle = typeof color === 'string' ? color : rgb(color);
    ctx.fillText(s, 0, 0);
    ctx.restore();
  };
  G.panel = function (ctx, x, y, w, h, a) { roundRect(ctx, x, y, w, h, 14); ctx.fillStyle = 'rgba(14,14,28,' + (a === undefined ? 0.8 : a) + ')'; ctx.fill(); };
  G.drawButton = function (ctx, b) {
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fillStyle = b.fill ? rgb(b.fill) : 'rgba(40,36,58,0.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();
    this.text(ctx, b.label, b.size || 17, b.ink || TEXT, b.x + b.w / 2, b.y + b.h / 2 + 1, { shadow: false });
  };

  // 天空顏色：隨高度從淺藍 → 深藍 → 黑
  var SKY = [[0, [140, 200, 250]], [2, [120, 185, 245]], [4, [90, 150, 230]], [5, [55, 100, 200]], [6, [30, 55, 140]],
             [7, [14, 18, 60]], [8, [6, 6, 26]], [11, [3, 3, 14]]];
  function skyAt(z) {
    for (var i = 1; i < SKY.length; i++) if (z <= SKY[i][0]) return lerpColor(SKY[i - 1][1], SKY[i][1], clamp((z - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0])));
    return SKY[SKY.length - 1][1];
  }
  G.cam = function () { return Math.max(CAM0, this.zR); };
  G.zoneY = function (z) { return H / 2 + (this.cam() - z) * ZONE_PX; };   // 世界高度 z 在畫面上的 y

  G.drawBackground = function (ctx) {
    var cam = this.cam(), t = this.time, i;
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgb(skyAt(cam + 0.5))); grad.addColorStop(1, rgb(skyAt(cam - 0.5)));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, SCENE_W, H);
    var starA = clamp((cam - 6.3) / 1.5);   // 星星
    if (starA > 0) {
      for (i = 0; i < this.stars.length; i++) {
        var s = this.stars[i], tw = 0.6 + 0.4 * Math.sin(t * 2 + s[3]);
        ctx.fillStyle = 'rgba(255,255,255,' + (starA * tw).toFixed(2) + ')';
        ctx.fillRect(s[0], (s[1] + cam * 40) % H, s[2], s[2]);
      }
    }
    if (cam > 5.3) this.drawEarth(ctx, cam);
    for (var k = Math.max(0, Math.floor(cam - 1)); k <= Math.min(10, Math.floor(cam + 1)); k++) this.drawZone(ctx, k, this.zoneY(k), t);
  };
  G.drawEarth = function (ctx, cam) {   // 越高地平線越彎，最後變成一顆藍色地球
    var p = clamp((cam - 5.3) / 4.9), R = 9000 * Math.pow(0.026, p), cap = lerp(30, 300, p);
    var cx = SCENE_W / 2, cy = H - cap + R;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(120,190,255,0.25)'; ctx.fill();   // 大氣光暈
    var g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, 'rgb(90,160,240)'); g.addColorStop(1, 'rgb(20,60,140)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.clip();
    var rng = mulberry32(3);   // 陸地與雲
    for (var i = 0; i < 14; i++) {
      var a = rng() * Math.PI * 2, d = rng() * R * 0.95;
      ellipse(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.08 + rng() * 0.12), R * (0.05 + rng() * 0.08), i < 7 ? 'rgba(80,150,90,0.8)' : 'rgba(255,255,255,0.55)');
    }
    ctx.restore();
  };
  G.drawZone = function (ctx, k, by, t) {   // by = 這一層底部的畫面 y；每一層高 ZONE_PX
    var rng = mulberry32(100 + k), i, x, y;
    if (k === 0) {   // 地面：公園與發射台
      ctx.fillStyle = 'rgb(110,185,95)'; ctx.fillRect(0, by - 8, SCENE_W, H);
      ctx.fillStyle = 'rgb(90,160,80)'; ctx.fillRect(0, by - 8, SCENE_W, 6);
      for (i = 0; i < 6; i++) {   // 遠方的樹
        x = 30 + i * 125 + rng() * 40; if (Math.abs(x - ROCKET_X) < 70 || Math.abs(x - 170) < 60) continue;
        var th = 50 + rng() * 40;
        ctx.fillStyle = 'rgb(110,80,55)'; ctx.fillRect(x - 4, by - 8 - th * 0.4, 8, th * 0.4);
        ellipse(ctx, x, by - 8 - th * 0.6, th * 0.35, th * 0.4, 'rgb(60,140,70)');
      }
      ctx.fillStyle = 'rgb(130,130,140)'; ctx.fillRect(ROCKET_X - 34, by - 12, 68, 8);   // 發射台
      ctx.fillStyle = 'rgb(90,90,100)'; ctx.fillRect(ROCKET_X - 3, by - 34, 6, 24);
      return;
    }
    if (k === 1) {   // 樹梢、飛鳥
      for (i = 0; i < 5; i++) {
        x = (rng() * SCENE_W + t * (20 + rng() * 30)) % (SCENE_W + 40) - 20; y = by - 120 - rng() * 300;
        ctx.strokeStyle = 'rgba(40,40,50,0.8)'; ctx.lineWidth = 2; ctx.beginPath();
        var flap = Math.sin(t * 8 + i) * 4;
        ctx.moveTo(x - 9, y - flap); ctx.quadraticCurveTo(x - 4, y - 6, x, y); ctx.quadraticCurveTo(x + 4, y - 6, x + 9, y - flap); ctx.stroke();
      }
      return;
    }
    if (k === 2) {   // 城市與台北 101
      for (i = 0; i < 16; i++) {
        var bw = 30 + rng() * 30, bh = 40 + rng() * 110; x = i * 48 + rng() * 10;
        ctx.fillStyle = 'rgb(' + (70 + (rng() * 30 | 0)) + ',' + (90 + (rng() * 30 | 0)) + ',120)'; ctx.fillRect(x, by - bh, bw, bh + 40);
      }
      var tx = 540, base = by;   // 101：8 節疊起的塔
      ctx.fillStyle = 'rgb(70,120,110)';
      ctx.fillRect(tx - 26, base - 120, 52, 160);
      for (i = 0; i < 8; i++) { var yy = base - 120 - (i + 1) * 34; polygon(ctx, [[tx - 22, yy + 34], [tx + 22, yy + 34], [tx + 28, yy], [tx - 28, yy]], 'rgb(80,135,125)', 'rgb(50,90,85)', 1.5); }
      ctx.fillStyle = 'rgb(60,100,95)'; ctx.fillRect(tx - 6, base - 120 - 8 * 34 - 40, 12, 40);
      ctx.fillRect(tx - 1.5, base - 120 - 8 * 34 - 90, 3, 50);
      this.text(ctx, '台北 101（508 公尺）', 14, TEXT, tx, base - 120 - 8 * 34 - 104);
      return;
    }
    if (k === 3) {   // 雲層
      for (i = 0; i < 9; i++) {
        x = (rng() * (SCENE_W + 200) + t * 8) % (SCENE_W + 200) - 100; y = by - 60 - rng() * 420; var s = 0.7 + rng() * 0.8;
        ellipse(ctx, x, y, 70 * s, 26 * s, 'rgba(255,255,255,0.92)'); ellipse(ctx, x - 40 * s, y + 8 * s, 45 * s, 20 * s, 'rgba(255,255,255,0.9)');
        ellipse(ctx, x + 42 * s, y + 6 * s, 50 * s, 22 * s, 'rgba(255,255,255,0.9)'); ellipse(ctx, x + 5 * s, y - 16 * s, 40 * s, 24 * s, 'rgba(255,255,255,0.95)');
      }
      return;
    }
    if (k === 4) {   // 玉山：山腳往下淡出，像山峰從雲霧中冒出來（不然會像一塊懸空的石板）
      var mg4 = ctx.createLinearGradient(0, by - 330, 0, by + 140);
      mg4.addColorStop(0, 'rgba(95,110,130,1)'); mg4.addColorStop(0.55, 'rgba(95,110,130,0.95)'); mg4.addColorStop(1, 'rgba(95,110,130,0)');
      polygon(ctx, [[-20, by + 140], [140, by - 240], [260, by - 110], [380, by - 330], [520, by - 160], [640, by - 260], [760, by + 140]], mg4);
      polygon(ctx, [[380, by - 330], [345, by - 268], [362, by - 274], [378, by - 258], [396, by - 276], [418, by - 268]], 'rgb(245,248,255)');
      polygon(ctx, [[140, by - 240], [116, by - 196], [140, by - 204], [160, by - 196]], 'rgb(245,248,255)');
      this.text(ctx, '玉山主峰 3,952 公尺', 14, TEXT, 380, by - 350);
      return;
    }
    if (k === 5) {   // 客機
      x = ((t * 70) % (SCENE_W + 300)) - 150; y = by - 300;
      ctx.save(); ctx.translate(x, y);
      ellipse(ctx, 0, 0, 46, 8, 'rgb(235,238,245)');
      polygon(ctx, [[-6, 0], [14, 0], [-10, 30], [-22, 30]], 'rgb(200,205,215)'); polygon(ctx, [[-6, 0], [14, 0], [-10, -26], [-22, -26]], 'rgb(210,215,225)');
      polygon(ctx, [[-38, -2], [-30, -2], [-44, -20], [-50, -20]], 'rgb(220,80,80)');
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 46, y); ctx.lineTo(x - 260, y + 6); ctx.stroke();
      this.text(ctx, '客機巡航高度約 10 公里', 14, TEXT, x, y - 34);
      return;
    }
    if (k === 6) {   // 臭氧層、氣象氣球
      var oz = ctx.createLinearGradient(0, by - 330, 0, by - 230);
      oz.addColorStop(0, 'rgba(150,120,255,0)'); oz.addColorStop(0.5, 'rgba(150,120,255,0.35)'); oz.addColorStop(1, 'rgba(150,120,255,0)');
      ctx.fillStyle = oz; ctx.fillRect(0, by - 330, SCENE_W, 100);
      this.text(ctx, '臭氧層', 16, [210, 190, 255], 90, by - 280);
      x = 560; y = by - 150 + Math.sin(t) * 6;
      ellipse(ctx, x, y, 26, 30, 'rgb(250,250,250)'); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + 30); ctx.lineTo(x, y + 70); ctx.stroke(); ctx.fillStyle = 'rgb(240,140,60)'; ctx.fillRect(x - 6, y + 70, 12, 10);
      this.text(ctx, '氣象氣球', 13, TEXT, x, y - 44);
      return;
    }
    if (k === 7) {   // 流星
      for (i = 0; i < 4; i++) {
        var period = 2.2 + rng() * 2, ph = ((t + rng() * 5) % period) / period;
        if (ph > 0.35) continue;
        var sx = rng() * SCENE_W, sy = by - 100 - rng() * 380, L = 120 * ph / 0.35;
        var mg = ctx.createLinearGradient(sx, sy, sx - L, sy - L * 0.5);
        mg.addColorStop(0, 'rgba(255,240,200,0.95)'); mg.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.strokeStyle = mg; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - L, sy - L * 0.5); ctx.stroke();
      }
      return;
    }
    if (k === 8) {   // 卡門線
      ctx.setLineDash([12, 10]); ctx.strokeStyle = 'rgba(255,170,90,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(SCENE_W, by); ctx.stroke(); ctx.setLineDash([]);
      this.text(ctx, '卡門線 100 公里：太空從這裡開始', 15, [255, 190, 120], SCENE_W / 2, by - 16);
      return;
    }
    if (k === 9) {   // 極光、國際太空站
      for (i = 0; i < 3; i++) {
        var ag = ctx.createLinearGradient(0, by - 60, 0, by - 260);
        ag.addColorStop(0, 'rgba(80,255,170,0.32)'); ag.addColorStop(1, 'rgba(80,255,170,0)');
        ctx.fillStyle = ag; ctx.beginPath(); ctx.moveTo(0, by - 60);
        for (x = 0; x <= SCENE_W; x += 20) ctx.lineTo(x, by - 60 - 140 - 50 * Math.sin(x / 90 + t * 0.8 + i * 2));
        ctx.lineTo(SCENE_W, by - 60); ctx.closePath(); ctx.fill();
      }
      x = ((t * 40) % (SCENE_W + 200)) - 100; y = by - 380;
      ctx.fillStyle = 'rgb(200,205,215)'; ctx.fillRect(x - 18, y - 5, 36, 10);
      ctx.fillStyle = 'rgb(60,90,170)'; ctx.fillRect(x - 46, y - 16, 22, 32); ctx.fillRect(x + 24, y - 16, 22, 32);
      this.text(ctx, '國際太空站（約 400 公里）', 13, TEXT, x, y - 30);
      return;
    }
    if (k === 10) {   // 月亮
      ellipse(ctx, 560, by - 330, 46, 46, 'rgb(235,232,215)');
      ellipse(ctx, 545, by - 345, 9, 9, 'rgb(205,200,180)'); ellipse(ctx, 575, by - 320, 12, 12, 'rgb(205,200,180)'); ellipse(ctx, 560, by - 355, 6, 6, 'rgb(205,200,180)');
      this.text(ctx, '月球（約 38 萬公里）', 13, TEXT, 560, by - 392);
    }
  };

  G.drawRocket = function (ctx) {
    var r = this.rocketScreen(), s = this.state, swell = 0;
    if (s === 'pump') swell = Math.min(this.force, 60) / 60 * 3 + Math.sin(this.time * 30) * Math.min(this.force, 60) / 60 * 0.8;
    var waterLeft = s === 'flight' ? clamp(1 - this.flightT / 0.7) : 1;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(this.rocketAngle);
    if (this.chute && s !== 'ready') {   // 降落傘
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -96); ctx.lineTo(-40, -150); ctx.moveTo(0, -96); ctx.lineTo(40, -150); ctx.moveTo(0, -96); ctx.lineTo(0, -160); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -150, 42, Math.PI, 0); ctx.fillStyle = 'rgb(255,110,90)'; ctx.fill();
      ctx.beginPath(); ctx.arc(0, -150, 42, Math.PI * 1.33, Math.PI * 1.67); ctx.lineTo(0, -150); ctx.fillStyle = 'rgb(255,230,120)'; ctx.fill();
    }
    var w = 15 + swell, h = 70;
    polygon(ctx, [[-w, -18], [-w - 12, 0], [-w, -6]], 'rgb(230,70,70)');   // 尾翼
    polygon(ctx, [[w, -18], [w + 12, 0], [w, -6]], 'rgb(230,70,70)');
    roundRect(ctx, -w, -h, w * 2, h - 4, 8); ctx.fillStyle = 'rgba(215,240,255,0.85)'; ctx.fill();   // 寶特瓶
    ctx.strokeStyle = 'rgba(120,170,210,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (waterLeft > 0) { roundRect(ctx, -w + 2, -4 - (h - 8) * 0.38 * waterLeft, w * 2 - 4, (h - 8) * 0.38 * waterLeft, 6); ctx.fillStyle = 'rgba(60,140,240,0.75)'; ctx.fill(); }
    polygon(ctx, [[-w, -h + 2], [w, -h + 2], [0, -h - 26]], 'rgb(235,70,70)', 'rgb(180,40,40)', 1.5);   // 鼻錐
    ctx.fillStyle = 'rgb(60,60,70)'; ctx.fillRect(-4, -6, 8, 8);   // 噴嘴
    ctx.restore();
  };
  G.drawPump = function (ctx) {   // 打氣筒與水管（只在地面時畫）
    var by = this.zoneY(0) - 8, px = 170, s = this.state;
    if (by > H + 40) return;
    var stroke = s === 'pump' ? (1 - Math.cos(this.pumpPhase * Math.PI * 2)) / 2 : 0;
    ctx.strokeStyle = 'rgb(40,40,50)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(px + 10, by - 4); ctx.quadraticCurveTo(250, by + 6, ROCKET_X - 4, by - 6); ctx.stroke();
    ctx.fillStyle = 'rgb(60,110,200)'; ctx.fillRect(px - 12, by - 90, 24, 86);
    ctx.fillStyle = 'rgb(40,40,50)'; ctx.fillRect(px - 26, by - 6, 52, 6);
    var hy = by - 90 - 40 + stroke * 34;
    ctx.fillStyle = 'rgb(150,150,160)'; ctx.fillRect(px - 2.5, hy, 5, by - 90 - hy + 4);
    roundRect(ctx, px - 26, hy - 8, 52, 10, 5); ctx.fillStyle = 'rgb(40,40,50)'; ctx.fill();
  };
  G.drawGauge = function (ctx) {   // 氣壓計：目前握力、各等級刻度、現在放開可達
    var x = 650, y = 70, w = 34, h = 330, top = 65, f = this.force || 0, i;
    roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 12); ctx.fillStyle = 'rgba(20,20,35,0.85)'; ctx.fill();
    var fill = clamp(f / top) * h, lv = levelOf(f);
    if (fill > 0) { roundRect(ctx, x, y + h - fill, w, fill, 9); ctx.fillStyle = rgb(LEVELS[lv].color); ctx.fill(); }
    for (i = 10; i <= 55; i += 5) {
      var ty = y + h - i / top * h;
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x - 8, ty - 1, 8, 2);
      this.text(ctx, String(i), 12, DIM, x - 20, ty, { shadow: false });
    }
    if (this.save.best) {   // 這位玩家的最佳
      var byy = y + h - clamp(this.save.best.force / top) * h;
      polygon(ctx, [[x + w + 4, byy], [x + w + 15, byy - 6], [x + w + 15, byy + 6]], rgb(GOLD));
    }
    this.text(ctx, f.toFixed(1), 30, lv ? LEVELS[lv].color : TEXT, x + w / 2, y - 30);
  };

  G.drawSidePanel = function (ctx) {
    var x0 = SCENE_W, i;
    ctx.fillStyle = 'rgb(18,18,34)'; ctx.fillRect(x0, 0, W - x0, H);
    this.text(ctx, '水火箭發射', 22, GOLD, x0 + 120, 26);
    var b = this.save.best;
    this.panel(ctx, x0 + 10, 48, 220, 62, 0.9);
    this.text(ctx, '最佳紀錄', 13, DIM, x0 + 120, 62, { shadow: false });
    this.text(ctx, b ? fmtAlt(b.alt) : '—', 22, GOLD, x0 + 120, 86);
    this.text(ctx, b ? '握力 ' + b.force.toFixed(1) + '・' + LEVELS[b.level].name : '還沒發射過', 12, DIM, x0 + 120, 103, { shadow: false });
    this.text(ctx, '最近 10 次', 14, TEXT, x0 + 20, 128, { align: 'left', shadow: false });
    var recs = this.save.records;
    for (i = 0; i < 10; i++) {
      var y = 146 + i * 30, r = recs[i];
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(x0 + 10, y - 13, 220, 28); }
      if (!r) continue;
      var isBest = b && r.alt === b.alt && r.force === b.force;
      var L = LEVELS[r.level];
      ctx.fillStyle = rgb(L.color); ctx.fillRect(x0 + 12, y - 9, 4, 18);
      this.text(ctx, (isBest ? '★ ' : '') + r.force.toFixed(1), 14, isBest ? GOLD : TEXT, x0 + 24, y - 4, { align: 'left', shadow: false });
      this.text(ctx, fmtAlt(r.alt), 14, isBest ? GOLD : TEXT, x0 + 226, y - 4, { align: 'right', shadow: false });
      this.text(ctx, r.level ? '等級 ' + r.level + ' ' + L.name : L.name, 11, DIM, x0 + 24, y + 9, { align: 'left', shadow: false, weight: 'normal' });
    }
    this.drawButton(ctx, this.button('book', x0 + 10, 452, 106, 40, '圖鑑 ' + this.collected() + '/10', { fill: [70, 60, 140] }));
    this.drawButton(ctx, this.button('swap', x0 + 124, 452, 106, 40, this.confirmSwap > 0 ? '確定換人？' : '換人挑戰',
      this.confirmSwap > 0 ? { fill: [215, 55, 60], ink: [255, 255, 255] } : {}));
    this.text(ctx, '版本 ' + VERSION, 11, DIM, W - 10, H - 12, { align: 'right', shadow: false, weight: 'normal' });
  };

  G.drawHints = function (ctx) {
    var s = this.state, f = this.force || 0;
    if (s === 'ready' || s === 'pump') {
      this.drawButton(ctx, this.button('music', 12, 12, 116, 36, this.save.music ? '♪ 音樂：開' : '♪ 音樂：關'));
      var g = this.env.grip;
      this.drawButton(ctx, this.button('grip', 136, 12, 190, 36, g.connected ? '✔ 已連線（點此重連）' : this.env.bluetoothSupported ? '連接握力球' : '此瀏覽器不支援藍牙',
        g.connected ? { ink: GREEN } : {}));
    }
    if (s === 'ready') {
      this.panel(ctx, 150, 70, 420, 64, 0.7);
      this.text(ctx, '握緊握力球打氣，放開就發射！', 22, TEXT, 360, 92);
      this.text(ctx, '至少握住 1 秒・放開那一刻的握力決定高度', 14, DIM, 360, 118, { shadow: false });
    } else if (s === 'pump') {
      var lv = levelOf(Math.max(f, this.recentPeak())), L = LEVELS[lv], ok = this.pumpT >= PUMP_MIN;
      this.panel(ctx, 150, 70, 420, 76, 0.75);
      this.text(ctx, ok ? '✔ 可以放開了！' : '打氣中… ' + this.pumpT.toFixed(1) + ' / 1.0 秒', 22, ok ? GREEN : GOLD, 360, 94);
      this.text(ctx, '現在放開：' + (lv ? '等級 ' + lv + ' ' + L.name : '發射失敗（握力要 10 以上）'), 16, L.color, 360, 126);
      roundRect(ctx, 200, 140, 320, 6, 3); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
      roundRect(ctx, 200, 140, 320 * clamp(this.pumpT / PUMP_MIN), 6, 3); ctx.fillStyle = rgb(ok ? GREEN : GOLD); ctx.fill();
    }
    var gs = this.env.grip;
    this.text(ctx, gs.status, 13, gs.connected ? GREEN : DIM, 12, H - 14, { align: 'left', shadow: false });
  };

  G.drawResult = function (ctx) {
    var L = LEVELS[this.level], k = easeOutBack(clamp(this.stateT / 0.4));
    ctx.save(); ctx.translate(360, 250); ctx.scale(k, k);
    this.panel(ctx, -230, -130, 460, this.newUnlock ? 260 : 230, 0.88);
    this.text(ctx, this.level ? '等級 ' + this.level + ' / 10' : '再用力一點！', 16, DIM, 0, -105, { shadow: false });
    this.text(ctx, L.name, 40, L.color, 0, -68);
    this.text(ctx, this.level ? '飛到 ' + fmtAlt(this.altitude) : '握力要 10 以上才能發射', 26, TEXT, 0, -20);
    var note = altNote(this.altitude);
    this.text(ctx, '放開時握力 ' + this.launchForce.toFixed(1) + (note ? '・' + note : ''), 16, DIM, 0, 14, { shadow: false });
    if (this.newBest && this.level) this.text(ctx, '★ 新的最佳紀錄！', 18, GOLD, 0, 44);
    if (this.newUnlock) this.text(ctx, '解鎖新圖鑑：' + L.name + '（' + this.collected() + '/10）', 18, GREEN, 0, 76);
    this.text(ctx, '再握一次就能繼續打氣', 14, DIM, 0, this.newUnlock ? 108 : 80, { shadow: false });
    ctx.restore();
  };

  G.drawCollection = function (ctx) {
    ctx.fillStyle = 'rgba(5,5,15,0.86)'; ctx.fillRect(0, 0, W, H);
    this.text(ctx, '圖鑑　' + this.collected() + ' / 10', 26, GOLD, W / 2, 34);
    this.text(ctx, '大家一起收集：飛到哪一層就解鎖那一張', 14, DIM, W / 2, 62, { shadow: false });
    for (var i = 1; i <= 10; i++) {
      var col = (i - 1) % 5, row = Math.floor((i - 1) / 5), x = 40 + col * 180, y = 86 + row * 196, L = LEVELS[i], got = !!this.save.collection[i];
      roundRect(ctx, x, y, 164, 182, 12);
      if (got) {
        var g = ctx.createLinearGradient(0, y, 0, y + 182);
        g.addColorStop(0, rgb(skyAt(i + 0.6))); g.addColorStop(1, rgb(skyAt(i - 0.3)));
        ctx.fillStyle = g;
      } else ctx.fillStyle = 'rgb(34,32,48)';
      ctx.fill(); ctx.strokeStyle = got ? rgb(L.color) : 'rgba(255,255,255,0.12)'; ctx.lineWidth = got ? 3 : 1.5; ctx.stroke();
      this.text(ctx, String(i), 16, got ? L.color : DIM, x + 18, y + 18);
      if (got) {
        this.text(ctx, L.name, L.name.length > 6 ? 15 : 18, TEXT, x + 82, y + 64);
        this.text(ctx, '約 ' + fmtAlt(L.alt[0]) + (i < 10 ? ' 起' : ' 以上'), 13, TEXT, x + 82, y + 92);
        var lines = this.wrap(ctx, L.desc, 140, 'normal 12px ' + FONT);
        for (var j = 0; j < lines.length && j < 4; j++) this.text(ctx, lines[j], 12, [225, 225, 235], x + 82, y + 118 + j * 16, { weight: 'normal' });
      } else {
        this.text(ctx, '?', 48, DIM, x + 82, y + 80);
        this.text(ctx, '握力 ' + L.lo + (i < 10 ? '～' + (L.hi - 1) : ' 以上'), 14, DIM, x + 82, y + 140, { shadow: false });
      }
    }
    this.drawButton(ctx, this.button('closeBook', W / 2 - 70, H - 46, 140, 36, '關閉', { fill: [79, 140, 255], ink: [255, 255, 255] }));
  };
  // 依實際寬度換行；數字、英文、小數點連在一起的部分不拆開（避免「50 / 8 公尺」這種斷法）
  G.wrap = function (ctx, s, maxW, font) {
    ctx.save(); ctx.font = font;
    var tokens = s.match(/[0-9A-Za-z.,%～~]+|./g) || [], out = [], line = '';
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (line && ctx.measureText(line + tk).width > maxW) {
        if (/^[，。！、；：）]$/.test(tk)) { line += tk; continue; }   // 標點不放在行首
        out.push(line.replace(/^ /, '')); line = tk;
      } else line += tk;
    }
    if (line) out.push(line.replace(/^ /, ''));
    ctx.restore();
    return out;
  };

  G.draw = function (ctx) {
    this.buttons = [];
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, SCENE_W, H); ctx.clip();
    this.drawBackground(ctx);
    this.drawPump(ctx);
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      ctx.globalAlpha = clamp(p.life / p.max * 1.5);
      ellipse(ctx, p.x, p.y, p.r, p.r, p.c);
    }
    ctx.globalAlpha = 1;
    this.drawRocket(ctx);
    if (this.state === 'ready' || this.state === 'pump') this.drawGauge(ctx);
    if (this.banner) {
      var a = clamp(this.banner.t / 0.3);
      this.panel(ctx, 160, 60, 400, 64, 0.75 * a);
      this.text(ctx, this.banner.s, 24, this.banner.color, 360, 84, { alpha: a });
      this.text(ctx, this.banner.sub, 14, TEXT, 360, 110, { alpha: a, shadow: false });
    }
    if (this.state === 'flight' && this.level > 0) {   // 即時高度
      var z = this.zR, lv = Math.min(10, Math.floor(z)), frac = clamp(z - lv);
      var L = LEVELS[Math.max(1, lv)], cur = lv === 0 ? lerp(0, LEVELS[1].alt[0], frac) : L.alt[0] * Math.pow((lv < 10 ? L.alt[1] : this.altitude) / L.alt[0], clamp((frac - 0.05) / 0.85));
      this.text(ctx, fmtAlt(Math.min(cur, this.altitude)), 30, TEXT, 600, H - 40);
    }
    this.drawHints(ctx);
    if (this.state === 'result') this.drawResult(ctx);
    if (this.toast) this.text(ctx, this.toast.s, 22, this.toast.color, 360, 200, { alpha: clamp(this.toast.t / 0.4) });
    ctx.restore();
    this.drawSidePanel(ctx);
    if (this.showCollection) this.drawCollection(ctx);
  };

  var api = { VERSION: VERSION, Game: Game, W: W, H: H, LEVELS: LEVELS, levelOf: levelOf, altitudeOf: altitudeOf, fmtAlt: fmtAlt };
  root.RocketGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
