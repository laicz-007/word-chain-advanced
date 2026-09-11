/* src/db.js — 加载词库文件，构建规则引擎 WordStore
 *
 * 词库有两份，按优先级自动选择（不需要手动配置）：
 *   1) data/db.json       全量词库（约 28 万词），由 `npm run build` 生成，需要 Python 3
 *   2) data/db.lite.json  轻量词库（约 3.7 万词），随项目一起提供，克隆下来就能直接运行
 *
 * 只有两份都找不到时才报错，并在错误信息里给出修复命令（而不是抛裸的 ENOENT）。
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
    return { vocab: readJson(config.DB_PATH), path: config.DB_PATH, full: true };
  }
  if (fs.existsSync(config.LITE_DB_PATH)) {
    return { vocab: readJson(config.LITE_DB_PATH), path: config.LITE_DB_PATH, full: false };
  }
  throw new Error(
    '找不到词库文件，游戏无法启动。已查找以下位置：\n' +
    '  ' + config.DB_PATH + '\n' +
    '  ' + config.LITE_DB_PATH + '\n' +
    '正常情况下轻量词库 data/db.lite.json 会随项目一起提供，请确认它没有被删除。\n' +
    '若确实缺失，可以生成全量词库（需要先安装 Python 3）：\n' +
    '  npm run build'
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
  dbPath: loaded.path,  // 实际加载的词库文件路径
  isFullDb: loaded.full // true=全量词库(db.json) / false=轻量词库(db.lite.json)
};
