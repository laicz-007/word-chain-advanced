/* src/rooms.js — 多设备联机房间（服务器版多人对战）
 * 房间模型：房主创建 → 玩家加入 → 房主开局 → 轮流接龙 → 房主可随时终止。
 * 房间对局复用同一套 R.Game 规则引擎（全人类玩家），仅按回合约束"当前出词人"。
 * 规则：一个账号同一时间只能在一个房间；加入/创建/开局均须登录(由 api 层校验)。
 */
'use strict';
var db = require('./db');
var view = require('./view');
var gameplay = require('./gameplay');
var points = require('./points');
var userdata = require('./userdata');

var rooms = Object.create(null);      // roomId -> room（空原型）
var userRoom = Object.create(null);   // username -> roomId（一个账号只能在一个房间）

function validRoomId(id) { return typeof id === 'string' && /^\d{6}$/.test(id); }

function newRoomId() {
  var id;
  do { id = String(100000 + Math.floor(Math.random() * 900000)); } while (rooms[id]);
  return id;
}

/* ---- 回合超时自动认输（默认 60 秒，可用环境变量 TURN_TIMEOUT_MS 覆盖，便于测试） ---- */
function turnTimeoutMs() { return Number(process.env.TURN_TIMEOUT_MS || 60000); }

function clearTurnTimer(r) {
  if (r.turnTimer) { clearTimeout(r.turnTimer); r.turnTimer = null; }
}

function armTurnTimer(r) {
  clearTurnTimer(r);
  r.turnDeadline = null;
  if (r.status !== 'playing' || !r.game || !r.game.roundActive) return;
  if (r.game.needsStart()) return;   // 开局词阶段不计时（开局者需思考，且避免超时后空转反复认输）
  var cur = r.game.players[r.game.turn];
  if (!cur || cur.type !== 'human') return;
  var ms = turnTimeoutMs();
  r.turnDeadline = Date.now() + ms;
  r.turnTimer = setTimeout(function () { onTurnTimeout(r); }, ms);
}

function onTurnTimeout(r) {
  if ((r.status !== 'playing' && r.status !== 'duel') || !r.game || !r.game.roundActive) return;
  if (Date.now() < (r.turnDeadline || 0)) return;   // 回合已变，作废
  var cur = r.game.players[r.game.turn];
  if (!cur || cur.type !== 'human') return;
  var why = '超时 ' + Math.round(turnTimeoutMs() / 1000) + ' 秒未出词，自动认输';
  r.game.concede(why);
  if (r.status === 'duel') { finishDuel(r, cur.name, why, true); return; }  // 单挑超时即结束本场
  r.game.newRound();
  r.notice = cur.name + ' 超时未出词，自动认输';
  r.updatedAt = Date.now();
  armTurnTimer(r);   // 新一轮继续计时
}

// 单挑邀请有效期（过期自动作废，避免"邀请挂着不动"把房间卡死）
function challengeTtlMs() { return Number(process.env.CHALLENGE_TTL_MS || 60000); }
var CHALLENGE_TTL_MS = challengeTtlMs();

/* ---- 1v1 单挑（房间内发起）----
 * 流程：房间成员 A 向 B 发起单挑 → B 选择接受/拒绝。
 * 按用户要求：**拒绝不判负**（拒绝只是不打，双方无任何惩罚）。
 * 接受后房间进入 'duel' 状态，A 与 B 进行一场 1v1；其余成员等待（可旁观）。
 * 单挑在"有人认输 / 超时未出词 / 单挑者离开"时结束，房间回到 'waiting'。
 */

// 结束单挑：回到房间等待状态并记录结果。
// alreadyScored=true 表示引擎侧已经计过分（例如认输路径里 gameplay.doAction 已 concede）
function finishDuel(r, loserName, reason, alreadyScored) {
  var d = r.duel, g = r.game;
  if (!d || !g) return;
  var winner = g.players.filter(function (p) { return p.name !== loserName; })[0];
  if (!alreadyScored && g.roundActive) g.concede(reason);   // 让引擎给胜者记分
  points.credit(g);                                        // 结算积分到各自账户（幂等）
  var winName = winner ? winner.name : '?';
  r.lastDuel = { winner: winName, loser: loserName, reason: reason, at: Date.now() };
  r.notice = '单挑结束：' + winName + ' 获胜（' + loserName + ' ' + reason + '）';
  r.game = null;
  r.duel = null;
  r.status = 'waiting';
  clearTurnTimer(r);
  r.updatedAt = Date.now();
}

