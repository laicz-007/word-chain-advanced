/* 单词接龙（服务端入口）
 * Copyright (c) 2026 Word Chain contributors — MIT License（见 LICENSE）
 * 组装 src/ 下各模块，启动 HTTP 服务，并导出内部对象供测试/复用。
 * 模块划分：config(配置) / db(词库) / auth(账号) / userdata(账户数据+画像)
 *           usage(防疲劳) / view(快照) / gameplay(对局编排) / api(HTTP 路由)。
 */
'use strict';
var config = require('./src/config');
var db = require('./src/db');
var auth = require('./src/auth');
var userdata = require('./src/userdata');
var usage = require('./src/usage');
var view = require('./src/view');
var gameplay = require('./src/gameplay');
var rooms = require('./src/rooms');
var api = require('./src/api');

var server = api.createServer();

function start(port) { server.listen(Number(port) || config.PORT); }

if (require.main === module) {
  server.listen(config.PORT, function () {
    console.log('单词接龙(服务端) 已启动: http://localhost:' + config.PORT);
    console.log('词库词条: ' + db.wordCount + '（含知识点: ' + db.noteCount + '）');
  });
}

module.exports = {
  // 词库 / 规则引擎（测试用）
  store: db.store,
  dbVocab: db.dbVocab,
  R: db.R,
  // 对局编排
  sessions: gameplay.sessions,
  createGame: gameplay.createGame,
  doAction: gameplay.doAction,
  // 视图 / 快照
  snapshot: view.snapshot,
  // 防疲劳
  seedUsage: usage.seedUsage,
  recordUsage: usage.recordUsage,
  resetUsage: usage.resetUsage,
  globalUsage: usage.globalUsage,
  // 账号
  makeToken: auth.makeToken,
  verifyToken: auth.verifyToken,
  userAccounts: function () { return auth.users; },
  loadUserData: userdata.loadUserData,
  saveUserData: userdata.saveUserData,
  accountProfile: userdata.accountProfile,
  // 联机房间
  rooms: rooms,
  // 服务
  server: server,
  start: start,
  // 配置（复用）
  config: config
};