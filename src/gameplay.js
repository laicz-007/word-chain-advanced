/* src/gameplay.js — 对局编排：会话表 + 处理一次人类动作 + 自动推进 AI */
'use strict';
var db = require('./db');
var view = require('./view');

var sessions = {}; // sessionId -> game

function createGame(players) { return new db.R.Game(db.store, players); }

// 只要轮到 AI 就替它出词，直到轮到人类 / AI 认输（暂停）/ 无动作
function advanceAI(game, state) {
  var guard = 0;
  while (game.roundActive && game.currentPlayer().type === 'ai' && guard < 30) {
    var r = game.tickAI();
    if (r && (r.action === 'start' || r.action === 'chain')) state.lastAI = view.formatAI(r);
    else if (r && r.action === 'concede') { state.lastAI = view.formatAI({ action: 'concede' }); state.aiConceded = true; break; } // 暂停，等待玩家确认
    else break;
    guard++;
  }
}

// 处理一次人类动作（start/chain/concede/continue-round）+ 自动处理 AI 回合
function doAction(game, kind, word, confirmed) {
  var state = { lastAI: '', pending: null, aiConceded: false };

  advanceAI(game, state); // 先自动跑 AI，确保轮到人类

  if (kind === 'start' || kind === 'chain') {
    if (game.currentPlayer().type !== 'human') return { error: '当前不是你的回合' };
    var res = kind === 'start'
      ? game.submitStart(word, { confirmed: !!confirmed })
      : game.submitChain(word, { confirmed: !!confirmed });
    if (res && res.pending === 'non-vocab') {
      state.pending = { word: res.word, reason: res.reason };
    } else if (res && !res.ok) {
      return { error: res.reason };
    }
  } else if (kind === 'concede') {
    if (game.currentPlayer().type !== 'human') return { error: '当前不是你的回合' };
    game.concede('手动认输');
    game.newRound();
    advanceAI(game, state); // 人类认输后若 AI 是开局者，让 AI 开局
  } else if (kind === 'continue-round') {
    if (game.roundActive) return { error: '当前回合仍在进行，无需继续' };
    game.newRound();        // 进入下一轮（认输方成为开局者）
    advanceAI(game, state); // 若 AI 是开局者，给出开局词
  } else {
    return { error: 'unknown action' };
  }

  advanceAI(game, state); // 人类行动后，再次自动推进 AI

  return { ok: true, lastAI: state.lastAI, pending: state.pending, aiConceded: state.aiConceded };
}

module.exports = { sessions: sessions, createGame: createGame, advanceAI: advanceAI, doAction: doAction };