/* localengine.js — 浏览器本地引擎（单文件离线版）
 * 复刻服务端逻辑：规则/AI/评分/快照/持久化防疲劳(localStorage)/AI 假装思考 540ms。
 * 暴露 window.__LOCAL_GAME__，供 app.js 在无服务端时调用。 */
(function () {
  'use strict';
  var R = window.WCRules;
  var db = window.__DB__ || [];
  var store = new R.WordStore(db);
  var sessions = {};
  var USAGE_KEY = 'wc_usage';
  var GAMES_KEY = 'wc_games', SEEN_KEY = 'wc_seen', BEST_KEY = 'wc_best';

  function loadUsage() { try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch (e) { return {}; } }
  function saveUsage(u) { try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) {} }
  function newId() { return 'loc' + Math.random().toString(36).slice(2, 10); }

  // 读取 localStorage 全部数据 → 用户学习画像（便携版：以浏览器为单位）
  function loadProfile() {
    var games = [], usage = {}, seen = [], best = 0;
    try { games = JSON.parse(localStorage.getItem(GAMES_KEY) || '[]'); } catch (e) {}
    try { usage = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch (e) {}
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) {}
    try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) {}
    if (!Array.isArray(games)) games = [];
    if (!Array.isArray(seen)) seen = [];
    try { return R.computeUserProfile(store, { games: games, usage: usage, seen: seen, best: best }); } catch (e) { return null; }
  }
  function profileSummary(p) {
    if (!p) return null;
    return { skill: p.skill, hasData: !!p.hasData, weakEndings: (p.weakEndings || []).slice(0, 8),
      bestChain: p.bestChain, avgChain: p.avgChain, games: p.games, knownCount: p.knownCount, noteSeen: p.noteSeen };
  }

  function enrichWord(w) {
    var e = store.lookup(w);
    if (!e) return { word: w, zh: '', phonetic: '', note: '', note_long: '', has_note: false, d: null, inVocab: false, chain_idx: null, has_succ: true, dead: false };
    return {
      word: w, zh: e.zh || '', phonetic: e.phonetic || '', note: e.note || '', note_long: e.note_long || '',
      has_note: !!e.has_note, d: e.diff != null ? e.diff : e.d, inVocab: true,
      chain_idx: e.chain_idx != null ? e.chain_idx : null, has_succ: e.has_succ !== false, dead: e.has_succ === false
    };
  }
  function enrichLogEntry(en) {
    var o = Object.assign({}, en);
    if (en.kind === 'start' || en.kind === 'chain') {
      var i = enrichWord(en.word);
      o.note = i.note; o.note_long = i.note_long; o.has_note = i.has_note; o.phonetic = i.phonetic;
      o.chain_idx = i.chain_idx; o.has_succ = i.has_succ; o.dead = i.dead;
      if (!o.zh) o.zh = i.zh;
    }
    return o;
  }
  function formatAI(r) {
    if (!r) return '';
    if (r.action === 'concede') return 'AI 无词可接，认输。';
    if (r.action === 'start') {
      var e = store.lookup(r.result.word);
      return 'AI 开局「' + r.result.word + '」难度 ' + (e ? (e.diff != null ? e.diff : e.d) : '?') + '/10。';
    }
    if (r.action === 'chain') {
      var c = r.candidate, t = (r.target == null) ? '尚无' : '≈' + r.target.toFixed(1);
      return 'AI 目标难度 ' + t + '，选「' + c.w + '」难度 ' + c.d + '/10（词频 ' + c.f.toFixed(2) + '，可接指数 ' + (c.chainIdx != null ? c.chainIdx.toFixed(2) : '?') + '）。';
    }
    return '';
  }
  function snapshot(game, sessionId, lastAI, pending, aiConceded) {
    return {
      sessionId: sessionId,
      players: game.players.map(function (p, i) {
        return {
          name: p.name, type: p.type, score: p.score, turn: i === game.turn,
          points: p.points || 0,
          properUsed: p.properUsed || 0,
          properLeft: Math.max(0, R.PROPER_QUOTA - (p.properUsed || 0))
        };
      }),
      properQuota: { perPlayer: R.PROPER_QUOTA, players: game.properQuotaInfo() },
      itemState: { perPlayer: R.ITEM_QUOTA, players: game.itemState() },
      reverseTurn: !!game.reverseTurn,
      account: null, profile: profileSummary(game.profile),
      turn: game.turn, starter: game.starter, round: game.round, roundActive: game.roundActive,
      needsStart: game.needsStart(), lastWord: game.lastWord, lastWordOwner: game.lastWordOwner,
      aiTarget: game.aiTarget(), aiInfo: lastAI || '', pending: pending || null, aiConceded: !!aiConceded,
      chain: game.chain.slice(-2).map(enrichLogEntry), chainLen: R.countWords(game.chain), log: game.log.map(enrichLogEntry),
      allUsedCount: Object.keys(game.allUsed).length
    };
  }
  function computeHint(game) {
    if (!game.lastWord) return { error: '还没有词，无法提示。' };
    if (game.currentPlayer().type !== 'human') return { error: '现在不是你的回合。' };
    var prev = game.lastWord, p2 = prev.slice(-2), p3 = prev.length >= 3 ? prev.slice(-3) : null;
    var prefixes = (p3 && p3 !== p2) ? [p2, p3] : [p2];
    var cands = store.candidates(prev, game.used).filter(function (c) { return c.has_succ !== false; }).slice(0, 3);
    var samples = cands.map(function (c) { return { word: c.w, zh: c.zh || '', phonetic: c.phonetic || '', note: c.note || '', d: c.d }; });
    return { ok: true, prefixes: prefixes, samples: samples };
  }
  function advanceAI(game, state) {
    var guard = 0;
    while (game.roundActive && game.currentPlayer().type === 'ai' && guard < 30) {
      var r = game.tickAI();
      if (r && (r.action === 'start' || r.action === 'chain')) state.lastAI = formatAI(r);
      else if (r && r.action === 'concede') { state.lastAI = formatAI({ action: 'concede' }); state.aiConceded = true; break; }
      else break;
      guard++;
    }
  }
  function doAction(game, kind, word, confirmed, state) {
    advanceAI(game, state);
    if (kind === 'start' || kind === 'chain') {
      if (game.currentPlayer().type !== 'human') return { error: '当前不是你的回合' };
      var res = kind === 'start' ? game.submitStart(word, { confirmed: !!confirmed }) : game.submitChain(word, { confirmed: !!confirmed });
      if (res && res.pending === 'non-vocab') state.pending = { word: res.word, reason: res.reason };
      else if (res && !res.ok) return { error: res.reason };
    } else if (kind === 'concede') {
      if (game.currentPlayer().type !== 'human') return { error: '当前不是你的回合' };
      game.concede('手动认输'); game.newRound(); advanceAI(game, state);
    } else if (kind === 'continue-round') {
      if (game.roundActive) return { error: '当前回合仍在进行，无需继续' };
      game.newRound(); advanceAI(game, state);
    } else return { error: 'unknown action' };
    advanceAI(game, state);
    return { ok: true, lastAI: state.lastAI, pending: state.pending, aiConceded: state.aiConceded };
  }
  function recordUsage(game, fromIdx, usage) {
    var mine = (game.myPlayerIdx == null) ? null : game.myPlayerIdx;   // 本地同屏"统计我的出词"
    for (var i = fromIdx || 0; i < game.log.length; i++) {
      var e = game.log[i];
      if (e.kind === 'start' || e.kind === 'chain') {
        if (mine != null && e.playerIdx !== mine) continue;
        usage[e.word] = (usage[e.word] || 0) + 1;
      }
    }
    saveUsage(usage);
  }

  window.__LOCAL_GAME__ = {
    lookup: function (word) { return Promise.resolve(enrichWord(word)); },
    profile: function () { return Promise.resolve(profileSummary(loadProfile())); },
    start: function (body) {
      var players = (body.playerArray && body.playerArray.length) ? body.playerArray : [{ name: '玩家', type: 'human' }, { name: 'AI', type: 'ai' }];
      var game = new R.Game(store, players);
      game.allUsed = Object.assign({}, loadUsage());  // 继承历史防疲劳
      // 画像作用于"人机对战"(含 AI)；PvP 全人类不用画像
      if (players.some(function (p) { return p.type === 'ai'; })) game.profile = loadProfile();
      if (body.explore) { game.explore = true; game.starter = 1; game.turn = 1; }
      // 本地同屏"统计我的出词"：标记我的玩家下标 → 防疲劳只算我的词
      if (typeof body.myPlayerIdx === 'number' && body.myPlayerIdx >= 0 && body.myPlayerIdx < players.length) game.myPlayerIdx = body.myPlayerIdx;
      var sid = newId(); sessions[sid] = { game: game };
      var lastAI = '';
      if (game.explore) { var r = game.tickAI(); if (r && r.action === 'start') lastAI = formatAI(r); }
      return Promise.resolve(snapshot(game, sid, lastAI, null, false));
    },
    action: function (body) {
      var sid = body.sessionId, game = sessions[sid] && sessions[sid].game;
      if (!game) return Promise.resolve({ error: '会话不存在' });
      var preLen = game.log.length;
      var st = { lastAI: '', pending: null, aiConceded: false };
      var out = doAction(game, body.kind, body.word, body.confirmed, st);
      if (out.error) return Promise.resolve({ error: out.error });
      var usage = loadUsage();
      recordUsage(game, preLen, usage);
      var snap = snapshot(game, sid, out.lastAI, out.pending, out.aiConceded);
      // AI 假装思考 540ms（仅当 AI 出了词）
      if (out.lastAI && !out.pending) return new Promise(function (res) { setTimeout(function () { res(snap); }, 540); });
      return Promise.resolve(snap);
    },
    hint: function (body) {
      var sid = body.sessionId, game = sessions[sid] && sessions[sid].game;
      if (!game) return Promise.resolve({ error: '会话不存在' });
      return Promise.resolve(computeHint(game));
    }
  };
})();