function challengeRoom(username, roomId, target) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在' };
  if (r.players.indexOf(username) < 0) return { error: '你不在该房间中' };
  if (r.status !== 'waiting') return { error: '房间正在对局中，无法发起单挑' };
  if (!target) return { error: '请选择单挑对象' };
  if (target === username) return { error: '不能向自己发起单挑' };
  if (r.players.indexOf(target) < 0) return { error: '对方不在该房间中' };
  if (r.challenge && Date.now() - r.challenge.at > CHALLENGE_TTL_MS) r.challenge = null;  // 邀请过期作废，避免永久卡住
  if (r.challenge) return { error: '已有一个待应答的单挑，请等待对方回应' };
  r.challenge = { from: username, to: target, at: Date.now() };
  r.notice = username + ' 向 ' + target + ' 发起了单挑';
  r.updatedAt = Date.now();
  return { ok: true, challenge: r.challenge };
}

function respondChallenge(username, roomId, accept) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在' };
  var c = r.challenge;
  if (!c) return { error: '没有待应答的单挑' };
  if (c.to !== username && c.from !== username) return { error: '这个单挑与你无关' };
  // 发起者可以撤回自己的邀请
  if (c.from === username && !accept) {
    r.challenge = null;
    r.notice = username + ' 撤回了单挑邀请';
    r.updatedAt = Date.now();
    return { ok: true, accepted: false, cancelled: true };
  }
  if (c.to !== username) return { error: '这个单挑不是向你发起的' };
  r.challenge = null;
  if (r.status !== 'waiting') { r.notice = '房间状态已变化，单挑已作废'; r.updatedAt = Date.now(); return { ok: true, accepted: false, cancelled: true }; }
  if (!accept) {
    // 用户明确要求：拒绝不判负 —— 只是不打，没有任何惩罚
    r.notice = username + ' 拒绝了 ' + c.from + ' 的单挑';
    r.updatedAt = Date.now();
    return { ok: true, accepted: false };
  }
  if (r.players.indexOf(c.from) < 0) {
    r.notice = '发起者已离开，单挑取消';
    r.updatedAt = Date.now();
    return { ok: true, accepted: false, cancelled: true };
  }
  r.game = gameplay.createGame([{ name: c.from, type: 'human' }, { name: username, type: 'human' }]);
  r.duel = { players: [c.from, username], at: Date.now() };
  r.status = 'duel';
  r.notice = '单挑开始：' + c.from + ' vs ' + username;
  r.updatedAt = Date.now();
  armTurnTimer(r);
  return { ok: true, accepted: true };
}

function createRoom(username) {
  if (userRoom[username]) return { error: '你已在房间 ' + userRoom[username] + ' 中，请先离开' };
  var id = newRoomId();
  var r = { id: id, host: username, players: [username], status: 'waiting', game: null,
            notice: username + ' 创建了房间', createdAt: Date.now(), updatedAt: Date.now() };
  rooms[id] = r;
  userRoom[username] = id;
  return { ok: true, roomId: id };
}

function joinRoom(username, roomId) {
  if (!validRoomId(roomId)) return { error: '房间号应为 6 位数字' };
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在（房间号错误或已解散）' };
  if (r.status !== 'waiting') return { error: '对局已开始，无法加入' };
  if (r.players.indexOf(username) >= 0) return { ok: true, roomId: roomId }; // 已在房里（刷新场景）
  if (userRoom[username]) return { error: '你已在其他房间中，请先离开' };
  if (r.players.length >= 6) return { error: '房间已满（最多 6 人）' };
  r.players.push(username);
  userRoom[username] = roomId;
  r.notice = username + ' 加入了房间';
  r.updatedAt = Date.now();
  return { ok: true, roomId: roomId };
}

// 把成员移出房间，并处理房主转移 / 空房解散 / 作废与自己相关的待应答单挑
function removeFromRoom(r, roomId, username, i, notice) {
  r.players.splice(i, 1);
  if (userRoom[username] === roomId) delete userRoom[username];
  r.notice = username + ' ' + notice;
  if (r.challenge && (r.challenge.from === username || r.challenge.to === username)) r.challenge = null;
  if (r.players.length === 0) { delete rooms[roomId]; return { ok: true, dissolved: true }; }
  if (username === r.host) { r.host = r.players[0]; r.notice += '；' + r.host + ' 成为新房主'; }
  r.status = r.game ? r.status : 'waiting';   // 还有对局在跑就保持原状态，否则回等待
  r.updatedAt = Date.now();
  return { ok: true };
}

function leaveRoom(username, roomId) {
  var r = rooms[roomId];
  if (!r) return { ok: true };
  var i = r.players.indexOf(username);
  if (i < 0) return { ok: true };

  var inGame = (r.status === 'playing' || r.status === 'duel');
  if (!inGame) return removeFromRoom(r, roomId, username, i, '离开了房间');

  // 单挑进行中：旁观者离开不影响单挑；单挑者离开 → 对手获胜
  var isDuelist = !!(r.duel && r.duel.players.indexOf(username) >= 0);
  if (r.status === 'duel' && !isDuelist) return removeFromRoom(r, roomId, username, i, '离开了房间（单挑继续）');
  if (r.status === 'duel') finishDuel(r, username, '离开房间', false);
  else { clearTurnTimer(r); r.game = null; }
  return removeFromRoom(r, roomId, username, i, '离开，对局已终止');
}

