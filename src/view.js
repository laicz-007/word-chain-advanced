/* src/view.js — 视图层：把游戏状态 + 数据库字段（知识点等）组装成给前端的快照/提示 */
'use strict';
var db = require('./db');

function enrichWord(w) {
  var e = db.store.lookup(w);
  if (!e) return { word: w, zh: '', phonetic: '', note: '', note_long: '', has_note: false, d: null, inVocab: false, chain_idx: null, has_succ: true, dead: false, proper: false };
  return {
    word: w,
    zh: e.zh || '',
    phonetic: e.phonetic || '',
    note: e.note || '',
    note_long: e.note_long || '',
    has_note: !!e.has_note,
    d: e.diff != null ? e.diff : e.d,
    inVocab: true,
    proper: db.R.isProperEntry(e),   // 专名（人名/地名/姓氏）→ 前端打标 + 计入限额
    chain_idx: e.chain_idx != null ? e.chain_idx : null,
    has_succ: e.has_succ !== false,
    dead: e.has_succ === false
  };
}

function enrichLogEntry(en) {
  var enriched = Object.assign({}, en);
  if (en.kind === 'start' || en.kind === 'chain') {
    var info = enrichWord(en.word);
    enriched.note = info.note;
    enriched.note_long = info.note_long;
    enriched.has_note = info.has_note;
    enriched.phonetic = info.phonetic;
    enriched.chain_idx = info.chain_idx;
    enriched.has_succ = info.has_succ;
    enriched.dead = info.dead;
    if (enriched.proper == null) enriched.proper = info.proper;
    if (!enriched.zh) enriched.zh = info.zh;
  }
  return enriched;
}

// AI 行动说明（前端展示 AI 选词依据）
function formatAI(r) {
  if (!r) return '';
  if (r.action === 'concede') return 'AI 无词可接，认输。';
  if (r.action === 'start') {
    var e = db.store.lookup(r.result.word);
    return 'AI 开局「' + r.result.word + '」难度 ' + (e ? (e.diff != null ? e.diff : e.d) : '?') + '/10。';
  }
  if (r.action === 'chain') {
    var c = r.candidate;
    var t = (r.target == null) ? '尚无' : '≈' + r.target.toFixed(1);
    return 'AI 目标难度 ' + t + '，选「' + c.w + '」难度 ' + c.d + '/10（词频 ' + c.f.toFixed(2) + '，可接指数 ' + (c.chainIdx != null ? c.chainIdx.toFixed(2) : '?') + '）。';
  }
  return '';
}

// 画像精简摘要（前端"学习画像"面板 + 账户接口返回）
function profileSummary(p) {
  if (!p) return null;
  return { skill: p.skill, hasData: !!p.hasData, weakEndings: (p.weakEndings || []).slice(0, 8),
    bestChain: p.bestChain, avgChain: p.avgChain, games: p.games, knownCount: p.knownCount, noteSeen: p.noteSeen };
}

function snapshot(game, sessionId, lastAI, pending, aiConceded) {
  var aiTarget = game.aiTarget();
  return {
    sessionId: sessionId,
    players: game.players.map(function (p, i) {
      return {
        name: p.name, type: p.type, score: p.score, turn: i === game.turn,
        points: p.points || 0,                                        // 本局累积积分
        properUsed: p.properUsed || 0,
        properLeft: Math.max(0, db.R.PROPER_QUOTA - (p.properUsed || 0))
      };
    }),
    properQuota: { perPlayer: db.R.PROPER_QUOTA, players: game.properQuotaInfo() },
    account: game.user || null,
    profile: game.profile ? profileSummary(game.profile) : null,
    turn: game.turn,
    starter: game.starter,
    round: game.round,
    roundActive: game.roundActive,
    needsStart: game.needsStart(),
    lastWord: game.lastWord,
    lastWordOwner: game.lastWordOwner,
    aiTarget: aiTarget,
    aiInfo: lastAI || '',
    pending: pending || null,
    aiConceded: !!aiConceded,
    chain: game.chain.slice(-2).map(enrichLogEntry),
    chainLen: game.chain.length,
    log: game.log.map(enrichLogEntry),
    allUsedCount: Object.keys(game.allUsed).length
  };
}

// 提示：给出需要的开头前缀 + 1-2 个能接的词（带释义）
function computeHint(game) {
  if (!game.lastWord) return { error: '还没有词，无法提示。' };
  if (game.currentPlayer().type !== 'human') return { error: '现在不是你的回合。' };
  var prev = game.lastWord, p2 = prev.slice(-2), p3 = prev.length >= 3 ? prev.slice(-3) : null;
  var prefixes = (p3 && p3 !== p2) ? [p2, p3] : [p2];
  var cands = db.store.candidates(prev, game.used).filter(function (c) { return c.has_succ !== false; }).slice(0, 3);
  var samples = cands.map(function (c) { return { word: c.w, zh: c.zh || '', phonetic: c.phonetic || '', note: c.note || '', d: c.d }; });
  return { ok: true, prefixes: prefixes, samples: samples };
}

module.exports = {
  enrichWord: enrichWord,
  enrichLogEntry: enrichLogEntry,
  formatAI: formatAI,
  profileSummary: profileSummary,
  snapshot: snapshot,
  computeHint: computeHint
};