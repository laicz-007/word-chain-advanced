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
  if (r.status !== 'playing' || !r.game || !r.game.roundActive) return;
  if (Date.now() < (r.turnDeadline || 0)) return;   // 回合已变，作废
  var cur = r.game.players[r.game.turn];
  if (!cur || cur.type !== 'human') return;
  r.game.concede('超时 ' + Math.round(turnTimeoutMs() / 1000) + ' 秒未出词，自动认输');
  r.game.newRound();
  r.notice = cur.name + ' 超时未出词，自动认输';
  r.updatedAt = Date.now();
  armTurnTimer(r);   // 新一轮继续计时
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

function leaveRoom(username, roomId) {
  var r = rooms[roomId];
  if (!r) return { ok: true };
  var i = r.players.indexOf(username);
  if (i < 0) return { ok: true };
  if (r.status === 'playing') {
    // 对局中有人离开 → 本局终止，回大厅；离开者被移出
    clearTurnTimer(r);
    r.players.splice(i, 1);
    if (userRoom[username] === roomId) delete userRoom[username];
    r.status = 'waiting';
    r.game = null;
    r.notice = username + ' 离开，对局已终止';
    if (r.players.length === 0) { delete rooms[roomId]; return { ok: true, dissolved: true }; }
    if (username === r.host) { r.host = r.players[0]; r.notice += '；' + r.host + ' 成为新房主'; }
    r.updatedAt = Date.now();
    return { ok: true };
  }
  // 等待中：直接移出
  r.players.splice(i, 1);
  if (userRoom[username] === roomId) delete userRoom[username];
  r.notice = username + ' 离开了房间';
  if (r.players.length === 0) { delete rooms[roomId]; return { ok: true, dissolved: true }; }
  if (username === r.host) { r.host = r.players[0]; r.notice += '；' + r.host + ' 成为新房主'; }
  r.updatedAt = Date.now();
  return { ok: true };
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
  if (r.status !== 'playing') return { error: '当前没有进行中的对局' };
  clearTurnTimer(r);
  r.status = 'waiting';
  r.game = null;
  r.notice = '房主终止了对局，可重新开始';
  r.updatedAt = Date.now();
  return { ok: true };
}

// 处理一次行动（仅限当前回合玩家）。返回 {ok} 或 {error}；结束后由客户端轮询同步。
function roomAction(username, roomId, kind, word, confirmed) {
  var r = rooms[roomId];
  if (!r) return { error: '房间不存在' };
  if (r.status !== 'playing' || !r.game) return { error: '对局未在进行' };
  var g = r.game;
  var cur = g.players[g.turn];
  if (!cur || cur.name !== username) return { error: '还没轮到你出词' };
  var out = gameplay.doAction(g, kind, word, confirmed);
  if (out.error) return { error: out.error };
  points.credit(g);   // 联机房间：玩家名就是用户名 → 各自结算到自己的账户（幂等）
  r.updatedAt = Date.now();
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
  if (r.status === 'playing' && r.game) {
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
  getUserRoom: getUserRoom,
  roomState: roomState
};