/* src/usage.js — 常态防疲劳（跨会话持久化）：游客=全局；登录=按账户 */
'use strict';
var fs = require('fs');
var config = require('./config');
var userdata = require('./userdata');

var globalUsage = Object.create(null);
try { globalUsage = Object.assign(Object.create(null), JSON.parse(fs.readFileSync(config.USAGE_FILE, 'utf8'))); } catch (e) { globalUsage = Object.create(null); }
function persistUsage() { try { fs.writeFileSync(config.USAGE_FILE, JSON.stringify(globalUsage), 'utf8'); } catch (e) {} }

// 开局时继承历史使用：登录用户 -> 账户数据；游客 -> 全局游客使用
function seedUsage(game) {
  if (game.user) game.allUsed = Object.assign(Object.create(null), userdata.loadUserData(game.user).usage);
  else game.allUsed = Object.assign(Object.create(null), globalUsage);
}

// 把 fromIdx 之后新用的词计入持久化使用（本地同屏"统计我的出词"时只计指定玩家）
function recordUsage(game, fromIdx) {
  var target = game.user ? userdata.loadUserData(game.user).usage : globalUsage;
  var mine = (game.myPlayerIdx == null) ? null : game.myPlayerIdx;
  for (var i = fromIdx || 0; i < game.log.length; i++) {
    var e = game.log[i];
    if (e.kind === 'start' || e.kind === 'chain') {
      if (mine != null && e.playerIdx !== mine) continue;
      target[e.word] = (target[e.word] || 0) + 1;
    }
  }
  if (game.user) userdata.saveUserData(game.user); else persistUsage();
}

// 重置防疲劳：username 传入则重置该账户，否则重置全局游客
function resetUsage(username) {
  if (username) { var d = userdata.loadUserData(username); d.usage = Object.create(null); userdata.saveUserData(username); }
  else { globalUsage = Object.create(null); persistUsage(); }
}

module.exports = {
  seedUsage: seedUsage,
  recordUsage: recordUsage,
  resetUsage: resetUsage,
  globalUsage: function () { return globalUsage; }
};