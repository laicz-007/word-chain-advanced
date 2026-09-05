/* src/userdata.js — 按账户数据（usage 防疲劳 / seen 生词 / best 最高纪录 / games 对局记录）+ 账户画像 */
'use strict';
var fs = require('fs');
var path = require('path');
var config = require('./config');
var db = require('./db');

var userStore = Object.create(null); // username -> 账户数据（空原型）

function userFile(name) { return path.join(config.SYNC_DIR, name + '.json'); }

function loadUserData(name) {
  if (userStore[name]) return userStore[name];
  var d = { usage: Object.create(null), seen: [], best: 0, games: [], updatedAt: Date.now() };
  try { var raw = JSON.parse(fs.readFileSync(userFile(name), 'utf8')); Object.assign(d, raw); } catch (e) {}
  if (!d.usage || typeof d.usage !== 'object') d.usage = Object.create(null);
  d.usage = Object.assign(Object.create(null), d.usage);   // usage 按词为键，空原型
  if (!Array.isArray(d.seen)) d.seen = [];
  if (!Array.isArray(d.games)) d.games = [];
  if (typeof d.best !== 'number') d.best = 0;
  userStore[name] = d;
  return d;
}

function saveUserData(name) {
  var d = userStore[name]; if (!d) return;
  d.updatedAt = Date.now();
  try { fs.mkdirSync(config.SYNC_DIR, { recursive: true }); fs.writeFileSync(userFile(name), JSON.stringify(d), 'utf8'); } catch (e) {}
}

// 存一条对局记录：追加 games、更新 best / seen
function addRecord(name, rec) {
  var d = loadUserData(name);
  rec.at = rec.at || Date.now();
  d.games.unshift(rec);
  if (rec.stats && rec.stats.bestChain && rec.stats.bestChain > d.best) d.best = rec.stats.bestChain;
  var seenSet = {};
  d.seen.forEach(function (w) { seenSet[w] = 1; });
  (rec.words || []).forEach(function (w) { if (w && w.word) seenSet[w.word] = 1; });
  d.seen = Object.keys(seenSet);
  saveUserData(name);
  return d;
}

// 账户学习画像（完整，供 AI 难度贴合 + 教学导向）
function accountProfile(name) {
  var d = loadUserData(name);
  return db.R.computeUserProfile(db.store, { games: d.games, usage: d.usage, seen: d.seen, best: d.best });
}

module.exports = { loadUserData: loadUserData, saveUserData: saveUserData, addRecord: addRecord, accountProfile: accountProfile };