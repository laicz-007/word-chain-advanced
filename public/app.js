/* 单词接龙 前端（薄客户端）：只调服务端 API，不含词库/规则 */
'use strict';

(function () {
  var mode = 'pve';
  var sessionId = null;
  var playerConfig = null;      // 记住当前对局玩家配置(重开用)
  var state = null;             // 最近一次服务端快照
  var busy = false;
  var pendingWord = null;       // 待确认的非词库词
  var op = null;                // 乐观显示：等待 AI 时 {word}

  // 提示/报告/里程碑(localStorage) —— 游客用
  var SEEN_KEY = 'wc_seen', BEST_KEY = 'wc_best', HIST_KEY = 'wc_games', TOKEN_KEY = 'wc_token';
  var seenSet = loadSet(SEEN_KEY);   // 历史上见过的词(跨会话累计)
  var seenStart = new Set();         // 本局开始的 seen 快照(用于"新词")
  var roundBest = 0;                 // 本局最长接龙
  var localBest = loadBest();        // 游客历史纪录(localStorage)
  var allBest = localBest;           // 历史纪录(显示用)
  var hintUsed = 0;                  // 本轮已用提示次数
  var lastRoundSeen = 0;             // 记录本轮以便重置提示计数
  var history = loadHistory();       // 游客已结束对局记录(记录区)
  var authToken = loadAuthToken();   // 登录 token(网站版)
  var account = null;                // 账户数据(服务端): {username, games, best, seen, profile}
  var registerMode = false;          // 登录页：false=登录, true=注册(需确认密码)

  // 联机房间（多设备服务器版）状态
  var onlineActive = false;          // 是否在房间中
  var roomId = null;
  var roomSeq = -1;
  var roomPollTimer = null;
  var roomIsHost = false;
  var roomStatus = null;
  var myName = null;                 // 我在房间中的账户名
  var myTurn = false;
  var turnDeadline = null;          // 联机：当前回合超时时间戳(用于倒计时)
  var localDeadline = null;         // 本地倒计时基准(避免服务器/浏览器时钟不同步导致的跳变)
  var countdownTimer = null;        // 倒计时本地刷新计时器
  var myLocalIdx = -1;              // 本地同屏"统计我的出词"：我的玩家下标(-1=不统计)
  var shopCatalogCache = null;      // 商店目录缓存
  var shopQuota = 3;                // 每局道具使用上限（服务端下发）
  var ITEM_KINDS = [
    { kind: 'skip', name: '跳过卡', desc: '跳过本次接龙（不算认输，直接轮到下一位）' },
    { kind: 'swap', name: '修改卡', desc: '把你要接的词换成另一个更好接的词（可接指数更高）' },
    { kind: 'reverse', name: '反转卡', desc: '倒转出词顺序（词接法不变），自身本轮免接' }
  ];

  function loadSet(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch (e) { return new Set(); } }
  function saveSet(k, s) { try { localStorage.setItem(k, JSON.stringify(Array.from(s))); } catch (e) {} }
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }
  function saveHistory() { try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch (e) {} }
  function loadBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; } }
  function loadAuthToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setAuthToken(t) { authToken = t || ''; try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function loggedIn() { return !!(authToken && account && account.username); }

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function api(path, body) {
    // 单文件离线版：使用本地引擎；否则走服务端 API
    if (window.__LOCAL_GAME__) {
      if (path === '/api/start') return window.__LOCAL_GAME__.start(body || {});
      if (path === '/api/hint') return window.__LOCAL_GAME__.hint(body || {});
      return window.__LOCAL_GAME__.action(body || {});
    }
    var b = body || {};
    if (authToken) b.token = authToken;   // 登录态随请求带上（服务端据此绑定账户）
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b)
    }).then(function (r) {
      return r.json().then(function (j) {
        j._http = r.status;
        // 服务端在每次动作后回传账户最新积分 → 实时刷新（只此一处，覆盖所有动作入口）
        if (j && j.accountPoints != null && account) { account.points = j.accountPoints; renderAccountBar(); }
        return j;
      });
    });
  }

  // 快速查词(供乐观显示"我出的词"释义, 不参与AI思考)
  function lookup(word) {
    if (window.__LOCAL_GAME__) return window.__LOCAL_GAME__.lookup(word);
    return fetch('/api/lookup?word=' + encodeURIComponent(word)).then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  function fillOpInfo(word) {
    if (!op || op.word !== word) return;
    lookup(word).then(function (info) { if (op && op.word === word) { op.info = info || {}; render(); } });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    wireSetup();
    wireTheme();
    $('start-btn').addEventListener('click', startGame);
    $('submit-btn').addEventListener('click', function () { onSubmit(false); });
    $('word-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') onSubmit(false); });
    $('concede-btn').addEventListener('click', onConcede);
    $('restart-btn').addEventListener('click', onRestart);
    $('back-btn').addEventListener('click', onBack);
    $('hint-btn').addEventListener('click', function () { onHint(); });
    $('confirm-yes').addEventListener('click', function () { confirmYes(); });
    $('confirm-no').addEventListener('click', function () { confirmNo(); });
    $('ai-confirm-go').addEventListener('click', function () { continueRound(); });
    $('report-proceed').addEventListener('click', closeReport);
    $('last-word').addEventListener('click', onPanelClick);
    $('log-list').addEventListener('click', onPanelClick);  // 对战记录里的 🔊/提示 也要能响应
    renderPvpNames();
    wireAuth();
    initGate();          // 网站版先出"登录/注册"门，离线版直接进游戏
    renderProfileBox();
    loadAuthSession();   // 既有 token → 拉取账户数据
  }

  /* ---------- 账号：注册/登录/退出/账户数据 ---------- */
  function fetchJSON(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { j._http = r.status; return j; }); });
  }
  function wireAuth() {
    if (window.__LOCAL_GAME__) { if ($('auth')) $('auth').classList.add('hidden'); if ($('account-bar')) $('account-bar').classList.add('hidden'); return; } // 离线单文件：无账号
    $('login-tab').addEventListener('click', function () { setAuthMode(false); });
    $('register-tab').addEventListener('click', function () { setAuthMode(true); });
    $('auth-submit').addEventListener('click', onAuthSubmit);
    $('auth-guest-go').addEventListener('click', onAuthGuest);
    $('account-bar-action').addEventListener('click', onAccountBarAction);
    $('account-bar-pw').addEventListener('click', openPwModal);
    $('account-bar-shop').addEventListener('click', openShop);
    $('shop-close').addEventListener('click', closeShop);
    $('pw-submit').addEventListener('click', onSubmitPw);
    $('pw-cancel').addEventListener('click', closePwModal);
    ['pw-old', 'pw-new', 'pw-new2'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') onSubmitPw(); });
    });
    $('auth-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') onAuthSubmit(); });
    $('auth-pass2').addEventListener('keydown', function (e) { if (e.key === 'Enter') onAuthSubmit(); });
    $('auth-user-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') onAuthSubmit(); });
  }
  function authMsg(m) {
    var el = $('auth-msg');
    if (!el) return;
    el.textContent = m || '';
    el.classList.toggle('err', /错误|存在|失败|过期|不一致/.test(m || ''));
  }
  // 登录/注册 切换
  function setAuthMode(reg) {
    registerMode = reg;
    $('login-tab').classList.toggle('active', !reg);
    $('register-tab').classList.toggle('active', reg);
    $('auth-pass2-row').classList.toggle('hidden', !reg);
    $('auth-submit').textContent = reg ? '注册' : '登录';
    $('auth-pass').placeholder = reg ? '4-64 位（注册）' : '4-64 位';
    authMsg('');
  }
  function onAuthSubmit() {
    if (registerMode) onAuthRegister();
    else onAuthLogin();
  }
  // 【两页切换】登录页(#auth) ↔ 游玩页(#setup + #log + #account-bar)
  function showGate() {                      // 显示登录页，隐藏游玩页
    if (window.__LOCAL_GAME__) return;
    $('app-header').classList.add('hidden');
    $('auth').classList.remove('hidden');
    $('setup').classList.add('hidden');
    $('game').classList.add('hidden');
    $('log').classList.add('hidden');
    $('account-bar').classList.add('hidden');
  }
  function enterGame() {                     // 隐藏登录页，显示游玩页
    $('app-header').classList.remove('hidden');
    $('auth').classList.add('hidden');
    $('setup').classList.remove('hidden');
    $('log').classList.remove('hidden');
    renderAccountBar();
    renderSetup();                          // 登录后即刻按身份渲染（隐藏昵称/显示身份等）
  }
  function renderAccountBar() {
    if (window.__LOCAL_GAME__) { $('account-bar').classList.add('hidden'); return; }
    if (authToken && !account) { $('account-bar').classList.add('hidden'); return; }  // 账户信息加载中
    var logged = loggedIn();
    $('account-bar').classList.remove('hidden');
    if (logged) {
      // 用 innerHTML 以便高亮积分；用户名必须转义（esc）
      $('account-bar-text').innerHTML = '已登录：' + esc(account.username) +
        '　<b class="pts">积分 ' + ((account && account.points) || 0) + '</b>';
    } else {
      $('account-bar-text').textContent = '游客身份（数据仅存本浏览器）';
    }
    $('account-bar-action').textContent = logged ? '退出' : '登录';
    $('account-bar-pw').classList.toggle('hidden', !logged);   // 只有登录用户才显示"修改密码"
    $('account-bar-shop').classList.toggle('hidden', !logged); // 商店同理（道具要用积分买）
  }
  function onAccountBarAction() {
    if (loggedIn()) onAuthLogout();                          // 退出 → 回登录页
    else { account = null; authMsg(''); showGate(); }        // 游客 → 去登录页
  }

  /* ---- 修改密码 ---- */
  function pwMsg(m, err) {
    var el = $('pw-msg');
    if (!el) return;
    el.textContent = m || '';
    el.classList.toggle('err', !!err);
  }
  function openPwModal() {
    if (!loggedIn()) return;
    $('pw-old').value = ''; $('pw-new').value = ''; $('pw-new2').value = '';
    pwMsg('');
    $('pw-modal').classList.remove('hidden');
    setTimeout(function () { $('pw-old').focus(); }, 0);
  }
  function closePwModal() {
    $('pw-modal').classList.add('hidden');
    pwMsg('');
  }
  function onSubmitPw() {
    var oldPw = $('pw-old').value, newPw = $('pw-new').value, newPw2 = $('pw-new2').value;
    if (!oldPw) { pwMsg('请输入原密码', true); return; }
    if (!newPw || newPw.length < 4) { pwMsg('新密码需 4-64 位', true); return; }
    if (newPw !== newPw2) { pwMsg('两次输入的新密码不一致', true); return; }
    if (newPw === oldPw) { pwMsg('新密码不能与原密码相同', true); return; }
    pwMsg('提交中…');
    fetchJSON('/api/change-password', 'POST', { token: authToken, oldPassword: oldPw, newPassword: newPw })
      .then(function (res) {
        if (res.error) { pwMsg('✗ ' + res.error, true); return; }
        // 改密后旧 token 已失效，必须保存服务端下发的新 token，否则本设备会被踢下线
        if (res.token) setAuthToken(res.token);
        closePwModal();
        setMsg('✓ 密码已修改，其他设备的登录已失效。', 'info');
      })
      .catch(function () { pwMsg('✗ 网络错误，请重试', true); });
  }
  function initGate() {                       // 决定首次进入哪一页
    if (window.__LOCAL_GAME__) {              // 离线：直接游玩页
      if ($('auth')) $('auth').classList.add('hidden');
      if ($('account-bar')) $('account-bar').classList.add('hidden');
      if ($('app-header')) $('app-header').classList.remove('hidden');
      $('setup').classList.remove('hidden');
      $('log').classList.remove('hidden');
      return;
    }
    if (authToken) enterGame();               // 网站 + 已登录：直接游玩页
    else showGate();                          // 网站 + 未登录：登录页
  }
  function onAuthGuest() {
    account = null;
    authMsg('');
    enterGame();
  }
  function applyLogin(res) {
    if (!res || !res.token || !res.username) { authMsg('登录失败'); return; }
    setAuthToken(res.token);
    account = { username: res.username, games: [], best: 0, seen: [], profile: res.profile || null };
    authMsg('');
    applyAccountLocal();
    enterGame();
    renderProfileBox();
    loadAccount().then(function () { renderAccountBar(); renderRecords(); renderProfileBox(); });
  }
  function onAuthLogin() {
    var u = ($('auth-user-in').value || '').trim(), p = $('auth-pass').value;
    if (!u || !p) { authMsg('请输入用户名和密码'); return; }
    fetchJSON('/api/login', 'POST', { username: u, password: p }).then(function (res) {
      if (res.error) { authMsg(res.error); return; }
      applyLogin(res);
    });
  }
  function onAuthRegister() {
    var u = ($('auth-user-in').value || '').trim(), p = $('auth-pass').value, p2 = $('auth-pass2').value;
    if (!u || !p) { authMsg('请输入用户名和密码'); return; }
    if (p !== p2) { authMsg('两次输入的密码不一致'); return; }
    fetchJSON('/api/register', 'POST', { username: u, password: p }).then(function (res) {
      if (res.error) { authMsg(res.error); return; }
      applyLogin(res);
    });
  }
  function onAuthLogout() {
    setAuthToken('');
    account = null;
    // 回到游客本地数据视图
    seenSet = loadSet(SEEN_KEY);
    allBest = loadBest();
    history = loadHistory();
    sessionId = null; state = null; op = null;
    stopRoomPolling();
    roomId = null; onlineActive = false; myName = null; myTurn = false; roomIsHost = false; roomStatus = null; roomSeq = -1;
    $('game').classList.add('hidden');
    hideConfirm();
    renderProfileBox();
    renderRecords();
    authMsg('');
    $('auth-user-in').value = ''; $('auth-pass').value = ''; $('auth-pass2').value = '';
    setAuthMode(false);
    showGate();
  }
  function loadAccount() {
    if (!authToken) { account = null; return Promise.resolve(null); }
    return fetch('/api/me?token=' + encodeURIComponent(authToken))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok && res.username) {
          account = { username: res.username, games: res.games || [], best: res.best || 0, seen: res.seen || [], points: res.points || 0, items: res.items || {}, profile: res.profile || null };
          applyAccountLocal();
        } else { account = null; setAuthToken(''); }
        return account;
      })
      .catch(function () { account = null; return null; });
  }
  // 登录后：视图数据切到账户（不做游客本地数据归并）
  function applyAccountLocal() {
    if (!account) return;
    seenSet = new Set(account.seen || []);
    allBest = account.best || 0;
  }
  function loadAuthSession() {
    if (!authToken) { account = null; renderProfileBox(); renderRecords(); return; }
    loadAccount().then(function () {
      renderAccountBar(); renderRecords(); renderProfileBox();
      if (loggedIn()) enterGame();   // 令牌有效：登录页→游玩页
      else showGate();               // 令牌失效：退回登录页
    });
  }

  /* ---------- 联机房间（多设备服务器版） ---------- */
  function onlineModeAvail() { return !window.__LOCAL_GAME__ && loggedIn(); }
  function onlineMsg(m) { var el = $('online-msg'); if (el) el.textContent = m || ''; }
  function roomGetState() {
    return fetch('/api/room/state?token=' + encodeURIComponent(authToken) + '&roomId=' + encodeURIComponent(roomId))
      .then(function (r) { return r.json(); }).catch(function () { return { error: '网络错误' }; });
  }
  function roomGetMine() {
    return fetch('/api/room/mine?token=' + encodeURIComponent(authToken))
      .then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  function renderOnlineView() {
    var can = onlineModeAvail();
    $('online-login-req').classList.toggle('hidden', can);
    $('online-gate').classList.toggle('hidden', !can || onlineActive);
    $('online-lobby').classList.toggle('hidden', !(can && onlineActive));
  }
  function onOnlineModeEnter() {
    if (mode !== 'online' || !onlineModeAvail() || onlineActive) return;
    roomGetMine().then(function (m) {
      if (m && m.roomId) { roomId = m.roomId; onlineActive = true; onlineMsg(''); renderOnlineView(); startRoomPolling(); pollRoom(true); }
      else renderOnlineView();
    });
  }
  function onRoomCreate() {
    if (!onlineModeAvail()) { renderOnlineView(); return; }
    api('/api/room/create', {}).then(function (res) {
      if (res.error) { onlineMsg(res.error); return; }
      roomId = res.roomId; onlineActive = true; onlineMsg('');
      renderOnlineView(); startRoomPolling(); pollRoom(true);
    });
  }
  function onRoomJoinOpen() {          // 点"加入房间"→ 展开房间号输入
    $('room-join-panel').classList.remove('hidden');
    $('room-join-input').focus();
  }
  function onRoomJoinCancel() {       // 取消 → 收起输入并清空
    $('room-join-panel').classList.add('hidden');
    $('room-join-input').value = '';
    onlineMsg('');
  }
  // 复制房间号：强制纯数字，杜绝复制到空格/干扰字符
  function onRoomCopy() {
    if (!roomId) return;
    var txt = String(roomId).replace(/\D+/g, '').slice(0, 6);
    var btn = $('room-copy-btn');
    function done() {
      if (!btn) return;
      btn.textContent = '已复制 ✓';
      setTimeout(function () { if (btn) btn.textContent = '复制'; }, 1500);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(); done(); });
    } else { fallback(); done(); }
  }
  function onRoomJoin() {
    if (!onlineModeAvail()) { renderOnlineView(); return; }
    var raw = ($('room-join-input').value || '');
    var id = raw.replace(/\D+/g, '');   // 提交时清洗：空格/字母等非数字自动忽略
    if (!id) { onlineMsg('请输入房间号（6 位数字）。'); return; }
    if (!/^\d{6}$/.test(id)) {
      onlineMsg('房间号应为 6 位数字（已自动忽略空格等字符）。当前：' + (raw.trim() || '空'));
      return;
    }
    api('/api/room/join', { roomId: id }).then(function (res) {
      if (res.error) { onlineMsg(res.error); return; }
      roomId = id; onlineActive = true; onlineMsg('');
      $('room-join-input').value = '';
      $('room-join-panel').classList.add('hidden');
      renderOnlineView(); startRoomPolling(); pollRoom(true);
    });
  }
  function onRoomStart() {
    if (!roomId) return;
    api('/api/room/start', { roomId: roomId }).then(function (res) {
      if (res.error) { onlineMsg(res.error); return; }
      pollRoom(true);
    });
  }
  function onRoomTerminate() {
    if (!roomId) return;
    api('/api/room/terminate', { roomId: roomId }).then(function (res) {
      if (res.error) { setMsg('✗ ' + res.error, 'err'); return; }
      pollRoom(true);
    });
  }
  function onRoomLeave() {
    if (!roomId) return;
    var rid = roomId;
    api('/api/room/leave', { roomId: rid }).then(function () {
      stopRoomPolling();
      roomId = null; onlineActive = false; myName = null; myTurn = false; roomIsHost = false; roomStatus = null;
      state = null; sessionId = null; op = null; busy = false; hideConfirm();
      $('game').classList.add('hidden');
      $('setup').classList.remove('hidden');
      $('log').classList.add('hidden');
      renderOnlineView(); renderSetup();
    });
  }
  function onRoomDissolve() {
    if (!roomId) return;
    var rid = roomId;
    api('/api/room/dissolve', { roomId: rid }).then(function (res) {
      if (res.error) { setMsg('✗ ' + res.error, 'err'); return; }
      stopRoomPolling();
      roomId = null; onlineActive = false; myName = null; myTurn = false; roomIsHost = false; roomStatus = null;
      state = null; sessionId = null; op = null; busy = false; hideConfirm();
      $('game').classList.add('hidden');
      $('setup').classList.remove('hidden');
      $('log').classList.add('hidden');
      renderOnlineView(); renderSetup();
      onlineMsg('房间已解散');
    });
  }
  function startRoomPolling() {
    stopRoomPolling();
    roomPollTimer = setInterval(function () { pollRoom(false); }, 800);
    // 倒计时本地每秒刷新（两次轮询之间也平滑跳动）
    countdownTimer = setInterval(function () {
      if (mode === 'online' && onlineActive && state) { renderTurn(); renderScoreboard(); }
    }, 1000);
  }
  function stopRoomPolling() {
    if (roomPollTimer) { clearInterval(roomPollTimer); roomPollTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }
  function pollRoom(force) {
    if (!roomId || !onlineActive) return;
    roomGetState().then(function (rs) {
      if (!rs || rs.error) {
        if (rs && rs.error && rs.error.indexOf('房间不存在') === 0) {
          // 房间已被房主解散或不存在
          stopRoomPolling();
          roomId = null; onlineActive = false; myName = null; myTurn = false; roomIsHost = false; roomStatus = null; state = null;
          $('game').classList.add('hidden');
          $('setup').classList.remove('hidden');
          renderOnlineView();
          onlineMsg('房间已被房主解散');
        } else if (rs && rs.error && rs.error !== '网络错误') { onlineMsg(rs.error); }
        return;
      }
      if (force || rs.seq !== roomSeq) { roomSeq = rs.seq; applyRoomState(rs); }
    });
  }
  function renderRoomPlayers(players, host) {
    var box = $('room-players');
    box.innerHTML = players.map(function (p, i) {
      return '<div class="room-player' + (p === host ? ' host' : '') + '">' +
        '<span class="badge">' + (p === host ? '房主' : ('P' + (i + 1))) + '</span>' +
        '<span>' + esc(p) + (p === myName ? '（我）' : '') + '</span></div>';
    }).join('');
  }
  function applyRoomState(rs) {
    roomIsHost = rs.isHost; roomStatus = rs.status; myName = rs.me;
    $('room-id').textContent = rs.roomId;
    renderRoomPlayers(rs.players, rs.host);
    if (rs.notice) $('room-notice').textContent = rs.notice;
    // 大厅按钮：房主=开始对战/解散房间；其他人=离开房间
    $('room-start-btn').classList.toggle('hidden', !(rs.isHost && rs.status === 'waiting'));
    $('room-start-btn').disabled = !(rs.isHost && rs.status === 'waiting' && rs.players.length >= 2);
    $('room-dissolve-btn').classList.toggle('hidden', !rs.isHost);
    $('room-leave-btn').classList.toggle('hidden', rs.isHost);
    if (rs.status === 'playing' && rs.game) {
      state = rs.game; myTurn = !!rs.myTurn;
      turnDeadline = rs.turnDeadline || null;
      // 用"剩余毫秒数"校准本地倒计时基准，避免服务器/浏览器时钟偏差导致跳变
      if (rs.turnMsLeft != null) localDeadline = Date.now() + rs.turnMsLeft;
      else localDeadline = null;
      $('setup').classList.add('hidden');
      $('game').classList.remove('hidden');
      $('log').classList.add('hidden');
      $('room-bar-id').textContent = rs.roomId;
      render();
    } else {
      state = null; myTurn = false;
      $('game').classList.add('hidden');
      $('setup').classList.remove('hidden');
      $('log').classList.add('hidden');
      renderOnlineView();
    }
  }
  // 出词/认输等动作：联机走房间，本地走会话
  function submitAction(kind, word, confirmed, item) {
    if (mode === 'online' && onlineActive) {
      return api('/api/room/action', { roomId: roomId, kind: kind, word: word, confirmed: !!confirmed, item: item });
    }
    return api('/api/action', { sessionId: sessionId, kind: kind, word: word, confirmed: !!confirmed, item: item });
  }

  // 学习画像面板 —— 便携版(离线): 本地画像; 网站版: 登录账户画像; 均仅"人机对战"
  function renderProfileBox() {
    var box = $('profile-box');
    if (!box || mode !== 'pve') { if (box) { box.classList.add('hidden'); box.innerHTML = ''; } return; }

    // 便携版（离线单文件）：以浏览器为单位的本地画像
    if (window.__LOCAL_GAME__) {
      if (!window.__LOCAL_GAME__.profile) { box.classList.add('hidden'); return; }
      window.__LOCAL_GAME__.profile().then(function (p) {
        if (!p || !p.hasData) { box.classList.add('hidden'); return; }
        var weak = (p.weakEndings || []).map(function (x) { return '「' + esc(x) + '」'; }).join(' ') || '暂无';
        box.classList.remove('hidden');
        box.innerHTML =
          '<div class="profile-title">🧠 你的学习画像（以本浏览器为单位）</div>' +
          '<div class="profile-row">难度水平 ≈ <b>' + p.skill + '</b>/10 · 已知 <b>' + p.knownCount +
          '</b> 个词 · 学到知识点 <b>' + (p.noteSeen || 0) + '</b> · 最长接龙 <b>' + (p.bestChain || 0) + '</b> 词</div>' +
          '<div class="profile-row">薄弱结尾：<b>' + weak + '</b>（AI 会优先在这些结尾给你练新词的机会）</div>';
      }).catch(function () {});
      return;
    }

    // 网站版：登录账户画像
    if (!account || !account.username) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var p = account.profile || {};
    var weak = (p.weakEndings || []).map(function (x) { return '「' + esc(x) + '」'; }).join(' ') || '暂无';
    box.classList.remove('hidden');
    box.innerHTML =
      '<div class="profile-title">🧠 学习画像 · <b>' + esc(account.username) + '</b></div>' +
      '<div class="profile-row">难度水平 ≈ <b>' + (p.skill || '?') + '</b>/10 · 已知 <b>' + (p.knownCount || 0) +
      '</b> 个词 · 学到知识点 <b>' + (p.noteSeen || 0) + '</b> · 最长接龙 <b>' + (p.bestChain || 0) + '</b> 词</div>' +
      '<div class="profile-row">薄弱结尾：<b>' + weak + '</b>（AI 会优先在这些结尾给你练新词的机会）</div>' +
      ((p.hasData === false) ? '<div class="profile-row">（账户数据还不算多，多玩几局画像会越来越准）</div>' : '');
  }

  function wireSetup() {
    if (window.__LOCAL_GAME__) { var mo = $('mode-online'); if (mo) mo.disabled = true; } // 离线无联机
    document.querySelectorAll('input[name="mode"]').forEach(function (el) {
      el.addEventListener('change', function () {
        mode = el.value; renderSetup(); renderProfileBox();
        if (mode === 'online') onOnlineModeEnter();
      });
    });
    $('pvp-count').addEventListener('change', function () { renderPvpNames(); });
    $('pvp-track').addEventListener('change', renderPvpMeRow);
    $('room-create-btn').addEventListener('click', onRoomCreate);
    $('room-join-btn').addEventListener('click', onRoomJoinOpen);
    $('room-join-confirm').addEventListener('click', onRoomJoin);
    $('room-join-cancel').addEventListener('click', onRoomJoinCancel);
    $('room-join-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') onRoomJoin(); });
    $('room-copy-btn').addEventListener('click', onRoomCopy);
    $('room-start-btn').addEventListener('click', onRoomStart);
    $('room-leave-btn').addEventListener('click', onRoomLeave);
    $('room-dissolve-btn').addEventListener('click', onRoomDissolve);
    $('room-bar-leave').addEventListener('click', onRoomLeave);
    $('room-bar-terminate').addEventListener('click', onRoomTerminate);
    $('room-bar-dissolve').addEventListener('click', onRoomDissolve);
    $('online-goto-login').addEventListener('click', function () { showGate(); });
  }

  /* ---------- 主题切换 ---------- */
  function wireTheme() {
    var sel = $('theme-select');
    var saved = localStorage.getItem('wc_theme') || '';
    if (saved) sel.value = saved;
    applyTheme(saved);
    sel.addEventListener('change', function () {
      var v = sel.value;
      localStorage.setItem('wc_theme', v);
      applyTheme(v);
    });
  }
  function applyTheme(file) {
    if (window.__LOCAL_GAME__) {
      // 单文件版：基础样式常开，切换各主题 <style> 是否启用
      document.querySelectorAll('style[data-theme-file]').forEach(function (s) {
        s.disabled = (file !== s.getAttribute('data-theme-file'));
      });
      return;
    }
    $('theme-style').href = file || '';
  }

  function renderSetup() {
    $('pve-config').classList.toggle('hidden', mode !== 'pve');
    $('pvp-config').classList.toggle('hidden', mode !== 'pvp');
    $('online-config').classList.toggle('hidden', mode !== 'online');
    $('start-btn').classList.toggle('hidden', mode === 'online');   // 联机模式用房间按钮开局
    // 人机对战：登录后直接以账户身份进行，不再要求昵称
    var logged = loggedIn() && !window.__LOCAL_GAME__;
    $('pve-name-row').classList.toggle('hidden', logged);
    $('pve-account-note').classList.toggle('hidden', !logged);
    if (logged) $('pve-account-name').textContent = account.username;
    if (mode === 'online') renderOnlineView();
  }

  function renderPvpNames() {
    var n = Number($('pvp-count').value);
    var box = $('pvp-names'); box.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var inp = document.createElement('input');
      inp.type = 'text'; inp.placeholder = '玩家 ' + (i + 1); inp.maxLength = 12; inp.dataset.pindex = i;
      inp.addEventListener('input', syncPvpMeLabels);
      box.appendChild(inp);
    }
    var meSel = $('pvp-me'); meSel.innerHTML = '';
    for (var j = 0; j < n; j++) {
      var opt = document.createElement('option');
      opt.value = String(j + 1); opt.textContent = '玩家 ' + (j + 1);
      meSel.appendChild(opt);
    }
    syncPvpMeLabels();
    renderPvpMeRow();
  }
  // "我是哪位玩家" 下拉文案跟随玩家名输入
  function syncPvpMeLabels() {
    var meSel = $('pvp-me'); if (!meSel) return;
    Array.prototype.forEach.call(meSel.options, function (opt) {
      var inp = document.querySelector('#pvp-names input[data-pindex="' + (Number(opt.value) - 1) + '"]');
      opt.textContent = (inp && inp.value.trim()) || '玩家 ' + opt.value;
    });
  }
  function renderPvpMeRow() {
    $('pvp-me-row').classList.toggle('hidden', !$('pvp-track').checked);
  }
  // 本地同屏"统计我的出词"：返回我的玩家下标；未勾选/非法返回 -1
  function pvpMeIdx() {
    if (mode !== 'pvp' || !$('pvp-track').checked) return -1;
    var v = Number($('pvp-me').value) - 1;
    var n = Number($('pvp-count').value);
    return (v >= 0 && v < n) ? v : -1;
  }
  function trackingMe() { return myLocalIdx >= 0; }

  function buildPlayers() {
    if (mode === 'pve') {
      var name = (loggedIn() && !window.__LOCAL_GAME__) ? account.username : (($('pve-name').value || '').trim() || '玩家');
      return [{ name: name, type: 'human' }, { name: 'AI', type: 'ai' }];
    }
    var n = Number($('pvp-count').value); var arr = [];
    for (var i = 0; i < n; i++) {
      var inp = document.querySelector('#pvp-names input[data-pindex="' + i + '"]');
      arr.push({ name: (inp && inp.value.trim()) || '玩家 ' + (i + 1), type: 'human' });
    }
    return arr;
  }

  /* ---------- 开始 / 重开 ---------- */
  function startGame() {
    playerConfig = buildPlayers();
    seenStart = new Set(seenSet); roundBest = 0;   // 本局开始的"已见"快照 与 本局最长
    myLocalIdx = pvpMeIdx();                       // 本地同屏"统计我的出词"
    var body = { name: mode === 'pve' ? playerConfig[0].name : '', playerArray: playerConfig, explore: mode === 'pve' && $('pve-explore').checked };
    if (myLocalIdx >= 0) body.myPlayerIdx = myLocalIdx;
    api('/api/start', body)
      .then(function (res) {
        if (res.error) { showSetupError(res.error); return; }
        sessionId = res.sessionId;
        $('setup').classList.add('hidden');
        $('game').classList.remove('hidden');
        $('log').classList.remove('hidden');
        $('log-list').innerHTML = '';
        closeReport();
        $('hint-box').classList.add('hidden');
        state = res;
        setMsg('', '');
        render();
      });
  }

  function doRestart() {
    if (!playerConfig) return;
    hideConfirm(); pendingWord = null; op = null;
    seenStart = new Set(seenSet); roundBest = 0;
    myLocalIdx = pvpMeIdx();
    var body = { name: playerConfig[0].name, playerArray: playerConfig };
    if (myLocalIdx >= 0) body.myPlayerIdx = myLocalIdx;
    api('/api/start', body)
      .then(function (res) { sessionId = res.sessionId; state = res; hideConfirm(); $('hint-box').classList.add('hidden'); setMsg('已开始新一局。', 'info'); render(); });
  }
  function doBack() {
    sessionId = null; state = null; op = null;
    myLocalIdx = -1;
    $('game').classList.add('hidden'); $('setup').classList.remove('hidden'); $('log').classList.remove('hidden');
    hideConfirm(); renderSetup();
  }
  // 把当前对局存成一条"局"记录（本地同屏"统计我的出词"时只记我的词）
  function captureRecord() {
    if (!state || !state.log || !state.log.length) return;
    var all = state.log.filter(function (e) { return e.kind === 'start' || e.kind === 'chain'; })
      .map(function (e) { return { word: e.word, zh: e.zh || '', phonetic: e.phonetic || '', d: e.d, playerIdx: e.playerIdx, playerType: e.playerType }; });
    var tracking = trackingMe();
    var words = tracking ? all.filter(function (w) { return w.playerIdx === myLocalIdx; }) : all;
    if (!words.length) return;   // 追踪模式下没出过词则不存
    var uniq = {}, sumD = 0, cnt = 0;
    words.forEach(function (w) { uniq[w.word] = 1; if (w.d) { sumD += w.d; cnt++; } });
    var bestChain = roundBest;
    if (tracking) {
      // 我的最长连续接龙（同屏轮流通常=1，不把别人的长龙算进我的纪录）
      var run = 0, myBest = 0;
      state.log.forEach(function (e) {
        if (e.kind === 'start' || e.kind === 'chain') {
          if (e.playerIdx === myLocalIdx) { run++; if (run > myBest) myBest = run; }
          else run = 0;
        }
      });
      bestChain = myBest;
    }
    var stats = {
      total: words.length, uniq: Object.keys(uniq).length,
      avgD: cnt ? (sumD / cnt) : 0, bestChain: bestChain,
      mode: mode, name: state.players[0] ? state.players[0].name : '',
      mine: tracking ? myLocalIdx : null
    };
    var rec = { at: Date.now(), words: words, stats: stats };
    if (loggedIn() && !window.__LOCAL_GAME__) {
      // 登录：本局记录存到服务端账户（不写入本地，避免与游客数据归并）
      fetchJSON('/api/record', 'POST', { token: authToken, record: rec }).then(function (res) {
        if (res.ok && res.games) {
          account.games = res.games; account.best = res.best; account.seen = res.seen; account.profile = res.profile || account.profile;
          allBest = Math.max(allBest, account.best || 0);
          renderRecords(); renderProfileBox();
        } else if (res.error) { setMsg('✗ 保存记录失败：' + res.error, 'err'); }
      }).catch(function () { setMsg('✗ 保存记录失败', 'err'); });
      return;
    }
    // 游客：存 localStorage
    history.unshift(rec);
    saveHistory();
    renderProfileBox();  // 一局结束(游客这里为隐藏), 兼容旧逻辑
  }
  function onRestart() {
    captureRecord();  // 本局结束 → 存为记录(记录区可见)
    doRestart();
  }
  function onBack() {
    captureRecord();
    doBack();
  }
  function showSetupError(m) { $('setup-error').textContent = m; $('setup-error').classList.remove('hidden'); }

  /* ---------- 提交 ---------- */
  function onSubmit(confirmed) {
    if (busy) return;
    var online = (mode === 'online' && onlineActive);
    if (!online && !sessionId) return;
    if (online && !roomId) return;
    var val = $('word-input').value.trim();
    if (!val) { setMsg('请输入一个英文单词。', 'err'); $('word-input').focus(); return; }
    if (online && !myTurn) { setMsg('还没轮到你出词。', 'err'); return; }
    busy = true;
    if (!online) { thinking(true); op = hasAI() ? { word: val, info: null } : null; render(); if (op) fillOpInfo(val); }
    submitAction(state.needsStart ? 'start' : 'chain', val, confirmed)
      .then(function (res) {
        busy = false;
        if (!online) { thinking(false); op = null; }
        if (res.error) { setMsg('✗ ' + res.error, 'err'); $('word-input').focus(); if (!online) render(); return; }
        if (res.pending) { showPendingConfirm(res.pending); if (online) pollRoom(true); else render(); return; }
        hideConfirm();
        $('word-input').value = '';
        if (online) { setMsg('出词成功，等待对方…', 'info'); pollRoom(true); }
        else { state = res; setMsg('', ''); render(); focusInput(); }
      });
  }

  function hasAI() { return !!(state && state.players.some(function (p) { return p.type === 'ai'; })); }

  function thinking(on) {
    if (!hasAI()) { setMsg('', ''); return; }
    setMsg(on ? 'AI 思考中…' : '', on ? 'info' : '');
  }

  // AI 思考完成后回到玩家回合：自动聚焦输入框，可直接输入
  function focusInput() {
    if (!state) return;
    if (state.aiConceded) return;                       // 等确认
    var cur = state.players[state.turn];
    if (!cur || cur.type !== 'human') return;           // 该 AI/其他人了
    setTimeout(function () {
      if (!$('word-input').disabled) $('word-input').focus();
    }, 60);
  }

  function showPendingConfirm(p) {
    pendingWord = p.word;
    $('confirm-msg').textContent = p.reason;
    $('confirm-row').classList.remove('hidden');
    $('word-input').focus();
  }
  function confirmYes() {
    if (pendingWord == null) { hideConfirm(); return; }
    var w = pendingWord; hideConfirm(); pendingWord = null;
    var online = (mode === 'online' && onlineActive);
    busy = true;
    if (!online) { thinking(true); op = hasAI() ? { word: w, info: null } : null; render(); if (op) fillOpInfo(w); }
    var kind = (state && state.needsStart) ? 'start' : 'chain';
    submitAction(kind, w, true)
      .then(function (res) {
        busy = false;
        if (!online) { thinking(false); op = null; }
        if (res.error) { setMsg('✗ ' + res.error, 'err'); $('word-input').focus(); if (!online) render(); return; }
        $('word-input').value = '';
        if (online) { setMsg('出词成功，等待对方…', 'info'); pollRoom(true); }
        else { state = res; setMsg('', ''); render(); focusInput(); }
      });
  }
  function confirmNo() { hideConfirm(); pendingWord = null; $('word-input').focus(); }
  function hideConfirm() { $('confirm-row').classList.add('hidden'); }

  function onConcede() {
    if (busy) return;
    var online = (mode === 'online' && onlineActive);
    if (!online && !sessionId) return;
    if (online && !roomId) return;
    busy = true;
    if (!online) thinking(true);
    submitAction('concede', null, false)
      .then(function (res) {
        busy = false; if (!online) thinking(false); op = null;
        if (res.error) { if (online) setMsg('✗ ' + res.error, 'err'); return; }
        hideConfirm(); pendingWord = null;
        if (online) { setMsg('已弃权，进入下一轮…', 'info'); pollRoom(true); }
        else { state = res; render(); }
      });
  }

  // 玩家确认 AI 认输后，进入下一轮
  function continueRound() {
    if (!sessionId || busy) return;
    busy = true;
    thinking(true);
    api('/api/action', { sessionId: sessionId, kind: 'continue-round' })
      .then(function (res) {
        busy = false; thinking(false);
        if (res.error) { setMsg('✗ ' + res.error, 'err'); return; }
        state = res; hideConfirm(); op = null; pendingWord = null; render(); focusInput();
      });
  }

  function setMsg(text, cls) { var m = $('game-msg'); m.textContent = text; m.className = 'game-msg ' + (cls || ''); }

  /* ---------- 道具商店 ---------- */
  function shopMsg(m, err) {
    var el = $('shop-msg');
    if (!el) return;
    el.textContent = m || '';
    el.classList.toggle('err', !!err);
  }
  function renderShop(res) {
    if (res && res.points != null && account) account.points = res.points;
    if (res && res.items && account) account.items = res.items;
    if (res && res.catalog) shopCatalogCache = res.catalog;
    if (res && res.quota) shopQuota = res.quota;
    renderAccountBar();
    var pts = $('shop-points');
    if (pts) pts.innerHTML = '我的积分：<b>' + ((account && account.points) || 0) + '</b>' +
      (shopQuota ? '　每局道具上限：' + shopQuota + ' 次' : '');
    var box = $('shop-list');
    if (!box) return;
    box.innerHTML = '';
    var items = (account && account.items) || {};
    (shopCatalogCache || []).forEach(function (it) {
      var own = items[it.kind] || 0;
      var row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = '<div class="shop-info"><b>' + esc(it.name) + '</b>' +
        '<span class="shop-price">' + it.price + ' 积分</span>' +
        '<div class="shop-desc">' + esc(it.desc) + '</div>' +
        '<div class="shop-own">持有 ' + own + '</div></div>';
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-sm';
      btn.textContent = '购买';
      btn.disabled = ((account && account.points) || 0) < it.price;
      btn.addEventListener('click', function () { buyItem(it.kind, btn); });
      row.appendChild(btn);
      box.appendChild(row);
    });
    if (!(shopCatalogCache || []).length) box.innerHTML = '<p class="empty">暂无可购买的道具。</p>';
  }
  function openShop() {
    if (!loggedIn()) return;
    shopMsg('');
    $('shop-modal').classList.remove('hidden');
    fetchJSON('/api/shop?token=' + encodeURIComponent(authToken), 'GET')
      .then(function (res) {
        if (res.error) { shopMsg('✗ ' + res.error, true); return; }
        renderShop(res);
      })
      .catch(function () { shopMsg('✗ 网络错误，请重试', true); });
  }
  function closeShop() { $('shop-modal').classList.add('hidden'); shopMsg(''); }
  function buyItem(kind, btn) {
    if (btn) btn.disabled = true;
    shopMsg('购买中…');
    fetchJSON('/api/shop/buy', 'POST', { token: authToken, item: kind })
      .then(function (res) {
        if (res.error) { shopMsg('✗ ' + res.error, true); if (btn) btn.disabled = false; return; }
        shopMsg('✓ 购买成功');
        renderShop(res);
        renderItemBar();
      })
      .catch(function () { shopMsg('✗ 网络错误，请重试', true); if (btn) btn.disabled = false; });
  }

  /* ---------- 局内道具栏 ---------- */
  // 是否轮到"本机的人"出词（决定道具按钮可不可点）
  function myTurnNow() {
    if (!state || !state.players) return false;
    var cur = state.players[state.turn];
    if (!cur) return false;
    if (mode === 'online' && onlineActive) return cur.name === myName;
    return cur.type === 'human';
  }
  function myItemLeft() {
    if (!state || !state.itemState || !state.itemState.players) return 0;
    var p = state.itemState.players[state.turn];
    return p ? p.left : 0;
  }
  function renderItemBar() {
    var bar = $('item-bar');
    if (!bar) return;
    if (!loggedIn() || !state || window.__LOCAL_GAME__) { bar.classList.add('hidden'); return; }
    var left = myItemLeft();
    var inv = (account && account.items) || {};
    bar.classList.remove('hidden');
    bar.innerHTML = '<span class="item-bar-label">道具 <b>' + (state.itemState ? state.itemState.perPlayer - left : 0) +
      '/' + (state.itemState ? state.itemState.perPlayer : 3) + '</b></span>';
    ITEM_KINDS.forEach(function (it) {
      var own = inv[it.kind] || 0;
      var btn = document.createElement('button');
      btn.className = 'btn btn-sm item-btn';
      btn.textContent = it.name + ' ×' + own;
      btn.title = it.desc + (left <= 0 ? '（本局道具次数已用完）' : '') + (own <= 0 ? '（没有库存，去商店购买）' : '');
      btn.disabled = !myTurnNow() || left <= 0 || own <= 0;
      btn.addEventListener('click', function () { useItemNow(it.kind, btn); });
      bar.appendChild(btn);
    });
  }
  function useItemNow(kind, btn) {
    if (btn) btn.disabled = true;
    setMsg('使用道具中…', 'info');
    submitAction('item', null, false, kind)
      .then(function (res) {
        if (res.error) { setMsg('✗ ' + res.error, 'err'); renderItemBar(); return; }
        if (res.accountItems && account) account.items = res.accountItems;
        if (res.accountPoints != null && account) account.points = res.accountPoints;
        var eff = res.itemEffect || {};
        var label = (ITEM_KINDS.filter(function (x) { return x.kind === kind; })[0] || {}).name || '道具';
        if (eff.effect === 'swap' && eff.word) setMsg('✓ ' + label + '：待接词已换成「' + eff.word + '」', 'info');
        else setMsg('✓ ' + label + ' 已使用', 'info');
        if (mode === 'online' && onlineActive) pollRoom(true);
        else { state = res; render(); focusInput(); }
      })
      .catch(function () { setMsg('✗ 网络错误，请重试', 'err'); renderItemBar(); });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!state) return;
    renderScoreboard();
    renderTurn();
    renderChain();
    renderAI();
    renderRecords();
    renderAIConfirm();
    renderControls();
    renderItemBar();
    renderModeActions();
    updateMilestone();
    trackSeen();
  }

  // 联机模式：隐藏 提示/重开/返回，显示房间条
  function renderModeActions() {
    var online = (mode === 'online' && onlineActive);
    $('hint-btn').classList.toggle('hidden', online);
    $('restart-btn').classList.toggle('hidden', online);
    $('back-btn').classList.toggle('hidden', online);
    $('room-bar').classList.toggle('hidden', !online);
    if (online) {
      $('room-bar-id').textContent = roomId || '';
      $('room-bar-terminate').classList.toggle('hidden', !roomIsHost);   // 房主：终止对局
      $('room-bar-dissolve').classList.toggle('hidden', !roomIsHost);    // 房主：解散房间
      $('room-bar-leave').classList.toggle('hidden', roomIsHost);        // 其他人：离开房间
    }
  }

  function updateMilestone() {
    if (!state) return;
    var len = state.chainLen || 0;
    if (len > roundBest) roundBest = len;
    var box = $('milestone');
    if (trackingMe()) {
      // 本地同屏"统计我的出词"：全屏合接是大家共同的，不写进"我的纪录"
      if (box) box.innerHTML = '🏆 全屏合接最长：<b>' + roundBest + '</b> 词　·　只统计你本人的出词（不并入历史纪录）';
      return;
    }
    if (loggedIn()) {
      allBest = Math.max(account.best || 0, roundBest);
    } else {
      if (roundBest > localBest) { localBest = roundBest; try { localStorage.setItem(BEST_KEY, String(localBest)); } catch (e) {} }
      allBest = Math.max(localBest, roundBest);
    }
    if (box) box.innerHTML = '🏆 本局最长接龙：<b>' + roundBest + '</b> 词　·　历史纪录：<b>' + allBest + '</b> 词';
  }

  function trackSeen() {
    if (!state || !state.log) return;
    var changed = false;
    var tracking = trackingMe();
    state.log.forEach(function (e) {
      if ((e.kind === 'start' || e.kind === 'chain') && e.word && !seenSet.has(e.word) && (!tracking || e.playerIdx === myLocalIdx)) {
        seenSet.add(e.word); changed = true;
      }
    });
    if (changed && !loggedIn()) saveSet(SEEN_KEY, seenSet);
    if (state.round !== lastRoundSeen) { lastRoundSeen = state.round; hintUsed = 0; } // 每轮重置提示次数
  }

  function onHint() {
    if (!sessionId || busy) return;
    if (hintUsed >= 2) { setMsg('本回合已用满 2 次提示。', 'info'); return; }
    if (!state || state.aiConceded || state.players[state.turn].type !== 'human') { setMsg('现在不能提示。', 'err'); return; }
    hintUsed++;
    api('/api/hint', { sessionId: sessionId }).then(function (h) {
      if (h && h.ok) {
        var txt = '💡 下个词要以「' + h.prefixes.join('」或「') + '」开头。';
        if (h.samples && h.samples.length) {
          var s = h.samples[0];
          txt += '<br/>试试：<b>' + esc(s.word) + '</b> <span class="phonetic">/' + esc(cleanPhon(s.phonetic)) + '/</span>（' + esc(s.zh || '') + '）';
        }
        $('hint-box').innerHTML = txt;
        $('hint-box').classList.remove('hidden');
      } else if (h && h.error) { setMsg('✗ ' + h.error, 'err'); }
    });
  }

  function closeReport() { $('report-modal').classList.add('hidden'); }

  function renderAIConfirm() {
    var box = $('ai-confirm');
    if (state.aiConceded) {
      $('ai-confirm-msg').innerHTML = '🤖 AI 认输了，<b>你 +1 分</b>。下一轮由 AI 开局，确认继续？';
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  }

  function renderScoreboard() {
    var box = $('scoreboard'); box.innerHTML = '';
    var online = (mode === 'online' && onlineActive);
    state.players.forEach(function (p, i) {
      var card = document.createElement('div');
      var isTurn = p.turn;
      card.className = 'player-card' + (isTurn ? ' active' : '');
      if (online && isTurn && myName === p.name) card.classList.add('mine');
      if (p.type === 'ai') { var b = document.createElement('span'); b.className = 'badge'; b.textContent = 'AI'; card.appendChild(b); }
      var nm = document.createElement('span'); nm.className = 'name'; nm.textContent = p.name; card.appendChild(nm);
      if (trackingMe() && i === myLocalIdx) { var mt = document.createElement('em'); mt.className = 'me-tag'; mt.textContent = '我'; card.appendChild(mt); }
      var sc = document.createElement('div'); sc.className = 'score'; sc.textContent = p.score; card.appendChild(sc);
      var sl = document.createElement('div'); sl.className = 'score-label'; sl.textContent = '得分'; card.appendChild(sl);
      // 本局赚取的积分（正反馈）
      if (p.points) {
        var gp = document.createElement('div');
        gp.className = 'game-points';
        gp.textContent = '+' + p.points;
        gp.title = '本局已赚取 ' + p.points + ' 积分';
        card.appendChild(gp);
      }
      // 专名额度（人名/地名/姓氏）：每局限用 N 个，用完变红
      if (p.properUsed != null && state.properQuota) {
        var pq = document.createElement('div');
        pq.className = 'proper-quota' + (p.properLeft === 0 ? ' used-up' : '');
        pq.textContent = '专名 ' + p.properUsed + '/' + state.properQuota.perPlayer;
        pq.title = '人名 / 地名 / 姓氏（专名）每局最多使用 ' + state.properQuota.perPlayer + ' 个';
        card.appendChild(pq);
      }
      // 回合角标文案：联机时按"是否我"区分；本地/人机用"当前出词"
      var tagText = '当前出词';
      if (online && isTurn) tagText = (myName === p.name) ? '你的回合' : '接龙中';
      var tt = document.createElement('span'); tt.className = 'turn-tag'; tt.textContent = tagText; card.appendChild(tt);
      box.appendChild(card);
    });
  }

  // 联机回合倒计时文本（用本地递减基准，避免跳变）
  function turnCountdown() {
    if (!(mode === 'online' && onlineActive) || !localDeadline) return '';
    var ms = localDeadline - Date.now();
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);   // 用 floor + 显示剩余整秒，避免 ceil 跳 2 秒
    return ' <span class="turn-timer' + (s <= 10 ? ' danger' : '') + '">⏱ ' + s + 's</span>';
  }

  function renderTurn() {
    var box = $('turn-banner');
    var cur = state.players[state.turn];
    var online = (mode === 'online' && onlineActive);
    // 反转卡生效提示（出词顺序已倒转）
    var rev = state.reverseTurn
      ? ' <span class="rev-badge" title="反转卡生效中：出词顺序已倒转（接龙规则不变）">🔄 顺序反转</span>' : '';
    if (online && !(myName && cur && cur.name === myName)) {
      box.innerHTML = '⏳ <b>' + esc(cur.name) + '</b> 接龙中…' + turnCountdown() + rev;
      return;
    }
    if (state.needsStart) {
      box.innerHTML = '轮到 <b>' + esc(cur.name) + '</b> 给出开局词 <span class="hint">(≥3字母，结尾含元音，非 ry/ht/ck 结尾)</span>' + turnCountdown() + rev;
    } else {
      box.innerHTML = '轮到 <b>' + esc(cur.name) + '</b> 接龙 <span class="hint">(接「' + esc(state.lastWord) + '」)</span>' + turnCountdown() + rev;
    }
  }

  function chainRow(en, tag, active) {
    var dHtml = en.inVocab && en.d != null ? '<span class="d-badge d' + en.d + '">难度 ' + en.d + '/10</span>' : '';
    var zh = en.zh ? '<div class="zh">' + esc(en.zh) + '</div>' : '';
    var phon = (en.inVocab && en.phonetic) ? '<span class="phonetic">/' + esc(cleanPhon(en.phonetic)) + '/</span>' : '';
    var speak = (en.word && /^[a-z]+$/.test(en.word)) ? '<button class="speak" data-word="' + esc(en.word) + '">🔊</button>' : '';
    var note = '';
    if (en.has_note) {
      note = '<div class="note-line">💡 ' + esc(en.note) + '</div>';
      if (en.note_long) {
        note += '<button class="note-toggle" data-word="' + esc(en.word) + '">打开提示</button>';
        note += '<div class="note-full hidden" id="note-full-' + esc(en.word) + '">' + esc(en.note_long) + '</div>';
      }
    }
    var warn = '';
    if (en.dead) warn = '<div class="dead-warn">⚠️ 这个词结尾几乎接不下去（死路），下家会很难。</div>';
    else if (en.chain_idx != null && en.chain_idx < 0.08) warn = '<div class="dead-warn soft">⚠️ 这个词结尾不好接，小心卡壳。</div>';
    var meMark = (trackingMe() && en.playerIdx === myLocalIdx) ? ' <em class="me-tag">我</em>' : '';
    var properBadge = en.proper
      ? '<span class="proper-badge" title="人名 / 地名 / 姓氏（专名），每局限用 ' + (state.properQuota ? state.properQuota.perPlayer : 3) + ' 个">专名</span>'
      : '';
    return '<div class="' + (active ? 'cur-word' : 'prev-word') + '">' +
      '<span class="tag">' + tag + '</span><span class="w">' + esc(en.word) + '</span>' + speak + phon + properBadge +
      '<span class="who">' + esc(en.playerName || en.player) + (en.kind === 'start' ? ' 开局' : '') + meMark + '</span>' +
      zh + note + warn + (dHtml ? '<div class="meta">' + dHtml + '</div>' : '') +
      '</div>';
  }

  function cleanPhon(p) { return String(p).replace(/^\[|\]$/g, '').trim(); }

  function renderChain() {
    var box = $('last-word');
    // 乐观显示：等待 AI 时 上上=我提交的词(立即补释义), 上=思考中(仅AI部分)
    if (op) {
      var who = state.players[state.turn] ? state.players[state.turn].name : '';
      var info = op.info || {};
      var dHtml = (info.inVocab && info.d != null) ? '<span class="d-badge d' + info.d + '">难度 ' + info.d + '/10</span>' : '';
      var zh = (info.inVocab && info.zh) ? '<div class="zh">' + esc(info.zh) + '</div>' : '';
      var note = info.has_note ? '<div class="note-line">💡 ' + esc(info.note || '') + '</div>' : '';
      var md = dHtml ? '<div class="meta">' + dHtml + '</div>' : '';
      var phon = (info.inVocab && info.phonetic) ? '<span class="phonetic">/' + esc(cleanPhon(info.phonetic)) + '/</span>' : '';
      var speak = /^[a-z]+$/.test(op.word || '') ? '<button class="speak" data-word="' + esc(op.word) + '">🔊</button>' : '';
      box.className = 'last-word';
      box.innerHTML = '<div class="chain-panel">' +
        '<div class="prev-word"><span class="tag">上上</span><span class="w">' + esc(op.word) + '</span>' + speak + phon +
        '<span class="who">' + esc(who) + ' 出词</span>' + zh + note + md + '</div>' +
        '<div class="cur-word thinking"><span class="tag">上</span><span class="w">思考中…</span></div>' +
        '</div>';
      return;
    }
    var ents = state.chain || [];
    if (!ents.length) { box.className = 'last-word empty'; box.innerHTML = '等待开局词…'; return; }
    box.className = 'last-word';
    var html = '<div class="chain-panel">';
    if (ents.length === 2) html += chainRow(ents[0], '上上', false);
    html += chainRow(ents[ents.length - 1], '上', true);
    box.innerHTML = html + '</div>';
  }

  function renderAI() {
    var box = $('ai-info');
    if (state.aiInfo) { box.textContent = state.aiInfo; box.classList.remove('hidden'); }
    else box.classList.add('hidden');
  }

  var recordsCache = [];
  function renderRecords() {
    var box = $('log-list'); box.innerHTML = ''; recordsCache = [];
    var items = [];
    // 当前局(进行中)
    if (state && state.log && state.log.length) {
      var words = state.log.filter(function (e) { return e.kind === 'start' || e.kind === 'chain'; })
        .map(function (e) { return { word: e.word, zh: e.zh || '', phonetic: e.phonetic || '', d: e.d }; });
      var u = {}, sumD = 0, cnt = 0;
      words.forEach(function (w) { u[w.word] = 1; if (w.d) { sumD += w.d; cnt++; } });
      items.push({ isCurrent: true, words: words, stats: { total: words.length, uniq: Object.keys(u).length, avgD: cnt ? sumD / cnt : 0, bestChain: roundBest } });
    }
    var past = loggedIn() ? (account.games || []) : history;
    past.forEach(function (r) { items.push(r); });
    if (!items.length) { box.innerHTML = '<p class="empty">还没有记录，先开始一局吧。</p>'; return; }
    items.forEach(function (it, i) { box.appendChild(recordRow(it, i)); recordsCache.push(it); });
  }

  function recordRow(it, i) {
    var row = document.createElement('div'); row.className = 'record-card';
    var isCur = it.isCurrent;
    var words = it.words || [];
    var t = isCur ? '本局（进行中）' : ('第 ' + (i) + ' 局 · ' + fmtTime(it.at));
    row.innerHTML =
      '<div class="record-head" data-i="' + i + '">' +
        '<span class="record-title">' + esc(t) + '</span>' +
        '<span class="record-meta">' + words.length + ' 词 · ' + (it.stats && it.stats.uniq ? it.stats.uniq : '') + ' 生词</span>' +
        '<div class="record-controls">' +
          '<button class="rec-toggle" data-i="' + i + '">展开</button>' +
        '</div>' +
      '</div>' +
      '<div class="record-body hidden" id="rec-body-' + i + '"></div>';
    return row;
  }
  function toggleRecord(i) {
    var i2 = Number(i), rec = recordsCache[i2], body = document.getElementById('rec-body-' + i2);
    if (!rec || !body) return;
    var btn = document.querySelector('.rec-toggle[data-i="' + i2 + '"]');
    var hidden = body.classList.contains('hidden');
    if (hidden) { body.innerHTML = recordWords(rec.words, rec.stats && rec.stats.mine != null ? rec.stats.mine : null); body.classList.remove('hidden'); if (btn) btn.textContent = '收起'; }
    else { body.classList.add('hidden'); if (btn) btn.textContent = '展开'; }
  }
  function fmtTime(t) {
    try { var d = new Date(t || Date.now()); return d.getMonth() + 1 + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    catch (e) { return ''; }
  }

  function renderControls() {
    if (!state) return;
    var online = (mode === 'online' && onlineActive);
    var cur = state.players[state.turn];
    var isMine = !online || (myName && cur && cur.name === myName);
    var isAI = !online && (cur.type === 'ai' || state.aiConceded);
    var blocked = isAI || (online && !isMine) || busy;
    $('word-input').disabled = blocked;
    $('submit-btn').disabled = blocked;
    $('concede-btn').disabled = isAI || busy || (online && !isMine);
    var ph;
    if (state.aiConceded) ph = '等待你确认 AI 认输…';
    else if (isAI) ph = 'AI 回合…';
    else if (online && !isMine) ph = '等待 ' + cur.name + ' 出词…';
    else ph = (state.needsStart ? '输入开局词' : '输入接龙词（接「' + state.lastWord + '」）');
    $('word-input').placeholder = ph;
  }

  // 朗读单词（浏览器 TTS）
  function speak(word) {
    try {
      if (!window.speechSynthesis) return;
      var u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  // 面板/日志点击：朗读 / 打开收起提示 / 记录区展开/详情
  function onPanelClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var btn = t.closest('.speak, .note-toggle, .rec-toggle');
    if (!btn) return;
    var cls = btn.className, word = btn.getAttribute('data-word');

    // 记录区：展开/折叠(点按钮或整条头部)
    if (cls === 'rec-toggle') {
      toggleRecord(btn.getAttribute('data-i')); return;
    }
    var head = t.closest('.record-head');
    if (head && head.getAttribute('data-i') != null) { toggleRecord(head.getAttribute('data-i')); return; }

    if (cls === 'speak') { if (word) speak(word); return; }
    if (cls !== 'note-toggle' || !word) return;
    var full = document.getElementById('note-full-' + word);
    if (!full) return;
    var hidden2 = full.classList.contains('hidden');
    full.classList.toggle('hidden', !hidden2);
    btn.textContent = hidden2 ? '收起提示' : '打开提示';
  }

  function recordWords(words, mine) {
    return words.map(function (w) {
      var mark = (mine != null && w.playerIdx === mine) ? ' <em class="me-tag">我</em>' : '';
      return '<div class="record-word"><b>' + esc(w.word) + '</b> <span class="phonetic">/' + esc(cleanPhon(w.phonetic)) + '/</span> <span>' + esc(w.zh || '') + '</span>' + mark + '</div>';
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
