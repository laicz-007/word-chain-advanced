'use strict';
/* 联机房间集成测试：创建/加入/开局/回合/越权/终止/离开/转让/解散 + 未登录 corner case */
var fs = require('fs');
var path = require('path');
var srv = require('../server.js');
var PORT = 8200;
var BASE = 'http://127.0.0.1:' + PORT;

var pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function post(p, b) { return fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }
function get(p) { return fetch(BASE + p).then(function (r) { return r.json(); }); }
async function reg(name) {
  var r = await post('/api/register', { username: name, password: 'pass1234' });
  return { name: name, token: r.token };
}

(async function () {
  await new Promise(function (res) { srv.start(PORT); setTimeout(res, 250); });
  var stem = 'tr' + Math.random().toString(36).slice(2, 8);
  var A = await reg(stem + '_a');
  var B = await reg(stem + '_b');
  var C = await reg(stem + '_c');
  var D = await reg(stem + '_d');
  var E = await reg(stem + '_e');
  var F = await reg(stem + '_f');

  /* ---- 创建 / 加入 ---- */
  var cr = await post('/api/room/create', { token: A.token });
  check('创建房间返回 6 位房间号', cr.ok && /^\d{6}$/.test(cr.roomId));
  var rid = cr.roomId;
  check('同一账号重复创建被拒', !!(await post('/api/room/create', { token: A.token })).error);
  check('加入不存在的房间被拒', !!(await post('/api/room/join', { token: B.token, roomId: '000000' })).error);
  check('B 加入成功', (await post('/api/room/join', { token: B.token, roomId: rid })).ok);
  check('C 加入成功', (await post('/api/room/join', { token: C.token, roomId: rid })).ok);
  check('B 重复加入(已在房)返回 ok', (await post('/api/room/join', { token: B.token, roomId: rid })).ok);
  check('非房主开局被拒', !!(await post('/api/room/start', { token: B.token, roomId: rid })).error);
  var sA = await get('/api/room/state?token=' + encodeURIComponent(A.token) + '&roomId=' + rid);
  check('等待中: 3 人 + A 房主', sA.ok && sA.players.length === 3 && sA.isHost && sA.status === 'waiting');

  var cr2 = await post('/api/room/create', { token: D.token });
  check('单人房开局被拒(需≥2人)', !!(await post('/api/room/start', { token: D.token, roomId: cr2.roomId })).error);

  /* ---- 开局 ---- */
  check('房主开局成功', (await post('/api/room/start', { token: A.token, roomId: rid })).ok);
  check('重复开局被拒', !!(await post('/api/room/start', { token: A.token, roomId: rid })).error);
  check('对局中加入被拒', !!(await post('/api/room/join', { token: D.token, roomId: rid })).error);
  var pA = await get('/api/room/state?token=' + encodeURIComponent(A.token) + '&roomId=' + rid);
  var pB = await get('/api/room/state?token=' + encodeURIComponent(B.token) + '&roomId=' + rid);
  check('开局后 playing + 有 game', pA.status === 'playing' && !!pA.game);
  check('开局后轮到房主 A', pA.myTurn === true);
  check('开局后 B 非当前回合', pB.myTurn === false);

  /* ---- 回合 / 越权 ---- */
  var a1 = await post('/api/room/action', { token: A.token, roomId: rid, kind: 'start', word: 'cat' });
  check('A 开局出词成功', a1.ok && !a1.error);
  check('A 越回合出词被拒', !!(await post('/api/room/action', { token: A.token, roomId: rid, kind: 'chain', word: 'atom' })).error);
  var b1 = await post('/api/room/action', { token: B.token, roomId: rid, kind: 'chain', word: 'atom' });
  check('B 正常接龙成功', !!b1.ok);
  check('B 再次越回合出词被拒', !!(await post('/api/room/action', { token: B.token, roomId: rid, kind: 'chain', word: 'money' })).error);

  /* ---- 终止 ---- */
  check('非房主终止被拒', !!(await post('/api/room/terminate', { token: B.token, roomId: rid })).error);
  check('房主终止成功', (await post('/api/room/terminate', { token: A.token, roomId: rid })).ok);
  var after = await get('/api/room/state?token=' + encodeURIComponent(A.token) + '&roomId=' + rid);
  check('终止后回等待、无 game、3 人', after.status === 'waiting' && !after.game && after.players.length === 3);
  check('终止后可再次开局', (await post('/api/room/start', { token: A.token, roomId: rid })).ok);

  /* ---- 对局中离开 ---- */
  check('对局中 C 离开 OK', (await post('/api/room/leave', { token: C.token, roomId: rid })).ok);
  var s2 = await get('/api/room/state?token=' + encodeURIComponent(A.token) + '&roomId=' + rid);
  check('C 离开后回等待、剩 2 人', s2.status === 'waiting' && s2.players.length === 2);

  /* ---- 房主离开转让 / 解散 ---- */
  check('房主 A 离开 OK', (await post('/api/room/leave', { token: A.token, roomId: rid })).ok);
  var s3 = await get('/api/room/state?token=' + encodeURIComponent(B.token) + '&roomId=' + rid);
  check('房主离开后 B 成为房主', s3.isHost === true && s3.host === B.name);
  check('最后一人 B 离开 OK', (await post('/api/room/leave', { token: B.token, roomId: rid })).ok);
  check('空房间已解散(再查报错)', !!(await get('/api/room/state?token=' + encodeURIComponent(B.token) + '&roomId=' + rid)).error);

  /* ---- 解散房间（房主专属） ---- */
  var crE = await post('/api/room/create', { token: E.token });
  check('E 创建房间成功', crE.ok && /^\d{6}$/.test(crE.roomId));
  await post('/api/room/join', { token: F.token, roomId: crE.roomId });
  check('非房主解散被拒', !!(await post('/api/room/dissolve', { token: F.token, roomId: crE.roomId })).error);
  check('房主 E 解散成功', (await post('/api/room/dissolve', { token: E.token, roomId: crE.roomId })).ok);
  var sGoneE = await get('/api/room/state?token=' + encodeURIComponent(F.token) + '&roomId=' + crE.roomId);
  check('解散后成员查状态报房间不存在', sGoneE.error === '房间不存在（可能已解散）');
  check('解散后 room/mine 为 null', (await get('/api/room/mine?token=' + encodeURIComponent(E.token))).roomId === null);

  /* ---- 60 秒超时自动认输（测试用短超时 600ms） ---- */
  process.env.TURN_TIMEOUT_MS = '600';
  var crT = await post('/api/room/create', { token: E.token });
  await post('/api/room/join', { token: F.token, roomId: crT.roomId });
  await post('/api/room/start', { token: E.token, roomId: crT.roomId });
  var st0 = await get('/api/room/state?token=' + encodeURIComponent(E.token) + '&roomId=' + crT.roomId);
  check('开局后 E 是回合方', st0.myTurn === true);
  check('开局词阶段不计时(turnDeadline 为空)', !st0.turnDeadline);
  // E 出开局词 -> 轮到 F 接龙，F 开始计时
  await post('/api/room/action', { token: E.token, roomId: crT.roomId, kind: 'start', word: 'cat' });
  var st1 = await get('/api/room/state?token=' + encodeURIComponent(F.token) + '&roomId=' + crT.roomId);
  check('接龙阶段开始计时(F 的 turnDeadline 有值)', st1.myTurn === true && !!st1.turnDeadline && st1.turnMsLeft >= 0);
  await new Promise(function (r) { setTimeout(r, 900); });   // F 超时未出词
  var stT = await get('/api/room/state?token=' + encodeURIComponent(E.token) + '&roomId=' + crT.roomId);
  check('超时后自动认输(notice 提示)', /超时/.test(stT.notice || ''));
  check('超时后游戏日志含认输记录', stT.game && stT.game.log.some(function (e) { return e.kind === 'concede'; }));
  check('认输后回到开局词阶段(不再计时)', stT.status === 'playing' && !stT.turnDeadline);
  await post('/api/room/dissolve', { token: E.token, roomId: crT.roomId });
  delete process.env.TURN_TIMEOUT_MS;

  /* ---- 1v1 单挑（房间内发起；按用户要求：拒绝不判负）---- */
  var cD = await post('/api/room/create', { token: A.token });
  var did = cD.roomId;
  await post('/api/room/join', { token: B.token, roomId: did });
  await post('/api/room/join', { token: C.token, roomId: did });

  check('单挑: 未登录发起被拒', !!(await post('/api/room/challenge', { roomId: did, target: B.name })).error);
  check('单挑: 不能向自己发起', !!(await post('/api/room/challenge', { token: A.token, roomId: did, target: A.name })).error);
  check('单挑: 不能向不在房的人发起', !!(await post('/api/room/challenge', { token: A.token, roomId: did, target: 'nobody_x' })).error);
  var ch = await post('/api/room/challenge', { token: A.token, roomId: did, target: B.name });
  check('单挑: 发起成功', ch.ok === true && ch.challenge.from === A.name && ch.challenge.to === B.name);
  check('单挑: 同时只能有一个待应答邀请',
    !!(await post('/api/room/challenge', { token: C.token, roomId: did, target: B.name })).error);
  var sCh = await get('/api/room/state?token=' + encodeURIComponent(B.token) + '&roomId=' + did);
  check('单挑: 房间状态暴露邀请给被邀请人', sCh.challenge && sCh.challenge.to === B.name);
  check('单挑: 非当事人不能应答', !!(await post('/api/room/challenge/respond', { token: C.token, roomId: did, accept: true })).error);

  // 关键：拒绝不判负
  var ptsABefore = (await get('/api/me?token=' + encodeURIComponent(A.token))).points;
  var dec = await post('/api/room/challenge/respond', { token: B.token, roomId: did, accept: false });
  check('单挑: 拒绝成功且无任何惩罚', dec.ok === true && dec.accepted === false);
  var sDec = await get('/api/room/state?token=' + encodeURIComponent(A.token) + '&roomId=' + did);
  check('单挑: 拒绝后房间回到等待、无结果记录', sDec.status === 'waiting' && !sDec.lastDuel && !sDec.challenge);
  check('单挑: 拒绝后发起者积分不变（未判负）',
    (await get('/api/me?token=' + encodeURIComponent(A.token))).points === ptsABefore);

  // 接受 → 进入单挑
  await post('/api/room/challenge', { token: A.token, roomId: did, target: B.name });
  var acc = await post('/api/room/challenge/respond', { token: B.token, roomId: did, accept: true });
  check('单挑: 接受后进入 duel 状态', acc.ok === true && acc.accepted === true);
  var sDuel = await get('/api/room/state?token=' + encodeURIComponent(A.token) + '&roomId=' + did);
  check('单挑: 状态为 duel 且对局含两位单挑者',
    sDuel.status === 'duel' && sDuel.game && sDuel.game.players.length === 2 &&
    sDuel.duel.players.indexOf(A.name) >= 0 && sDuel.duel.players.indexOf(B.name) >= 0);
  check('单挑: 发起者先手（轮到 A 给开局词）', sDuel.myTurn === true || sDuel.game.players[sDuel.game.turn].name === A.name);
  check('单挑: 旁观者不能出词',
    !!(await post('/api/room/action', { token: C.token, roomId: did, kind: 'start', word: 'cat' })).error);

  // 打完：B 认输 → A 获胜，单人局结束
  var ptsABefore2 = (await get('/api/me?token=' + encodeURIComponent(A.token))).points;
  await post('/api/room/action', { token: A.token, roomId: did, kind: 'start', word: 'apple' });
  var endRes = await post('/api/room/action', { token: B.token, roomId: did, kind: 'concede' });
  check('单挑: 认输即结束本场', endRes.ok === true && endRes.duelEnded === true);
  var sEnd = await get('/api/room/state?token=' + encodeURIComponent(A.token) + '&roomId=' + did);
  check('单挑: 结束后回到等待并记录结果',
    sEnd.status === 'waiting' && sEnd.lastDuel && sEnd.lastDuel.winner === A.name && sEnd.lastDuel.loser === B.name);
  check('单挑: 胜者获得积分（已结算到账户）',
    (await get('/api/me?token=' + encodeURIComponent(A.token))).points > ptsABefore2);
  check('单挑: 结束后可再次发起', (await post('/api/room/challenge', { token: C.token, roomId: did, target: A.name })).ok === true);
  await post('/api/room/challenge/respond', { token: A.token, roomId: did, accept: false });
  // 注意：必须解散这个单挑房间，否则后面的 "room/mine 为 null" 检查会因 A 仍在房间而失败
  await post('/api/room/dissolve', { token: A.token, roomId: did });
  check('单挑: 解散房间后成员都不再属于任何房间',
    (await get('/api/room/mine?token=' + encodeURIComponent(A.token))).roomId === null);

  /* ---- room/mine ---- */
  check('离开后 room/mine 为 null', (await get('/api/room/mine?token=' + encodeURIComponent(A.token))).roomId === null);

  /* ---- 未登录 ---- */
  check('未登录创建被拒', !!(await post('/api/room/create', {})).error);
  check('未登录加入被拒', !!(await post('/api/room/join', { roomId: '123456' })).error);
  check('未登录查状态被拒', !!(await get('/api/room/state?roomId=123456')).error);

  /* ---- 清理 ---- */
  try {
    var uf = path.join(__dirname, '..', 'data', 'users.json');
    var users = JSON.parse(fs.readFileSync(uf, 'utf8'));
    [A, B, C, D, E, F].forEach(function (u) { delete users[u.name]; });
    fs.writeFileSync(uf, JSON.stringify(users));
    [A, B, C, D, E, F].forEach(function (u) { try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'sync', u.name + '.json')); } catch (e) {} });
  } catch (e) {}

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();