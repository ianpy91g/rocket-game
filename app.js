/* 水火箭發射（網頁版）— 頁面啟動：畫面縮放、觸控、Web Bluetooth 握力球、存檔。 */
(function () {
  'use strict';
  var SERVICE = '0000ffb0-0000-1000-8000-00805f9b34fb';
  var FORCE_CHAR = '0000ffb2-0000-1000-8000-00805f9b34fb';
  var W = RocketGame.W, H = RocketGame.H;
  var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  var scale = 1, dpr = 1;

  var grip = { force: 0, rising: false, connected: false, status: '' };
  var bt = !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  grip.status = bt ? '尚未連接握力球　·　沒有握力球時按住畫面也能玩'
                   : '這個瀏覽器不支援藍牙（iPad 請用 Bluefy 開啟）　·　按住畫面也能玩';

  var storage = {
    get: function () { try { return localStorage.getItem('rocketGame.v1'); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem('rocketGame.v1', v); } catch (e) { } }
  };

  // ---------- 握力球（Web Bluetooth） ----------
  var device = null, retryTimer = null;
  function parse(dv) {
    var s = '';
    for (var i = 0; i < dv.byteLength; i++) s += String.fromCharCode(dv.getUint8(i));
    s = s.trim();
    // 格式："19" + 方向(1=用力/0=放鬆) + 握力值，例如 "19128.0"
    if (s.length < 4 || s.slice(0, 2) !== '19') return;
    var v = parseFloat(s.slice(3));
    if (!isNaN(v)) { grip.rising = s.charAt(2) === '1'; grip.force = v; }
  }
  // iPad (CoreBluetooth) 的連線請求不會自己逾時：握力球休眠時 gatt.connect() 會永遠等下去。
  // 所以每一步都加時間限制，逾時就取消；並用 attemptId 讓新的嘗試取代舊的，舊的結果一律忽略。
  var attemptId = 0, busy = false, lastUserTap = 0, chooseNext = false;
  function errText(e) { return e ? (e.name || '') + ' ' + (e.message || e) : '未知錯誤'; }
  function withTimeout(p, ms, what) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject({ name: 'Timeout', message: what + '超過 ' + ms / 1000 + ' 秒沒有回應' }); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function cancelPending(dev) {   // 斷開＝取消還在等的連線請求
    try { if (dev) dev.gatt.disconnect(); } catch (e) { }
  }
  function attach(dev, id) {
    busy = true;
    grip.status = '連線中…';
    var current = function () { if (id !== attemptId) throw { name: 'Superseded', message: '已被新的連線取代' }; };
    return withTimeout(dev.gatt.connect(), 10000, '連線')
      .then(function (server) { current(); return withTimeout(server.getPrimaryService(SERVICE), 6000, '讀取服務'); })
      .then(function (svc) { current(); return withTimeout(svc.getCharacteristic(FORCE_CHAR), 6000, '讀取握力通道'); })
      .then(function (ch) {
        current();
        ch.addEventListener('characteristicvaluechanged', function (e) { parse(e.target.value); });
        return withTimeout(ch.startNotifications(), 6000, '開始接收握力');
      })
      .then(function () {
        current();
        busy = false; chooseNext = false;
        grip.connected = true;
        grip.status = '已連線 ' + (dev.name || '握力球');
      }, function (e) {
        if (id === attemptId) { busy = false; cancelPending(dev); }
        throw e;
      });
  }
  function reconnect() {   // 斷線後在背景自動重連
    clearTimeout(retryTimer);
    if (!device || grip.connected) return;
    if (busy || Date.now() - lastUserTap < 15000) { retryTimer = setTimeout(reconnect, 3000); return; }
    var id = ++attemptId;
    attach(device, id).catch(function (e) {
      if (id !== attemptId) return;
      grip.status = '握力球斷線，重新連線中…（捏一下喚醒它，或按「連接握力球」）';
      retryTimer = setTimeout(reconnect, 4000);
    });
  }
  function onDisconnected() {
    grip.connected = false; grip.force = 0;
    if (busy) return;   // 正在連線中（例如使用者按了重連，是我們自己斷開的）：不插手
    grip.status = '握力球斷線，重新連線中…（捏一下喚醒它）';
    clearTimeout(retryTimer);
    retryTimer = setTimeout(reconnect, 1500);
  }
  function hook(dev) {
    if (!dev._rocketHooked) { dev._rocketHooked = true; dev.addEventListener('gattserverdisconnected', onDisconnected); }
  }
  function connectGrip() {   // 必須在使用者觸碰的事件裡呼叫（requestDevice 需要使用者手勢）
    if (!bt) { grip.status = '這個瀏覽器不支援藍牙：iPad 請安裝 Bluefy 並用它開啟本網址'; return; }
    clearTimeout(retryTimer);
    lastUserTap = Date.now();
    var id = ++attemptId;   // 使用者按的永遠優先：舊的嘗試作廢
    busy = false;
    grip.connected = false; grip.force = 0;
    cancelPending(device);
    if (device && !chooseNext) {
      // 之前選過這顆球：直接重連，不用再選（握力球休眠時 iPad 不一定會通知斷線，所以先斷開再連）
      attach(device, id).catch(function (e) {
        if (id !== attemptId) return;
        chooseNext = true;   // 下次按就跳出選擇清單
        grip.status = '重連失敗（' + errText(e) + '）：捏一下喚醒握力球，再按一次「連接握力球」';
      });
      return;
    }
    grip.status = '請在清單選擇 weixin- 握力球（清單空白：關掉握力球電源再開，或重開 Bluefy）';
    // 名稱 或 廣播中的服務代碼 任一符合就列出
    var opts = { filters: [{ namePrefix: 'weixin' }, { services: [SERVICE] }], optionalServices: [SERVICE] };
    navigator.bluetooth.requestDevice(opts)
      .then(function (dev) {
        if (id !== attemptId) return;
        device = dev; hook(dev);
        return attach(dev, id);
      })
      .catch(function (e) {
        if (id !== attemptId) return;
        busy = false;
        grip.status = e && e.name === 'NotFoundError'
          ? '沒有選到握力球（' + errText(e) + '）：捏一下喚醒握力球再試一次'
          : '連線失敗：' + errText(e);
      });
  }

  // 重新整理網頁時，藍牙連線是 Bluefy 在底層維持的，不會跟著網頁消失：
  // 握力球仍連著 iPad、停止廣播，新網頁的選擇清單就找不到它。所以離開網頁前主動斷線釋放。
  function release() {
    attemptId++;
    clearTimeout(retryTimer);
    cancelPending(device);
  }
  window.addEventListener('pagehide', release);
  window.addEventListener('beforeunload', release);

  // 網頁一打開就找回之前授權過的握力球（瀏覽器支援 getDevices 時），不用再跳選擇清單；
  // 就算舊連線還卡在底層，對同一個裝置 connect() 也能直接沿用
  if (bt && navigator.bluetooth.getDevices) {
    navigator.bluetooth.getDevices().then(function (list) {
      var dev = null;
      for (var i = 0; i < list.length; i++) if ((list[i].name || '').indexOf('weixin') === 0) dev = list[i];
      if (!dev || device) return;
      device = dev; hook(dev);
      var id = ++attemptId;
      grip.status = '找到之前連過的 ' + (dev.name || '握力球') + '，自動連線中…';
      attach(dev, id).catch(function (e) {
        if (id !== attemptId) return;
        grip.status = '自動連線失敗（' + errText(e) + '）：捏一下握力球，再按「連接握力球」';
      });
    }, function () { /* 不支援或沒有授權過的裝置 */ });
  }

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  var game = new RocketGame.Game({ grip: grip, storage: storage, audio: null, connectGrip: connectGrip,
                                bluetoothSupported: bt, makeCanvas: makeCanvas });

  // ---------- 音效：iOS 要在第一次觸碰時建立 ----------
  var audioReady = false;
  function unlockAudio() {
    if (audioReady) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      var ac = new AC();
      var b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource();
      s.buffer = b; s.connect(ac.destination); s.start(0);
      if (ac.resume) ac.resume();
      game.setAudio(ac);
      audioReady = true;
    } catch (e) { }
  }

  // ---------- 畫面縮放（等比例，文字依實際解析度繪製所以清晰） ----------
  function resize() {
    var vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / W, vh / H);
    // Retina 最多用 1.5 倍解析度：畫面幾乎看不出差別，iPad Air 2 的繪圖量少一半
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var cw = Math.round(W * scale), ch = Math.round(H * scale);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.style.marginLeft = (-cw / 2) + 'px'; canvas.style.marginTop = (-ch / 2) + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    game.pixelScale = scale * dpr;   // 快取圖依實際像素倍率繪製
    document.getElementById('rotate').style.display = vh > vw * 1.1 && !resize.dismissed ? 'flex' : 'none';
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 300); });
  document.getElementById('rotate').addEventListener('click', function () { resize.dismissed = true; resize(); });
  resize();

  function toLogical(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  }

  // ---------- 觸控：遊戲中按住畫面＝握住；其他畫面點按鈕 ----------
  var holdTouches = {};
  function updateHeld() { game.held = Object.keys(holdTouches).length > 0; }
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    unlockAudio();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], p = toLogical(t.clientX, t.clientY);
      if (game.pointerInPlayArea(p.x, p.y)) holdTouches[t.identifier] = true;
    }
    updateHeld();
  }, { passive: false });
  function touchEnd(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], p = toLogical(t.clientX, t.clientY);
      if (holdTouches[t.identifier]) delete holdTouches[t.identifier];
      else if (e.type === 'touchend') game.tap(p.x, p.y);   // 觸控事件本身就算使用者手勢，可以在這裡要求藍牙
    }
    updateHeld();
  }
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  canvas.addEventListener('touchcancel', touchEnd, { passive: false });

  // 滑鼠（電腦上測試用）
  var mouseHold = false;
  canvas.addEventListener('mousedown', function (e) {
    unlockAudio();
    var p = toLogical(e.clientX, e.clientY);
    if (game.pointerInPlayArea(p.x, p.y)) { mouseHold = true; game.held = true; }
  });
  window.addEventListener('mouseup', function (e) {
    if (mouseHold) { mouseHold = false; game.held = false; return; }
    if (e.target === canvas) { var p = toLogical(e.clientX, e.clientY); game.tap(p.x, p.y); }
  });
  window.addEventListener('keydown', function (e) {
    unlockAudio();
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) game.key(e.code, true);
  });
  window.addEventListener('keyup', function (e) { game.key(e.code, false); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });   // 防止雙指縮放

  // ---------- 主迴圈 ----------
  var last = 0;
  function frame(t) {
    var dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
    last = t;
    game.update(dt);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    game.draw(ctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
