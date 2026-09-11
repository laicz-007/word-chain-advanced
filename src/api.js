/* src/api.js — HTTP 层：路由 /api/* + 静态文件服务（数据与网页分离） */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var crypto = require('crypto');

var config = require('./config');
var db = require('./db');
var auth = require('./auth');
var userdata = require('./userdata');
var usage = require('./usage');
var view = require('./view');
var gameplay = require('./gameplay');
var rooms = require('./rooms');

function readBody(req, cb) {
  var data = '';
  req.on('data', function (c) { data += c; if (data.length > 1e6) req.destroy(); });
  req.on('end', function () {
    try { cb(JSON.parse(data || '{}')); } catch (e) { cb({}); }
  });
}

function json(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
}

function makeMime(filePath) {
  return config.MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function handleApi(req, res, pathname) {
  /* ---- 对局 ---- */
  if (pathname === '/api/start' && req.method === 'POST') {
    readBody(req, function (body) {
      var sid = crypto.randomBytes(8).toString('hex');
      var players = body.playerArray && body.playerArray.length
        ? body.playerArray
        : [{ name: body.name || '玩家', type: 'human' }, { name: 'AI', type: 'ai' }];
      var game = gameplay.createGame(players);
      // 绑定登录账号（token 有效且用户存在时）
      var uname = body.token ? auth.verifyToken(body.token) : null;
      if (uname && auth.hasUser(uname)) game.user = uname;
      usage.seedUsage(game);   // 防疲劳：登录按账户, 游客按全局
      // 画像只作用于"人机对战 + 已登录账户"
      if (game.user && players.some(function (p) { return p.type === 'ai'; })) game.profile = userdata.accountProfile(game.user);
      if (body.explore) { game.explore = true; game.starter = 1; game.turn = 1; } // 探索·发现：AI 先手
      // 本地同屏"统计我的出词"：标记我的玩家下标 → 防疲劳只算我的词
      if (typeof body.myPlayerIdx === 'number' && body.myPlayerIdx >= 0 && body.myPlayerIdx < players.length) game.myPlayerIdx = body.myPlayerIdx;
      gameplay.sessions[sid] = game;
      var lastAI = '';
      if (game.explore) { var r = game.tickAI(); if (r && r.action === 'start') lastAI = view.formatAI(r); }
      json(res, 200, view.snapshot(game, sid, lastAI, null));
    });
    return;
  }

  if (pathname === '/api/action' && req.method === 'POST') {
    readBody(req, function (body) {
      var game = gameplay.sessions[body.sessionId];
      if (!game) { json(res, 404, { error: '会话不存在' }); return; }
      var preLen = game.log.length;
      var out = gameplay.doAction(game, body.kind, body.word, body.confirmed);
      if (out.error) { json(res, 400, { error: out.error }); return; }
      usage.recordUsage(game, preLen); // 把本回合新用的词计入持久化防疲劳
      var snap = view.snapshot(game, body.sessionId, out.lastAI, out.pending, out.aiConceded);
      if (out.lastAI && !out.pending) { setTimeout(function () { json(res, 200, snap); }, 540); } // AI 假装思考
      else json(res, 200, snap);
    });
    return;
  }

  if (pathname === '/api/lookup' && req.method === 'GET') {
    var lq = url.parse(req.url, true).query;
    json(res, 200, view.enrichWord(decodeURIComponent(lq.word || '')));
    return;
  }

  if (pathname === '/api/hint' && req.method === 'POST') {
    readBody(req, function (body) {
      var game = gameplay.sessions[body.sessionId];
      if (!game) { json(res, 404, { error: '会话不存在' }); return; }
      json(res, 200, view.computeHint(game));
    });
    return;
  }

  if (pathname === '/api/reset-usage' && req.method === 'POST') {
    readBody(req, function (body) {
      var uname = body.token ? auth.verifyToken(body.token) : null;
      if (uname && auth.hasUser(uname)) usage.resetUsage(uname);
      else usage.resetUsage(null);
      json(res, 200, { ok: true, cleared: true });
    });
    return;
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    var sq = url.parse(req.url, true).query;
    var g = gameplay.sessions[sq.sessionId];
    if (!g) { json(res, 404, { error: '会话不存在' }); return; }
    json(res, 200, view.snapshot(g, sq.sessionId, '', null));
    return;
  }

  /* ---- 账号 ---- */
  if (pathname === '/api/register' && req.method === 'POST') {
    readBody(req, function (body) {
      var name = String(body.username || '').trim(), pw = String(body.password || '');
      if (!auth.validUsername(name)) { json(res, 400, { error: '用户名需 2-20 位字母/数字/_/-' }); return; }
      if (!auth.validPassword(pw)) { json(res, 400, { error: '密码需 4-64 位' }); return; }
      if (auth.hasUser(name)) { json(res, 400, { error: '该用户名已存在' }); return; }
      auth.users[name] = auth.makeUser(name, pw);
      auth.persistUsers();
      userdata.loadUserData(name); // 初始化账户数据(空)
      json(res, 200, { ok: true, token: auth.makeToken(name), username: name, profile: view.profileSummary(userdata.accountProfile(name)) });
    });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    readBody(req, function (body) {
      var name = String(body.username || '').trim(), pw = String(body.password || '');
      var u = auth.users[name];
      if (!u || !auth.verifyPw(u, pw)) { json(res, 401, { error: '用户名或密码错误' }); return; }
      json(res, 200, { ok: true, token: auth.makeToken(name), username: name, profile: view.profileSummary(userdata.accountProfile(name)) });
    });
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    json(res, 200, { ok: true }); // 无状态 token：客户端删除本地 token 即可
    return;
  }

  /* 修改密码（需登录）。成功后旧 token 全部失效，所以必须下发新 token 供当前设备继续登录。 */
  if (pathname === '/api/change-password' && req.method === 'POST') {
    readBody(req, function (body) {
      var pname = auth.verifyToken(body.token);
      if (!pname || !auth.hasUser(pname)) { json(res, 401, { error: '未登录或登录已过期' }); return; }
      var r = auth.changePw(pname, String(body.oldPassword || ''), String(body.newPassword || ''));
      if (r.error) { json(res, 400, { error: r.error }); return; }
      auth.persistUsers();
      json(res, 200, { ok: true, username: pname, token: auth.makeToken(pname) });
    });
    return;
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    var mq = url.parse(req.url, true).query;
    var mname = auth.verifyToken(mq.token);
    if (!mname || !auth.hasUser(mname)) { json(res, 401, { error: '未登录或登录已过期' }); return; }
    var md = userdata.loadUserData(mname);
    json(res, 200, { ok: true, username: mname, games: md.games, best: md.best, seen: md.seen, profile: view.profileSummary(userdata.accountProfile(mname)) });
    return;
  }

  if (pathname === '/api/record' && req.method === 'POST') {
    readBody(req, function (body) {
      var rname = auth.verifyToken(body.token);
      if (!rname || !auth.hasUser(rname)) { json(res, 401, { error: '未登录或登录已过期' }); return; }
      var rec = body.record;
      if (!rec || !rec.stats || !Array.isArray(rec.words)) { json(res, 400, { error: '记录格式错误' }); return; }
      var d = userdata.addRecord(rname, rec);
      json(res, 200, { ok: true, username: rname, games: d.games, best: d.best, seen: d.seen, profile: view.profileSummary(userdata.accountProfile(rname)) });
    });
    return;
  }

  /* ---- 联机房间（多设备服务器版多维对战；全部要求登录） ---- */
  function roomName(body) {
    var name = auth.verifyToken(body && body.token);
    if (!name || !auth.hasUser(name)) { json(res, 401, { error: '未登录或登录已过期' }); return null; }
    return name;
  }

  if (pathname === '/api/room/create' && req.method === 'POST') {
    readBody(req, function (body) { var n = roomName(body); if (n) json(res, 200, rooms.createRoom(n)); });
    return;
  }
  if (pathname === '/api/room/join' && req.method === 'POST') {
    readBody(req, function (body) {
      var n = roomName(body); if (!n) return;
      var rr = rooms.joinRoom(n, body.roomId);
      if (rr.error) json(res, 400, rr); else json(res, 200, rr);
    });
    return;
  }
  if (pathname === '/api/room/leave' && req.method === 'POST') {
    readBody(req, function (body) { var n = roomName(body); if (n) json(res, 200, rooms.leaveRoom(n, body.roomId)); });
    return;
  }
  if (pathname === '/api/room/start' && req.method === 'POST') {
    readBody(req, function (body) {
      var n = roomName(body); if (!n) return;
      var rr = rooms.startRoom(n, body.roomId);
      if (rr.error) json(res, 400, rr); else json(res, 200, rr);
    });
    return;
  }
  if (pathname === '/api/room/action' && req.method === 'POST') {
    readBody(req, function (body) {
      var n = roomName(body); if (!n) return;
      var rr = rooms.roomAction(n, body.roomId, body.kind, body.word, body.confirmed);
      if (rr.error) json(res, 400, rr); else json(res, 200, rr);
    });
    return;
  }
  if (pathname === '/api/room/terminate' && req.method === 'POST') {
    readBody(req, function (body) {
      var n = roomName(body); if (!n) return;
      var rr = rooms.terminateRoom(n, body.roomId);
      if (rr.error) json(res, 400, rr); else json(res, 200, rr);
    });
    return;
  }
  if (pathname === '/api/room/state' && req.method === 'GET') {
    var rq = url.parse(req.url, true).query;
    var rn = auth.verifyToken(rq.token);
    if (!rn || !auth.hasUser(rn)) { json(res, 401, { error: '未登录或登录已过期' }); return; }
    var rs = rooms.roomState(rn, rq.roomId);
    if (rs.error) json(res, 400, rs); else json(res, 200, rs);
    return;
  }
  if (pathname === '/api/room/mine' && req.method === 'GET') {
    var mq = url.parse(req.url, true).query;
    var mn = auth.verifyToken(mq.token);
    if (!mn || !auth.hasUser(mn)) { json(res, 401, { error: '未登录或登录已过期' }); return; }
    json(res, 200, { roomId: rooms.getUserRoom(mn) });
    return;
  }
  if (pathname === '/api/room/dissolve' && req.method === 'POST') {
    readBody(req, function (body) {
      var n = roomName(body); if (!n) return;
      var rr = rooms.dissolveRoom(n, body.roomId);
      if (rr.error) json(res, 400, rr); else json(res, 200, rr);
    });
    return;
  }

  json(res, 404, { error: 'unknown api' });
}

function handleStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  var filePath = path.normalize(path.join(config.PUBLIC, pathname));
  // 路径穿越防护：必须严格位于 public 目录内（用分隔符做边界判断，避免前缀误判）
  if (filePath !== config.PUBLIC && filePath.indexOf(config.PUBLIC + path.sep) !== 0) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': makeMime(filePath), 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function createServer() {
  return http.createServer(function (req, res) {
    var pathname = decodeURIComponent(url.parse(req.url).pathname);
    if (pathname.indexOf('/api/') === 0) { handleApi(req, res, pathname); return; }
    handleStatic(req, res, pathname);
  });
}

module.exports = { createServer: createServer, handleApi: handleApi, handleStatic: handleStatic };