/* src/db.js — 加载统一词库 data/db.json，构建规则引擎 WordStore */
'use strict';
var fs = require('fs');
var config = require('./config');
var R = require('../public/logic.js');

var dbVocab = JSON.parse(fs.readFileSync(config.DB_PATH, 'utf8'));
var store = new R.WordStore(dbVocab);

module.exports = {
  R: R,                 // 规则/AI 引擎（logic.js UMD）
  store: store,         // WordStore 实例（查词/候选/开局）
  dbVocab: dbVocab,     // 原始词条数组
  wordCount: dbVocab.length,
  noteCount: dbVocab.filter(function (e) { return e.has_note; }).length
};