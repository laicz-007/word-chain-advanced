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
  // 新增字段一律给默认值 → 老账户文件（只有 usage/seen/best/games）可直接升级
  var d = { usage: Object.create(null), seen: [], best: 0, games: [], points: 0, items: Object.create(null), updatedAt: Date.now() };
  try { var raw = JSON.parse(fs.readFileSync(userFile(name), 'utf8')); Object.assign(d, raw); } catch (e) {}
  if (!d.usage || typeof d.usage !== 'object') d.usage = Object.create(null);
  d.usage = Object.assign(Object.create(null), d.usage);   // usage 按词为键，空原型
  if (!Array.isArray(d.seen)) d.seen = [];
  if (!Array.isArray(d.games)) d.games = [];
  if (typeof d.best !== 'number') d.best = 0;
  // 积分：非负整数
  var p = Math.floor(Number(d.points));
  d.points = (isFinite(p) && p > 0) ? p : 0;
  // 道具库存：{ skip: 2, swap: 1 }；数量必须是 >=0 的整数，非法项直接丢弃
  if (!d.items || typeof d.items !== 'object') d.items = Object.create(null);
  var clean = Object.create(null);
  Object.keys(d.items).forEach(function (k) {
    var v = Math.floor(Number(d.items[k]));
    if (isFinite(v) && v > 0) clean[k] = v;
  });
  d.items = clean;
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

/* ---- 积分与道具库存 ---- */

// 增减积分（结果不低于 0），返回结算后的积分
function addPoints(name, n) {
  var d = loadUserData(name);
  var v = (d.points || 0) + Math.round(Number(n) || 0);
  d.points = v > 0 ? v : 0;
  saveUserData(name);
  return d.points;
}

// 增减道具，返回该道具结算后的数量
function addItem(name, kind, n) {
  var d = loadUserData(name);
  var v = (d.items[kind] || 0) + Math.floor(Number(n) || 0);
  if (v > 0) d.items[kind] = v; else delete d.items[kind];
  saveUserData(name);
  return d.items[kind] || 0;
}

// 尝试扣除积分：足够则扣掉并返回 true，不足返回 false（不产生任何改动）
function spendPoints(name, cost) {
  var d = loadUserData(name);
  var c = Math.max(0, Math.round(Number(cost) || 0));
  if ((d.points || 0) < c) return false;
  d.points -= c;
  saveUserData(name);
  return true;
}

module.exports = {
  loadUserData: loadUserData,
  saveUserData: saveUserData,
  addRecord: addRecord,
  accountProfile: accountProfile,
  addPoints: addPoints,
  addItem: addItem,
  spendPoints: spendPoints
};