/* src/db.js — 加载词库文件，构建规则引擎 WordStore
 *
 * 只加载一份词库：data/db.json（成品），由 `npm run build` 生成（需要 Python 3）。
 *   克隆仓库后**必须先跑一次** npm run build —— 项目不再附带轻量词库。
 *   （2026-09 之前附带 data/db.lite.json，但它没有生成脚本、会静默过期，已废弃。）
 *
 * 找不到时给出可照做的中文提示，而不是抛裸的 ENOENT。
 */
'use strict';
var fs = require('fs');
var config = require('./config');
var R = require('../public/logic.js');

// 读 JSON，把"文件不存在/损坏"翻译成看得懂的中文提示
function readJson(filePath) {
  var raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error('无法读取词库文件：' + filePath + '\n  原因：' + e.message);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      '词库文件不是合法的 JSON（可能生成中断或下载不完整）：\n' +
      '  ' + filePath + '\n' +
      '  原因：' + e.message + '\n' +
      '  修复：删掉这个文件后重新运行 npm run build'
    );
  }
}

function loadVocab() {
  if (fs.existsSync(config.DB_PATH)) {
    return { vocab: readJson(config.DB_PATH), path: config.DB_PATH };
  }
  throw new Error(
    '找不到词库文件，游戏无法启动：\n' +
    '  ' + config.DB_PATH + '\n' +
    '\n' +
    '词库需要用构建脚本生成一次（约 3~5 分钟，需要 Python 3 与 Node.js）：\n' +
    '  npm run build\n' +
    '\n' +
    '说明：项目从 2026-09 起不再随仓库附带轻量词库 db.lite.json ——\n' +
    '那个文件没有生成脚本、会静默过期（详见 README「词库是怎么用的？」）。\n' +
    '若 npm run build 跑到一半失败，请先看它的报错；缺源数据时它会提示怎么补齐。'
  );
}

var loaded = loadVocab();
var dbVocab = loaded.vocab;
var store = new R.WordStore(dbVocab);

module.exports = {
  R: R,                 // 规则/AI 引擎（logic.js UMD）
  store: store,         // WordStore 实例（查词/候选/开局）
  dbVocab: dbVocab,     // 原始词条数组
  wordCount: dbVocab.length,
  noteCount: dbVocab.filter(function (e) { return e.has_note; }).length,
  dbPath: loaded.path   // 实际加载的词库文件路径
};
