/* 水火箭發射（網頁版）— 遊戲本體。
 * 握緊握力球打氣（至少 1 秒），放開那一瞬間的握力決定火箭飛多高。
 * 不直接碰 DOM：由 app.js 提供 env（握力球、存檔、音效、建立畫布），所以也能在 Node 裡測試。
 * iPad iOS 12（Bluefy）相容：不用 ?. ?? 、class 欄位、Array.at、roundRect 等新語法。
 * 邏輯座標固定 960x540：右側 240 是紀錄欄，收合後主畫面佔滿 960。寫實風背景由 art.js（RocketArt）繪製並快取。
 */
(function (root) {
  'use strict';

  var VERSION = '2026.10.19-5';   // 每次發佈都改，畫面右下角會顯示
  var A = root.RocketArt || (typeof require !== 'undefined' ? require('./art.js') : null);
  var W = 960, H = 540, SCENE_W = 720, PANEL_W = W - SCENE_W, ZONE_PX = 540, CAM0 = 0.4, ART_PAD_X = 440;
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
    this.panelK = this.save.panel ? 0 : 1;   // 0 = 紀錄欄展開，1 = 收合
    this.layout();
    this.art = null;
  }
  var G = Game.prototype;

  G.setAudio = function (ac) {
    this.sfx = new Sfx(ac);
    try { this.music = new Music(ac); this.music.setEnabled(this.save.music); } catch (e) { this.music = null; }
  };

  // ---- 存檔：圖鑑留在這台裝置；最佳紀錄與最近 10 次是「這位玩家」的，按換人挑戰清空 ----
  G.loadSave = function () {
    var s = { music: true, collection: {}, records: [], best: null, panel: true };
    try {
      var d = JSON.parse(this.env.storage.get() || 'null');
      if (d) {
        s.music = d.music !== false;
        s.collection = d.collection || {};
        s.records = (d.records || []).slice(0, 10);
        s.best = d.best || null;
        s.panel = d.panel !== false;
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
    var press = this.state === 'pump' ? clamp(force / 45) : 0;   // 打氣筒握把：握越緊壓越下去，握住就停住，放開彈回
    this.pumpPress = (this.pumpPress || 0) + (press - (this.pumpPress || 0)) * Math.min(1, dt * (press > (this.pumpPress || 0) ? 10 : 6));
    var target = this.save.panel ? 0 : 1;   // 紀錄欄滑動
    if (this.panelK !== target) { this.panelK = target > this.panelK ? Math.min(1, this.panelK + dt * 5) : Math.max(0, this.panelK - dt * 5); }
    this.layout();

    var s = this.state;
    if (s === 'ready') {
      if (!this.showCollection && !this.waitRelease && force >= START_FORCE) this.startPump();
    } else if (s === 'pump') this.updatePump(dt, force);
    else if (s === 'flight') this.updateFlight(dt);
    else if (s === 'result' && this.replay) { if (this.stateT > 1.2) this.endReplay(); }
    else if (s === 'result') {
      // 再握一下就直接開始下一次打氣（要先放開過，避免發射那一下的餘力觸發）
      if (!this.showCollection && this.armed && this.stateT > 0.8 && force >= START_FORCE) { this.toReady(); this.startPump(); }
    }
  };
  G.layout = function () {   // 主畫面寬度、火箭位置隨紀錄欄收合改變
    var k = this.panelK, e = k * k * (3 - 2 * k);
    this.sceneW = Math.round(SCENE_W + PANEL_W * e);
    this.rocketX = Math.round(this.sceneW * 0.458);
    this.artX = this.rocketX - ART_PAD_X;   // 背景圖的發射台對齊火箭
  };
  G.togglePanel = function () { this.save.panel = !this.save.panel; this.saveData(); };
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
    this.pumpPhase += dt * (1.6 + Math.min(force, 60) / 25);   // 瓶內冒氣泡的節奏：握越大力越快（握把不跟著動）
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
    this.replay = 0;
    this.startFlight(force);
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
  G.startFlight = function (force) {   // 飛行設定：真的發射和圖鑑重播共用
    var lv = levelOf(force);
    this.state = 'flight'; this.flightT = 0; this.particles = [];
    this.launchForce = force; this.level = lv; this.altitude = altitudeOf(force);
    this.targetZ = lv === 0 ? 0.08 : lv + 0.05 + fracInLevel(force) * 0.85;
    this.flightDur = lv === 0 ? 2.2 : 2.6 + lv * 0.55;
    this.zR = 0; this.rocketAngle = 0; this.zoneShown = 0; this.chute = false; this.banner = null;
  };
  G.startReplay = function (n) {   // 圖鑑重播：從發射台飛到第 n 層，不寫入紀錄
    var L = LEVELS[n];
    this.showCollection = false; this.toast = null;
    this.replay = n; this.newUnlock = false; this.newBest = false;
    this.startFlight(n === 10 ? 75 : L.lo + (L.hi - L.lo) * 0.6);   // 外太空就一路飛到月球
    this.sfx.play('launch'); if (this.music) this.music.duck(this.flightDur);
  };
  G.endReplay = function () { this.replay = 0; this.toReady(); this.showCollection = true; };
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
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.life -= dt; if (p.grow) p.r += p.grow * dt;
    }
    this.particles = this.particles.filter(function (p) { return p.life > 0; });
  };
  G.addParticle = function (p) { if (this.particles.length < 250) this.particles.push(p); };
  G.rocketScreen = function () {   // 火箭在畫面上的位置（底部中心）；z=0 時剛好站在發射台上
    var cam = Math.max(CAM0, this.zR);
    return { x: this.rocketX, y: H / 2 + (cam - this.zR) * ZONE_PX - 12 };
  };
  G.jet = function () {
    var r = this.rocketScreen();
    for (var i = 0; i < 3; i++) {
      this.addParticle({ x: r.x + (Math.random() - 0.5) * 8, y: r.y + 4, vx: (Math.random() - 0.5) * 80, vy: 260 + Math.random() * 220,
        g: 300, life: 0.5 + Math.random() * 0.4, max: 0.9, r: 3 + Math.random() * 5, c: Math.random() < 0.5 ? 'water' : 'mist', grow: 14 });
    }
  };
  G.splash = function (n, power) {
    var r = this.rocketScreen();
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      this.addParticle({ x: r.x, y: r.y, vx: Math.cos(a) * 180 * power, vy: Math.sin(a) * 260 * power, g: 700,
        life: 0.6 + Math.random() * 0.4, max: 1, r: 3 + Math.random() * 3, c: 'water' });
    }
  };
  G.bubbles = function (n) {
    var r = this.rocketScreen();
    for (var i = 0; i < n; i++) {
      this.addParticle({ x: r.x + (Math.random() - 0.5) * 16, y: r.y - 14 - Math.random() * 18, vx: (Math.random() - 0.5) * 10, vy: -40 - Math.random() * 40,
        g: 0, life: 0.5, max: 0.5, r: 1.5 + Math.random() * 2, c: 'bubble' });
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
      if (this.state === 'result' && !this.replay && x < this.sceneW) { this.toReady(); return true; }
      return false;
    }
    if (this.showCollection && id.indexOf('card') === 0) { this.startReplay(+id.slice(4)); return true; }
    if (this.showCollection && id !== 'closeBook') return true;   // 圖鑑開著時只能關閉或點卡片
    if (id === 'skipReplay') { this.endReplay(); return true; }
    if (id === 'grip') this.env.connectGrip();
    else if (id === 'music') this.toggleMusic();
    else if (id === 'book') this.showCollection = true;
    else if (id === 'closeBook') this.showCollection = false;
    else if (id === 'panel') this.togglePanel();
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
    return x < this.sceneW && !this.hit(x, y) && !this.showCollection && (this.state === 'ready' || this.state === 'pump');   // 結果畫面點一下＝繼續
  };
  G.key = function (code, down) {
    if (code === 'Space') { this.keyHeld = down; return; }
    if (!down) return;
    if (code === 'KeyM') this.toggleMusic();
    else if (code === 'KeyB') this.showCollection = !this.showCollection;
    else if (code === 'Escape') { if (this.replay) this.endReplay(); else this.showCollection = false; }
    else if (code === 'KeyR') this.togglePanel();
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

  G.cam = function () { return Math.max(CAM0, this.zR); };
  G.zoneY = function (z) { return H / 2 + (this.cam() - z) * ZONE_PX; };   // 世界高度 z 在畫面上的 y

  // ---- 背景快取：各層背景、星空、地球、月球、柔邊水珠，開始時畫一次 ----
  G.ensureArt = function () {
    if (this.art) return this.art;
    var mk = this.env.makeCanvas, art = { zone: {}, card: {}, spr: {} };
    for (var k = 0; k <= 9; k++) if (k !== 8) art.zone[k] = A.paintZone(mk, k);
    art.space = A.paintSpace(mk); art.earth = A.paintEarthTexture(mk); art.moon = A.paintMoon(mk);
    var sprites = { water: [150, 205, 255, 0.9], mist: [235, 245, 255, 0.75], bubble: [255, 255, 255, 0.85] };
    for (var n in sprites) {
      var c = mk(32, 32), x = c.getContext('2d'), col = sprites[n], g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, A.rgba(col, col[3])); g.addColorStop(0.45, A.rgba(col, col[3] * 0.6)); g.addColorStop(1, A.rgba(col, 0));
      x.fillStyle = g; x.fillRect(0, 0, 32, 32); art.spr[n] = c;
    }
    this.art = art;
    return art;
  };

  G.drawBackground = function (ctx) {
    var cam = this.cam(), t = this.time, sw = this.sceneW, art = this.ensureArt();
    A.drawSky(ctx, sw, H, cam);
    var starA = clamp((cam - 6.0) / 1.5);   // 星空與銀河（慢慢往下捲動）
    if (starA > 0) {
      var off = (cam * 40) % H;
      ctx.globalAlpha = starA;
      ctx.drawImage(art.space, 0, off - H); ctx.drawImage(art.space, 0, off);
      ctx.globalAlpha = 1;
    }
    if (cam > 5.3) A.drawEarth(ctx, sw, H, cam, art.earth);
    for (var k = Math.max(0, Math.floor(cam - 1)); k <= Math.min(10, Math.floor(cam + 1)); k++) {
      var by = this.zoneY(k), img = art.zone[k];
      if (img) {
        if (k === 9) ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 1.3);   // 極光微微閃動
        ctx.drawImage(img, this.artX + (k === 9 ? Math.sin(t * 0.4) * 12 : 0), by - A.BASE_Y);
        ctx.globalAlpha = 1;
      }
      this.drawZoneLive(ctx, k, by, t);
    }
  };
  // 會動的東西與標示（背景圖之外）
  G.drawZoneLive = function (ctx, k, by, t) {
    var rng = mulberry32(100 + k), sw = this.sceneW, ax = this.artX, i, x, y;
    if (k === 1) {   // 遠方的鳥群
      for (i = 0; i < 7; i++) {
        x = (rng() * sw + t * (18 + rng() * 14)) % (sw + 40) - 20; y = by - 200 - rng() * 160 + Math.sin(t + i) * 4;
        var flap = Math.sin(t * 9 + i * 1.7) * 3;
        ctx.strokeStyle = 'rgba(30,35,45,0.75)'; ctx.lineWidth = 1.4; ctx.beginPath();
        ctx.moveTo(x - 6, y - flap); ctx.quadraticCurveTo(x - 3, y - 2, x, y); ctx.quadraticCurveTo(x + 3, y - 2, x + 6, y - flap); ctx.stroke();
      }
    } else if (k === 2) this.label(ctx, '台北 101・508 公尺', ax + 700, by - 418);
    else if (k === 4) this.label(ctx, '玉山主峰・3,952 公尺', ax + 520, by - 372);
    else if (k === 5) {
      x = ((t * 60) % (sw + 400)) - 200; y = by - 300;
      this.drawAirliner(ctx, x, y, 1);
      this.label(ctx, '客機巡航高度約 10 公里', x, y - 30);
    } else if (k === 6) {
      this.label(ctx, '臭氧層', ax + 160, by - 250, [205, 190, 255]);
      x = ax + 650; y = by - 160 + Math.sin(t) * 6;
      this.drawBalloon(ctx, x, y, 1);
      this.label(ctx, '氣象氣球', x, y - 46);
    } else if (k === 7) {
      for (i = 0; i < 5; i++) {
        var period = 2.4 + rng() * 2.2, ph = ((t + rng() * 5) % period) / period;
        var sx = rng() * sw, sy = by - 120 - rng() * 360;
        if (ph < 0.3) this.drawMeteor(ctx, sx + ph * 160, sy + ph * 80, ph / 0.3);
      }
    } else if (k === 8) {   // 卡門線：一條發光的細線
      var lg = ctx.createLinearGradient(0, 0, sw, 0);
      lg.addColorStop(0, 'rgba(255,170,90,0)'); lg.addColorStop(0.2, 'rgba(255,170,90,0.7)'); lg.addColorStop(0.8, 'rgba(255,170,90,0.7)'); lg.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = lg; ctx.fillRect(0, by - 1, sw, 2);
      var hg = ctx.createLinearGradient(0, by - 14, 0, by + 14);
      hg.addColorStop(0, 'rgba(255,170,90,0)'); hg.addColorStop(0.5, 'rgba(255,170,90,0.12)'); hg.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = hg; ctx.fillRect(0, by - 14, sw, 28);
      this.label(ctx, '卡門線 100 公里：太空從這裡開始', sw / 2, by - 18, [255, 195, 130]);
    } else if (k === 9) {
      x = ((t * 34) % (sw + 300)) - 150; y = by - 380;
      this.drawISS(ctx, x, y, 1);
      this.label(ctx, '國際太空站・約 400 公里', x, y - 40);
    } else if (k === 10) {
      x = ax + 700; y = by - 330;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; A.glow(ctx, x, y, 110, [200, 205, 220], 0.12); ctx.restore();
      ctx.drawImage(this.art.moon, x - 80, y - 80);
      this.label(ctx, '月球・約 38 萬公里', x, y - 96);
    }
  };
  G.label = function (ctx, s, x, y, color) {   // 小標示：細字＋陰影
    this.text(ctx, s, 13, color || [235, 240, 248], x, y, { weight: 'normal' });
  };
  G.drawAirliner = function (ctx, x, y, s) {   // 側面客機＋凝結尾
    var cg = ctx.createLinearGradient(x - 60 * s, y, x - 360 * s, y);
    cg.addColorStop(0, 'rgba(255,255,255,0.7)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg; ctx.fillRect(x - 360 * s, y - 2 * s, 300 * s, 3 * s); ctx.fillRect(x - 330 * s, y + 4 * s, 270 * s, 2 * s);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    var fg = ctx.createLinearGradient(0, -7, 0, 7);
    fg.addColorStop(0, 'rgb(250,251,253)'); fg.addColorStop(0.6, 'rgb(205,210,220)'); fg.addColorStop(1, 'rgb(140,148,162)');
    polygon(ctx, [[-30, 2], [-8, 2], [-26, 14], [-34, 14]], 'rgb(150,156,168)');   // 遠側機翼
    ctx.beginPath(); ctx.moveTo(-56, -3); ctx.lineTo(42, -5); ctx.quadraticCurveTo(58, -4, 62, 1); ctx.quadraticCurveTo(58, 6, 42, 6); ctx.lineTo(-50, 5); ctx.closePath();
    ctx.fillStyle = fg; ctx.fill();
    polygon(ctx, [[-44, -3], [-56, -3], [-66, -22], [-58, -22]], 'rgb(30,70,140)');   // 垂直尾翼
    polygon(ctx, [[-48, 2], [-60, 3], [-68, 7], [-58, 7]], 'rgb(180,186,198)');
    polygon(ctx, [[-14, 3], [8, 3], [-18, 18], [-28, 18]], 'rgb(195,200,212)');   // 近側機翼
    ctx.fillStyle = 'rgb(120,126,140)'; ctx.fillRect(-12, 9, 14, 5);   // 引擎
    ctx.fillStyle = 'rgba(40,60,90,0.8)'; for (var i = 0; i < 14; i++) ctx.fillRect(-40 + i * 6, -2, 2, 2);   // 窗
    ctx.fillStyle = 'rgba(30,70,140,0.9)'; ctx.fillRect(-50, 3, 92, 1.5);
    ctx.restore();
  };
  G.drawBalloon = function (ctx, x, y, s) {   // 半透明乳膠氣象氣球
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = 'rgba(230,230,230,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, 72); ctx.stroke();
    var g = ctx.createRadialGradient(-9, -12, 3, 0, 0, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(225,228,235,0.8)'); g.addColorStop(1, 'rgba(160,165,180,0.75)');
    ctx.beginPath(); ctx.ellipse(0, 0, 26, 31, 0, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = 'rgb(220,120,50)'; ctx.fillRect(-5, 72, 10, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-5, 72, 3, 9);
    ctx.restore();
  };
  G.drawMeteor = function (ctx, x, y, k) {   // 發光流星（k：0～1 生命週期）
    var L = 60 + 120 * k, a = Math.sin(k * Math.PI);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var mg = ctx.createLinearGradient(x, y, x - L, y - L * 0.5);
    mg.addColorStop(0, 'rgba(255,245,220,' + (0.95 * a).toFixed(2) + ')'); mg.addColorStop(0.3, 'rgba(160,220,255,' + (0.45 * a).toFixed(2) + ')'); mg.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.strokeStyle = mg; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - L, y - L * 0.5); ctx.stroke();
    A.glow(ctx, x, y, 10, [255, 240, 210], 0.8 * a);
    ctx.restore();
  };
  G.drawISS = function (ctx, x, y, s) {   // 國際太空站：桁架、太陽能板、艙段
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgb(170,172,178)'; ctx.fillRect(-58, -1.5, 116, 3);   // 主桁架
    for (var i = 0; i < 4; i++) {
      var px = [-56, -38, 24, 42][i];
      for (var j = -1; j <= 1; j += 2) {
        var pg = ctx.createLinearGradient(px, 0, px + 14, 0);
        pg.addColorStop(0, 'rgb(150,110,50)'); pg.addColorStop(0.5, 'rgb(210,165,80)'); pg.addColorStop(1, 'rgb(120,85,40)');
        ctx.fillStyle = pg; ctx.fillRect(px, j < 0 ? -30 : 3, 14, 27);
        ctx.strokeStyle = 'rgba(60,40,20,0.6)'; ctx.lineWidth = 0.5;
        for (var q = 1; q < 6; q++) { ctx.beginPath(); ctx.moveTo(px, (j < 0 ? -30 : 3) + q * 4.5); ctx.lineTo(px + 14, (j < 0 ? -30 : 3) + q * 4.5); ctx.stroke(); }
      }
    }
    var mg = ctx.createLinearGradient(0, -6, 0, 6);
    mg.addColorStop(0, 'rgb(250,250,250)'); mg.addColorStop(1, 'rgb(150,152,160)');
    ctx.fillStyle = mg; ctx.fillRect(-6, -14, 12, 28); ctx.fillRect(-18, -4, 36, 8);
    ctx.fillStyle = 'rgb(225,228,235)'; ctx.fillRect(-14, 10, 6, 14); ctx.fillRect(8, 10, 6, 14);   // 散熱板
    ctx.restore();
  };

  G.drawRocket = function (ctx) {
    var r = this.rocketScreen(), s = this.state, swell = 0;
    if (s === 'pump') swell = Math.min(this.force, 60) / 60 * 3 + Math.sin(this.time * 30) * Math.min(this.force, 60) / 60 * 0.8;
    var waterLeft = s === 'flight' ? clamp(1 - this.flightT / 0.7) : 1;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(this.rocketAngle);
    A.drawRocket(ctx, swell, waterLeft, this.chute && s !== 'ready', this.time);
    ctx.restore();
  };
  G.drawPump = function (ctx) {   // 發射架、打氣筒與水管（只在地面時畫）
    var by = this.zoneY(0) - 4, s = this.state, rx = this.rocketX;
    if (by > H + 60) return;
    var stroke = this.pumpPress || 0, needle = s === 'pump' ? clamp((this.force || 0) / 65) : 0;
    ctx.strokeStyle = 'rgb(70,72,80)'; ctx.lineWidth = 3; ctx.lineCap = 'round';   // 三腳發射架
    ctx.beginPath(); ctx.moveTo(rx - 26, by + 4); ctx.lineTo(rx - 4, by - 16); ctx.moveTo(rx + 26, by + 4); ctx.lineTo(rx + 4, by - 16); ctx.moveTo(rx, by + 6); ctx.lineTo(rx, by - 16); ctx.stroke();
    ctx.fillStyle = 'rgb(50,52,58)'; ctx.fillRect(rx - 8, by - 18, 16, 6);
    A.drawPump(ctx, rx - 160, by, stroke, needle);
  };
  G.drawGauge = function (ctx) {   // 氣壓計：目前握力、各等級刻度、這位玩家的最佳
    var x = this.sceneW - 70, y = 70, w = 30, h = 330, top = 65, f = this.force || 0, i;
    roundRect(ctx, x - 5, y - 5, w + 10, h + 10, 14); ctx.fillStyle = 'rgba(10,14,24,0.72)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    var fill = clamp(f / top) * h;
    if (fill > 0) {
      var g = ctx.createLinearGradient(0, y + h, 0, y);   // 整條固定的冷→熱漸層，不對應等級
      g.addColorStop(0, 'rgb(70,150,255)'); g.addColorStop(0.35, 'rgb(60,210,220)'); g.addColorStop(0.7, 'rgb(255,200,70)'); g.addColorStop(1, 'rgb(255,100,60)');
      roundRect(ctx, x, y + h - fill, w, fill, 10); ctx.fillStyle = g; ctx.fill();
      var sh = ctx.createLinearGradient(x, 0, x + w, 0);   // 圓柱立體感
      sh.addColorStop(0, 'rgba(0,0,0,0.25)'); sh.addColorStop(0.35, 'rgba(255,255,255,0.25)'); sh.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = sh; ctx.fill();
    }
    roundRect(ctx, x + 4, y + 6, 5, h - 12, 2.5); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();   // 玻璃反光
    for (i = 10; i <= 55; i += 5) {
      var ty = y + h - i / top * h;
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x - 9, ty - 0.75, 8, 1.5);
      this.text(ctx, String(i), 12, [220, 225, 235], x - 21, ty, { weight: 'normal' });
    }
    if (this.save.best) {
      var byy = y + h - clamp(this.save.best.force / top) * h;
      polygon(ctx, [[x + w + 6, byy], [x + w + 16, byy - 6], [x + w + 16, byy + 6]], rgb(GOLD));
    }
    this.text(ctx, f.toFixed(1), 30, TEXT, x + w / 2, y - 30);
  };

  G.drawSidePanel = function (ctx) {
    var x0 = this.sceneW, i;
    if (x0 < W) {
      var bg = ctx.createLinearGradient(x0, 0, W, 0);
      bg.addColorStop(0, 'rgb(10,12,24)'); bg.addColorStop(1, 'rgb(16,18,34)');
      ctx.fillStyle = bg; ctx.fillRect(x0, 0, W - x0, H);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x0, 0, 1, H);
      this.drawButton(ctx, this.button('panel', x0 + 8, 8, 40, 36, '▶', { size: 16 }));
      this.text(ctx, '水火箭發射', 22, GOLD, x0 + 138, 26);
      var b = this.save.best;
      this.panel(ctx, x0 + 10, 52, 220, 62, 0.9);
      this.text(ctx, '最佳紀錄', 13, DIM, x0 + 120, 66, { shadow: false });
      this.text(ctx, b ? fmtAlt(b.alt) : '—', 22, GOLD, x0 + 120, 90);
      this.text(ctx, b ? '握力 ' + b.force.toFixed(1) + '・' + LEVELS[b.level].name : '還沒發射過', 12, DIM, x0 + 120, 107, { shadow: false });
      this.text(ctx, '最近 10 次', 14, TEXT, x0 + 20, 130, { align: 'left', shadow: false });
      var recs = this.save.records;
      for (i = 0; i < 10; i++) {
        var y = 148 + i * 30, r = recs[i];
        if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(x0 + 10, y - 13, 220, 28); }
        if (!r) continue;
        var isBest = b && r.alt === b.alt && r.force === b.force, L = LEVELS[r.level];
        ctx.fillStyle = rgb(L.color); ctx.fillRect(x0 + 12, y - 9, 4, 18);
        this.text(ctx, (isBest ? '★ ' : '') + r.force.toFixed(1), 14, isBest ? GOLD : TEXT, x0 + 24, y - 4, { align: 'left', shadow: false });
        this.text(ctx, fmtAlt(r.alt), 14, isBest ? GOLD : TEXT, x0 + 226, y - 4, { align: 'right', shadow: false });
        this.text(ctx, r.level ? '等級 ' + r.level + ' ' + L.name : L.name, 11, DIM, x0 + 24, y + 9, { align: 'left', shadow: false, weight: 'normal' });
      }
      this.drawButton(ctx, this.button('book', x0 + 10, 454, 106, 40, '圖鑑 ' + this.collected() + '/10', { fill: [70, 60, 140] }));
      this.drawButton(ctx, this.button('swap', x0 + 124, 454, 106, 40, this.confirmSwap > 0 ? '確定換人？' : '換人挑戰',
        this.confirmSwap > 0 ? { fill: [215, 55, 60], ink: [255, 255, 255] } : {}));
      this.text(ctx, '版本 ' + VERSION, 11, DIM, x0 + 230, H - 12, { align: 'right', shadow: false, weight: 'normal' });
    }
    if (this.panelK > 0.98) {   // 收合時：右緣的「紀錄」小標籤
      var tb = this.button('panel', W - 40, 190, 40, 120, '');
      roundRect(ctx, tb.x, tb.y, tb.w + 14, tb.h, 12); ctx.fillStyle = 'rgba(14,16,30,0.78)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      this.text(ctx, '◀', 14, GOLD, W - 20, 212, { shadow: false });
      this.text(ctx, '紀', 17, TEXT, W - 20, 240, { shadow: false });
      this.text(ctx, '錄', 17, TEXT, W - 20, 262, { shadow: false });
      this.text(ctx, this.collected() + '/10', 11, DIM, W - 20, 290, { shadow: false, weight: 'normal' });
      this.text(ctx, '版本 ' + VERSION, 11, [210, 215, 225], W - 10, H - 12, { align: 'right', weight: 'normal' });
    }
  };

  G.drawHints = function (ctx) {
    var s = this.state, f = this.force || 0, cx = this.sceneW / 2;
    if (s === 'ready' || s === 'pump') {
      this.drawButton(ctx, this.button('music', 12, 12, 116, 36, this.save.music ? '♪ 音樂：開' : '♪ 音樂：關'));
      var g = this.env.grip;
      this.drawButton(ctx, this.button('grip', 136, 12, 190, 36, g.connected ? '✔ 已連線（點此重連）' : this.env.bluetoothSupported ? '連接握力球' : '此瀏覽器不支援藍牙',
        g.connected ? { ink: GREEN } : {}));
      if (this.panelK > 0.98) {   // 紀錄欄收起時，最佳紀錄放在按鈕旁
        var b = this.save.best;
        this.text(ctx, '最佳 ' + (b ? fmtAlt(b.alt) : '—'), 15, GOLD, 340, 30, { align: 'left' });
      }
    }
    if (s === 'ready') {
      this.panel(ctx, cx - 210, 70, 420, 64, 0.6);
      this.text(ctx, '握緊握力球打氣，放開就發射！', 22, TEXT, cx, 92);
      this.text(ctx, '至少握住 1 秒・放開那一刻的握力決定高度', 14, [200, 200, 215], cx, 118, { shadow: false });
    } else if (s === 'pump') {
      var ok = this.pumpT >= PUMP_MIN;   // 打氣時不透露會飛到哪一層，留到發射後揭曉
      this.panel(ctx, cx - 210, 70, 420, 82, 0.65);
      this.text(ctx, ok ? '✔ 可以放開了！' : '打氣中… ' + this.pumpT.toFixed(1) + ' / 1.0 秒', 22, ok ? GREEN : GOLD, cx, 94);
      this.text(ctx, ok ? '放開那一刻的握力決定高度，會飛到哪裡呢？' : '繼續握緊，打足氣再放開', 16, [205, 210, 225], cx, 124);
      roundRect(ctx, cx - 160, 140, 320, 6, 3); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
      roundRect(ctx, cx - 160, 140, 320 * clamp(this.pumpT / PUMP_MIN), 6, 3); ctx.fillStyle = rgb(ok ? GREEN : GOLD); ctx.fill();
    }
    var gs = this.env.grip;
    this.text(ctx, gs.status, 13, gs.connected ? GREEN : [225, 228, 235], 12, H - 14, { align: 'left' });
  };

  G.drawResult = function (ctx) {
    var L = LEVELS[this.level], k = easeOutBack(clamp(this.stateT / 0.4));
    ctx.save(); ctx.translate(this.sceneW / 2, 250); ctx.scale(k, k);
    this.panel(ctx, -230, -130, 460, this.newUnlock ? 260 : 230, 0.8);
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

  // 圖鑑卡片上方的小圖：用同一套背景縮小畫（每張畫一次後快取）
  var CARD_VIEW = { 1: [440, 300], 2: [640, 260], 3: [480, 300], 4: [520, 250], 5: [480, 300], 6: [600, 260], 7: [480, 340], 8: [480, 300], 9: [480, 320], 10: [700, 330] };
  G.cardArt = function (i) {
    var art = this.ensureArt();
    if (art.card[i]) return art.card[i];
    var cw = 164, ch = 100, c = this.env.makeCanvas(cw, ch), x = c.getContext('2d'), v = CARD_VIEW[i], sc = 3;
    x.save(); x.scale(1 / sc, 1 / sc);   // 在 3 倍大的座標裡畫，再縮小
    var vw = cw * sc, vh = ch * sc, sx = v[0] - vw / 2, sy = A.BASE_Y - v[1] - vh / 2, by = A.BASE_Y - sy;
    A.drawSky(x, vw, vh, i + 0.5);
    if (i >= 7) x.drawImage(art.space, 0, 0, vw, vh);
    if (i >= 6) A.drawEarth(x, vw, vh, i + 0.6, art.earth);
    if (art.zone[i]) x.drawImage(art.zone[i], -sx, -sy);
    if (i === 3 && art.zone[4]) x.drawImage(art.zone[4], -sx, -sy - ZONE_PX);
    var mx = vw / 2, my = vh * 0.42;
    if (i === 5) this.drawAirliner(x, mx, my, 2);
    else if (i === 6) this.drawBalloon(x, mx + 120, my, 2.2);
    else if (i === 7) { this.drawMeteor(x, mx + 60, my - 20, 0.5); this.drawMeteor(x, mx - 120, my + 50, 0.4); }
    else if (i === 8) { x.fillStyle = 'rgba(255,170,90,0.8)'; x.fillRect(0, by - 2, vw, 4); }
    else if (i === 9) this.drawISS(x, mx, my - 30, 2.4);
    else if (i === 10) x.drawImage(art.moon, mx - 160, my - 160, 320, 320);
    x.restore();
    var sh = x.createLinearGradient(0, ch * 0.45, 0, ch);   // 底部變暗，讓名稱看得清楚
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.65)');
    x.fillStyle = sh; x.fillRect(0, 0, cw, ch);
    art.card[i] = c;
    return c;
  };
  G.drawCollection = function (ctx) {
    ctx.fillStyle = 'rgba(5,6,14,0.9)'; ctx.fillRect(0, 0, W, H);
    this.text(ctx, '圖鑑　' + this.collected() + ' / 10', 26, GOLD, W / 2, 34);
    this.text(ctx, '大家一起收集：飛到哪一層就解鎖那一張・點已解鎖的卡片看飛行過程', 14, DIM, W / 2, 62, { shadow: false });
    for (var i = 1; i <= 10; i++) {
      var col = (i - 1) % 5, row = Math.floor((i - 1) / 5), x = 40 + col * 180, y = 86 + row * 196, L = LEVELS[i], got = !!this.save.collection[i];
      roundRect(ctx, x, y, 164, 182, 12);
      ctx.fillStyle = got ? 'rgb(22,24,38)' : 'rgb(30,30,44)'; ctx.fill();
      if (got) {
        this.button('card' + i, x, y, 164, 182, '');
        ctx.save(); roundRect(ctx, x, y, 164, 182, 12); ctx.clip();
        ctx.drawImage(this.cardArt(i), x, y);
        ctx.restore();
        this.text(ctx, L.name, L.name.length > 6 ? 15 : 18, TEXT, x + 82, y + 84);
        this.text(ctx, '約 ' + fmtAlt(L.alt[0]) + (i < 10 ? ' 起' : ' 以上'), 13, L.color, x + 82, y + 114, { shadow: false });
        var lines = this.wrap(ctx, L.desc, 144, 'normal 12px ' + FONT);
        for (var j = 0; j < lines.length && j < 3; j++) this.text(ctx, lines[j], 12, [215, 218, 228], x + 82, y + 134 + j * 16, { weight: 'normal', shadow: false });
        ctx.save(); ctx.globalAlpha = 0.85;   // 播放鍵
        ctx.beginPath(); ctx.arc(x + 146, y + 18, 11, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
        polygon(ctx, [[x + 142, y + 12], [x + 142, y + 24], [x + 152, y + 18]], 'rgb(255,255,255)');
        ctx.restore();
      } else {
        this.text(ctx, '?', 48, DIM, x + 82, y + 80);
        this.text(ctx, '握力 ' + L.lo + (i < 10 ? '～' + (L.hi - 1) : ' 以上'), 14, DIM, x + 82, y + 140, { shadow: false });
      }
      roundRect(ctx, x, y, 164, 182, 12);
      ctx.strokeStyle = got ? rgb(L.color) : 'rgba(255,255,255,0.12)'; ctx.lineWidth = got ? 2.5 : 1.5; ctx.stroke();
      this.text(ctx, String(i), 16, got ? L.color : DIM, x + 18, y + 18);
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
    var sw = this.sceneW, cx = sw / 2, art = this.ensureArt();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, sw, H); ctx.clip();
    this.drawBackground(ctx);
    this.drawPump(ctx);
    for (var i = 0; i < this.particles.length; i++) {   // 水柱、水花：柔邊水珠
      var p = this.particles[i], spr = art.spr[p.c] || art.spr.water;
      ctx.globalAlpha = clamp(p.life / p.max * 1.5);
      ctx.drawImage(spr, p.x - p.r * 1.6, p.y - p.r * 1.6, p.r * 3.2, p.r * 3.2);
    }
    ctx.globalAlpha = 1;
    this.drawRocket(ctx);
    if (this.state === 'ready' || this.state === 'pump') this.drawGauge(ctx);
    if (this.banner) {
      var a = clamp(this.banner.t / 0.3);
      this.panel(ctx, cx - 200, 60, 400, 64, 0.65 * a);
      this.text(ctx, this.banner.s, 24, this.banner.color, cx, 84, { alpha: a });
      this.text(ctx, this.banner.sub, 14, TEXT, cx, 110, { alpha: a, shadow: false });
    }
    if (this.state === 'flight' && this.level > 0) {   // 即時高度
      var z = this.zR, lv = Math.min(10, Math.floor(z)), frac = clamp(z - lv);
      var L = LEVELS[Math.max(1, lv)], cur = lv === 0 ? lerp(0, LEVELS[1].alt[0], frac) : L.alt[0] * Math.pow((lv < 10 ? L.alt[1] : this.altitude) / L.alt[0], clamp((frac - 0.05) / 0.85));
      this.text(ctx, fmtAlt(Math.min(cur, this.altitude)), 30, TEXT, sw - 120, H - 40);
    }
    this.drawHints(ctx);
    if (this.replay) {
      var RL = LEVELS[this.replay];
      this.panel(ctx, 12, 12, 300, 40, 0.6);
      this.text(ctx, '圖鑑重播・等級 ' + this.replay + ' ' + RL.name, 16, RL.color, 162, 32, { shadow: false });
      this.drawButton(ctx, this.button('skipReplay', sw - 112, 12, 100, 36, '跳過 ✕', { size: 15 }));
      if (this.state === 'result') {
        var ra = clamp(this.stateT / 0.3);
        this.panel(ctx, cx - 180, 200, 360, 70, 0.75 * ra);
        this.text(ctx, '抵達 ' + RL.name, 26, RL.color, cx, 224, { alpha: ra });
        this.text(ctx, '約 ' + fmtAlt(this.altitude), 15, TEXT, cx, 254, { alpha: ra, shadow: false });
      }
    } else if (this.state === 'result') this.drawResult(ctx);
    if (this.toast) this.text(ctx, this.toast.s, 22, this.toast.color, cx, 200, { alpha: clamp(this.toast.t / 0.4) });
    ctx.restore();
    this.drawSidePanel(ctx);
    if (this.showCollection) this.drawCollection(ctx);
  };

  var api = { VERSION: VERSION, Game: Game, W: W, H: H, LEVELS: LEVELS, levelOf: levelOf, altitudeOf: altitudeOf, fmtAlt: fmtAlt };
  root.RocketGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