function startRoom(username, roomId) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在' };
  if (r.host !== username) return { error: '只有房主能开始对局' };
  if (r.status !== 'waiting') return { error: '对局已开始' };
  if (r.players.length < 2) return { error: '至少需要 2 人才能开始' };
  var players = r.players.map(function (n) { return { name: n, type: 'human' }; });
  r.game = gameplay.createGame(players);
  r.status = 'playing';
  r.notice = '房主开始了对局';
  r.updatedAt = Date.now();
  armTurnTimer(r);   // 首个回合开始计时
  return { ok: true };
}

function terminateRoom(username, roomId) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在' };
  if (r.host !== username) return { error: '只有房主能终止对局' };
  if (r.status === 'duel') {
    // 房主终止单挑（无胜负判定，直接取消）
    clearTurnTimer(r);
    r.game = null; r.duel = null; r.status = 'waiting';
    r.notice = '房主终止了单挑，可重新开始';
    r.updatedAt = Date.now();
    return { ok: true };
  }
  if (r.status !== 'playing') return { error: '当前没有进行中的对局' };
  clearTurnTimer(r);
  r.status = 'waiting';
  r.game = null;
  r.notice = '房主终止了对局，可重新开始';
  r.updatedAt = Date.now();
  return { ok: true };
}

// 处理一次行动（仅限当前回合玩家）。返回 {ok} 或 {error}；结束后由客户端轮询同步。
function roomAction(username, roomId, kind, word, confirmed, itemKind) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在' };
  if ((r.status !== 'playing' && r.status !== 'duel') || !r.game) return { error: '对局未在进行' };
  var g = r.game;
  var cur = g.players[g.turn];
  if (!cur || cur.name !== username) return { error: '还没轮到你出词' };
  var out = gameplay.doAction(g, kind, word, confirmed, itemKind);
  if (out.error) return { error: out.error };
  points.credit(g);   // 联机房间：玩家名就是用户名 → 各自结算到自己的账户（幂等）
  r.updatedAt = Date.now();
  // 单挑：出现"认输"即结束本场（引擎在 doAction 内已 concede 给胜者记分，故 alreadyScored=true）
  if (r.status === 'duel' && kind === 'concede') {
    finishDuel(r, username, '认输', true);
    return { ok: true, duelEnded: true, notice: r.notice };
  }
  armTurnTimer(r);   // 轮到下一位，重新计时
  return { ok: true, pending: out.pending || null };
}

function getUserRoom(username) {
  return userRoom[username] && rooms[userRoom[username]] ? userRoom[username] : null;
}

// 解散房间（仅房主）：整房移除，所有成员都退出
function dissolveRoom(username, roomId) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在' };
  if (r.host !== username) return { error: '只有房主能解散房间' };
  clearTurnTimer(r);
  r.players.forEach(function (p) { if (userRoom[p] === roomId) delete userRoom[p]; });
  delete rooms[roomId];
  return { ok: true };
}

// 生成某一玩家的房间视图（用于轮询同步）
function roomState(username, roomId) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在（可能已解散）' };
  if (r.players.indexOf(username) < 0) return { error: '你已不在该房间中' };
  var out = {
    ok: true, roomId: r.id, host: r.host, status: r.status,
    players: r.players.slice(), me: username, isHost: (r.host === username),
    notice: r.notice, seq: r.updatedAt
  };
  // 该玩家的账户积分/道具库存（联机房间的玩家名就是用户名）
  var ud = userdata.loadUserData(username);
  out.myPoints = ud.points || 0;
  out.myItems = ud.items || {};
  // 单挑相关信息（供前端渲染"邀请/接受/拒绝"与倒计时）
  out.challenge = r.challenge || null;
  out.duel = r.duel || null;
  out.lastDuel = r.lastDuel || null;
  if ((r.status === 'playing' || r.status === 'duel') && r.game) {
    out.game = view.snapshot(r.game, r.id, '', null, false);
    out.myTurn = !!(out.game.players[out.game.turn] && out.game.players[out.game.turn].name === username);
    out.turnDeadline = r.turnDeadline || null;
    out.turnMsLeft = r.turnDeadline ? Math.max(0, r.turnDeadline - Date.now()) : null;
  }
  return out;
}

module.exports = {
  rooms: rooms,
  userRoom: userRoom,
  createRoom: createRoom,
  joinRoom: joinRoom,
  leaveRoom: leaveRoom,
  startRoom: startRoom,
  terminateRoom: terminateRoom,
  dissolveRoom: dissolveRoom,
  roomAction: roomAction,
  challengeRoom: challengeRoom,
  respondChallenge: respondChallenge,
  finishDuel: finishDuel,
  getUserRoom: getUserRoom,
  roomState: roomState
};